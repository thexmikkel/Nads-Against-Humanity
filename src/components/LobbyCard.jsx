// src/components/LobbyCard.jsx
import React from 'react'
import { toast } from '../lib/toast.jsx'
import { useUsernamesMulti } from '../hooks/useUsernamesMulti.js'

const MONAD_ID = 10143
const MONAD_HEX = '0x279f'

export default function LobbyCard({ activeGame, address, getGameRead, getGame, onLeaveLobby, onStatus }) {
  const { id, code } = activeGame || {}
  const [players, setPlayers] = React.useState([])
  const [status, setStatus] = React.useState('Lobby')
  const [minToStart, setMinToStart] = React.useState(4)
  const [maxPlayers, setMaxPlayers] = React.useState(0)
  const [expiryTs, setExpiryTs] = React.useState(null)
  const [createdAt, setCreatedAt] = React.useState(null)
  const [creator, setCreator] = React.useState(null)
  const [names, setNames] = React.useState({})


  const [nowMs, setNowMs] = React.useState(Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useUsernamesMulti(players, setNames)

  async function ensureMonad(provider) {
    const net = await provider.getNetwork()
    if (Number(net.chainId) === MONAD_ID) return
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
    } catch (err) {
      const msg = String(err?.message || '')
      if (err?.code === 4902 || /unknown chain|addEthereumChain|unrecognized/i.test(msg)) {
        await provider.send('wallet_addEthereumChain', [{
          chainId: MONAD_HEX,
          chainName: 'Monad Testnet',
          nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
          rpcUrls: ['https://testnet-rpc.monad.xyz/'],
          blockExplorerUrls: ['https://testnet.monadexplorer.com/']
        }])
        await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
      } else { throw err }
    }
  }

  // Poll lobby state
  React.useEffect(() => {
    let stop = false
    ;(async () => {
      if (!id) return
      while (!stop) {
        try {
          const game = await getGameRead()
          const [list, stRaw, minRaw, meta] = await Promise.all([
            game.getPlayers(id),
            game.getGameStatus(id),
            game.minPlayersToStart(),
            game.getGameMeta(id),
          ])
          const st = ['None','Lobby','Started','Finished','Cancelled'][Number(stRaw) || 0] || 'Lobby'
          if (st !== status) { setStatus(st); onStatus?.(st) }
          setPlayers([...list])
          setMinToStart(Number(minRaw || 0))
          setMaxPlayers(Number(meta?.[2] || 0))
          setCreator(String(meta?.[0] || '0x'))
          setCreatedAt(Number(meta?.[4] || 0))
          setExpiryTs(Number(meta?.[5] || 0))
        } catch (e) {
          // silent
        }
        await new Promise(r => setTimeout(r, 1200))
      }
    })()
    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const totalSecs = createdAt && expiryTs ? Math.max(0, Number(expiryTs - createdAt)) : 0
  const secsLeft  = expiryTs ? Math.max(0, Number(expiryTs - Math.floor(nowMs/1000))) : 0
  const pct = totalSecs ? Math.max(0, Math.min(100, Math.round((1 - secsLeft/totalSecs) * 100))) : 0
  const expired = expiryTs ? (Math.floor(nowMs/1000) >= Number(expiryTs)) : false

  async function doForceStart() {
    try {
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      await ensureMonad(provider)
      const tx = await game.forceStart(id)
      toast('Starting game…', 'loading')
      await tx.wait()
    } catch (e) {
      const msg = e?.shortMessage || e?.message || 'Force start failed'
      toast(msg, 'error')
    }
  }
  
  // Remove from Public Lobbies when lobby ends or expires
  const prevStatus = React.useRef(status)
  React.useEffect(() => {
    const ended = status !== 'Lobby' || (expiryTs && Date.now()/1000 >= Number(expiryTs))
    if (ended && prevStatus.current === 'Lobby') {
      fetch('/api/public-lobbies/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: Number(id) })
      }).catch(() => {})
    }
    prevStatus.current = status
  }, [status, expiryTs, id])

  async function doTickLobby() {
    try {
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      await ensureMonad(provider)
      const tx = await game.tickLobby(id)
      toast('Resolving expired lobby…', 'loading')
      await tx.wait()
    } catch (e) {
      const msg = e?.shortMessage || e?.message || 'Tick failed'
      toast(msg, 'error')
    }
  }

  const short = (a) => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—'
  const you = address?.toLowerCase?.()
  const canForceStart = players.length >= minToStart && you && creator && you === creator.toLowerCase()

  return (
    <div className="rounded-2xl p-[1px] bg-gradient-to-br from-indigo-500/40 via-fuchsia-500/40 to-cyan-500/40">
      <div className="rounded-2xl bg-[#0b0e17]/95 border border-white/10 shadow-xl">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Lobby #{id}</div>
              <div className="text-xs text-white/60 mt-0.5 flex items-center gap-2">
                <span>
                  Code: <span className="font-mono tracking-widest text-white/80">{code || '—'}</span>
                </span>
                {!!code && (
                  <button
                    className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px]"
                    title="Copy code"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(code); toast('Copied!', 'success') } catch {}
                    }}
                  >
                    Copy
                  </button>
                )}
              </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded-md text-xs border ${status==='Lobby'?'border-indigo-500/40 text-indigo-300 bg-indigo-500/10':status==='Started'?'border-emerald-500/40 text-emerald-300 bg-emerald-500/10':status==='Finished'?'border-sky-500/40 text-sky-300 bg-sky-500/10':'border-rose-500/40 text-rose-300 bg-rose-500/10'}`}>
              {status}
            </span>
            {status === 'Lobby' && (
              <>
                {canForceStart && (
                  <button className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500"
                          onClick={doForceStart}>
                    Force start
                  </button>
                )}
                {expired && (
                  <button className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                          onClick={doTickLobby}>
                    Resolve expiry
                  </button>
                )}
                <button className="px-3 py-1.5" onClick={onLeaveLobby}>Leave</button>
              </>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {status === 'Lobby' && totalSecs > 0 && (
          <div className="px-5 pt-3">
            <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-600 to-fuchsia-600 transition-[width] duration-1000"
                   style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-xs text-white/60">
              {expired
                ? <span className="text-rose-300">Lobby expired</span>
                : <>Expires in <span className="text-white/80">{Math.floor(secsLeft/60)}m {secsLeft%60}s</span></>}
            </div>
          </div>
        )}

        {/* Players */}
        <div className="p-5">
          <div className="text-sm text-white/70 mb-3">
            Players <span className="text-white/90">{players.length}</span>
            {maxPlayers ? <> / <span className="text-white/90">{maxPlayers}</span></> : null}
            {status === 'Lobby' && (
              <> &middot; Need <span className="text-white/90">{minToStart}</span> to enable force start</>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {players.map((p) => (
              <div key={p}
                   className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between">
                <div className="text-sm">
                  {names[p?.toLowerCase?.()] || short(p)}
                </div>
                {you && p?.toLowerCase?.() === you && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/80">You</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
