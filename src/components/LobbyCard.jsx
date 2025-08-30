import React from 'react'
import { ethers } from 'ethers'
import { toast } from '../lib/toast.jsx'
import { useUsernamesMulti } from '../hooks/useUsernamesMulti.js'

const MONAD_ID = 10143
const MONAD_HEX = '0x279f'

export default function LobbyCard({ activeGame, address, getGameRead, getGame, onLeaveLobby, onStatus }) {
  const { id, code } = activeGame || {}
  
  const RELAYER = (import.meta.env.VITE_RELAYER_ADDR || '').toLowerCase()
  const [players, setPlayers] = React.useState([])
  const [status, setStatus] = React.useState('Lobby')
  const [minToStart, setMinToStart] = React.useState(4)
  const [expiryTs, setExpiryTs] = React.useState(null)
  const [isCreator, setIsCreator] = React.useState(false)
  const [creator, setCreator] = React.useState('')
  const [creatorNeedsDelegate, setCreatorNeedsDelegate] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const [names, setNames] = React.useState({})
  const display = React.useCallback((addr) => {
    if (!addr) return '—'
    const key = addr.toLowerCase?.() || addr
    const val = names[key]
    return val ? val : (addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : '—')
  }, [names])
  
  // Poll players, status, min threshold, expiryTs, and creator delegate state
  React.useEffect(() => {
    let killed = false
    async function load() {
      if (!id || !getGameRead) return
      try {
        const game = await getGameRead()
        const [list, stRaw, minRaw, meta] = await Promise.all([
          game.getPlayers(id),
          game.getGameStatus(id),
          game.minPlayersToStart(),
          game.getGameMeta(id)
        ])
        if (killed) return
        const addrs = (Array.isArray(list) ? list : []).map(a => a.toLowerCase())
        setPlayers(addrs)
        const map = { 0:'None', 1:'Lobby', 2:'Started', 3:'Finished', 4:'Cancelled' }
        const st = map[Number(stRaw)] || 'None'
        setStatus(st)
        onStatus?.(st)
        setMinToStart(Number(minRaw))
        const creatorAddr = String(meta?.[0] || '').toLowerCase()
        setCreator(creatorAddr)
        setIsCreator(address && creatorAddr && address.toLowerCase() === creatorAddr)
        const chainExpiry = Number(meta?.[5] ?? meta?.expiryTs ?? 0)
        setExpiryTs(chainExpiry || null)

        // check creator delegate (delegate must be creator & not expired)
        try {
          const info = await game.delegateOf(id, creatorAddr)
          const rawDel = (info?.delegate ?? info?.[0] ?? '').toString()
          const delegate = rawDel.toLowerCase()
          const expiresAt = Number(info?.expiresAt ?? info?.[1] ?? 0)
          const ok = delegate === RELAYER && (expiresAt === 0 || expiresAt >= Math.floor(Date.now()/1000))
          setCreatorNeedsDelegate(!ok)
        } catch {
          setCreatorNeedsDelegate(true)
        }
      } catch (e) {
        console.warn('lobby poll failed', e)
      }
    }
    load()
    const iv = setInterval(load, 3000)
    return () => { killed = true; clearInterval(iv) }
  }, [id, getGameRead, address])

  // Chain countdown
  const [now, setNow] = React.useState(Math.floor(Date.now()/1000))
  React.useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now()/1000)), 1_000)
    return () => clearInterval(t)
  }, [])
  const expired = expiryTs ? now >= Number(expiryTs) : false
  const secsLeft = expiryTs ? Math.max(0, Number(expiryTs) - now) : null
  
  // Resolve usernames for the lobby list
  useUsernamesMulti(players, setNames)
  
  async function ensureMonad(provider) {
    const net = await provider.getNetwork()
    if (Number(net.chainId) === MONAD_ID) return
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
    } catch (err) {
      const c = err?.code
      const msg = String(err?.message || '')
      if (c === 4902 || /unknown chain|addEthereumChain|unrecognized/i.test(msg)) {
        await provider.send('wallet_addEthereumChain', [{
          chainId: MONAD_HEX,
          chainName: 'Monad Testnet',
          nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
          rpcUrls: ['https://testnet-rpc.monad.xyz/'],
          blockExplorerUrls: ['https://testnet.monadexplorer.com/']
        }])
        await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
      } else {
        throw err
      }
    }
  }

  async function onForceStart() {
    if (!isCreator || status !== 'Lobby' || busy) return
    if (players.length < minToStart) return toast(`Need ≥ ${minToStart} players`, 'error')
    setBusy(true)
    try {
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      await ensureMonad(provider)
      const tx = await game.forceStart(id)
      toast('Starting game…', 'loading')
      await tx.wait()
      toast('Game started', 'success')
    } catch (e) {
      const msg = e?.shortMessage || e?.reason || e?.message || 'Force start failed'
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function onResolveExpiry() {
    if (status !== 'Lobby' || !expired || busy) return
    setBusy(true)
    try {
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      await ensureMonad(provider)
      const tx = await game.tickLobby(id)
      toast('Resolving lobby…', 'loading')
      await tx.wait()
      toast('Lobby resolved', 'success')
    } catch (e) {
      const msg = e?.shortMessage || e?.reason || e?.message || 'Resolve failed'
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function onSetCreatorDelegate() {
    if (!isCreator || busy) return
    if (!RELAYER) { toast('Relayer not configured (VITE_RELAYER_ADDR)', 'error'); return }
    setBusy(true)
    try {
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      await ensureMonad(provider)
      // Minimal: set delegate to RELAYER with no expiry & no signature (caller is the player)
      const tx = await game.setDelegateApproval(id, {
        player: creator,            // creatorAddr is the player, and you are creator here
        delegate: RELAYER,          // delegate must be the relayer
        expiresAt: 0,               // 0 = no expiry
        signature: '0x'             // no EIP-712 needed for self-approval
      })
      
      toast('Setting delegation…', 'loading')
      await tx.wait()
      toast('Creator delegation set', 'success')
      setCreatorNeedsDelegate(false)
    } catch (e) {
      toast(e?.shortMessage || e?.reason || e?.message || 'Set delegate failed', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="w-full max-w-3xl mb-8 rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">Lobby</div>
        {id && <div className="text-sm text-slate-400">Game ID: #{id} • {status}</div>}
      </div>

      {isCreator && status === 'Lobby' && creatorNeedsDelegate && (
        <div className="mt-3 p-3 rounded-md bg-amber-900/30 border border-amber-800 text-amber-200 text-sm flex items-center justify-between">
          <span>Approve the relayer once (1 tx) so the game can auto-finalize.</span>
          <button className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600" onClick={onSetCreatorDelegate} disabled={busy}>
            {busy ? 'Working…' : 'Set delegate'}
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-slate-400 text-sm">Invite code</div>
          <div className="font-mono text-xl">{code || '—'}</div>
        </div>
        <div className="flex items-end gap-2">
          {code && (
            <>
              <button className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700" onClick={() => navigator.clipboard.writeText(code)}>Copy code</button>
              <button className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?code=${code}`)}>Copy link</button>
            </>
          )}

          {isCreator && status === 'Lobby' && (
            <button
              className="px-3 py-2 rounded-md bg-indigo-600 disabled:opacity-50"
              onClick={onForceStart}
              disabled={busy || players.length < minToStart}
              title={`Requires ≥ ${minToStart} players`}
            >
              {busy ? 'Starting…' : 'Force start'}
            </button>
          )}

          {status === 'Lobby' && expired && (
            <button className="px-3 py-2 rounded-md bg-rose-600 disabled:opacity-50" onClick={onResolveExpiry} disabled={busy}>
              {busy ? 'Resolving…' : 'Resolve expiry'}
            </button>
          )}

          {typeof onLeaveLobby === 'function' && (
            <button
              className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700 disabled:opacity-50"
              onClick={() => onLeaveLobby?.()}
              disabled={busy}
            >
              {busy ? 'Leaving…' : 'Leave lobby'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm text-slate-400">Players ({players.length})</div>
        <div className="flex flex-wrap gap-2 mt-1">
          {players.length === 0 && <span className="text-slate-500">No players yet</span>}
          {players.map(p => (
            <span key={p} className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-sm">
              {display(p)}{p === address?.toLowerCase() ? ' (you)' : ''}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 text-sm text-slate-400">
        {status === 'Lobby' ? (
          <>
            Waiting for players… <span className="text-slate-200">{players.length}</span> joined.
            {' '}Force start unlocks at <span className="text-slate-200">{minToStart}</span>.
            {' '}{expiryTs ? (
              expired
                ? <span className="text-rose-300"> Lobby expired.</span>
                : <> Lobby expires in <span className="text-slate-200">{Math.floor(secsLeft/60)}m {secsLeft%60}s</span>.</>
            ) : null}
          </>
        ) : (
          <>Game has {status.toLowerCase()}.</>
        )}
      </div>
    </div>
  )
}
