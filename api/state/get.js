// api/state/get.js
import { Redis } from '@upstash/redis'
import { ethers } from 'ethers'

// ---- Contract ABIs ----
const GAME_ABI = [
  'function getGameStatus(uint256) view returns (uint8)',
  'function getPlayers(uint256) view returns (address[])',
  'function getGameMeta(uint256) view returns (address creator, bytes32 inviteCodeHash, uint8 maxPlayers, bool usePrize, uint64 createdAt, uint64 expiryTs, uint256 prizeAmount, uint256 feeSnapshot, bool started, bool finished, bool cancelled)',
]

const CARDS_ABI = [
  'function promptCount() view returns (uint256)',
  'function answerCount() view returns (uint256)',
  'function pagePrompts(uint256 startId, uint256 maxItems, bool onlyActive) view returns (uint256[] ids, string[] texts, uint32[] imageRefs, bool[] actives)',
  'function pageAnswers(uint256 startId, uint256 maxItems, bool onlyActive) view returns (uint256[] ids, string[] texts, uint32[] imageRefs, bool[] actives)',
]

// ---- Timers (env, seconds) ----
const PRESTART = Number(process.env.ROUND_PRESTART_SECS || '10')
const SUBMIT   = Number(process.env.ROUND_SUBMIT_SECS   || '45')
const JUDGE    = Number(process.env.ROUND_JUDGE_SECS    || '30')
const SUMMARY  = Number(process.env.ROUND_SUMMARY_SECS  || '6') // recommend 6
const ROUNDS_TOTAL = 10

// ---- Redis ----
function makeRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  if (process.env.REDIS_URL && process.env.REDIS_TOKEN) {
    const url = process.env.REDIS_URL.replace(/^rediss:\/\//, 'https://')
    return new Redis({ url, token: process.env.REDIS_TOKEN })
  }
  throw new Error('Missing Upstash envs')
}
const redis = makeRedis()
const KEY = (addr, gid) => `cah:${addr}:${gid}:state`
const nowMs = () => Date.now()

// ---- Deterministic RNG / shuffle ----
function rngFromSeed(seedHex) {
  let h = String(seedHex || '').replace(/^0x/i, '')
  if (h.length < 32) h = h.padStart(32, '0')
  let x = BigInt('0x' + h.slice(0, 32))
  return () => {
    x ^= x << 13n; x ^= x >> 7n; x ^= x << 17n
    // 32-bit
    const val = Number((x & 0xffffffffffffffffn) % 0x1_0000_0000n)
    return val >>> 0
  }
}
function pick(rand, n) { return n ? rand() % n : 0 }
function shuffleDet(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = pick(rand, i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ---- Helpers ----
const judgeAt = (players, round) => (players.length ? players[(round - 1) % players.length] : null)
function ensureScores(state, players) {
  state.scores ||= {}
  for (const p of players) if (state.scores[p] == null) state.scores[p] = 0
}
function missingSubmitters(players, judge, submissions) {
  const out = []
  for (const p of players) {
    if (p === judge) continue
    if (!(p in (submissions || {}))) out.push(p)
  }
  return out
}
function drawOne(state, addr) {
  // Draw from deck avoiding cards the player has seen
  const seen = new Set(state.seenAnswers[addr] || [])
  const deck = state.answersDeck
  let tries = 0
  while (tries < deck.length) {
    const idx = state.drawPtr % deck.length
    state.drawPtr++
    const card = deck[idx]
    if (!seen.has(card)) return card
    tries++
  }
  // Fallback: accept repeats if deck exhausted
  const card = deck[state.drawPtr % deck.length]
  state.drawPtr++
  return card
}
function dealInitialHands(state) {
  state.hands = {}
  state.seenAnswers = {}
  for (const p of state.players) {
    state.hands[p] = []
    state.seenAnswers[p] = []
    for (let k = 0; k < 7; k++) {
      const c = drawOne(state, p)
      state.hands[p].push(c)
      state.seenAnswers[p].push(c)
    }
  }
}
function afterRoundDrawUp(state) {
  // For each non-judge who submitted, remove used card and draw one new
  const subs = state.submissions || {}
  for (const p of state.players) {
    if (p === state.judge) continue
    const used = subs[p]
    if (!used) continue
    const hand = state.hands[p] || []
    const idx = hand.indexOf(used)
    if (idx >= 0) hand.splice(idx, 1)
    const newCard = drawOne(state, p)
    hand.push(newCard)
    state.seenAnswers[p].push(newCard)
    state.hands[p] = hand
  }
}

function applyRoundWin(state, winnerAddr) {
  const now = nowMs()
  const winningAnswerId = state.submissions?.[winnerAddr] || 0
  state.scores[winnerAddr] = (state.scores[winnerAddr] || 0) + 1
  state.last = { round: state.round, winner: winnerAddr, winningAnswerId, at: now }
  // Draw-up immediately at end of round
  afterRoundDrawUp(state)
  state.phase = 'summary'
  state.summaryUntil = now + SUMMARY * 1000
}

function beginNextOrEnd(state) {
  if (state.round >= state.roundsTotal) {
    state.phase = 'ended'
  } else {
    state.round += 1
    state.judge = judgeAt(state.players, state.round)
    // advance prompt
    const idx = (state.round - 1) % state.promptOrder.length
    state.promptId = state.promptOrder[idx]
    state.phase = 'submit'
    state.submissions = {}
    state.submitDeadline = nowMs() + SUBMIT * 1000
  }
}

function hash32(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i)
  return h | 0
}

async function loadActiveIds(contract, countFn, pageFn) {
  const total = Number(await contract[countFn]())
  if (!total) return []
  const ids = []
  let start = 1
  while (start <= total) {
    const res = await contract[pageFn](start, 200, true)
    const pageIds = (res?.[0] || []).map((x) => Number(x))
    for (const id of pageIds) ids.push(id)
    start += 200
    if (ids.length > 4000) break
  }
  return ids
}

function tickState(state) {
  if (!state) return [state, false]
  const now = nowMs()
  let changed = false

  if (state.phase === 'prestart') {
    if (now >= (state.prestartUntil || 0)) {
      state.phase = 'submit'
      state.submitDeadline = now + SUBMIT * 1000
      state.submissions = {}
      changed = true
    }
  } else if (state.phase === 'submit') {
    const miss = missingSubmitters(state.players, state.judge, state.submissions)
    if (miss.length === 0 || now >= (state.submitDeadline || 0)) {
      // Auto-submit missing at deadline, pick *from each player's hand*
      if (miss.length > 0 && now >= (state.submitDeadline || 0)) {
        for (const m of miss) {
          const hand = state.hands[m] || []
          if (hand.length) {
            const i = Math.abs(hash32(`${state.seed}:${state.round}:${m}:auto`)) % hand.length
            state.submissions[m] = hand[i]
          }
        }
      }
      state.phase = 'judge'
      state.judgeDeadline = now + JUDGE * 1000
      changed = true
    }
  } else if (state.phase === 'judge') {
    if (now >= (state.judgeDeadline || 0)) {
      const entries = Object.entries(state.submissions || {})
      if (entries.length > 0) {
        const i = Math.abs(hash32(`${state.seed}:${state.round}:auto-judge`)) % entries.length
        const [winner] = entries[i]
        applyRoundWin(state, winner)
        changed = true
      } else {
        // nobody submitted; just advance
        state.last = { round: state.round, winner: null, winningAnswerId: 0, at: now }
        state.phase = 'summary'
        state.summaryUntil = now + SUMMARY * 1000
        changed = true
      }
    }
  } else if (state.phase === 'summary') {
    if (now >= (state.summaryUntil || 0)) {
      beginNextOrEnd(state)
      changed = true
    }
  }
  return [state, changed]
}

export default async function handler(req, res) {
  try {
    const gameId = Number(req.query.gameId || 0)
    const me = String(req.query.me || '').toLowerCase()
    if (!gameId) return res.status(400).json({ error: 'bad gameId' })

    const addr = process.env.GAME_ADDRESS
    const rpc  = process.env.RPC_URL
    const cardsAddr = process.env.CARDS_ADDRESS || process.env.VITE_CARDS_ADDRESS
    if (!addr || !rpc || !cardsAddr) return res.status(500).json({ error: 'missing env (GAME_ADDRESS/RPC_URL/CARDS_ADDRESS)' })

    const provider = new ethers.JsonRpcProvider(rpc)
    const game = new ethers.Contract(addr, GAME_ABI, provider)
    const cards = new ethers.Contract(cardsAddr, CARDS_ABI, provider)

    const [statusBN, playersArr] = await Promise.all([
      game.getGameStatus(gameId),
      game.getPlayers(gameId),
    ])
    const status  = Number(statusBN) // 1=Lobby 2=Started 3=Finished 4=Cancelled
    const players = (playersArr || []).map(s => String(s).toLowerCase())

    let state = await redis.get(KEY(addr, gameId))

    // Initialize when Started && no state yet
    if (!state && status === 2 && players.length > 0) {
      // Load active prompt/answer IDs
      const [activePrompts, activeAnswers] = await Promise.all([
        loadActiveIds(cards, 'promptCount', 'pagePrompts'),
        loadActiveIds(cards, 'answerCount', 'pageAnswers'),
      ])
      if (!activePrompts.length || !activeAnswers.length) {
        return res.status(500).json({ error: 'no active prompts/answers in Cards' })
      }

      // Build prompt order & answer deck deterministically
      const seed = ethers.id(`${addr}:${gameId}`)
      const rand = rngFromSeed(seed)
      const promptOrder = shuffleDet(activePrompts.slice(), rand)
      // Needed answers: initial 7 each + rounds*(players-1)
      const needed = players.length * 7 + ROUNDS_TOTAL * Math.max(0, players.length - 1)
      // Grow the pool if too small, then shuffle
      const copies = Math.ceil(needed / activeAnswers.length)
      let deckPool = []
      for (let i = 0; i < copies; i++) deckPool = deckPool.concat(activeAnswers)
      const answersDeck = shuffleDet(deckPool, rand)

      state = {
        v: 3,
        seed,
        players,
        // rounds
        round: 1,
        roundsTotal: ROUNDS_TOTAL,
        judge: judgeAt(players, 1),
        promptOrder,
        promptId: promptOrder[0],
        // timing
        phase: 'prestart',
        prestartUntil: nowMs() + PRESTART * 1000,
        // deck & hands
        answersDeck,
        drawPtr: 0,
        hands: {},          // addr -> number[]
        seenAnswers: {},    // addr -> number[]
        // gameplay
        submissions: {},    // addr -> answerId
        scores: Object.fromEntries(players.map(p => [p, 0])),
        last: null,
        startedAt: nowMs(),
      }
      // Deal initial hands
      dealInitialHands(state)
      await redis.set(KEY(addr, gameId), state, { ex: 60 * 60 * 24 })
    }

    if (state) {
      // Sync players & scores
      state.players = players
      ensureScores(state, players)

      // One tick
      const [next, changed] = tickState(state)
      state = next
      if (changed) {
        await redis.set(KEY(addr, gameId), state, { ex: 60 * 60 * 24 })
      } else {
        await redis.expire(KEY(addr, gameId), 60 * 60 * 24)
      }
    }

    // Privacy: only return *my* hand (if provided)
    let hand = undefined
    if (me && state?.hands?.[me]) hand = state.hands[me]

    return res.status(200).json({
      ok: true,
      status,
      players,
      state: state ? {
        // public shape
        v: state.v,
        seed: state.seed,
        players: state.players,
        round: state.round,
        roundsTotal: state.roundsTotal,
        judge: state.judge,
        promptId: state.promptId,
        phase: state.phase,
        submitDeadline: state.submitDeadline,
        judgeDeadline: state.judgeDeadline,
        summaryUntil: state.summaryUntil,
        submissions: state.submissions, // mapping addr->answerId (judge view stays anonymous in UI)
        scores: state.scores,
        last: state.last,
      } : null,
      hand, // my 7-card hand (array of answerIds)
      address: addr,
      now: nowMs(),
      timers: { PRESTART, SUBMIT, JUDGE, SUMMARY }
    })
  } catch (e) {
    console.error('[state/get] err:', e)
    return res.status(500).json({ error: e?.message || 'failed' })
  }
}
