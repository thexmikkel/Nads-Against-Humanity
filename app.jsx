import React, { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import MagicBackground from './ui/MagicBackground.jsx'
import { ethers } from 'ethers'
import { usePrivy, useWallets } from '@privy-io/react-auth'

import Docs from './pages/Docs'
import Header from './components/Header.jsx'
import JoinPanel from './components/panels/JoinPanel.jsx'
import CreatePanel from './components/panels/CreatePanel.jsx'
import LobbyCard from './components/LobbyCard.jsx'
import RecallModal from './components/modals/RecallModal.jsx'
import WithdrawModal from './components/modals/WithdrawModal.jsx'
import CardsModal from './components/modals/CardsModal.jsx'
import GameInstance from './components/GameInstance.jsx'

import { ToastHost, toast } from './lib/toast.jsx'
import useContracts from './hooks/useContracts.js'

export default function App() {
  const { login, logout, authenticated, ready, user } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()

  // tx wallet (embedded)
  const [signer, setSigner] = useState(null)
  const [address, setAddress] = useState('')
  const [balance, setBalance] = useState('')

  // Games ID
  const [gidAddress, setGidAddress] = useState('')
  const [username, setUsername] = useState(null)

  // Panels
  const [showJoin, setShowJoin] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  // Active game + in-game
  const [activeGame, setActiveGame] = useState(() => {
    try { return JSON.parse(localStorage.getItem('activeGame') || 'null') } catch { return null }
  })
  const [inGame, setInGame] = useState(false)

  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === 'privy'),
    [wallets]
  )

  const { getGame, getCards, getGameRead } = useContracts(embedded)

  async function handleConnect() {
    if (!ready) return toast('Initializing sign-in… try again in a second', 'loading')
    if (authenticated) return
    try {
      await login()
    } catch (e) {
      console.warn('login() failed', e)
      toast('Sign in failed. Check Privy allowed origins & provider enabled.', 'error')
    }
  }

  async function handleLogout() {
    try { await logout() } finally {
      setSigner(null); setAddress(''); setBalance('')
      setGidAddress(''); setUsername(null)
      setShowJoin(false); setShowCreate(false)
      setActiveGame(null); localStorage.removeItem('activeGame'); setInGame(false)
    }
  }

  // Balance refresh helper
  async function refreshBalance() {
    if (!address || !embedded) return
    try {
      const eip1193 = await embedded.getEthereumProvider()
      const provider = new ethers.BrowserProvider(eip1193)
      const bal = await provider.getBalance(address) // bigint
      setBalance(ethers.formatEther(bal))
    } catch {
      try {
        const eip1193 = await embedded.getEthereumProvider()
        const raw = await eip1193.request({ method: 'eth_getBalance', params: [address, 'latest'] })
        setBalance(ethers.formatEther(BigInt(raw)))
      } catch { setBalance('') }
    }
  }

  async function handleLeaveLobby(gameId) {
  try {
    const id = typeof gameId === 'bigint' ? gameId : BigInt(gameId)
    const game = await getGame() // signer-connected
    const tx = await game.leaveLobby(id)
    toast?.('Leaving lobby…', 'info')
    await tx.wait()
    // clear local cache
    setActiveGame(null)
    localStorage.removeItem('activeGame')
    setInGame(false)
    toast?.('Left lobby', 'success')
  } catch (err) {
    const msg = err?.shortMessage || err?.message || String(err)
    // helpful hints based on common reverts in contract
    if (/started|closed|finished|cancelled/i.test(msg)) {
      toast?.('Lobby already started/closed', 'warn')
      // reflect reality in UI
    } else if (/expired/i.test(msg)) {
      toast?.('Lobby expired', 'warn')
      setActiveGame(null)
      localStorage.removeItem('activeGame')
      setInGame(false)
    } else {
      toast?.(`Leave failed: ${msg}`, 'error')
    }
  }
  }
  
function toWeiFromMonString(input) {
  const s = String(input ?? '').trim().replace(',', '.')
  if (!/^\d*\.?\d*$/.test(s)) throw new Error('Invalid amount format')
  if (s === '' || s === '.') return 0n
  const [whole = '0', fracRaw = ''] = s.split('.')
  const frac = (fracRaw + '0'.repeat(18)).slice(0, 18) // pad/truncate to 18 dp
  return BigInt(whole || '0') * 10n ** 18n + BigInt(frac || '0')
}

async function handleWithdrawConfirm({ to, amountMon, max }) {
  if (!signer || !address) throw new Error('Wallet not ready')

  const provider = signer.provider
  const from = await signer.getAddress()
  const toAddr = ethers.getAddress(to)

  // Balance & fee data
  const bal = await provider.getBalance(from) // bigint
  if (bal === 0n) throw new Error('No MON to withdraw')

  const fee = await provider.getFeeData()
  // Prefer EIP-1559, fallback to legacy gasPrice, fallback to getGasPrice()
  let gasPrice = fee.gasPrice ?? fee.maxFeePerGas
  if (!gasPrice && provider.getGasPrice) {
    try { gasPrice = await provider.getGasPrice() } catch {}
  }
  if (!gasPrice) throw new Error('Could not fetch gas price')

  const gasLimit = 21000n
  const gasCost = gasPrice * gasLimit
  if (bal <= gasCost) throw new Error('Not enough MON to cover gas')

  // Amount → wei (bigint)
  let value
  if (max) {
    value = bal - gasCost
    if (value <= 0n) throw new Error('Nothing left to withdraw after gas')
  } else {
    const wantWei = toWeiFromMonString(amountMon)
    if (wantWei <= 0n) throw new Error('Invalid amount')
    if (wantWei + gasCost > bal) throw new Error('Insufficient balance for gas + amount')
    value = wantWei
  }

  // Build tx (use EIP-1559 fields if present)
  const txParams = (fee.maxFeePerGas && fee.maxPriorityFeePerGas)
    ? { to: toAddr, value, gasLimit,
        maxFeePerGas: fee.maxFeePerGas,
        maxPriorityFeePerGas: fee.maxPriorityFeePerGas }
    : { to: toAddr, value, gasLimit, gasPrice }

  const tx = await signer.sendTransaction(txParams)
  await tx.wait()
  await refreshBalance?.()
}

  // Hydrate signer/address + initial balance
  useEffect(() => {
    (async () => {
      if (!authenticated || !walletsReady || !embedded) return
      try {
        try { await embedded.switchChain(10143) } catch {}
        const eip1193 = await embedded.getEthereumProvider()
        const provider = new ethers.BrowserProvider(eip1193)
        const s = await provider.getSigner()
        const addr = await s.getAddress()
        setSigner(s)
        setAddress(addr)
        try {
          const bal = await provider.getBalance(addr)
          setBalance(ethers.formatEther(bal))
        } catch {
          try {
            const raw = await eip1193.request({ method: 'eth_getBalance', params: [addr, 'latest'] })
            setBalance(ethers.formatEther(BigInt(raw)))
          } catch { setBalance('') }
        }
      } catch (e) {
        console.warn('signer init failed', e)
        setSigner(null); setAddress(''); setBalance('')
      }
    })()
  }, [authenticated, walletsReady, embedded])
  
  // Chain-driven reconnect (no tx)
  useEffect(() => {
    let killed = false
    async function run() {
      try {
        if (!authenticated || !address || !getGameRead) return
        const game = await getGameRead()
        const info = await game.rejoinInfo(address)
        const can = Boolean(info?.[0])
        const gid = info?.[1] ? Number(info[1]) : 0
        if (!can || gid === 0) {
          if (!killed) {
            const local = (() => { try { return JSON.parse(localStorage.getItem('activeGame')||'null') } catch { return null } })()
            if (local?.id) {
              localStorage.removeItem('activeGame')
              setActiveGame(null)
            }
          }
          return
        }
        const meta = await game.getGameMeta(gid)
        const expiryTs = Number(meta?.[5] ?? 0)
        let code = null
        try {
          const local = JSON.parse(localStorage.getItem('activeGame') || 'null')
          if (local?.id && Number(local.id) === gid && local.code) code = local.code
        } catch {}
        if (!killed) {
          const next = { id: String(gid), code, expiryTs }
          setActiveGame(next)
          localStorage.setItem('activeGame', JSON.stringify(next))
        }
      } catch {}
    }
    run()
    const iv = setInterval(run, 10_000)
    return () => { killed = true; clearInterval(iv) }
  }, [authenticated, address, getGameRead])

  // Auto-refresh balance on account/chain changes
  useEffect(() => {
    let off = () => {}
    ;(async () => {
      if (!embedded) return
      const eip1193 = await embedded.getEthereumProvider()
      const handler = () => refreshBalance()
      if (eip1193?.on) {
        eip1193.on('accountsChanged', handler)
        eip1193.on('chainChanged', handler)
        off = () => {
          eip1193.removeListener?.('accountsChanged', handler)
          eip1193.removeListener?.('chainChanged', handler)
        }
      }
    })()
    return () => off()
  }, [embedded, address])

  // Games-ID wallet + alias
  useEffect(() => {
    try {
      const cross = user?.linkedAccounts?.find?.(
        (acc) => acc.type === 'cross_app' && acc.providerApp?.id === 'cmd8euall0037le0my79qpz42'
      )
      const addr = cross?.embeddedWallets?.[0]?.address || ''
      setGidAddress(addr || '')
    } catch { setGidAddress('') }
  }, [user])

  useEffect(() => {
    (async () => {
      if (!gidAddress) { setUsername(null); return }
      try {
        const r = await fetch(`https://monad-games-id-site.vercel.app/api/check-wallet?wallet=${gidAddress}`)
        if (r.ok) {
          const j = await r.json()
          setUsername(j?.hasUsername ? j.user.username : null)
        } else setUsername(null)
      } catch { setUsername(null) }
    })()
  }, [gidAddress])

  // Link embedded -> Games-ID once (signed by embedded key)
  useEffect(() => {
    (async () => {
      try {
        if (!signer || !address || !gidAddress) return
  
        // avoid spamming: if we already linked this pair in this session, skip
        const cacheKey = `addrmap:${address.toLowerCase()}`
        const cached = localStorage.getItem(cacheKey)
        if (cached && cached.toLowerCase() === gidAddress.toLowerCase()) return
  
        // Check server first; skip if already correct
        const probe = await fetch(`/api/addrmap/get?addr=${address}`)
        if (probe.ok) {
          const { value } = await probe.json()
          if (value && value.toLowerCase() === gidAddress.toLowerCase()) {
            localStorage.setItem(cacheKey, gidAddress)
            return
          }
        }
  
        const nonce = Date.now()                    // monotonic per client
        const exp   = Math.floor(Date.now()/1000) + 300  // 5 min expiry
        const msg   = `link:${ethers.getAddress(gidAddress)}:${nonce}:${exp}`
        const sig   = await signer.signMessage(msg) // embedded key signs
  
        const r = await fetch('/api/addrmap/put', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            key: address,
            value: gidAddress,
            sig,
            nonce,
            exp
          })
        })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          console.warn('addrmap put failed', r.status, j)
          return
        }
        localStorage.setItem(cacheKey, gidAddress)
        console.log('[addrmap] linked', { embedded: address, identity: gidAddress })
      } catch (e) {
        console.warn('[addrmap] link failed', e)
      }
    })()
  }, [signer, address, gidAddress])

  const connected = authenticated && !!signer && !!address

  return (
  <BrowserRouter>
    <MagicBackground />

    <div className="relative min-h-dvh text-slate-100">
      {/* Header stays outside Routes so it shows on every page */}
      <Header
        connected={connected}
        onConnect={handleConnect}
        onLogout={handleLogout}
        username={username}
        address={address}
        balance={balance}
        onRefreshBalance={refreshBalance}
      />

      <Routes>
        {/* HOME */}
        <Route
          path="/"
          element={
            <main className="max-w-6xl mx-auto px-4 py-10">
              <section className="py-12 flex flex-col items-center">
                <h2 className="text-3xl font-semibold mb-3">
                  Nads against humanity
                </h2>

                <p className="text-center text-slate-400 floaty mb-4">
                  {connected ? 'Let the fun begin!' : 'Sign in to begin playing'}
                </p>

                {/* Reconnect banner */}
                {!showCreate && !showJoin && activeGame?.id && !inGame && (
                  <div className="mb-6 w-full max-w-3xl rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm flex items-center justify-between">
                    <div>
                      You have an active game (ID #{activeGame.id})
                      {activeGame.code ? (
                        <> — code <span className="font-mono">{activeGame.code}</span></>
                      ) : null}
                      .
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700"
                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                      >
                        Open lobby
                      </button>
                    </div>
                  </div>
                )}

                {/* Lobby / Game */}
                {activeGame && inGame ? (
                  <GameInstance
                    activeGame={activeGame}
                    address={address}
                    getGameRead={getGameRead}
                    getGame={getGame}
                    onExitToLobby={() => setInGame(false)}
                  />
                ) : activeGame ? (
                  <LobbyCard
                    activeGame={activeGame}
                    address={address}
                    getGameRead={getGameRead}
                    getGame={getGame}
                    onLeaveLobby={() => activeGame?.id && handleLeaveLobby(activeGame.id)}
                    onStatus={(st) => { if (st === 'Started') setInGame(true) }}
                  />
                ) : null}

                {/* Landing only when no active game */}
                {!activeGame && (
                  <>
                    <Landing
                      connected={connected}
                      onOpenJoin={() => setShowJoin(true)}
                      onOpenCreate={() => setShowCreate(true)}
                    />
                    <JoinPanel
                      open={showJoin}
                      onClose={() => setShowJoin(false)}
                      disabled={!connected}
                      onJoined={({ code, gameId }) => {
                        setShowJoin(false)
                        const next = { id: gameId ? String(gameId) : null, code, joinedAt: Date.now() }
                        setActiveGame(next)
                        localStorage.setItem('activeGame', JSON.stringify(next))
                        toast(gameId ? `Joined game #${gameId}` : 'Joined game', 'success')
                      }}
                      getGame={getGame}
                    />
                    <CreatePanel
                      open={showCreate}
                      onClose={() => setShowCreate(false)}
                      disabled={!connected}
                      onCreated={({ code, gameId }) => {
                        setShowCreate(false)
                        const next = { id: gameId ? String(gameId) : null, code, createdAt: Date.now() }
                        setActiveGame(next)
                        localStorage.setItem('activeGame', JSON.stringify(next))
                        toast(gameId ? `Game #${gameId} created` : 'Game created', 'success')
                      }}
                      getGame={getGame}
                    />
                  </>
                )}
              </section>
            </main>
          }
        />

        {/* DOCS */}
        <Route path="/docs" element={<Docs />} />
      </Routes>

      {/* Modals live outside Routes so they’re available everywhere */}
      <CardsModal getCards={getCards} />
      <RecallModal />
      <WithdrawModal
        balanceMon={balance}
        onConfirm={handleWithdrawConfirm}
        toast={toast}
      />

      <footer className="py-10">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-center gap-6 text-slate-400 text-sm">
          <a href="https://x.com/" target="_blank" rel="noreferrer">X</a>
          <a href="https://discord.gg/" target="_blank" rel="noreferrer">Discord</a>
          <a href="https://github.com/" target="_blank" rel="noreferrer">GitHub</a>
          {/* use Link for client-side nav */}
          <Link to="/docs">Docs</Link>
        </div>
      </footer>

      <ToastHost />
    </div>
  </BrowserRouter>
)
}

function Landing({ connected, onOpenJoin, onOpenCreate }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <button
        className="px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 w-64 disabled:opacity-50"
        disabled={!connected}
        onClick={onOpenJoin}
      >
        Join a game
      </button>
      <button
        className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 w-64 disabled:opacity-50"
        disabled={!connected}
        onClick={onOpenCreate}
      >
        Create a game
      </button>
    </div>
  )
}
