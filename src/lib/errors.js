// src/lib/errors.js
export function humanTxError(err) {
  // ethers v6 surfaces shortMessage + reason fairly well
  const parts = [
    err?.shortMessage,
    err?.reason,
    err?.info?.error?.message,
    err?.message
  ].filter(Boolean)

  const msg = parts[0] || 'Transaction failed'

  // Friendly specials
  if ((err?.code || '').toUpperCase?.() === 'INSUFFICIENT_FUNDS') {
    return 'Insufficient funds for fee/prize + gas'
  }

  // Common patterns
  if (/user rejected/i.test(msg)) return 'Transaction rejected'
  if (/insufficient funds/i.test(msg)) return 'Insufficient funds for fee/prize + gas'
  if (/execution reverted/i.test(msg)) return 'Execution reverted (check fee, prize, or parameters)'

  return msg
}
