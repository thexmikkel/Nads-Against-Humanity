// src/utils/formatMon.js
// Show a plain number, trimming to at most `maxDecimals` decimals.
export function formatMonDisplay(value, maxDecimals = 4) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'

  // Round to `maxDecimals`, then strip trailing zeros and trailing dot.
  const s = Math.abs(n).toFixed(maxDecimals).replace(/\.?0+$/, '')
  return n < 0 ? `-${s}` : s
}
