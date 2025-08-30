import React, { useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'

function isAddr(a) { try { return ethers.isAddress(a) } catch { return false } }
function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '' }
function fmtDot(n, dec = 6) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toFixed(dec).replace(/\.?0+$/, '')
}
function monFromWei(wei) {
  const w = BigInt(wei)
  const whole = w / 10n ** 18n
  const frac = (w % 10n ** 18n).toString().padStart(18, '0').slice(0, 6) // 6 dp
  return frac ? `${whole}.${frac}`.replace(/\.?0+$/, '') : `${whole}`
}

export default function WithdrawModal({
  balanceMon = '0',                 // number or string
  onConfirm,                        // async ({ to, amountMon, max }) => { valueWei? }
  toast,                            // function(message, level='info')
}) {
  const dlgRef = useRef(null)
  const [to, setTo] = useState('')         // blank — only placeholder is shown
  const [amount, setAmount] = useState('') // keep raw string (dot decimals)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const balNum = useMemo(() => {
    const v = Number(balanceMon)
    return Number.isFinite(v) && v >= 0 ? v : 0
  }, [balanceMon])

  const amountNum = useMemo(() => {
    if (!amount) return 0
    const s = amount.replace(',', '.')
    const n = Number(s)
    return Number.isFinite(n) ? n : NaN
  }, [amount])

  const validAddr = isAddr(to)
  const validAmt  = amount === '' ? false : Number.isFinite(amountNum) && amountNum > 0
  const notTooMuch = validAmt ? amountNum <= balNum : true
  const canSubmit = !submitting && validAddr && validAmt && notTooMuch

  async function submitStandard(e) {
    e?.preventDefault()
    setError('')
    if (!canSubmit) return

    // capture values, then close UI immediately so wallet prompt is not hidden
    const toClean = to
    const amountClean = amount.replace(',', '.')
    const displayAmount = fmtDot(amountClean, 6)

    dlgRef.current?.close()
    setSubmitting(true)
    setAmount('')
    setTo('')

    ;(async () => {
      try {
        const res = await onConfirm?.({ to: toClean, amountMon: amountClean, max: false })
        const shown = res?.valueWei != null ? monFromWei(res.valueWei) : displayAmount
        toast?.(`Sent ${shown} MON to ${shortAddr(toClean)}`, 'success')
      } catch (err) {
        const msg = err?.shortMessage || err?.message || 'Withdraw failed'
        toast?.(`Withdraw failed: ${msg}`, 'error')
      } finally {
        setSubmitting(false)
      }
    })()
  }

  async function submitMax() {
    setError('')
    if (!validAddr) { setError('Enter a valid address first'); return }

    const toClean = to

    dlgRef.current?.close()
    setSubmitting(true)
    setAmount('')
    setTo('')

    ;(async () => {
      try {
        const res = await onConfirm?.({ to: toClean, amountMon: null, max: true })
        const shown = res?.valueWei != null ? monFromWei(res.valueWei) : 'max'
        toast?.(`Sent ${shown} MON to ${shortAddr(toClean)}`, 'success')
      } catch (err) {
        const msg = err?.shortMessage || err?.message || 'Withdraw failed'
        toast?.(`Withdraw failed: ${msg}`, 'error')
      } finally {
        setSubmitting(false)
      }
    })()
  }

  return (
    <dialog id="withdrawModal" ref={dlgRef} className="modal bg-transparent overflow-x-hidden">
      <div className="modal-box w-[92vw] max-w-[520px] p-5 sm:p-6 rounded-2xl shadow-2xl bg-slate-900/95 border border-slate-800 text-slate-100 mx-auto overflow-x-hidden">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-lg font-semibold">Withdraw MON</h3>
          <button
            type="button"
            className="ml-auto px-3 py-1 rounded-xl bg-slate-800/80 border border-slate-700 hover:bg-slate-700/80"
            onClick={() => dlgRef.current?.close()}
          >
            Close
          </button>
        </div>

        <form onSubmit={submitStandard} className="space-y-4">
          <div className="text-sm text-slate-300">
            Available: <span className="text-slate-100">{fmtDot(balNum, 6)}</span> MON
          </div>

          {/* Recipient */}
          <label className="block text-sm">
            <div className="mb-1 text-slate-200">Recipient address</div>
            <input
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 outline-none focus:border-indigo-500 font-mono text-slate-100 placeholder-slate-500"
              placeholder="0x…"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              inputMode="text"
              autoComplete="off"
              spellCheck="false"
            />
            {to.length > 0 && (
              <div className={`mt-1 text-xs ${validAddr ? 'text-emerald-400' : 'text-rose-400'}`}>
                {validAddr ? 'Valid address' : 'Invalid address'}
              </div>
            )}
          </label>

          {/* Amount */}
          <label className="block text-sm">
            <div className="mb-1 text-slate-200">Amount (MON)</div>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(e) => {
                  let v = e.target.value.replace(',', '.')
                  v = v.replace(/[^\d.]/g, '')        // digits + dot only
                  const parts = v.split('.')
                  if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('')
                  if (parts[1]?.length > 18) v = parts[0] + '.' + parts[1].slice(0, 18)
                  setAmount(v)
                }}
              />
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700"
                onClick={() => setAmount(fmtDot(balNum, 6))}
              >
                MAX
              </button>
            </div>
            {amount && !validAmt && <div className="mt-1 text-xs text-rose-400">Invalid amount</div>}
            {amount && validAmt && !notTooMuch && (
              <div className="mt-1 text-xs text-rose-400">Amount exceeds balance</div>
            )}
          </label>

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full mt-1 px-4 py-2 rounded-xl bg-indigo-600 disabled:bg-slate-700 hover:bg-indigo-500"
          >
            {submitting ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  )
}
