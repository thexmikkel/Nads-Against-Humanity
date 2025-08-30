import React, { useEffect, useRef, useState } from 'react'
import useMyLBScore from '../hooks/useMyLBScore.js'
import { formatMonDisplay } from '../utils/formatMon'

export default function Header({
  connected,
  onConnect,
  onLogout,
  username,
  address,           // tx wallet (embedded)
  balance,           // string like "2.3456" MON
  onRefreshBalance,  // optional async fn to refresh balance
}) {
  const { loading: lbLoading, score, txs } = useMyLBScore(connected ? address : null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const refProfile = useRef(null)
  const refMenu = useRef(null)

  useEffect(() => {
    function onDoc(e) {
      if (profileOpen && refProfile.current && !refProfile.current.contains(e.target)) setProfileOpen(false)
      if (menuOpen && refMenu.current && !refMenu.current.contains(e.target)) setMenuOpen(false)
    }
    function onEsc(e) {
      if (e.key === 'Escape') { setProfileOpen(false); setMenuOpen(false) }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [profileOpen, menuOpen])

  const shortAddr = address ? `${address.slice(0,6)}…${address.slice(-4)}` : '—'

  // Helper: open <dialog> by id, supports both camelCase and PascalCase ids
  const openModal = (id) => {
    setMenuOpen(false)
    const el =
      document.getElementById(id) ||
      document.getElementById(id.charAt(0).toUpperCase() + id.slice(1))
    if (el && typeof el.showModal === 'function') el.showModal()
    else console.warn('Modal not found or not a <dialog>:', id)
  }

  return (
    <header className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Monad CAH</h1>

        <div className="ml-auto flex items-center gap-2">
          {!connected ? (
            <button onClick={onConnect} className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500">
              Sign in
            </button>
          ) : (
            <>
              {/* Profile dropdown */}
              <div className="relative" ref={refProfile}>
                <button
                  onClick={() => setProfileOpen(v => !v)}
                  className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700"
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                >
                  {username ? `${username}` : 'Set an alias'}
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
                    <div className="px-3 py-2 text-sm text-slate-400 border-b border-slate-800">
                      {username ? <>Signed in as <span className="text-slate-200">{username}</span></> : 'No alias yet!'}
                    </div>

                    {/* Game wallet (tx wallet) */}
                    <div className="px-3 py-2 text-sm">
                      <div className="text-slate-400 mb-1">Game wallet (for fees)</div>
                      <button
                        className="w-full text-left px-2 py-2 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700"
                        onClick={() => { if (address) navigator.clipboard.writeText(address) }}
                        title="Copy wallet address to top up MON"
                      >
                        <span className="font-mono">{shortAddr}</span> — copy
                      </button>

                      {/* Balance row */}
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-slate-400">Balance</div>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{formatMonDisplay(balance)} <span className="text-slate-400">MON</span></div>
                          {onRefreshBalance && (
                            <button
                              onClick={onRefreshBalance}
                              className="px-2 py-1 text-xs rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700"
                              title="Refresh balance"
                            >
                              Refresh
                            </button>
                          )}
                        </div>
                      </div>

                       {/* Withdraw trigger UNDER balance */}
                      <button
                        onClick={() => { setProfileOpen(false); openModal('withdrawModal') }}
                        className="mt-2 w-full text-left px-2 py-2 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700"
                        title="Send MON to another address"
                      >
                        Withdraw
                      </button>
                    
                    </div>

                    <div className="px-3 py-2 text-xs border-t border-slate-700">
                      <div className="flex items-center justify-between">
                        <span className="opacity-70">Your score</span>
                        <span className="font-semibold tabular-nums">
                          {lbLoading ? '…' : score}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between opacity-70">
                        <span>Transactions</span>
                        <span className="tabular-nums">{lbLoading ? '…' : txs}</span>
                      </div>
                    </div>

                    {!username && (
                      <a
                        className="block px-3 py-2 text-sm hover:bg-slate-800"
                        href="https://monad-games-id-site.vercel.app/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Reserve username →
                      </a>
                    )}

                    <div className="border-t border-slate-800" />
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800 text-rose-300"
                      onClick={() => { setProfileOpen(false); onLogout?.() }}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>

              {/* Hamburger dropdown */}
              <div className="relative" ref={refMenu}>
                <button
                  onClick={() => setMenuOpen(v => !v)}
                  className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls="mainMenu"
                >
                  ☰
                </button>

                {menuOpen && (
                  <div
                    id="mainMenu"
                    className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-800 bg-slate-900 shadow-xl overflow-hidden"
                    role="menu"
                  >
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800"
                      onClick={() => openModal('cardsModal')}
                      role="menuitem"
                    >
                      Cards
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800"
                      onClick={() => openModal('recallModal')}
                      role="menuitem"
                    >
                      Recall game stats
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
