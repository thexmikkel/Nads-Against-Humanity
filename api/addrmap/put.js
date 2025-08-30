// /api/addrmap/put.js
import { Redis } from '@upstash/redis'
import { ethers } from 'ethers'

const NS = 'cah:addrmap:'            // mapping:   NS + <embeddedLower> -> <identityChecksum>
const NSN = 'cah:addrmap:nonce:'     // nonce key: NSN + <embeddedLower> -> <uint>

function makeRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return Redis.fromEnv()
  if (process.env.REDIS_URL && process.env.REDIS_TOKEN) {
    const url = process.env.REDIS_URL.replace(/^rediss:\/\//, 'https://')
    return new Redis({ url, token: process.env.REDIS_TOKEN })
  }
  throw new Error('Missing Upstash envs')
}

// Message format (EIP-191 personal_sign):
//   link:<identityChecksum>:<nonce>:<exp>
// - signer MUST be the embedded address
function makeMsg(identity, nonce, exp) {
  return `link:${ethers.getAddress(identity)}:${Number(nonce)}:${Number(exp || 0)}`
}

async function parseJSON(req) {
  if (req.body && typeof req.body === 'object') return req.body
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', c => (d += c))
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  try {
    const { key, value, sig, nonce, exp } = await parseJSON(req)
    if (!key || !value || !sig || (nonce == null)) {
      return res.status(400).json({ error: 'required: key,value,sig,nonce[,exp]' })
    }

    const embeddedLower = String(key).toLowerCase()
    if (!ethers.isAddress(embeddedLower) || !ethers.isAddress(value)) {
      return res.status(400).json({ error: 'bad addresses' })
    }
    const identity = ethers.getAddress(value)
    const n = Number(nonce)
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'bad nonce' })
    const expNum = exp ? Number(exp) : 0
    if (expNum && (!Number.isFinite(expNum) || expNum < 0)) return res.status(400).json({ error: 'bad exp' })
    if (expNum && Math.floor(Date.now() / 1000) > expNum + 60) {
      return res.status(400).json({ error: 'signature expired' })
    }

    const msg = makeMsg(identity, n, expNum)
    let recovered
    try {
      recovered = ethers.verifyMessage(msg, sig)
    } catch {
      return res.status(400).json({ error: 'bad signature' })
    }
    if (recovered.toLowerCase() !== embeddedLower) {
      return res.status(401).json({ error: 'signature does not match embedded address' })
    }

    const redis = makeRedis()
    const nonceKey = NSN + embeddedLower
    const prevNonce = Number(await redis.get(nonceKey) || 0)

    if (!(n > prevNonce)) {
      return res.status(409).json({ error: 'nonce too low', prevNonce })
    }

    // write mapping + advance nonce
    await redis.set(NS + embeddedLower, identity)
    await redis.set(nonceKey, n)

    return res.status(200).json({ ok: true, mapped: { embedded: ethers.getAddress(recovered), identity }, nonce: n })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed' })
  }
}
