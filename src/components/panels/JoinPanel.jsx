// src/components/panels/JoinPanel.jsx
import React, { useState } from 'react'
import { ethers } from 'ethers'
import { usePrivy } from '@privy-io/react-auth'
import { toast } from '../../lib/toast.jsx'
import { inviteHash } from '../../lib/invite.js'

const CODE_RE = /^[A-Z0-9]{6}$/
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

export default function JoinPanel({ open, disabled, onClose, onJoined, getGame }) {
  const [code, setCode] = useState('')
  const [terms, setTerms] = useState(true)
  const [busy, setBusy] = useState(false)
  const { user } = usePrivy()

  if (!open) return null

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

  async function pasteCode() {
    try {
      const txt = await navigator.clipboard.readText()
      const m = (txt || '').toUpperCase().match(/[A-Z0-9]{6}/)
      if (m) setCode(m[0])
    } catch {}
  }

  async function doJoin() {
    if (disabled || busy) return
    const codeUpper = (code || '').trim().toUpperCase()
    if (!CODE_RE.test(codeUpper)) return toast('Invalid code format', 'error')
    if (!terms) return toast('Please accept the rules to continue', 'error')

    setBusy(true)
    try {
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      const signer   = game.runner || game.signer
      await ensureMonad(provider)

      const addr = await signer.getAddress()
      const hash = inviteHash(codeUpper)

      const res = await game.canJoinByCode.staticCall(hash, addr)
      const ok = Boolean(res?.[0]); const gid = Number(res?.[1] || 0n)
      const reason = (res?.[2] || '').toString()

      if (!ok && reason !== 'already joined') {
        setBusy(false)
        return toast(reason || 'Invite not valid or lobby closed.', 'error')
      }

      const gidAddress = getGamesIdAddressFromPrivyUser(user)
      const idToUse = gidAddress ? ethers.getAddress(gidAddress) : ethers.ZeroAddress

      toast(gidAddress ? 'Joining with your Monad Games ID…' : 'Joining…', 'loading')
      const tx = await game.joinWithSetup(gid, idToUse, { delegateExpiry: 0 })
      await tx.wait()

      toast('Joined!', 'success')
      onJoined?.({ code: codeUpper, gameId: String(gid) })
      localStorage.setItem('activeGame', JSON.stringify({ id: String(gid), code: codeUpper }))
      onClose?.()
    } catch (e) {
      const msg = e?.shortMessage || e?.message || 'Join failed'
      toast(msg, 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur">
      <div className="w-[560px] max-w-[94vw] rounded-2xl p-[1px] bg-gradient-to-br from-indigo-500/40 via-fuchsia-500/40 to-cyan-500/40">
        <div className="rounded-2xl bg-[#0b0e17]/95 border border-white/10 shadow-2xl">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">Join a game</h3>
                <p className="text-xs text-white/60 mt-1">One tx: join + Games-ID + relayer approval</p>
              </div>
              <button onClick={onClose} className="text-white/60 hover:text-white text-sm">Close</button>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-white/70">Invite code</span>
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-white/10 tracking-widest uppercase font-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))}
                  placeholder="ABC123"
                  maxLength={6}
                />
                <button onClick={pasteCode} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
                  Paste
                </button>
                <button onClick={() => setCode('')} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
                  Clear
                </button>
              </div>
            </label>

            <label className="flex items-start gap-2">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span className="text-sm text-white/70">
                I accept that timeouts may auto-advance rounds (auto-pick rules).
              </span>
            </label>
          </div>

          <div className="p-6 pt-3 border-t border-white/10 flex justify-end gap-2">
            <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10" onClick={onClose}>Cancel</button>
            <button
              onClick={doJoin}
              disabled={disabled || busy}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 disabled:opacity-50">
              {busy ? 'Joining…' : 'Join'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
