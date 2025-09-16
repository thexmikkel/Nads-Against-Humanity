// src/components/JoinableLobbies.jsx
import React from 'react'
import { ethers } from 'ethers'
import { usePrivy } from '@privy-io/react-auth'
import { inviteHash } from '../lib/invite.js'

const MONAD_ID = 10143
const MONAD_HEX = '0x279f'

// Same Games-ID helper used in JoinPanel
const GID_APP_ID = import.meta.env.VITE_MONAD_GID_APP_ID || 'cmd8euall0037le0my79qpz42'
function getGamesIdAddressFromPrivyUser(user) {
  try {
    const cross = user?.linkedAccounts?.find?.(
      (acc) => acc.type === 'cross_app' && acc.providerApp?.id === GID_APP_ID
    )
    return cross?.embeddedWallets?.[0]?.address || ''
  } catch { return '' }
}

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

const ABI_GAME = [
  'function getGameStatus(uint256) view returns (uint8)',
  'function getPlayers(uint256) view returns (address[])',
  'function getGameMeta(uint256) view returns (address,bytes32,uint8,bool,uint64,uint64,uint256,uint256,bool,bool,bool)',
  'function joinGameByCode(bytes32) external',
]

export default function JoinableLobbies({ getGameRead, getGame, onJoined, toast }) {
  const [items, setItems] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [joiningId, setJoiningId] = React.useState(0)
  const { user } = usePrivy()
  
  React.useEffect(() => {
    let off = false
    let inflight = false
  
    const load = async () => {
      if (inflight) return
      inflight = true
      try {
        setLoading(true)
        const r = await fetch('/api/public-lobbies/list')
        const j = await r.json()
        const list = Array.isArray(j?.lobbies) ? j.lobbies : []
  
        const G = await getGameRead()
        const out = []
        for (const it of list) {
          const gid = BigInt(it.gameId)
          let st = 1, players = [], meta
          try {
            st = Number(await G.getGameStatus(gid))
            players = await G.getPlayers(gid)
            meta = await G.getGameMeta(gid)
          } catch {}
          const maxP   = Number(meta?.[2] ?? it.maxPlayers ?? 0)
          const prize  = meta?.[6] ?? it.prizeAmount ?? 0n
          const expSec = Number(it.expiresAt || 0)
          out.push({
            ...it,
            status: st,                      // 1 Lobby, 2 Started, 3 Finished, 4 Cancelled
            playersNow: (players || []).length,
            maxPlayers: maxP,
            prizeAmount: prize,              // BigInt/string
            expiresAt: expSec,
          })
        }
        if (!off) setItems(out.sort((a, b) => a.expiresAt - b.expiresAt))
      } catch (e) {
        if (!off) setItems([])
      } finally {
        if (!off) setLoading(false)
        inflight = false
      }
    }
  
    // initial load + poll every 12s
    load()
    const iv = setInterval(load, 12000)
  
    return () => { off = true; clearInterval(iv) }
  }, [getGameRead])

  // live ticking for countdowns
  const [nowSec, setNowSec] = React.useState(() => Math.floor(Date.now() / 1000))
  React.useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  
  // tiny formatter for "Xm Ys"
  const fmtCountdown = React.useCallback((secs) => {
    const s = Math.max(0, Math.floor(secs || 0))
    const m = Math.floor(s / 60)
    const r = s % 60
    return m > 0 ? `${m}m ${r}s` : `${r}s`
  }, [])

  
   async function joinLobby(it) {
    try {
      setJoiningId(it.gameId)
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      const signer   = game.runner || game.signer
      if (!provider) throw new Error('Wallet not ready')
      await ensureMonad(provider)

      const codeUpper = String(it.code || '').toUpperCase()
      const addr      = await signer.getAddress()
      const hash      = inviteHash(codeUpper)

      // Same pre-check as JoinPanel
      const res = await game.canJoinByCode.staticCall(hash, addr)
      const ok = Boolean(res?.[0]); const gid = Number(res?.[1] || 0n)
      const reason = (res?.[2] || '').toString()
      if (!ok && reason !== 'already joined') {
        setJoiningId(0)
        return toast?.(reason || 'Invite not valid or lobby closed.', 'error')
      }

      // Same one-tx join as JoinPanel (join + Games-ID + relayer approval)
      const gidAddress = getGamesIdAddressFromPrivyUser(user)
      const idToUse = gidAddress ? ethers.getAddress(gidAddress) : ethers.ZeroAddress

      toast?.(gidAddress ? 'Joining with your Monad Games ID…' : 'Joining…', 'loading')
      const tx = await game.joinWithSetup(gid, idToUse, { delegateExpiry: 0 })
      await tx.wait()

      toast?.('Joined lobby!', 'success')
      onJoined?.({ code: codeUpper, gameId: String(gid) })
      localStorage.setItem('activeGame', JSON.stringify({ id: String(gid), code: codeUpper }))

      // optimistically bump players count
      setItems(prev => prev.map(x => x.gameId === it.gameId
        ? { ...x, playersNow: Math.min((x.playersNow||0)+1, x.maxPlayers||x.playersNow) }
        : x))
    } catch (e) {
      const msg = e?.shortMessage || e?.reason || e?.message || 'Join failed'
      toast?.(msg, 'error')
    } finally {
      setJoiningId(0)
    }
  }

  if (loading && !items.length) {
    return (
      <div className="mt-6 rounded-xl border border-white/10 p-4 text-sm text-white/70">
        Loading public lobbies…
      </div>
    )
  }
  if (!items.length) return null

  const fmtMon = (v) => {
    try {
      const bn = typeof v === 'string' ? BigInt(v) : BigInt(v || 0)
      return Number(ethers.formatEther(bn)).toLocaleString(undefined, { maximumFractionDigits: 6 })
    } catch { return '0' }
  }

  return (
    <div className="mt-6 rounded-xl border border-white/10 overflow-hidden">
      <div className="px-4 py-3 bg-white/5 text-sm font-medium">Public games</div>
      <ul className="divide-y divide-white/10">
        {items.map((it) => {
          const expired = nowSec >= it.expiresAt

          const joinDisabled = it.status !== 1 || expired || (it.playersNow >= (it.maxPlayers || 0))
          return (
            <li key={it.gameId} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm">
                  Code: <span className="font-mono tracking-widest">{it.code}</span>
                </div>
                <div className="text-xs text-white/60 flex gap-3">
                  <span>{it.playersNow}/{it.maxPlayers || '—'} players</span>
                  <span>expires in {fmtCountdown(it.expiresAt - nowSec)}</span>
                  { (it.prizeAmount && it.prizeAmount !== '0') ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="opacity-70">prize</span>
                      <span className="text-white/80">{fmtMon(it.prizeAmount)} MON</span>
                    </span>
                  ) : null }
                </div>
              </div>

              <button
                className={`px-3 py-1.5 rounded-md border ${
                  joinDisabled
                    ? 'opacity-50 cursor-not-allowed bg-slate-900 border-white/10'
                    : 'bg-indigo-600 border-indigo-500 hover:bg-indigo-500'
                }`}
                disabled={joinDisabled || joiningId === it.gameId}
                onClick={() => joinLobby(it)}
                title={joinDisabled ? 'Not joinable' : 'Join lobby'}
              >
                {joiningId === it.gameId ? 'Joining…' : 'Join'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
