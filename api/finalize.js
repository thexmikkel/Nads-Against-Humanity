// api/finalize.js 
// Ethers v6 + optional Upstash Redis for embedded -> identity mapping
import { ethers } from 'ethers'
import { Redis } from '@upstash/redis'
import abi from '../src/abi/abiGame.js'

const RPC_URL    = process.env.RPC_URL || process.env.MONAD_RPC_URL || process.env.ANVIL_RPC_URL
const GAME_ADDR  = process.env.GAME_ADDRESS || process.env.NEXT_PUBLIC_GAME_ADDRESS || process.env.VITE_GAME_ADDR
const RELAYER_PK = process.env.RELAYER_PK || process.env.PRIVATE_KEY
const API_KEY    = process.env.API_KEY || process.env.VERCEL_API_KEY || process.env.FINALIZE_API_KEY

// Toggle: push identity (Monad Games ID) addresses to Leaderboard instead of embedded
const USE_IDENTITY_FOR_LB = process.env.USE_IDENTITY_FOR_LB === '1'
const MAP_NS = 'cah:addrmap:' // stored as lowercased embedded -> checksummed identity

function bad(res, msg, code = 400, extra = {}) {
  return res.status(code).json({ ok: false, error: msg, ...extra })
}

async function readJSON(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const text = await new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
  return text ? JSON.parse(text) : {}
}

function normalize(payload) {
  let { players, scores } = payload
  // support { scores: { "0x..": 3, ... } }
  if (scores && !Array.isArray(scores) && typeof scores === 'object') {
    const keys = Object.keys(scores)
    if (!players || !players.length) players = keys
    scores = players.map((p) => Number(scores[p] ?? 0))
  }
  players = Array.isArray(players) ? players : []
  scores  = Array.isArray(scores)  ? scores  : []
  players = players.map((p) => ethers.getAddress(p))
  scores  = scores.map((n) => Number(n || 0))
  return { players, scores }
}

function computeWinners(players, scores) {
  let top = 0
  for (const s of scores) if (s > top) top = s
  return players.filter((_, i) => scores[i] === top)
}

function hashFinal(players, scores) {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const encP  = coder.encode(['address[]'], [players])
  const encS  = coder.encode(['uint32[]'], [scores.map((n) => Number(n))])
  return ethers.keccak256(ethers.concat([encP, encS]))
}
function makeRequestId(chainId, gameAddr, gameId, players, scores) {
  const coder  = ethers.AbiCoder.defaultAbiCoder()
  const finalH = hashFinal(players, scores)
  return ethers.keccak256(
    coder.encode(['uint256','address','uint256','bytes32'],
                 [BigInt(chainId), gameAddr, BigInt(gameId), finalH])
  )
}

// --- Upstash helpers (for embedded -> identity mapping) ---
function makeRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REST_TOKEN) {
    // Note: some setups expose different env names; keep the original from your code too:
    return Redis.fromEnv()
  }
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  if (process.env.REDIS_URL && process.env.REDIS_TOKEN) {
    const url = process.env.REDIS_URL.replace(/^rediss:\/\//, 'https://')
    return new Redis({ url, token: process.env.REDIS_TOKEN })
  }
  throw new Error('Missing Upstash envs for addrmap (UPSTASH_REDIS_REST_URL/TOKEN or REDIS_URL/TOKEN)')
}

async function mapPlayersToIdentity(redis, players) {
  const keys = players.map((p) => MAP_NS + String(p).toLowerCase())
  const vals = await redis.mget(...keys)
  return players.map((p, i) => {
    const m = vals?.[i]
    try { return (m && ethers.isAddress(m)) ? ethers.getAddress(m) : ethers.getAddress(p) }
    catch { return ethers.getAddress(p) }
  })
}

export default async function handler(req, res) {
  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
    return res.status(204).end()
  }
  res.setHeader('Access-Control-Allow-Origin', '*')

  // API key (optional)
  if (API_KEY) {
    const got = req.headers['x-api-key']
    if (got !== API_KEY) return bad(res, 'Unauthorized', 401)
  }
  if (req.method !== 'POST') return bad(res, 'Method not allowed', 405)

  if (!RPC_URL || !GAME_ADDR || !RELAYER_PK) {
    return bad(res, 'Server missing RPC_URL / GAME_ADDRESS / RELAYER_PK', 500)
  }

  const body   = await readJSON(req)
  const gameId = Number(body.gameId || body.id || 0)
  if (!Number.isFinite(gameId) || gameId <= 0) return bad(res, 'Missing/invalid gameId')

  const { players: reqPlayers, scores: reqScores } = normalize(body)
  if (!reqPlayers.length || reqPlayers.length !== reqScores.length) {
    return bad(res, 'Bad payload: players/scores length mismatch', 400, { players: reqPlayers, scores: reqScores })
  }

  const provider  = new ethers.JsonRpcProvider(RPC_URL)
  const wallet    = new ethers.Wallet(RELAYER_PK, provider)
  const relayer   = await wallet.getAddress()
  const game      = new ethers.Contract(GAME_ADDR, abi, wallet)
  const net       = await provider.getNetwork()

  // --- ABI presence (tolerant)
  const hasFinalizeByDelegate = typeof game.finalizeByDelegate === 'function'
  const hasExternalPush       = typeof game.externalPushScores === 'function'
  if (!hasExternalPush) {
    return bad(res, 'ABI missing externalPushScores. Update abiGame.js to match the deployed contract.', 500)
  }

  // --- Canonical players from chain (authoritative order)
  let chainPlayers = []
  try {
    chainPlayers = (await game.getPlayers(gameId)).map(ethers.getAddress)
  } catch (e) {
    return bad(res, 'Could not read getPlayers', 500, { detail: e.shortMessage || e.message })
  }
  if (!chainPlayers.length) return bad(res, 'Game has no players on-chain?')

  // Build canonical scores array in chainPlayers order
  const scoreMap = new Map(reqPlayers.map((p, i) => [ethers.getAddress(p), Number(reqScores[i])]))
  const players  = chainPlayers
  const scores   = players.map((p) => Number(scoreMap.get(p) || 0))

  // Must have at least one winner
  const winners = computeWinners(players, scores)
  if (!winners.length) return bad(res, 'No winners computed')

  // --- 0) Status snapshot
  let statusCode = Number(await game.getGameStatus(gameId).catch(() => 0))
  // 0=None, 1=Lobby, 2=Started, 3=Finished, 4=Cancelled

  // --- 1) finalize on-chain state by delegate IF supported
  let finalized = false
  if (hasFinalizeByDelegate) {
    // Preflight: check delegates for each player (only needed if we’ll call finalizeByDelegate)
    const now = Math.floor(Date.now() / 1000)
    const missing = []
    for (const p of players) {
      const del = await game.delegate(gameId, p).catch(() => ethers.ZeroAddress)
      const exp = Number(await game.delegateExpiry(gameId, p).catch(() => 0n))
      const ok  = (String(del).toLowerCase() === String(relayer).toLowerCase()) && (exp === 0 || exp >= now)
      if (!ok) missing.push({ player: p, delegate: del, expiry: exp })
    }
    if (missing.length) {
      return bad(res, 'Missing delegate approvals for some players', 400, { missingDelegates: missing, relayer })
    }

    // Nonce for finalize
    const nonce = await game.finalizeNonce(gameId).catch(() => 0n)

    try {
      const payload = {
        gameId: BigInt(gameId),
        players,
        scores: scores.map((n) => BigInt(n)),
        winners,
        roundCount: BigInt(body.roundCount ?? 10),
        nonce,
        deadline: 0n,
        roundsHash: ethers.ZeroHash,
      }
      const tx = await game.finalizeByDelegate(payload)
      await tx.wait()
      finalized = true
      statusCode = 3 // Finished
    } catch (e) {
      // If already finished, keep going; otherwise surface reason
      statusCode = Number(await game.getGameStatus(gameId).catch(() => 0))
      if (statusCode !== 3) {
        return bad(res, 'finalizeByDelegate failed', 500, { reason: e.shortMessage || e.reason || e.message })
      }
    }
  } else {
    // No finalizeByDelegate in ABI: we can only proceed if already finished
    if (statusCode !== 3) {
      return bad(res, 'Game not finished and finalizeByDelegate is unavailable. Finalize via your multi-sig flow or add finalizeByDelegate.', 400, { statusCode })
    }
  }

  // --- 2) external push to Leaderboard (role or globalRelayer)
  // (We no longer require SUBMITTER_ROLE strictly; contract also accepts current globalRelayer)
  let pushAuth = 'unknown'
  const SUBMITTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SUBMITTER_ROLE'))
  try {
    const hasRole = await game.hasRole?.(SUBMITTER_ROLE, relayer).catch(() => null)
    const glr = await game.globalRelayer?.().catch(() => ethers.ZeroAddress)
    const isGlr = String(glr || '').toLowerCase() === String(relayer).toLowerCase()
    pushAuth = hasRole ? 'SUBMITTER_ROLE' : (isGlr ? 'globalRelayer' : 'none')
    if (pushAuth === 'none') {
      // We'll try anyway; if contract rejects, the catch below returns a soft success with a warning.
    }
  } catch {}

  // Map to identity addresses just for the LB preview (contract already maps internally via identityOf)
  let lbPlayers = players
  let mappedPairs = []
  if (USE_IDENTITY_FOR_LB) {
    try {
      const redis = makeRedis()
      lbPlayers = await mapPlayersToIdentity(redis, players)
      mappedPairs = players.map((p, i) => ({ embedded: p, identity: lbPlayers[i] }))
    } catch {
      lbPlayers = players
    }
  }

  let pushed = false
  try {
    const reqId = makeRequestId(Number(net.chainId), await game.getAddress(), gameId, players, scores)
    const tx2   = await game.externalPushScores(gameId, players, scores, reqId)
    await tx2.wait()
    pushed = true
  } catch (e) {
    // Return soft success so UI can decide to retry; include mapping + auth info for debugging
    return res.status(200).json({
      ok: true,
      finalized,
      pushed,
      usedIdentityForLB: USE_IDENTITY_FOR_LB,
      playersPushed: lbPlayers,
      mapPreview: mappedPairs.slice(0, players.length),
      pushAuth,
      warning: e.shortMessage || e.reason || e.message || 'externalPushScores failed (likely not authorized or consent missing)',
    })
  }

  return res.status(200).json({
    ok: true,
    finalized,
    pushed,
    usedIdentityForLB: USE_IDENTITY_FOR_LB,
    playersPushed: lbPlayers,
    mapPreview: mappedPairs.slice(0, players.length),
    pushAuth,
  })
}
