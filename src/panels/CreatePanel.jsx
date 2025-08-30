// src/components/panels/CreatePanel.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import { usePrivy } from '@privy-io/react-auth'
import { toast } from '../../lib/toast.jsx'
import { randomInvite, inviteHash } from '../../lib/invite.js'

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
  const [fee, setFee] = useState('0.1')
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [expiry, setExpiry] = useState(15)
  const [usePrize, setUsePrize] = useState(false)
  const [prize, setPrize] = useState('0')
  const [busy, setBusy] = useState(false)
  const [estTotal, setEstTotal] = useState(null)
  const { user } = usePrivy()

  useEffect(() => {
    (async () => {
      if (!open || disabled) return
      try {
        const game = await getGame()
        const f = await game.gameFee()
        setFee(ethers.formatEther(f))
      } catch {}
    })()
  }, [open, disabled, getGame])

  useEffect(() => {
    (async () => {
      if (!open || disabled) return setEstTotal(null)
      try {
        const game = await getGame()
        const provider = game.runner?.provider || game.provider
        const feeWei = await game.gameFee()
        const prizeWei = usePrize ? ethers.parseEther((prize || '0').trim()) : 0n
        const totalWei = feeWei + prizeWei

        let totalWithGas = totalWei
        try {
          const gas = await game.createGame.estimateGas(
            inviteHash('ABC123'), maxPlayers, expiry * 60, usePrize, prizeWei, { value: totalWei }
          )
          const fd = await provider.getFeeData()
          const gp = fd.gasPrice ?? fd.maxFeePerGas ?? 0n
          if (gp) totalWithGas = totalWei + gas * gp
        } catch {}
        setEstTotal(ethers.formatEther(totalWithGas))
      } catch {
        setEstTotal(null)
      }
    })()
  }, [open, disabled, getGame, maxPlayers, expiry, usePrize, prize])

  const totalNoGas = useMemo(() => {
    const f = parseFloat(fee || '0')
    const p = usePrize ? parseFloat(prize || '0') : 0
    return (isFinite(f) ? f : 0) + (isFinite(p) ? p : 0)
  }, [fee, usePrize, prize])

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
    const net2 = await provider.getNetwork()
    if (Number(net2.chainId) !== MONAD_ID) throw new Error('Please switch to Monad Testnet (10143) to continue')
  }

  async function doCreate() {
    if (disabled) return
    if (maxPlayers < 3) return toast('Max players must be ≥ 3', 'error')
    if (expiry < 5 || expiry > 30) return toast('Expiry must be 5–30 minutes', 'error')
    if (usePrize && !/^\d*\.?\d+$/.test((prize || '').trim())) return toast('Invalid prize amount', 'error')

    setBusy(true)
    try {
      // Get contract + provider + signer
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      await ensureMonad(provider)
      const signer = await provider.getSigner()
      const addr = await signer.getAddress()

      // Read fee + compute value
      const feeWei   = await game.gameFee()
      const prizeWei = usePrize ? ethers.parseEther((prize || '0').trim()) : 0n
      const totalWei = feeWei + (usePrize ? prizeWei : 0n)

      // Balance check
      const bal = await provider.getBalance(addr)
      if (bal < totalWei) return toast('Insufficient funds for fee/prize', 'error')

      // Generate invite code, normalize & hash
      const rawCode   = randomInvite()
      const codeUpper = rawCode.toUpperCase()
      const codeHash  = inviteHash(codeUpper)

      // Create game
      const tx = await game.createGame(
        codeHash,
        maxPlayers,
        expiry * 60,  // minutes -> seconds
        usePrize,
        prizeWei,
        { value: totalWei }
      )
      toast('Creating game…', 'loading')
      const rcpt = await tx.wait()

      // Resolve createdId (mapping first)
      let createdId = null
      try {
        const idFromCode = await game.codeToGameId(codeHash)
        if (idFromCode && idFromCode !== 0n) createdId = Number(idFromCode)
      } catch {}
      // Fallback from logs
      if (createdId == null) {
        try {
          for (const log of rcpt.logs || []) {
            if ((log.address || '').toLowerCase() !== (game.target || '').toLowerCase()) continue
            const parsed = game.interface.parseLog({ topics: log.topics, data: log.data })
            if (parsed?.name === 'GameCreated') {
              createdId = parsed.args?.gameId ? Number(parsed.args.gameId) : null
              break
            }
          }
        } catch {}
      }
      // Final fallback: creator’s active game
      if (createdId == null) {
        try {
          const gActive = await game.activeGameOf(addr)
          if (gActive && gActive !== 0n) createdId = Number(gActive)
        } catch {}
      }

      // 🔹 link creator's Games-ID for this game (if available)
      const gidAddress = getGamesIdAddressFromPrivyUser(user)
      if (createdId != null && gidAddress) {
        try {
          toast('Linking your Monad Games ID…', 'loading')
          // optional pre-check to skip if already same value
          try {
            const current = await game.identityOf(createdId, addr)
            if (current && current !== ethers.ZeroAddress && current.toLowerCase() === gidAddress.toLowerCase()) {
              // already linked
            } else {
              const txId = await game.setIdentityForThisGame(createdId, ethers.getAddress(gidAddress))
              await txId.wait()
              toast('Games ID linked', 'success')
            }
          } catch {
            const txId = await game.setIdentityForThisGame(createdId, ethers.getAddress(gidAddress))
            await txId.wait()
            toast('Games ID linked', 'success')
          }
        } catch (e) {
          console.warn('setIdentityForThisGame failed', e)
          toast('Could not link your Games ID (you can link later).', 'warn')
        }
      }

      // Pre-approve relayer as delegate (B2) so backend can finalize
      const relayer = import.meta.env.VITE_RELAYER_ADDR
      if (createdId != null && relayer) {
        try {
          const net = await provider.getNetwork()
          const chainId = Number(net.chainId)
          const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60 // 24h
          const domain = { name: 'MonadCAH', version: '1', chainId, verifyingContract: await game.getAddress() }
          const types = {
            FinalizeDelegate: [
              { name: 'player',   type: 'address'  },
              { name: 'gameId',   type: 'uint256'  },
              { name: 'delegate', type: 'address'  },
              { name: 'expiresAt',type: 'uint256'  },
            ],
          }
          const value = { player: addr, gameId: BigInt(createdId), delegate: relayer, expiresAt: BigInt(expiresAt) }
          const sig   = await signer.signTypedData(domain, types, value)

          const tx2 = await game.setDelegateApproval(createdId, {
            player: addr,
            delegate: relayer,
            expiresAt,
            signature: sig,
          })
          toast('Pre-approving relayer to finalize…', 'loading')
          await tx2.wait()
          toast('Relayer approved', 'success')
        } catch (e) {
          console.warn('setDelegateApproval failed', e)
          toast('Could not pre-approve relayer. You can still play.', 'warn')
        }
      } else if (!relayer) {
        toast('Missing VITE_RELAYER_ADDR; relayer cannot auto-finalize this match.', 'error')
      }

      // Persist + notify UI
      onCreated?.({ code: codeUpper, gameId: createdId ?? null })
      try { await navigator.clipboard.writeText(codeUpper) } catch {}
      localStorage.setItem('activeGame', JSON.stringify({
        id: createdId ?? null,
        code: codeUpper,
        createdAt: Date.now(),
        expiryMins: expiry,
      }))
      onClose?.()
    } catch (e) {
      console.error('[createGame] error:', e)
      const msg = e?.shortMessage || e?.reason || e?.message || 'Create failed'
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={['transition-all duration-300 overflow-hidden', open ? 'max-h-[1000px] opacity-100 mt-4' : 'max-h-0 opacity-0'].join(' ')} aria-hidden={!open}>
      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="text-lg font-semibold">Create Game</div>
          <button onClick={onClose} className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700">Close</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <span className="text-xs uppercase tracking-wider text-slate-400">Game Fee</span>
            <div className="text-2xl font-semibold"><span>{fee}</span> MON</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">Max players</label>
              <select value={maxPlayers} onChange={e => setMaxPlayers(parseInt(e.target.value))} className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700">
                {Array.from({ length: 7 }).map((_, i) => {
                  const v = 4 + i
                  return <option key={v} value={v}>{v}</option>
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Lobby expiry (minutes)</label>
              <input type="range" min="5" max="30" value={expiry} onChange={e => setExpiry(parseInt(e.target.value))} className="w-full" />
              <div className="text-sm text-slate-400">Value: <span>{expiry}</span>m</div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={usePrize} onChange={e => setUsePrize(e.target.checked)} aria-controls="prizeRow" aria-expanded={usePrize} />
              Prize pool (optional)
            </label>

            {usePrize && (
              <div id="prizeRow" className="grid grid-cols-2 gap-3">
                <input
                  value={prize}
                  onChange={e => setPrize(e.target.value)}
                  className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700"
                  placeholder="Amount in MON"
                  inputMode="decimal"
                />
                <div className="text-slate-400 text-sm self-center">
                  Total (no gas): <span>{totalNoGas}</span> MON
                </div>
              </div>
            )}

            <div className="text-slate-400 text-sm">
              Estimated total incl. gas: <span>{estTotal ?? '—'}</span> MON
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-slate-800 flex justify-end gap-2">
          <button className="px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button onClick={doCreate} disabled={disabled || busy} className="px-3 py-1.5 rounded-md bg-indigo-600 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
