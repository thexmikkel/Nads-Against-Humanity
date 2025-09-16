// src/components/panels/CreatePanel.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import { usePrivy } from '@privy-io/react-auth'
import { toast } from '../../lib/toast.jsx'
import { randomInvite, inviteHash } from '../../lib/invite.js'
import { buildDomain, PublishLobbyTypes, buildPublishLobbyMessage, signTyped } from '../../lib/eip712.js'

const MONAD_ID = 10143
const MONAD_HEX = '0x279f'
const GID_APP_ID = import.meta.env.VITE_MONAD_GID_APP_ID || 'cmd8euall0037le0my79qpz42'

function getGamesIdAddressFromPrivyUser(user) {
  try {
    const cross = user?.linkedAccounts?.find?.(
      (acc) => acc.type === 'cross_app' && acc.providerApp?.id === GID_APP_ID
    )
    return cross?.embeddedWallets?.[0]?.address || ''
  } catch { return '' }
}

export default function CreatePanel({ open, disabled, onClose, onCreated, getGame }) {
  const [feeWei, setFeeWei] = useState(0n)
  const [fee, setFee]       = useState('0')
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [expiry, setExpiry] = useState(15) // minutes
  const [usePrize, setUsePrize] = useState(false)
  const [prize, setPrize] = useState('0')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [isPublic, setIsPublic] = React.useState(false)
  const { user } = usePrivy()

  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const game = await getGame()
        const fw = await game.gameFee()
        setFeeWei(fw)
        setFee(ethers.formatEther(fw))
      } catch {
        setFeeWei(0n); setFee('0')
      }
    })()
  }, [open, getGame])

  useEffect(() => {
    if (!open) return
    setCode(randomInvite())
  }, [open])

  const estTotal = useMemo(() => {
    const f = Number(fee || '0')
    const p = usePrize ? Number(prize || '0') : 0
    const total = (isFinite(f) ? f : 0) + (isFinite(p) ? p : 0)
    return total.toFixed(6)
  }, [fee, usePrize, prize])

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

  function shuffleCode() { setCode(randomInvite()) }

  async function publishLobby({ gameId, code, expiryTs, maxPlayers, usePrize, prizeAmount }) {
    try {
      await fetch('/api/public-lobbies/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gameId,
          code,
          expiresAt: Number(expiryTs || 0),
          maxPlayers,
          usePrize: !!usePrize,
          prizeAmount: String(prizeAmount || 0),
        })
      })
    } catch {}
  }

  async function doCreate() {
    if (disabled || busy) return
    const codeUpper = (code || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(codeUpper)) return toast('Invalid code format', 'error')
    if (maxPlayers < 2 || maxPlayers > 10) return toast('Pick 2–10 players', 'error')
    if (expiry < 3 || expiry > 30) return toast('Expiry must be 3–30 minutes', 'error')
    if (usePrize && !/^[0-9]*\.?[0-9]*$/.test(prize || '')) return toast('Bad prize amount', 'error')

    setBusy(true)
    try {
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      await ensureMonad(provider)

      const hash = inviteHash(codeUpper)
      const prizeWei = usePrize ? ethers.parseEther((prize || '0').trim() || '0') : 0n
      const total = feeWei + prizeWei

      const gidAddress = getGamesIdAddressFromPrivyUser(user)
      const gamesID = gidAddress ? ethers.getAddress(gidAddress) : ethers.ZeroAddress

      toast('Creating lobby…', 'loading')
      const tx = await game.createGameWithSetup(
        hash,
        Number(maxPlayers),
        Number(expiry) * 60,
        Boolean(usePrize),
        prizeWei,
        gamesID,
        { delegateExpiry: 0 },
        { value: total }
      )
      const rcpt = await tx.wait()

      let createdId = null
        try {
          for (const log of rcpt.logs || []) {
            try {
              const parsed = game.interface.parseLog(log)
              if (parsed?.name === 'GameCreated') {
                createdId = Number(parsed.args?.gameId ?? 0n); break
              }
            } catch {}
          }
        } catch {}
        
        // Publish to Public Lobbies (signed by creator)
        // Requires env: VITE_GAME_ADDRESS
        if (isPublic && createdId) {
          (async () => {
            try {
              const chainId = 10143 // Monad Testnet
              const gameAddr = import.meta.env.VITE_GAME_ADDRESS
              const signerObj = game.runner // ethers v6 Contract has .runner (Signer)
              const signerAddr = await signerObj.getAddress()
        
              const domain = buildDomain(chainId, gameAddr)
              const inviteCodeHash = inviteHash(codeUpper)
              const deadline = Math.floor(Date.now() / 1000) + 10 * 60
        
              const sig = await signTyped(
                signerObj,
                domain,
                PublishLobbyTypes,
                buildPublishLobbyMessage({ signer: signerAddr, gameId: createdId, inviteCodeHash, deadline })
              )
        
              // You can still send extra UI info; server will derive truth from chain anyway
              await fetch('/api/public-lobbies/add', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  gameId: Number(createdId),
                  code: codeUpper,
                  signer: signerAddr,
                  deadline,
                  sig,
                }),
              })
            } catch (e) {
              console.debug('public lobby publish failed:', e)
            }
          })()
        }


      toast('Lobby created!', 'success')
      onCreated?.({ code: codeUpper, gameId: createdId ?? null })
      try { await navigator.clipboard.writeText(codeUpper) } catch {}
      localStorage.setItem('activeGame', JSON.stringify({ id: String(createdId ?? ''), code: codeUpper }))
      onClose?.()
    } catch (e) {
      const msg = e?.shortMessage || e?.message || 'Create failed'
      toast(msg, 'error')
    } finally { setBusy(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-full flex items-start justify-center p-4 sm:p-6">
        <div className="w-[980px] max-w-[96vw] rounded-2xl p-[1px] bg-gradient-to-br from-indigo-500/40 via-fuchsia-500/40 to-cyan-500/40 shadow-2xl">
          <div className="rounded-2xl bg-[#0b0e17]/95 border border-white/10 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="p-4 sm:p-6 border-b border-white/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold tracking-tight">Create game</h3>
                  <p className="text-xs text-white/60 mt-1">Share the invite code with friends and start playing.</p>
                </div>
                <button
                  className="text-white/70 hover:text-white text-sm px-3 py-1.5 rounded-md bg-white/5 border border-white/10"
                  onClick={onClose}
                >
                  Close
                </button>
              </div>
            </div>
  
            {/* Body (scroll area) */}
            <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
                {/* LEFT: form */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Row 1: Invite + Max players */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Invite code */}
                    <label className="flex flex-col gap-2">
                      <span className="text-sm text-white/70">Invite code</span>
                      <div className="flex items-center gap-2">
                        <input
                          className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-white/10 tracking-widest uppercase font-mono"
                          value={code}
                          maxLength={6}
                          onChange={(e) =>
                            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                          }
                          placeholder="ABC123"
                        />
                        <button
                          onClick={shuffleCode}
                          title="Shuffle"
                          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                        >
                          🎲
                        </button>
                      </div>
                      <p className="text-xs text-white/50">6 chars, letters & digits.</p>
                    </label>
  
                    {/* Max players (quick picks) */}
                    <label className="flex flex-col gap-2">
                      <span className="text-sm text-white/70">Max players</span>
                      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                        {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setMaxPlayers(n)}
                            className={`h-10 rounded-lg border text-sm ${
                              maxPlayers === n
                                ? 'bg-indigo-600 border-indigo-500'
                                : 'bg-slate-900 border-white/10 hover:bg-slate-800'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-white/50">
                        Pick between 3 and 10. Lobby autostarts when full.
                      </p>
                    </label>
                  </div>
  
                  {/* Row 2: Expiry + Presets */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Expiry slider */}
                    <label className="flex flex-col gap-2">
                      <span className="text-sm text-white/70">Lobby expiry</span>
                      <input
                        type="range"
                        min="3"
                        max="30"
                        value={expiry}
                        onChange={(e) => setExpiry(Number(e.target.value))}
                        className="w-full"
                      />
                      <div className="text-xs text-white/60">
                        Expires in <span className="text-white/80">{expiry} minutes</span>
                      </div>
                    </label>
  
                    {/* Expiry quick picks */}
                    <div className="flex flex-col gap-2">
                      <span className="text-sm text-white/70">Quick picks</span>
                      <div className="flex flex-wrap gap-2">
                        {[5, 10, 15, 20, 25, 30].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setExpiry(m)}
                            className={`px-3 py-2 rounded-lg border text-sm ${
                              expiry === m
                                ? 'bg-fuchsia-600 border-fuchsia-500'
                                : 'bg-slate-900 border-white/10 hover:bg-slate-800'
                            }`}
                          >
                            {m}m
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Public lobby toggle */}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isPublic}
                          onChange={(e) => setIsPublic(e.target.checked)}
                        />
                        <span className="text-sm text-white/80">List this lobby in Public Lobbies</span>
                      </label>
                  </div>
  
                  <p className="text-[11px] text-white/50">
                    Winners split any prize evenly. Any remainder goes to the first winner.
                  </p>
                </div>
  
                {/* RIGHT: summary / payment */}
                <aside className="lg:col-span-1">
                  <div className="rounded-xl border border-white/10 bg-slate-900/60">
                    <div className="p-4 border-b border-white/10 text-sm font-medium">Summary</div>
                    <div className="p-4 space-y-4">
                      {/* Prize toggle + amount */}
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={usePrize}
                            onChange={(e) => setUsePrize(e.target.checked)}
                          />
                          <span className="text-sm">Prize pool</span>
                        </label>
                        <input
                          className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 w-32 sm:w-36 text-right disabled:opacity-50"
                          disabled={!usePrize}
                          placeholder="0.00"
                          value={prize}
                          onChange={(e) => setPrize(e.target.value)}
                        />
                      </div>
  
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/60">Fee</span>
                        <span>{fee} MON</span>
                      </div>
  
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/60">Players</span>
                        <span>{maxPlayers}</span>
                      </div>
  
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/60">Expires</span>
                        <span>{expiry}m</span>
                      </div>
  
                      <div className="h-px bg-white/10" />
  
                      <div className="flex items-center justify-between">
                        <span className="text-white/70">Total</span>
                        <span className="text-lg font-semibold text-indigo-300">{estTotal} MON</span>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
  
            {/* Footer */}
            <div className="p-4 sm:p-6 pt-3 border-t border-white/10 flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 disabled:opacity-60"
                onClick={doCreate}
                disabled={disabled || busy}
              >
                {busy ? 'Creating…' : 'Create game'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
