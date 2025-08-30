// api/state/put.js
import { Redis } from '@upstash/redis'
import { ethers } from 'ethers'

const GAME_ABI = [
  'function getGameStatus(uint256) view returns (uint8)',
  'function getPlayers(uint256) view returns (address[])',
]

const PRESTART = Number(process.env.ROUND_PRESTART_SECS || '10')
const SUBMIT   = Number(process.env.ROUND_SUBMIT_SECS   || '45')
const JUDGE    = Number(process.env.ROUND_JUDGE_SECS    || '30')
const SUMMARY  = Number(process.env.ROUND_SUMMARY_SECS  || '6')
const ROUNDS_TOTAL = 10

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

function missingSubmitters(players, judge, submissions) {
  const out = []
  for (const p of players) {
    if (p === judge) continue
    if (!(p in (submissions || {}))) out.push(p)
  }
  return out
}
function ensureScores(state, players) {
  state.scores ||= {}
  for (const p of players) if (state.scores[p] == null) state.scores[p] = 0
}
function hash32(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i)
  return h | 0
}

function applyRoundWin(state, winnerAddr) {
  const now = nowMs()
  const winningAnswerId = state.submissions?.[winnerAddr] || 0
  state.scores[winnerAddr] = (state.scores[winnerAddr] || 0) + 1
  state.last = { round: state.round, winner: winnerAddr, winningAnswerId, at: now }
  // draw-up
  for (const p of state.players) {
    if (p === state.judge) continue
    const used = state.submissions?.[p]
    if (!used) continue
    const hand = state.hands[p] || []
    const idx = hand.indexOf(used)
    if (idx >= 0) hand.splice(idx, 1)
    // drawOne (avoid repeats)
    const seen = new Set(state.seenAnswers[p] || [])
    const deck = state.answersDeck
    let tries = 0
    let card = null
    while (tries < deck.length) {
      const i = state.drawPtr % deck.length
      state.drawPtr++
      const c = deck[i]
      if (!seen.has(c)) { card = c; break }
      tries++
    }
    if (card == null) { card = deck[state.drawPtr % deck.length]; state.drawPtr++ }
    hand.push(card)
    state.seenAnswers[p] = [...(state.seenAnswers[p] || []), card]
    state.hands[p] = hand
  }
  state.phase = 'summary'
  state.summaryUntil = now + SUMMARY * 1000
}

function beginNextOrEnd(state) {
  if (state.round >= state.roundsTotal) {
    state.phase = 'ended'
  } else {
    state.round += 1
    state.judge = (state.players.length ? state.players[(state.round - 1) % state.players.length] : null)
    const idx = (state.round - 1) % state.promptOrder.length
    state.promptId = state.promptOrder[idx]
    state.phase = 'submit'
    state.submissions = {}
    state.submitDeadline = nowMs() + SUBMIT * 1000
  }
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
      if (miss.length > 0 && now >= (state.submitDeadline || 0)) {
        // auto-submit from each player's hand
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  try {
    const { gameId, from, action, payload } = req.body || {}
    const gid = Number(gameId || 0)
    const sender = String(from || '').toLowerCase()
    if (!gid || !sender) return res.status(400).json({ error: 'bad args' })

    const addr = process.env.GAME_ADDRESS
    const rpc  = process.env.RPC_URL
    if (!addr || !rpc) return res.status(500).json({ error: 'missing env (GAME_ADDRESS/RPC_URL)' })

    const provider = new ethers.JsonRpcProvider(rpc)
    const game = new ethers.Contract(addr, GAME_ABI, provider)

    const [statusBN, playersArr] = await Promise.all([
      game.getGameStatus(gid),
      game.getPlayers(gid),
    ])
    const status = Number(statusBN)
    if (status !== 2) return res.status(409).json({ error: 'game not active' })

    const players = (playersArr || []).map((a) => String(a).toLowerCase())
    if (!players.includes(sender)) return res.status(403).json({ error: 'not a player' })

    let state = await redis.get(KEY(addr, gid))
    if (!state) {
      // Let GET initialize (prestart, deck, hands). For now, create minimal shell if someone posts early.
      state = {
        v: 3,
        seed: ethers.id(`${addr}:${gid}`),
        players,
        round: 1,
        roundsTotal: ROUNDS_TOTAL,
        judge: (players.length ? players[0] : null),
        promptOrder: [],
        promptId: 0,
        phase: 'prestart',
        prestartUntil: nowMs() + PRESTART * 1000,
        answersDeck: [],
        drawPtr: 0,
        hands: {},
        seenAnswers: {},
        submissions: {},
        scores: Object.fromEntries(players.map(p => [p, 0])),
        last: null,
        startedAt: nowMs(),
      }
    } else {
      state.players = players
      ensureScores(state, players)
    }

    // Tick before action
    ;[state] = tickState(state)

    const ensurePhase = (ph) => { if (state.phase !== ph) throw new Error(`phase=${state.phase}`) }

    if (action === 'submit') {
      ensurePhase('submit')
      if (sender === state.judge) return res.status(403).json({ error: 'judge cannot submit' })
      const ansId = Number(payload?.answerId || 0)
      if (!ansId) return res.status(400).json({ error: 'no answerId' })
      if (state.submissions[sender] != null) return res.status(409).json({ error: 'already submitted' })
      const hand = state.hands?.[sender] || []
      if (!hand.includes(ansId)) return res.status(400).json({ error: 'answer not in hand' })
      state.submissions[sender] = ansId
      // early advance if last needed
      const miss = missingSubmitters(state.players, state.judge, state.submissions)
      if (miss.length === 0) {
        state.phase = 'judge'
        state.judgeDeadline = nowMs() + JUDGE * 1000
      }
    }
    else if (action === 'judge_pick') {
      ensurePhase('judge')
      if (sender !== state.judge) return res.status(403).json({ error: 'only judge' })
      const winner = String(payload?.winner || '').toLowerCase()
      if (!players.includes(winner)) return res.status(400).json({ error: 'bad winner' })
      if (state.submissions[winner] == null) return res.status(400).json({ error: 'winner has no submission' })
      applyRoundWin(state, winner)
    }
    else if (action === 'nudge') {
      // no-op except ticking
    }
    else {
      return res.status(400).json({ error: 'bad action' })
    }

    // Tick after action
    ;[state] = tickState(state)

    await redis.set(KEY(addr, gid), state, { ex: 60 * 60 * 24 })
    return res.status(200).json({ ok: true, state })
  } catch (e) {
    console.error('[state/put] err:', e)
    return res.status(500).json({ error: e?.message || 'failed' })
  }
}
