import { Redis } from '@upstash/redis'
import { ethers } from 'ethers'

const NS = 'cah:addrmap:' // key prefix (lowercased embedded -> identity)

function makeRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return Redis.fromEnv()
  if (process.env.REDIS_URL && process.env.REDIS_TOKEN) {
    const url = process.env.REDIS_URL.replace(/^rediss:\/\//, 'https://')
    return new Redis({ url, token: process.env.REDIS_TOKEN })
  }
  throw new Error('Missing Upstash envs')
}

export default async function handler(req, res) {
  try {
    const redis = makeRedis()

    if (req.method === 'GET') {
      const addr = String(req.query.addr || '').toLowerCase()
      if (!addr || !ethers.isAddress(addr)) return res.status(400).json({ error: 'bad addr' })
      const v = await redis.get(NS + addr)
      return res.status(200).json({ value: v || null })
    }

    if (req.method === 'POST') {
      const { keys } = (req.body || {})
      const list = Array.isArray(keys) ? keys : []
      if (!list.length) return res.status(400).json({ error: 'keys required' })
      const lowers = list.map(s => String(s).toLowerCase())
      const out = {}
      const vals = await redis.mget(...lowers.map(a => NS + a))
      lowers.forEach((a, i) => { out[a] = vals?.[i] || null })
      return res.status(200).json({ values: out })
    }

    return res.status(405).json({ error: 'method' })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed' })
  }
}
