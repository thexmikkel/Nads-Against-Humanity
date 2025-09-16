// src/components/GameInstance.jsx
import React from 'react'
import { ethers } from 'ethers'
import { toast } from '../lib/toast.jsx'
import { useUsernamesMulti } from '../hooks/useUsernamesMulti.js'

const API_GET = (gid, me) => `/api/state/get?gameId=${gid}${me ? `&me=${me}` : ''}`
const API_PUT = `/api/state/put`
const API_FINALIZE = `/api/finalize`

const SITE_URL = 'https://monadhumanity.xyz'
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
  // card not loading helper
  const [cardsErr, setCardsErr] = React.useState(null)
  const [reloadCardsTick, setReloadCardsTick] = React.useState(0)


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

  // Ensure current round's prompt/answers exist in cache; retry + manual reload support
  React.useEffect(() => {
    let killed = false
    ;(async () => {
      try {
        if (!gid || !getGameRead) return
        const game = await getGameRead()
        const provider = game.runner?.provider || game.provider
        const cardsAddr = import.meta.env.VITE_CARDS_ADDRESS
        const abi = [
          'function pagePrompts(uint256,uint256,bool) view returns (uint256[] ids, string[] texts, uint32[] imageRefs, bool[] actives)',
          'function pageAnswers(uint256,uint256,bool) view returns (uint256[] ids, string[] texts, uint32[] imageRefs, bool[] actives)'
        ]
        const C = new ethers.Contract(cardsAddr, abi, provider)
  
        const promptId = Number(state?.promptId || 0)
        const sub = state?.submissions || {}
        const subIds = Array.isArray(sub) ? sub : Object.values(sub || {})
        const handIds = Array.isArray(hand) ? hand : []
        const winId = Number(state?.last?.winningAnswerId || 0)
  
        const needAns = Array.from(new Set(
          [...subIds, ...handIds, winId].map(n => Number(n)).filter(Boolean)
        ))
        const needPrompt = promptId ? [promptId] : []
  
        const missingPrompt = needPrompt.filter((id) => !promptTextById[id])
        const missingAns = needAns.filter((id) => !answerTextById[id])
        if (!missingPrompt.length && !missingAns.length) { setCardsErr(null); return }
  
        setCardsErr('loading')
  
        const withRetry = async (fn, tries = 3, base = 350) => {
          let last
          for (let i = 0; i < tries; i++) {
            try { return await fn() } catch (e) { last = e }
            await new Promise(r => setTimeout(r, base * Math.pow(1.8, i)))
          }
          throw last
        }
  
        for (const id of missingPrompt) {
          if (killed) return
          await withRetry(async () => {
            const res = await C.pagePrompts(id, 1, false)
            const ids = res?.[0] || []
            const texts = res?.[1] || []
            const idx = ids.findIndex((x) => Number(x) === id)
            setPromptTextById(m => ({ ...m, [id]: idx >= 0 ? texts[idx] : (m[id] ?? '') }))
          })
        }
        for (const id of missingAns) {
          if (killed) return
          await withRetry(async () => {
            const res = await C.pageAnswers(id, 1, false)
            const ids = res?.[0] || []
            const texts = res?.[1] || []
            const idx = ids.findIndex((x) => Number(x) === id)
            setAnswerTextById(m => ({ ...m, [id]: idx >= 0 ? texts[idx] : (m[id] ?? '') }))
          })
        }
  
        if (!killed) setCardsErr(null)
      } catch (e) {
        if (!killed) setCardsErr(e?.message || 'error')
      }
    })()
    return () => { killed = true }
  }, [
    gid,
    getGameRead,
    state?.promptId,
    state?.submissions,
    state?.last?.winningAnswerId,
    Array.isArray(hand) ? hand.join(',') : '',
    reloadCardsTick
  ])

  
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

  const roundCountFromState = React.useCallback(
    () => Number(state?.roundsTotal ?? state?.round ?? 0),
    [state?.roundsTotal, state?.round]
  )

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

  // ---- finalize helpers ----
  const [finalizeStatus, setFinalizeStatus] = React.useState('idle')

  // Mark finalize done if on-chain game status is Finished (code 3)
  React.useEffect(() => {
    let off = false
    ;(async () => {
      try {
        if (!gid || !getGameRead) return
        const G = await getGameRead()
        const st = Number(await G.getGameStatus(gid)) // 0 None, 1 Lobby, 2 Started, 3 Finished, 4 Cancelled
        if (!off && st === 3) setFinalizeStatus('ok')
      } catch {}
    })()
    const iv = setInterval(async () => {
      try {
        if (!gid || !getGameRead) return
        const G = await getGameRead()
        const st = Number(await G.getGameStatus(gid))
        if (st === 3) setFinalizeStatus('ok')
      } catch {}
    }, 5000)
    return () => { off = true; clearInterval(iv) }
  }, [gid, getGameRead])
  
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

  // Manual build (server can also build; this is kept for clarity)
  async function buildFinalizePayloadClean(gid, state, getGameRead) {
    const arrPlayers = Array.isArray(state?.players) ? state.players.slice() : []
    if (!arrPlayers.length) throw new Error('no players')
    const arrScores = arrPlayers.map(p => Number(state?.scores?.[p] ?? 0))
    const top = arrScores.length ? Math.max(...arrScores) : 0
    const winners = arrPlayers.filter((_, i) => arrScores[i] === top)
    if (!winners.length) throw new Error('no winners')

    const game = await getGameRead()
    const nonce = Number(await game.finalizeNonce(gid))

    const players = arrPlayers.map(a => ethers.getAddress(a))
    const winnersNorm = winners.map(a => ethers.getAddress(a))

    return {
      gameId: Number(gid),
      players,
      scores: arrScores.map(n => Number(n)),
      winners: winnersNorm,
      roundCount: Number(state?.roundsTotal ?? state?.round ?? 0),
      deadline: Math.floor(Date.now() / 1000) + 15 * 60,
      roundsHash: '0x' + '00'.repeat(64),
      nonce,
    }
  }

  async function finalizeViaRelayer() {
    if (state?.phase !== 'ended') { toast('Match not ended', 'error'); return }
    setFinalizeStatus('working')
    try {
      const payload = await buildFinalizePayloadClean(gid, state, getGameRead)
      const j = await tryFinalize(payload)
      setFinalizeStatus('ok')
      toast('Game ended.', 'success')
    } catch (e) {
      // check chain: if finished elsewhere, treat as ok (no error toast)
      try {
        const G = await getGameRead()
        const st = Number(await G.getGameStatus(gid)) // 3 = Finished
        if (st === 3) { setFinalizeStatus('ok'); return }
      } catch {}
      setFinalizeStatus('error')
      // comment out next line if you want to silence the toast entirely
      toast(e?.message || 'Finalize failed', 'error')
    }
  }


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

  // --- SHARE helper (no confetti) ---
  function shareResult() {
    const winners = computeWinners()
    const iWon = winners.some(w => w.toLowerCase() === me)
    let text

    if (iWon) {
      // include prize if available
      if (gamePrize.usePrize && gamePrize.prizeWei > 0n && winners.length > 0) {
        const each = gamePrize.prizeWei / BigInt(winners.length)
        const s = fmtMon(each)
        const n = Number.parseFloat(s)
        const eachStr = Number.isFinite(n) ? n.toFixed(4).replace(/\.?0+$/, '') : s
        text = `I just played monadhumanity.xyz and won ${eachStr} MON.`
      } else {
        text = `I just played monadhumanity.xyz and won!`
      }
    } else {
      text = `I just played monadhumanity.xyz - a cards against humanity @monad edition. Come join the fun!`
    }

    const shareUrl = SITE_URL
    const twitter = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`
    if (navigator.share) {
      navigator.share({ text, url: shareUrl }).catch(() => {
        window.open(twitter, '_blank', 'noopener,noreferrer')
      })
    } else {
      window.open(twitter, '_blank', 'noopener,noreferrer')
    }
  }

  // judge anonymous cards
  function judgeCards() {
    if (!isJudge) return []
    const subs = state?.submissions || {}
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
    return () => { x ^= x << 13n; x ^= x >> 7n; x ^= x << 17n; return Number((x & 0xffffffffffffffffn) % 0x1_0000_0000n) >>> 0 }
  }
  function pick(rand, n) { return n ? rand() % n : 0 }

  // auto-kick finalize once when the match reaches "ended"
  const autoKickRef = React.useRef(false)

  // Reset the one-shot auto-finalize guard when switching to a new game
  React.useEffect(() => {
    autoKickRef.current = false
  }, [gid])
  
  React.useEffect(() => {
    if (phase === 'ended' && !autoKickRef.current) {
      autoKickRef.current = true
      ;(async () => {
        try {
          await finalizeViaRelayer()
        } catch {
          setFinalizeStatus('error')
        }
      })()
    }
  }, [phase, gid])

  const subs = state?.submissions || {}
  const waiting = players
    .filter(p => p !== (state?.judge || '').toLowerCase())
    .filter(p => subs[p] == null)

  const promptText = state?.promptId ? (promptTextById[state.promptId] || `Prompt #${state?.promptId}`) : ''

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
      
      {/* Card text load helper */}
        {(() => {
          const promptMissing = state?.promptId && !promptTextById[state.promptId]
          const s = state?.submissions || {}
          const subIds = Array.isArray(s) ? s : Object.values(s || {})
          const ansMissing = subIds.some((id) => id && !answerTextById[Number(id)])
          if (!promptMissing && !ansMissing && cardsErr !== 'loading') return null
          return (
            <div className="mt-2 mb-3 flex items-center gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span className="opacity-80">
                {cardsErr === 'loading' ? 'Loading card text…' : 'Having trouble loading cards.'}
              </span>
              <button
                className="ml-auto px-2 py-1 rounded bg-slate-700 hover:bg-slate-600"
                onClick={() => setReloadCardsTick(x => x + 1)}
              >
                Reload cards
              </button>
            </div>
          )
        })()}
      
        {isJudge && phase === 'submit' && (
          <div className="mb-2 text-sm text-slate-300">
            You’re the judge — waiting for players to pick…
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

      {/* JUDGE phase (non-judge: anonymized submissions) */}
      {phase === 'judge' && !isJudge && (() => {
        const uniqueIds = Array.from(new Set(Object.values(subs || {}))).filter(Boolean)
        if (!uniqueIds.length) return null
        return (
          <div className="mt-4">
            <div className="text-sm text-slate-400 mb-2">
              Others have submitted. Waiting for the judge…
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {uniqueIds.map(id => (
                <div key={id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
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

      {/* ENDED phase (sticky; manual exit & share) */}
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
            {/* Manual retry (creator only) */}
            {isCreator && finalizeStatus === 'error' && (
              <button
                className="px-3 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500"
                onClick={async () => {
                  try {
                    setFinalizeStatus('working')
                    const payload = await buildFinalizePayloadClean(gid, state, getGameRead)
                    const j = await tryFinalize(payload)
                    setFinalizeStatus('ok')
                    toast('Finalized ✅', 'success')
                  } catch (e) {
                    // check chain status before erroring
                    try {
                      const G = await getGameRead()
                      const st = Number(await G.getGameStatus(gid))
                      if (st === 3) { setFinalizeStatus('ok'); return }
                    } catch {}
                    setFinalizeStatus('error')
                    toast(e?.message || 'Finalize failed', 'error')
                  }
                }}

              >
                Retry finalize
              </button>
            )}

            <span className="text-sm text-slate-400">
              {finalizeStatus === 'working' && 'finalizing…'}
              {finalizeStatus === 'ok' && 'done'}
              {finalizeStatus === 'error' && 'failed — retry'}
            </span>

            {/* Share button */}
            <button
              className="ml-auto px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500"
              onClick={shareResult}
              title="Share your result"
            >
              Share
            </button>

            <button
              className="px-3 py-2 rounded bg-slate-800 border border-slate-700"
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
