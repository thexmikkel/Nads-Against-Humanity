// src/components/modals/RecallModal.jsx
import React from 'react'
import { toast } from '../../lib/toast.jsx'

const EXPLORER_TX = 'https://testnet.monadexplorer.com/tx/'

export default function RecallModal() {
  const dlgRef = React.useRef(null)

  const [gid, setGid] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    const el = dlgRef.current
    if (!el) return
    const onCancel = (e) => { e.preventDefault(); el.close() } // ESC closes
    el.addEventListener('cancel', onCancel)
    return () => el.removeEventListener('cancel', onCancel)
  }, [])

  function close() {
    dlgRef.current?.close()
    // small delay to avoid flicker while closing
    setTimeout(() => { setData(null); setError(''); setGid('') }, 150)
  }

  // Helper: fetch with timeout
  async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal })
      return r
    } finally {
      clearTimeout(t)
    }
  }

  async function fetchStats() {
    const n = Number(gid)
    if (!n || n < 1) return toast('Enter a valid game ID', 'error')
    setLoading(true); setError(''); setData(null)
    try {
      const r = await fetchWithTimeout(`/api/recall?gameId=${n}`, {}, 8000)
      const j = await r.json()
      if (!r.ok) {
        setError(j?.error || 'Not found')
        setData(null)
      } else {
        setData(j)
      }
    } catch (e) {
      setError(e?.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const short = (a) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—')
  const whenStr = data?.when ? new Date(data.when * 1000).toLocaleString() : null

  return (
    <dialog
      id="recallModal"
      ref={dlgRef}
      className="rounded-xl p-0 bg-slate-900 text-slate-100 w-[42rem] max-w-[92vw] border border-slate-800"
    >
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800">
        <div className="text-lg font-semibold">Recall Game Stats</div>
        <button onClick={close} className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700">
          Close
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm mb-1 text-slate-300">Game ID</label>
            <input
              value={gid}
              onChange={e => setGid(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="e.g. 12"
              className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700"
            />
          </div>
          <button
            disabled={loading || !gid}
            onClick={fetchStats}
            className="px-4 py-2 rounded-md bg-indigo-600 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Recall'}
          </button>
        </div>

        {error && (
          <div className="text-sm text-rose-300 bg-rose-950/40 border border-rose-900 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-3">
            <div className="text-sm text-slate-300">
              <div>Game ID: <span className="text-slate-100 font-mono">{data.gameId}</span></div>
              {whenStr && <div>When: <span className="text-slate-100">{whenStr}</span></div>}
              {data.tx && (
                <div>
                  Tx: <a className="text-indigo-400 hover:underline" href={`${EXPLORER_TX}${data.tx}`} target="_blank" rel="noreferrer">{short(data.tx)}</a>
                </div>
              )}
            </div>

            {/* Example rendering; adapt to your API shape */}
            {Array.isArray(data.players) && Array.isArray(data.scores) && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-slate-800 rounded-md overflow-hidden">
                  <thead className="bg-slate-800/60">
                    <tr>
                      <th className="text-left px-3 py-2">#</th>
                      <th className="text-left px-3 py-2">Player</th>
                      <th className="text-right px-3 py-2">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.players.map((p, i) => (
                      <tr key={p} className="border-t border-slate-800">
                        <td className="px-3 py-2">{i + 1}</td>
                        <td className="px-3 py-2 font-mono">{short(p)}</td>
                        <td className="px-3 py-2 text-right">{data.scores[i]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </dialog>
  )
}
