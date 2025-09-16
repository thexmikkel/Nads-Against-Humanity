// src/components/modals/LeaderboardModal.jsx
import React from 'react'
import { ethers } from 'ethers'
import { useUsernamesMulti } from '../../hooks/useUsernamesMulti.js'

// Minimal ABIs
const ABI_LB = [
  // expected shape: (address[] players, uint256[] scores, uint256[] txs)
  'function playerDataPerGame(uint256 gameId) view returns (address[] players, uint256[] scores, uint256[] txs)'
]
const ABI_GAME_FALLBACK = [
  'function getPlayers(uint256 gameId) view returns (address[] memory)',
  'function finalScore(uint256 gameId, address player) view returns (uint32)',
  'function getGameStatus(uint256 gameId) view returns (uint8)'
]

export default function LeaderboardModal() {
  const [gameId, setGameId] = React.useState(() => {
    try { return Number(JSON.parse(localStorage.getItem('activeGame') || '{}')?.id || 0) } catch { return 0 }
  })
  const [rows, setRows] = React.useState([]) // { addr, score, txs }
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')
  const [names, setNames] = React.useState({})

  const addrList = React.useMemo(() => rows.map(r => r.addr), [rows])
  useUsernamesMulti(addrList, setNames)
  const display = (a) => names[a?.toLowerCase?.()] || short(a)

  React.useEffect(() => {
    if (!gameId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  async function load() {
    setLoading(true); setErr('')
    try {
      const provider = window.ethereum
        ? new ethers.BrowserProvider(window.ethereum)
        : new ethers.JsonRpcProvider(import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz/')

      // Try leaderboard first
      const lbAddr = import.meta.env.VITE_LEADERBOARD_ADDRESS
      if (lbAddr) {
        try {
          const LB = new ethers.Contract(lbAddr, ABI_LB, provider)
          const res = await LB.playerDataPerGame(BigInt(gameId))
          const players = Array.from(res?.[0] || [])
          const scores  = Array.from(res?.[1] || []).map(n => Number(n))
          const txs     = Array.from(res?.[2] || []).map(n => Number(n))
          if (players.length) {
            const out = players.map((addr, i) => ({
              addr,
              score: scores[i] ?? 0,
              txs: txs[i] ?? 0
            }))
            setRows(out.sort((a,b) => b.score - a.score))
            setLoading(false)
            return
          }
        } catch (e) {
          // fallthrough to game fallback
        }
      }

      // Fallback: compute from game contract finalScore
      const gameAddr = import.meta.env.VITE_GAME_ADDRESS
      if (!gameAddr) throw new Error('GAME address missing')
      const G = new ethers.Contract(gameAddr, ABI_GAME_FALLBACK, provider)
      const st = Number(await G.getGameStatus(BigInt(gameId)))
      if (st !== 3) {
        // not finished yet; we still show live scores for joined players
        // (works if finalScore was populated during finalize; else will be 0)
      }
      const players = await G.getPlayers(BigInt(gameId))
      const out = []
      for (const a of players) {
        const s = Number(await G.finalScore(BigInt(gameId), a))
        out.push({ addr: a, score: s, txs: 0 })
      }
      setRows(out.sort((a,b) => b.score - a.score))
    } catch (e) {
      setErr(e?.shortMessage || e?.message || 'Failed to load leaderboard')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  function short(a) {
    if (!a) return '—'
    return `${a.slice(0,6)}…${a.slice(-4)}`
  }

  return (
    <dialog id="leaderboardModal" className="rounded-xl p-0 bg-slate-900 text-slate-100 w-[720px] max-w-[94vw]">
      {/* Header */}
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Game leaderboard</div>
            <div className="text-xs text-white/60">Sorted by score (desc)</div>
          </div>
          <button className="text-white/70 hover:text-white text-sm px-3 py-1.5 rounded-md bg-white/5 border border-white/10"
                  onClick={() => document.getElementById('leaderboardModal')?.close()}>
            Close
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <label className="text-sm text-white/70">Game ID</label>
          <input
            className="px-2 py-1 rounded bg-slate-800 border border-slate-700 w-28"
            value={gameId || ''}
            onChange={(e) => setGameId(Number(e.target.value.replace(/\D/g,'')) || 0)}
            placeholder="e.g. 12"
          />
          <button className="ml-auto px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700"
                  onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="p-5">
        {err ? (
          <div className="text-rose-300 text-sm">{err}</div>
        ) : loading ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : rows.length ? (
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-white/80">#</th>
                  <th className="text-left px-3 py-2 font-medium text-white/80">Player</th>
                  <th className="text-right px-3 py-2 font-medium text-white/80">Score</th>
                  <th className="text-right px-3 py-2 font-medium text-white/80">Txs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r, i) => (
                  <tr key={r.addr}>
                    <td className="px-3 py-2 text-white/70">{i+1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{display(r.addr)}</span>
                        <span className="text-xs text-white/40 font-mono">{short(r.addr)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{r.score}</td>
                    <td className="px-3 py-2 text-right opacity-80">{r.txs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-slate-400 text-sm">No data yet for this game.</div>
        )}
      </div>
    </dialog>
  )
}
