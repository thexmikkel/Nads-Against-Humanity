// src/components/modals/Recall.js
import React, { useEffect, useMemo, useRef, useState } from 'react'

function toShort(addr) {
  if (!addr) return '—'
  const a = String(addr)
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export default function RecallModal() {
  const dlgRef = useRef(null)
  const [gameIdInput, setGameIdInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  // Auto-open & fetch if URL has ?recall=<gameId>
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const recall = sp.get('recall')
      if (recall) {
        setGameIdInput(recall)
        // open dialog
        const el = dlgRef.current
        if (el && typeof el.showModal === 'function') {
          el.showModal()
        }
        // kick off fetch
        ;(async () => {
          await fetchById(recall)
        })()
      }
    } catch {}
    // no deps; run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchById(id) {
    const trimmed = String(id || '').trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      // Support both ?gameId and ?id on the API (defensive)
      let res = await fetch(`/api/recall?gameId=${encodeURIComponent(trimmed)}`)
      if (!res.ok) {
        // try alt param name once
        res = await fetch(`/api/recall?id=${encodeURIComponent(trimmed)}`)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Request failed (${res.status})`)
      }
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    fetchById(gameIdInput)
  }

  const shareLink = useMemo(() => {
    if (!gameIdInput) return ''
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('recall', String(gameIdInput).trim())
      return url.toString()
    } catch {
      return ''
    }
  }, [gameIdInput])

  async function copyShare() {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      // quick toast
      console.log('Copied:', shareLink)
    } catch {}
  }

  // Try to pull a friendly quick summary if the API returns familiar keys
  const quick = useMemo(() => {
    if (!data || typeof data !== 'object') return null
    const players = data.players || data.final?.players
    const scores  = data.scores  || data.final?.scores
    const winners = data.winners || data.final?.winners
    const gameId  = data.gameId ?? data.final?.gameId
    const tx      = data.txHash || data.transactionHash
    const block   = data.blockNumber || data.block || null
    return { players, scores, winners, gameId, tx, block }
  }, [data])

  const close = () => {
    const el = dlgRef.current
    if (el && typeof el.close === 'function') el.close()
  }

  return (
    <dialog
      id="recallModal"
      ref={dlgRef}
      className="rounded-2xl border border-slate-800 bg-slate-900/95 text-slate-100 max-w-2xl w-[92vw] p-0"
    >
      <form method="dialog" className="m-0">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold">Recall game summary</h2>
          <button
            type="button"
            onClick={close}
            className="px-2 py-1 rounded hover:bg-slate-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pt-4 pb-1">
          <form onSubmit={onSubmit} className="flex gap-2 items-center">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter Game ID (e.g. 1234)"
              value={gameIdInput}
              onChange={(e) => setGameIdInput(e.target.value)}
              className="flex-1 px-3 py-2 rounded bg-slate-800/70 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <button
              type="submit"
              disabled={!gameIdInput || loading}
              className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
            >
              {loading ? 'Fetching…' : 'Fetch'}
            </button>
          </form>

          {shareLink && (
            <div className="mt-2 text-xs text-slate-400 flex items-center gap-3">
              <span className="truncate">Share: {shareLink}</span>
              <button
                type="button"
                onClick={copyShare}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="px-5 py-4">
          {error && (
            <div className="text-sm text-red-400 bg-red-950/30 border border-red-800/50 rounded p-3">
              {error}
            </div>
          )}

          {!error && !loading && data && (
            <>
              {/* Quick summary (if recognizable shape) */}
              {quick && (quick.players || quick.winners) && (
                <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/70">
                  <div className="px-4 py-3 border-b border-slate-800">
                    <div className="text-sm text-slate-300">
                      {quick.gameId ? <>Game <span className="font-semibold text-slate-200">{quick.gameId}</span></> : 'Game'}
                      {quick.block ? <> · Block <span className="font-mono">{quick.block}</span></> : null}
                    </div>
                    {quick.tx && (
                      <div className="text-xs text-slate-400 break-all mt-1">
                        Tx: <span className="font-mono">{quick.tx}</span>
                      </div>
                    )}
                  </div>

                  <div className="p-4 space-y-4">
                    {Array.isArray(quick.winners) && quick.winners.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Winners</div>
                        <div className="flex flex-wrap gap-2">
                          {quick.winners.map((w, i) => (
                            <span key={i} className="px-2 py-1 rounded bg-emerald-900/30 border border-emerald-700/40 text-emerald-200">
                              {toShort(w)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {Array.isArray(quick.players) && Array.isArray(quick.scores) && quick.players.length === quick.scores.length && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Players & Scores</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {quick.players.map((p, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 rounded bg-slate-800/50 border border-slate-700/50">
                              <span className="font-mono text-sm">{toShort(p)}</span>
                              <span className="text-slate-200 font-semibold">{quick.scores[i]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Raw JSON viewer (always shown) */}
              <details className="rounded-lg border border-slate-800 bg-slate-900/60">
                <summary className="cursor-pointer px-4 py-2 text-sm text-slate-300 select-none">
                  Raw response
                </summary>
                <pre className="m-0 p-4 overflow-auto text-xs leading-relaxed">
{JSON.stringify(data, null, 2)}
                </pre>
              </details>
            </>
          )}

          {!error && !loading && !data && (
            <div className="text-sm text-slate-400">
              Enter a game ID and press <span className="text-slate-200">Fetch</span>.
              You can also open this modal with <span className="text-slate-200">?recall=&lt;id&gt;</span> in the URL.
            </div>
          )}
        </div>

        <div className="px-5 pb-4 flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700"
            onClick={close}
          >
            Close
          </button>
        </div>
      </form>
    </dialog>
  )
                }
