import React from 'react'
import { toast } from '../../lib/toast.jsx'

const EXPLORER_TX = 'https://testnet.monadexplorer.com/tx/'

export default function RecallModal() {
  const [open, setOpen] = React.useState(false)
  const [gid, setGid] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState('')

  function close() {
    setOpen(false)
    setTimeout(() => {
      setData(null); setError(''); setGid('')
    }, 200)
  }

  async function fetchStats() {
    const n = Number(gid)
    if (!n || n < 1) return toast('Enter a valid game ID', 'error')
    setLoading(true); setError(''); setData(null)
    try {
      const r = await fetch(`/api/recall?gameId=${n}`)
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
    <>
      {/* Modal panel */}
      <div className={[
        'fixed inset-0 z-[80] transition',
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      ].join(' ')}>
        <div className="absolute inset-0 bg-black/50" onClick={close} />
        <div className="absolute inset-x-0 top-20 mx-auto w-full max-w-2xl rounded-xl bg-slate-900 border border-slate-800 shadow-xl">
          <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800">
            <div className="text-lg font-semibold">Recall Game Stats</div>
            <button onClick={close} className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700">Close</button>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-sm mb-1 text-slate-300">
                  Game ID
                </label>
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
              <div className="space-y-4">
                <div className="text-sm text-slate-400">
                  <div>Game ID: <span className="font-mono text-slate-300">{data.gameId}</span></div>
                  <div>
                    Finalized: {whenStr ? whenStr : '—'}
                    {data.txHash && (
                      <>
                        {' '}•{' '}
                        <a
                          className="underline"
                          href={`${EXPLORER_TX}${data.txHash}`}
                          target="_blank" rel="noreferrer"
                        >
                          View tx
                        </a>
                      </>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="text-left p-2">Player</th>
                        <th className="text-right p-2">Score</th>
                        <th className="text-center p-2">Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.players.map((p, i) => {
                        const win = data.winners?.includes(p)
                        return (
                          <tr key={`${p}-${i}`} className="border-t border-slate-800">
                            <td className="p-2 font-mono">{short(p)}</td>
                            <td className="p-2 text-right">{data.scores[i] ?? 0}</td>
                            <td className="p-2 text-center">
                              {win ? <span className="px-2 py-0.5 rounded bg-emerald-700/30 border border-emerald-600 text-emerald-300 text-xs">Winner</span> : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-slate-800 flex justify-end">
            <button onClick={close} className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700">Close</button>
          </div>
        </div>
      </div>
    </>
  )
}
