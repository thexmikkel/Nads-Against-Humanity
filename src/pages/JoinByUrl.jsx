// src/pages/JoinByUrl.jsx
import React from 'react'
import { ethers } from 'ethers'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'

// Minimal toast; swap for your own toast if you have one
function toast(msg) { console.log('[join]', msg) }

// --- Chain helpers -----------------------------------------------------------
const MONAD_ID = 10143
const MONAD_HEX = '0x279f'
async function ensureMonad(provider) {
  const net = await provider.getNetwork()
  if (Number(net.chainId) === MONAD_ID) return
  try {
    await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
  } catch (err) {
    const c = err && err.code
    const msg = String((err && err.message) || '')
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

// --- Privy Games-ID helper ---------------------------------------------------
const GID_APP_ID =
  (import.meta.env.VITE_MONAD_GID_APP_ID || import.meta.env.VITE_PRIVY_APP_ID || '').trim()

function getGamesIdAddressFromPrivyUser(user) {
  try {
    // If you’re using a dedicated Privy app for the Games ID:
    const cross = user?.linkedAccounts?.find?.(
      (acc) => acc.type === 'cross_app' && acc.providerApp?.id === GID_APP_ID
    )
    // If you’re not using cross-app, fall back to the first embedded wallet:
    const addr =
      cross?.embeddedWallets?.[0]?.address ||
      user?.wallet?.address ||
      user?.linkedAccounts?.find?.(a => a.type === 'wallet')?.address ||
      ''
    return addr || ''
  } catch {
    return ''
  }
}

/**
 * Props:
 * - getGame: () => ethers.Contract (with signer)
 * - onJoined?: ({ gameId, code }) => void
 */
export default function JoinByUrl({ getGame, onJoined }) {
  const nav = useNavigate()
  const loc = useLocation()
  const params = useParams()
  const { user } = usePrivy()

  const [status, setStatus] = React.useState('Parsing invite…')
  const [error, setError] = React.useState('')

  const codeFromUrl = React.useMemo(() => {
    const sp = new URLSearchParams(loc.search)
    // supports /join?code=ABCD or /join/ABCD
    return (sp.get('code') || params.code || '').trim()
  }, [loc.search, params.code])

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = codeFromUrl
        if (!raw) {
          setError('No invite code in URL')
          return
        }
        const code = raw.toUpperCase()
        setStatus(`Resolving lobby for code "${code}"…`)

        const game = await getGame()
        const provider = game.runner?.provider || game.provider
        if (!provider) throw new Error('Wallet/provider not ready')
        await ensureMonad(provider)

        const signer = game.runner || game.signer
        const me = await signer.getAddress()

        // Resolve invite -> gameId and joinability
        const inviteHash = ethers.keccak256(ethers.toUtf8Bytes(code))
        const res = await game.canJoinByCode.staticCall(inviteHash, me)
        const ok = Boolean(res?.[0])
        const gameId = Number(res?.[1] || 0n)
        const reason = (res?.[2] || '').toString()

        if (!gameId) {
          throw new Error(reason || 'Unknown invite code')
        }

        // One-tx join: join + link Games-ID + relayer approval (consent)
        const gidAddr = getGamesIdAddressFromPrivyUser(user)
        const gamesID = gidAddr ? ethers.getAddress(gidAddr) : ethers.ZeroAddress

        // Even if reason == "already joined", we can still call joinWithSetup to
        // backfill identity/consent without re-adding the player (contract handles it).
        setStatus(ok ? 'Joining lobby…' : 'Syncing your identity…')
        const tx = await game.joinWithSetup(
          gameId,
          gamesID,
          { delegateExpiry: 0 } // set >0 (e.g., 86400) if you want a time limit
        )
        setStatus('Confirming transaction…')
        await tx.wait()

        if (cancelled) return
        toast('Ready!')
        onJoined?.({ gameId, code })
        // Persist active game in localStorage so the LobbyCard picks it up
        try { localStorage.setItem('activeGame', JSON.stringify({ id: String(gameId), code })) } catch {}
        // Strip the join URL so refresh doesn’t try again
        nav('/', { replace: true })
      } catch (e) {
        if (cancelled) return
        const msg = e?.shortMessage || e?.reason || e?.message || 'Join failed'
        setError(msg)
      }
    })()
    return () => { cancelled = true }
  }, [codeFromUrl, getGame, nav, onJoined, user])

  return (
    <div className="min-h-[60vh] grid place-items-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-xl font-semibold mb-2">Joining Lobby</h2>
        {!error ? (
          <p className="text-slate-300">{status}</p>
        ) : (
          <>
            <p className="text-red-400 mb-3">{error}</p>
            <button
              className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500"
              onClick={() => nav('/')}
            >
              Go home
            </button>
          </>
        )}
      </div>
    </div>
  )
}
