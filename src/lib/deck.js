import { rngFromHex, pickIndex } from './rng.js'

// Make prompt sequence (array of promptIds) given state.seed and total prompts N
export function promptIdForRound(seedHex, round, promptIds) {
  const rand = rngFromHex(seedHex + ':' + round)
  const idx = pickIndex(rand, promptIds.length)
  return promptIds[idx]
}

// Per-player deterministic “hand stream” (no duplicates within hand)
export function buildHand(seedHex, address, answerIds, handSize = 7, round = 1, used = []) {
  const rand = rngFromHex(seedHex + ':' + address.toLowerCase() + ':' + round)
  const pool = answerIds.slice()
  const out = []
  const seen = new Set(used)
  while (out.length < handSize && pool.length) {
    const i = pickIndex(rand, pool.length)
    const card = pool.splice(i, 1)[0]
    if (seen.has(card)) continue
    out.push(card)
    seen.add(card)
  }
  return out
}
