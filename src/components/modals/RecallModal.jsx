// src/components/modals/RecallModal.jsx
import React from 'react'
import { ethers } from 'ethers'
import { usePrivy } from '@privy-io/react-auth'
import { useUsernamesMulti } from '../../hooks/useUsernamesMulti.js'

const ABI_GAME = [
  'event FinalScores(uint256 indexed gameId, address[] players, uint32[] scores, address[] winners)'
]

export default function RecallModal() {
  const { user } = usePrivy()
  const myAddr = React.useMemo(() => {
    try { return ethers.getAddress(user?.wallet?.address || user?.address || '') } catch { return '' }
  }, [user])

  const [rows, setRows] = React.useState([]) // { gameId, date, yourScore, yourRank, winners[], players[] }
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')

  // for pretty names
  const allAddrs = React.useMemo(() => {
    const s = new Set()
    rows.forEach(r => { (r.players||[]).forEach(a => s.add(a)); (r.winners||[]).forEach(a=>s.add(a)) })
    return Array.from(s)
  }, [rows])
  const [names, setNames] = React.useState({})
  useUsernamesMulti(allAddrs, setNames)
  const display = (a) => names[a?.toLowerCase?.()] || short(a)

  const rpcUrl  = import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz/'
  const gameAddr = import.meta.env.VITE_GAME_ADDRESS
  const deployBlock = Number(import.meta.env.VITE_GAME_DEPLOY_BLOCK || 0)

  function short(a) { if (!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}` }

  async function loadMine() {
    if (!myAddr) { setRows([]); return }
    if (!gameAddr) throw new Error('GAME address missing')
    setLoading(true); setErr('')
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const iface = new ethers.Interface(ABI_GAME)
      const topic = iface.getEvent('FinalScores').topicHash
      const latest = await provider.getBlockNumber()
      const CHUNK = 8000
      const from = Math.max(0, deployBlock || 0)

      const mine = []
      // cache block timestamps so we don't re-fetch
      const tsCache = new Map()

      for (let start = from; start <= latest; start += CHUNK + 1) {
        const end = Math.min(latest, start + CHUNK)
        const logs = await provider.getLogs({
          address: gameAddr,
          fromBlock: start,
          toBlock: end,
          topics: [topic]
        })
        for (const lg of logs) {
          let parsed
          try { parsed = iface.parseLog({ topics: lg.topics, data: lg.data }) } catch { continue }
          const gid = Number(parsed.args?.gameId || 0n)
          const players = (parsed.args?.players || []).map(a => ethers.getAddress(a))
          if (!players.some(a => a.toLowerCase() === myAddr.toLowerCase())) continue

          const scores  = Array.from(parsed.args?.scores || []).map(n => Number(n))
          const winners = (parsed.args?.winners || []).map(a => ethers.getAddress(a))

          const yourIdx = players.findIndex(a => a.toLowerCase() === myAddr.toLowerCase())
          const yourScore = yourIdx >= 0 ? scores[yourIdx] : 0

          // rank (1 = highest)
          const sorted = [...scores].sort((a,b) => b - a)
          const yourRank = sorted.findIndex(s => s === yourScore) + 1

          // block time
          let ts = tsCache.get(lg.blockNumber)
          if (!ts) {
            const blk = await provider.getBlock(lg.blockNumber)
            ts = blk?.timestamp || 0
            tsCache.set(lg.blockNumber, ts)
          }

          mine.push({
            gameId: gid,
            date: ts ? new Date(ts * 1000) : null,
            yourScore,
            yourRank,
            winners,
            players
          })
        }
      }

      // newest first
      mine.sort((a,b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
      setRows(mine)
    } catch (e) {
      setErr(e?.shortMessage || e?.message || 'Failed to load your history')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { loadMine()  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAddr])

  return (
    <dialog id="recallModal" className="rounded-xl p-0 bg-slate-900 text-slate-100 w-[800px] max-w-[96vw]">
      <div className="p-5 border-b border-slate-800 flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Your game history</div>
          <div className="text-xs text-white/60">All finished matches you participated in</div>
        </div>
        <button className="text-white/70 hover:text-white text-sm px-3 py-1.5 rounded-md bg-white/5 border border-white/10"
                onClick={() => document.getElementById('recallModal')?.close()}>
          Close
        </button>
      </div>

      <div className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700"
            onClick={loadMine} disabled={loading}
          >
            {loading ? 'Loading…' : 'Reload'}
          </button>
        </div>

        {err ? (
          <div className="text-rose-300 text-sm">{err}</div>
        ) : loading ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : rows.length ? (
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-white/80">When</th>
                  <th className="text-left px-3 py-2 font-medium text-white/80">Game</th>
                  <th className="text-right px-3 py-2 font-medium text-white/80">Your score</th>
                  <th className="text-right px-3 py-2 font-medium text-white/80">Your rank</th>
                  <th className="text-left px-3 py-2 font-medium text-white/80">Winners</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r, i) => (
                  <tr key={`${r.gameId}-${i}`}>
                    <td className="px-3 py-2">{r.date ? r.date.toLocaleString() : '—'}</td>
                    <td className="px-3 py-2">#{r.gameId}</td>
                    <td className="px-3 py-2 text-right">{r.yourScore}</td>
                    <td className="px-3 py-2 text-right">{r.yourRank || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {r.winners?.map((w) => (
                          <span key={w} className="px-2 py-0.5 rounded bg-white/5 border border-white/10">
                            {display(w)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-slate-400 text-sm">No finished games found for your address.</div>
        )}
      </div>
    </dialog>
  )
}
