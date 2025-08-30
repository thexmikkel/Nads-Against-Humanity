// xorshift-ish PRNG seeded from hex; deterministic across clients
export function rngFromHex(hex) {
  let h = hex.replace(/^0x/i, '')
  if (h.length < 16) h = h.padStart(16, '0')
  // take 64 bits
  let x = BigInt('0x' + h.slice(0, 16))
  return () => {
    // xorshift64*
    x ^= x << 13n
    x ^= x >> 7n
    x ^= x << 17n
    const val = Number((x & 0xffffffffffffffffn) % 0x1_0000_0000n) // 32-bit
    return val >>> 0
  }
}
export function pickIndex(rand, n) {
  return n ? rand() % n : 0
}
