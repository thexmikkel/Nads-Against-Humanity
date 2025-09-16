// /api/public-lobbies/list.js
import { kv } from '@vercel/kv'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    // Storage not configured; respond gracefully
    return res.status(200).json({ lobbies: [] })
  }
  try {
    const data = (await kv.get('public:lobbies')) || []
    const now = Math.floor(Date.now() / 1000)

    // prune expired
    let pruned = data.filter(x => Number(x?.expiresAt || 0) > now)

    // optional cap to avoid accidental bloat
    if (pruned.length > 200) pruned = pruned.slice(0, 200)

    if (pruned.length !== data.length) await kv.set('public:lobbies', pruned)

    return res.status(200).json({ lobbies: pruned })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed' })
  }
}
