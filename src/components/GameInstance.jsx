// src/components/GameInstance.jsx
import React from 'react'
import { ethers } from 'ethers'
import { toast } from '../lib/toast.jsx'
// Fetch usernames
import { useUsernamesMulti } from '../hooks/useUsernamesMulti.js'

const API_GET = (gid, me) => `/api/state/get?gameId=${gid}${me ? `&me=${me}` : ''}`
const API_PUT = `/api/state/put`
const API_FINALIZE = `/api/finalize`

const short = (a = '') => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—')

export default function GameInstance({ activeGame, address, getGameRead, getGame, onExitToLobby }) {
  const gid = Number(activeGame?.id || 0)
  const me = (address || '').toLowerCase()

  const [players, setPlayers] = React.useState([])
  const [creator, setCreator] = React.useState('')
  const [gamePrize, setGamePrize] = React.useState({ usePrize: false, prizeWei: 0n })
  const isCreator = creator && me === creator

  const [promptTextById, setPromptTextById] = React.useState({})
  const [answerTextById, setAnswerTextById] = React.useState({})

  const [names, setNames] = React.useState({})
  const display = React.useCallback((addr) => {
    if (!addr) return '—'
    const key = addr.toLowerCase?.() || addr
    return names[key] || short(addr)
  }, [names])
  
  const [state, setState] = React.useState(null)
  const [hand, setHand] = React.useState([])
  const phase = state?.phase || 'idle'
  const isJudge = state?.judge && me === state.judge.toLowerCase()

  const [autoState, setAutoState] = React.useState('idle')
  const [attempts, setAttempts] = React.useState(0)
  const MAX_RETRIES = 2
  const TIMEOUT_MS = 10000

  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const secsLeft = (ts) => Math.max(0, Math.floor(((ts || 0) - now) / 1000))

  // chain meta
  React.useEffect(() => {
    let off = false
    async function load() {
      if (!gid || !getGameRead) return
      try {
        const game = await getGameRead()
        const [list, meta] = await Promise.all([
          game.getPlayers(gid),
          game.getGameMeta(gid)
        ])
        if (off) return
        const ps = (list || []).map(s => s.toLowerCase())
        setPlayers(ps)
        setCreator(String(meta?.[0] || '').toLowerCase())
        setGamePrize({
          usePrize: Boolean(meta?.[3]),
          prizeWei: meta?.[6] ? BigInt(meta[6]) : 0n,
        })
      } catch {}
    }
    load()
    const iv = setInterval(load, 5000)
    return () => { off = true; clearInterval(iv) }
  }, [gid, getGameRead])

  // cards text cache
  React.useEffect(() => {
    let off = false
    ;(async () => {
      try {
        const game = await getGameRead()
        const provider = game.runner?.provider || game.provider
        const cardsAddr = import.meta.env.VITE_CARDS_ADDRESS
        const abi = [
          'function pagePrompts(uint256,uint256,bool) view returns (uint256[] ids, string[] texts, uint32[] imageRefs, bool[] actives)',
          'function pageAnswers(uint256,uint256,bool) view returns (uint256[] ids, string[] texts, uint32[] imageRefs, bool[] actives)',
          'function promptCount() view returns (uint256)',
          'function answerCount() view returns (uint256)',
        ]
        const cards = new ethers.Contract(cardsAddr, abi, provider)
        async function page(countName, pageName) {
          const total = Number(await cards[countName]())
          const map = {}
          let start = 1
          while (start <= total) {
            const res = await cards[pageName](start, 200, true)
            const ids = res[0]; const texts = res[1]
            for (let i = 0; i < ids.length; i++) map[Number(ids[i])] = texts[i]
            start += 200
            if (Object.keys(map).length > 4000) break
          }
          return map
        }
        const [pMap, aMap] = await Promise.all([page('promptCount','pagePrompts'), page('answerCount','pageAnswers')])
        if (!off) { setPromptTextById(pMap); setAnswerTextById(aMap) }
      } catch {}
    })()
    return () => { off = true }
  }, [getGameRead])

  // poll server state
  React.useEffect(() => {
    let kill = false
    async function tick() {
      try {
        const r = await fetch(API_GET(gid, me))
        const j = await r.json()
        if (!kill && j.ok) {
          setState(j.state || null)
          setHand(j.hand || [])
        }
      } catch {}
    }
    if (gid) tick()
    const iv = setInterval(tick, 1500)
    return () => { kill = true; clearInterval(iv) }
  }, [gid, me])

  // usernames
  useUsernamesMulti(players, setNames)
  
  // unify how we compute roundCount for finalize payloads
  const roundCountFromState = React.useCallback(
    () => Number(state?.roundsTotal ?? state?.round ?? 0),
    [state?.roundsTotal, state?.round]
  );
  
  // actions
  async function put(action, payload) {
    const body = { gameId: gid, from: address, action, payload }
    const r = await fetch(API_PUT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j?.error || 'state update failed')
    setState(j.state)
    return j.state
  }
  async function submitAnswer(ansId) {
    if (isJudge) return
    if (state?.phase !== 'submit') return
    if (state?.submissions?.[me] != null) return
    try { await put('submit', { answerId: Number(ansId) }) } catch (e) { toast(e.message, 'error') }
  }
  async function judgePickByAddr(winnerAddr) {
    if (!isJudge) return
    if (state?.phase !== 'judge') return
    try { await put('judge_pick', { winner: winnerAddr }) } catch (e) { toast(e.message, 'error') }
  }
  
  // finalize (creator auto) — no auto-exit
  // function buildFinalizePayload() {
  //  const arrPlayers = players.slice()
  //  const arrScores  = arrPlayers.map(p => Number(state?.scores?.[p] || 0))
  //  const top        = arrScores.length ? Math.max(...arrScores) : 0
  //  const winners    = arrPlayers.filter((_, i) => arrScores[i] === top)
  //  return {
  //    gameId: gid,
  //    players: arrPlayers,
  //    scores: arrScores,
  //    winners,
  //    roundCount: roundCountFromState(),
  //  }
  //}
  // somewhere in GameInstance
  const [missing, setMissing] = React.useState(null)
  
  async function probeDelegates() {
    try {
      const game = await getGameRead()
      const relayer = import.meta.env.VITE_RELAYER_ADDR
      const addrs = await game.getPlayers(gid)
      const out = []
      const now = Math.floor(Date.now()/1000)
      for (const p of addrs) {
        const d = await game.delegate(gid, p)
        const ex = Number(await game.delegateExpiry(gid, p))
        if (d.toLowerCase() !== relayer.toLowerCase() || (ex !== 0 && ex < now)) {
          out.push({ player: p, delegate: d, expiry: ex })
        }
      }
      setMissing(out)
    } catch {}
  }

  // call probeDelegates() when phase hits 'ended' or when relayer changes
  // build a clean FinalizePayload for /api/finalize
  async function buildFinalizePayloadClean(gid, state, getGameRead) {
    // players in the exact order the game used
    const arrPlayers = Array.isArray(state?.players) ? state.players.slice() : []
    if (!arrPlayers.length) throw new Error('no players')
  
    // scores aligned with players
    const arrScores = arrPlayers.map(p => Number(state?.scores?.[p] ?? 0))
  
    // compute winners (allow ties)
    const top = arrScores.length ? Math.max(...arrScores) : 0
    const winners = arrPlayers.filter((_, i) => arrScores[i] === top)
    if (!winners.length) throw new Error('no winners')
  
    // fresh nonce from chain
    const game = await getGameRead()
    const nonce = Number(await game.finalizeNonce(gid))
  
    // normalize address formatting to checksum (safer for API validators)
    const players = arrPlayers.map(a => ethers.getAddress(a))
    const winnersNorm = winners.map(a => ethers.getAddress(a))
  
    return {
      gameId: Number(gid),
      players,
      scores: arrScores.map(n => Number(n)),     // u32 in js
      winners: winnersNorm,
      roundCount: Number(state?.roundsTotal ?? state?.round ?? 0),
      nonce,
      deadline: Math.floor(Date.now() / 1000) + 15 * 60, // +15min
      roundsHash: '0x' + '00'.repeat(64),                // optional
    }
  }
  
  async function finalizeViaRelayer() {
  if (state?.phase !== 'ended') return toast('Match not ended', 'error')
  try {
    setAutoState('attempting')

    const payload = await buildFinalizePayloadClean(gid, state, getGameRead)

    const r = await fetch('/api/finalize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(import.meta.env.VITE_API_KEY
          ? { 'x-api-key': import.meta.env.VITE_API_KEY }
          : {}),
      },
      body: JSON.stringify(payload),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error('[finalize] bad response', j)
      throw new Error(j?.error || 'finalize failed')
    }

    toast('Relayer submitted finalize', 'success')
    setAutoState('ok')
  } catch (e) {
    console.error('[finalize] error', e)
    setAutoState('failed')
    toast(e?.message || 'Finalize failed', 'error')
  }
  }

  const promptText = state?.promptId ? (promptTextById[state.promptId] || `Prompt #${state?.promptId}`) : ''
  const subs = state?.submissions || {}
  const waiting = players
    .filter(p => p !== (state?.judge || '').toLowerCase())
    .filter(p => subs[p] == null)

  // winners + prize helpers
  function computeWinners() {
    const scores = state?.scores || {}
    const rows = players.map(p => ({ p, s: Number(scores[p] ?? 0) }))
    const max = rows.length ? Math.max(...rows.map(r => r.s)) : 0
    if (max <= 0) return []
    return rows.filter(r => r.s === max).map(r => r.p)
  }
  function fmtMon(wei) {
    try { return ethers.formatEther(wei) } catch { return '0' }
  }

  // judge anonymous cards
  function judgeCards() {
    if (!isJudge) return []
    const entries = Object.entries(subs)
    const rand = rngFromSeed(`${state?.seed || '0x'}:${state?.round || 1}:show`)
    const shuffled = entries.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = pick(rand, i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled.map(([addr, ansId], idx) => ({
      key: `${addr}:${ansId}:${idx}`,
      text: answerTextById[ansId] || `Answer #${ansId}`,
      onPick: () => judgePickByAddr(addr),
      label: `Submission ${idx + 1}`,
    }))
  }

  function rngFromSeed(seedHex) {
    let h = String(seedHex || '').replace(/^0x/i, '')
    if (h.length < 32) h = h.padStart(32, '0')
    let x = BigInt('0x' + h.slice(0, 32))
    return () => {
      x ^= x << 13n; x ^= x >> 7n; x ^= x << 17n
      const val = Number((x & 0xffffffffffffffffn) % 0x1_0000_0000n)
      return val >>> 0
    }
  }
  function pick(rand, n) { return n ? rand() % n : 0 }

  // --- finalize helpers (manual + auto kick) ---
  const [finalizeStatus, setFinalizeStatus] = React.useState('idle')
  
  async function tryFinalize(payload) {
    const r = await fetch('/api/finalize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(import.meta.env.VITE_API_KEY ? { 'x-api-key': import.meta.env.VITE_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j?.error || 'finalize failed')
    return j
  }

  // auto-kick finalize once when the match reaches "ended"
  const autoKickRef = React.useRef(false)
  React.useEffect(() => {
    if (phase === 'ended' && !autoKickRef.current) {
      autoKickRef.current = true
      ;(async () => {
        try {
          setFinalizeStatus('working')
          await finalizeViaRelayer()
          setFinalizeStatus('ok')
        } catch {
          setFinalizeStatus('error') // show manual button to retry
        }
      })()
    }
  }, [phase, gid])
  
  return (
  <div className="w-full max-w-4xl rounded-xl border border-slate-800 bg-slate-900 p-5 mt-6">
    {/* Header */}
    <div className="flex items-center justify-between mb-3">
      <div className="text-lg font-semibold">Game #{gid}</div>
      <div className="text-sm text-slate-400">
        {phase === 'prestart' && <>Preparing match… {secsLeft(state?.prestartUntil)}s</>}
        {phase === 'submit' && <>Round {state?.round} • {isJudge ? 'You are judge' : 'Submit your card'} • {secsLeft(state?.submitDeadline)}s</>}
        {phase === 'judge' && <>Round {state?.round} • Judge deciding… {secsLeft(state?.judgeDeadline)}s</>}
        {phase === 'summary' && <>Round {state?.round} summary… {secsLeft(state?.summaryUntil)}s</>}
        {phase === 'ended' && 'Match ended'}
        {isCreator && finalizeStatus === 'working' && (
          <span className="ml-2 text-xs text-slate-500">(finalizing…)</span>
        )}
      </div>
    </div>

    {/* Prompt + judge label (hide in prestart/ended) */}
    {phase !== 'prestart' && phase !== 'ended' && (
      <div className="mb-4">
        <div className="text-base font-medium">{promptText}</div>
        <div className="text-sm text-slate-400">
          Judge: <span className="font-medium">{display(state?.judge)}</span>
        </div>
      </div>
    )}

    {/* SUBMIT phase (non-judge) */}
    {phase === 'submit' && !isJudge && (
      <div className="space-y-3">
        <div className="text-sm text-slate-300">Your hand (pick one):</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {hand.map((id) => (
            <button
              key={id}
              onClick={() => submitAnswer(id)}
              disabled={subs[me] != null}
              className="p-3 rounded-lg bg-slate-800 border border-slate-700 text-left hover:bg-slate-700 disabled:opacity-50"
            >
              <div className="text-xs text-slate-400 mb-1">Answer #{id}</div>
              <div className="text-sm">{answerTextById[id] || `Answer #${id}`}</div>
            </button>
          ))}
        </div>
        {subs[me] != null && (
          <div className="mt-2 text-sm text-emerald-300">Submitted! Waiting for others…</div>
        )}
        {!!waiting.length && (
          <div className="mt-2 text-xs text-slate-400">
            Waiting: {waiting.map(display).join(', ')}
          </div>
        )}
      </div>
    )}

    {/* JUDGE phase (judge view) */}
    {phase === 'judge' && isJudge && (
      <div className="mt-4">
        <div className="text-sm text-slate-300 mb-2">Pick the winner:</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {judgeCards().map(({ key, text, onPick, label }) => (
            <button
              key={key}
              onClick={onPick}
              className="p-3 rounded-lg bg-fuchsia-900/30 border border-fuchsia-700 text-left hover:bg-fuchsia-700/30"
            >
              <div className="text-xs text-slate-400 mb-1">{label}</div>
              <div className="text-sm">{text}</div>
            </button>
          ))}
        </div>
      </div>
    )}

    {/* JUDGE phase (non-judge: show anonymized submissions) */}
    {phase === 'judge' && !isJudge && (() => {
      // unique + anonymized list of submitted answer IDs
      const uniqueIds = Array.from(new Set(Object.values(subs || {}))).filter(Boolean)
      if (!uniqueIds.length) return null
      // simple stable shuffle substitute not required; order is fine & anonymized
      return (
        <div className="mt-4">
          <div className="text-sm text-slate-400 mb-2">
            Others have submitted. Waiting for the judge…
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {uniqueIds.map(id => (
              <div
                key={id}
                className="rounded-lg border border-slate-800 bg-slate-900 p-3"
              >
                <div className="text-xs text-slate-500 mb-1">Submission</div>
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {answerTextById[id] || `Answer #${id}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    })()}

    {/* SUMMARY phase */}
    {phase === 'summary' && (
      <div className="mt-4 text-sm">
        {state?.last?.winner ? (
          <>Round {state?.round}:{' '}
            <span className="font-medium">{display(state.last.winner)}</span>
            {' '}wins — “{answerTextById[state?.last?.winningAnswerId] || `Answer #${state?.last?.winningAnswerId}`}”
          </>
        ) : (
          <>Round {state?.round}: no winner (no submissions).</>
        )}
      </div>
    )}

    {/* Scores */}
    {state?.scores && (
      <div className="mt-6">
        <div className="text-sm text-slate-300 mb-2">Scores</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left p-2">Player</th>
                <th className="text-right p-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p} className="border-t border-slate-800">
                  <td className="p-2">
                    {display(p)}{p === me ? ' (you)' : ''}
                  </td>
                  <td className="p-2 text-right">{state.scores[p] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {/* ENDED phase */}
    {phase === 'ended' && (
      <div className="mt-6">
        {(() => {
          const winners = computeWinners()
          const title =
            winners.length === 0
              ? 'No winner this time'
              : winners.length === 1
              ? `⭐ ${display(winners[0])} is the winner ⭐`
              : `⭐ ${winners.map(display).join(' & ')} are the winners ⭐`
    
          let prizeLine = null
          if (gamePrize.usePrize && gamePrize.prizeWei > 0n && winners.length > 0) {
            const each = gamePrize.prizeWei / BigInt(winners.length)
            const s = fmtMon(each)
            const n = Number.parseFloat(s)
            const eachStr = Number.isFinite(n) ? n.toFixed(4).replace(/\.?0+$/, '') : s
            prizeLine = `🎉 WON: ${eachStr} MON 🎉`
          }
    
          return (
            <div className="text-center py-4">
              <h1 className="text-2xl font-bold mb-2">{title}</h1>
              {prizeLine && <h2 className="text-lg text-emerald-300 mb-3">{prizeLine}</h2>}
              <p className="text-sm text-slate-400">The final scores are shown above.</p>
            </div>
          )
        })()}
    
        <div className="mt-4 flex items-center gap-3">
          {/* Manual retry (creator only). If you want anyone to retry, remove `isCreator &&`. */}
          {isCreator && finalizeStatus !== 'working' && (
            <button
              className="px-3 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500"
              onClick={async () => {
                try {
                  setFinalizeStatus('working')
                  await tryFinalize({ gameId: Number(gid) }) // server builds payload from Redis and pushes scores
                  setFinalizeStatus('ok')
                  toast('Finalized ✅', 'success')
                } catch (e) {
                  setFinalizeStatus('error')
                  toast(e?.message || 'Finalize failed', 'error')
                }
              }}
            >
              {finalizeStatus === 'error' ? 'Retry finalize' : 'Finalize now'}
            </button>
          )}
    
          <span className="text-sm text-slate-400">
            {finalizeStatus === 'working' && 'finalizing…'}
            {finalizeStatus === 'ok' && 'done'}
            {finalizeStatus === 'error' && 'failed — retry'}
          </span>
    
          <button
            className="ml-auto px-3 py-2 rounded bg-slate-800 border border-slate-700"
            onClick={() => onExitToLobby?.()}
          >
            Back to Lobby
          </button>
        </div>
      </div>
    )}
    </div>
  )
}
