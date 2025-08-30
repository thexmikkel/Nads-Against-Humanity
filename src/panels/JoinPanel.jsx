// src/components/panels/JoinPanel.jsx
import React, { useState } from 'react'
import { ethers } from 'ethers'
import { usePrivy } from '@privy-io/react-auth'
import { toast } from '../../lib/toast.jsx'
import { inviteHash } from '../../lib/invite.js'

const CODE_RE = /^[A-Z0-9]{6}$/
const MONAD_ID = 10143
const MONAD_HEX = '0x279f'
const GID_APP_ID = import.meta.env.VITE_PRIVY_APP_ID

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
  const [terms, setTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const { user } = usePrivy()

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

  async function doJoin() {
    if (disabled) return
    const codeUpper = (code || '').trim().toUpperCase()
    if (!CODE_RE.test(codeUpper)) return toast('Invalid code format', 'error')
    if (!terms) return toast('Please accept the game terms to continue', 'error')

    setBusy(true)
    try {
      const game = await getGame()
      const provider = game.runner?.provider || game.provider
      try {
        await ensureMonad(provider)
      } catch (e) {
        console.warn('ensureMonad failed', e)
        return toast('Please approve the network switch to Monad Testnet', 'error')
      }

      const signer = game.runner
      const addr = await signer.getAddress()
      const net = await provider.getNetwork()
      const chainId = Number(net.chainId)

      // 1) Resolve + precheck (never reverts)
      const hash = inviteHash(codeUpper)
      const res = await game.canJoinByCode.staticCall(hash, addr)
      const ok  = Boolean(res?.[0])
      const gid = Number(res?.[1] || 0n)
      const reason = (res?.[2] || '').toString()

      if (!ok || gid === 0) {
        if (reason === 'already joined') {
          onJoined?.({ code: codeUpper, gameId: String(gid) })
          localStorage.setItem('activeGame', JSON.stringify({ id: String(gid), code: codeUpper }))
          toast('You are already in this lobby.', 'success')
          onClose?.()
          return
        }
        return toast(reason || 'Invite not valid or lobby closed.', 'error')
      }

      // 2) Relayer that will finalize
      const relayer = import.meta.env.VITE_RELAYER_ADDR
      if (!relayer) return toast('Missing VITE_RELAYER_ADDR', 'error')

      // 3) Sign EIP-712 delegate approval (player -> relayer)
      const expiresAt = Math.floor(Date.now()/1000) + 24*60*60
      const domain = { name: 'MonadCAH', version: '1', chainId, verifyingContract: await game.getAddress() }
      const types = {
        FinalizeDelegate: [
          { name: 'player', type: 'address' },
          { name: 'gameId', type: 'uint256' },
          { name: 'delegate', type: 'address' },
          { name: 'expiresAt', type: 'uint256' },
        ],
      }
      const value = { player: addr, gameId: BigInt(gid), delegate: relayer, expiresAt: BigInt(expiresAt) }
      const signature = await signer.signTypedData(domain, types, value)

      // 4) Join WITH IDENTITY (new path)
      const gidAddress = getGamesIdAddressFromPrivyUser(user)
      const idToUse = gidAddress ? ethers.getAddress(gidAddress) : ethers.ZeroAddress

      toast(gidAddress ? 'Joining with your Monad Games ID…' : 'Joining…', 'loading')
      let tx = await game.joinWithIdentity(gid, idToUse)
      await tx.wait()

      // 5) Set delegate approval (second tx)
      try {
        toast('Granting finalize approval…', 'loading')
        tx = await game.setDelegateApproval(gid, { player: addr, delegate: relayer, expiresAt, signature })
        await tx.wait()
      } catch (e) {
        console.warn('setDelegateApproval failed (continuing):', e)
        toast('Joined. Could not set finalize approval (relayer may ask later).', 'warn')
      }

      onJoined?.({ code: codeUpper, gameId: String(gid) })
      localStorage.setItem('activeGame', JSON.stringify({ id: String(gid), code: codeUpper }))
      onClose?.()
    } catch (e) {
      console.error('[join] error', e)
      const msg = e?.shortMessage || e?.reason || e?.message || 'Join failed'
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={['transition-all duration-300 overflow-hidden', open ? 'max-h-[600px] opacity-100 mt-4' : 'max-h-0 opacity-0'].join(' ')} aria-hidden={!open}>
      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="text-lg font-semibold">Join a Game</div>
          <button onClick={onClose} className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700">Close</button>
        </div>

        <div className="p-5 space-y-3">
          <label className="block text-sm">Invite code</label>
          <input
            value={code}
            onChange={e => setCode((e.target.value || '').toUpperCase())}
            className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700"
            placeholder="ABC123"
          />

          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" className="mt-1" checked={terms} onChange={e => setTerms(e.target.checked)} />
            <span>
              By joining you accept fixed timing (~15 rounds), sudden death tie-breaks, auto-picks on timeouts,
              and 0 points for missed submissions.
            </span>
          </label>
        </div>

        <div className="p-5 border-t border-slate-800 flex justify-end gap-2">
          <button className="px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button
            onClick={doJoin}
            disabled={disabled || busy}
            className="px-3 py-1.5 rounded-md bg-indigo-600 disabled:opacity-50"
          >
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  )
}
