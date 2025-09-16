// src/components/modals/LeaderboardModal.jsx
import React from 'react'
import { ethers } from 'ethers'
import { useUsernamesMulti } from '../../hooks/useUsernamesMulti.js'

// Game ABI bits we need
const ABI_GAME = [
  'event FinalScores(uint256 indexed gameId, address[] players, uint32[] scores, address[] winners)',
  'function getPlayers(uint256 gameId) view returns (address[])',
  'function finalScore(uint256 gameId, address player) view returns (uint32)',
  'function getGameStatus(uint256 gameId) view returns (uint8)',
]

export default function LeaderboardModal() {
  // UI state
  const [tab, setTab] = React.useState('global') // 'global' | 'pergame'
  const [gameId, setGameId] = React.useState(() => {
    try { return Number(JSON.parse(localStorage.getItem('activeGame') || '{}')?.id || 0) } catch { return 0 }
  })
  const [rows, setRows] = React.useState([]) // { addr, score, games }
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')

  // name mapping
  const [names, setNames] = React.useState({})
  const addrList = React.useMemo(() => rows.map(r => r.addr), [rows])
  useUsernamesMulti(addrList, setNames)
  const display = (a) => names[a?.toLowerCase?.()] || short(a)

  // --------- providers & config ----------
  const rpcUrl  = import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz/'
  const gameAddr = import.meta.env.VITE_GAME_ADDRESS
  const deployBlock = Number(import.meta.env.VITE_GAME_DEPLOY_BLOCK || 0) // set if you know it for faster scans

  // helpers
  function short(a) {
    if (!a) return '—'
    return `${a.slice(0,6)}…${a.slice(-4)}`
  }

  async function loadGlobalTotals() {
    if (!gameAddr) throw new Error('GAME address missing')
    setLoading(true); setErr('')
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const iface = new ethers.Interface(ABI_GAME)
      const topic = iface.getEvent('FinalScores').topicHash
      const latest = await provider.getBlockNumber()

      // chunked log scan so we don’t blow RPC limits
      const CHUNK = 8000
      const from = Math.max(0, deployBlock || 0)
      const totals = new Map() // addrLower -> { addr, score, games }

      for (let start = from; start <= latest; start += CHUNK + 1) {
        const end = Math.min(latest, start + CHUNK)
        const logs = await provider.getLogs({
          address: gameAddr,
          fromBlock: start,
          toBlock: end,
          topics: [topic] // event signature only
        })
        for (const lg of logs) {
          let parsed
          try { parsed = iface.parseLog({ topics: lg.topics, data: lg.data }) } catch { continue }
          const gPlayers = parsed.args?.players || []
          const gScores  = parsed.args?.scores  || []
          for (let i = 0; i < gPlayers.length; i++) {
            const addr = ethers.getAddress(gPlayers[i])
            const key = addr.toLowerCase()
            const add = Number(gScores[i] || 0)
            const prev = totals.get(key) || { addr, score: 0, games: 0 }
            totals.set(key, { addr, score: prev.score + add, games: prev.games + 1 })
          }
        }
      }
      const list = Array.from(totals.values()).sort((a,b) => b.score - a.score)
      setRows(list)
    } catch (e) {
      setErr(e?.shortMessage || e?.message || 'Failed to load global totals')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  async function loadPerGame(gid) {
    if (!gameAddr) throw new Error('GAME address missing')
    setLoading(true); setErr('')
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const G = new ethers.Contract(gameAddr, ABI_GAME, provider)
      const st = Number(await G.getGameStatus(BigInt(gid)))
      // even if not finished, we show finalScore for current players (may be 0)
      const players = await G.getPlayers(BigInt(gid))
      const out = []
      for (const a of players) {
        const s = Number(await G.finalScore(BigInt(gid), a))
        out.push({ addr: a, score: s, games: 1 })
      }
      setRows(out.sort((a,b) => b.score - a.score))
    } catch (e) {
      setErr(e?.shortMessage || e?.message || 'Failed to load game scores')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    if (tab === 'global') loadGlobalTotals()
    else if (tab === 'pergame' && gameId) loadPerGame(gameId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, gameId])

  return (
    <dialog id="leaderboardModal" className="rounded-xl p-0 bg-slate-900 text-slate-100 w-[780px] max-w-[96vw]">
      {/* Header */}
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Leaderboard</div>
            <div className="text-xs text-white/60">
              {tab === 'global' ? 'Total score across all finished games' : `Scores for game #${gameId || '—'}`}
            </div>
          </div>
          <button className="text-white/70 hover:text-white text-sm px-3 py-1.5 rounded-md bg-white/5 border border-white/10"
                  onClick={() => document.getElementById('leaderboardModal')?.close()}>
            Close
          </button>
        </div>
      </div>

      {/* Tabs + Controls */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <button
            className={`px-3 py-1.5 rounded-md text-sm border ${tab==='global' ? 'bg-indigo-600 border-indigo-500' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'}`}
            onClick={() => setTab('global')}
          >
            Global totals
          </button>
          <button
            className={`px-3 py-1.5 rounded-md text-sm border ${tab==='pergame' ? 'bg-indigo-600 border-indigo-500' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'}`}
            onClick={() => setTab('pergame')}
          >
            This game
          </button>

          {tab === 'pergame' && (
            <>
              <label className="ml-3 text-sm text-white/70">Game ID</label>
              <input
                className="px-2 py-1 rounded bg-slate-800 border border-slate-700 w-28"
                value={gameId || ''}
                onChange={(e) => setGameId(Number(e.target.value.replace(/\D/g,'')) || 0)}
                placeholder="e.g. 12"
              />
              <button className="ml-auto px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700"
                      onClick={() => loadPerGame(gameId)} disabled={loading}>
                {loading ? 'Loading…' : 'Reload'}
              </button>
            </>
          )}
          {tab === 'global' && (
            <button className="ml-auto px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700"
                    onClick={loadGlobalTotals} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          )}
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
                  <th className="text-right px-3 py-2 font-medium text-white/80">Total Score</th>
                  <th className="text-right px-3 py-2 font-medium text-white/80">Games</th>
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
                    <td className="px-3 py-2 text-right opacity-80">{r.games}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-slate-400 text-sm">No data yet.</div>
        )}
      </div>
    </dialog>
  )
}
