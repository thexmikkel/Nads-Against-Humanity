// src/hooks/useUsernamesMulti.js 
import { useEffect, useRef } from 'react'

// cross-session cache (resets on page refresh)
const NAME_CACHE = new Map()   // embeddedLower -> username string ('' = known no-username)
const INFLIGHT = new Map()     // embeddedLower -> Promise<string>

async function mapEmbeddedToIdentityBatch(embeddedList) {
  try {
    const r = await fetch('/api/addrmap/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: embeddedList })
    })
    if (!r.ok) return {}
    const j = await r.json()
    return j.values || j || {}
  } catch {
    return {}
  }
}

async function fetchOne(identityAddr) {
  try {
    const r = await fetch(
      `https://monad-games-id-site.vercel.app/api/check-wallet?wallet=${identityAddr}`
    )
    if (!r.ok) throw new Error('lookup failed')
    const j = await r.json()
    return j?.hasUsername ? (j.user?.username || '') : ''
  } catch {
    return ''
  }
}

export function useUsernamesMulti(addresses, setNames) {
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  useEffect(() => {
    const list = Array.isArray(addresses) ? addresses.filter(Boolean) : []
    if (!list.length) return

    const lowers = list.map(a => a.toLowerCase())

    // push any cached names immediately
    const pushCached = () => {
      if (!mounted.current) return
      const out = {}
      for (const a of lowers) {
        if (NAME_CACHE.has(a)) out[a] = NAME_CACHE.get(a)
      }
      setNames(prev => ({ ...prev, ...out }))
    }
    pushCached()

    // what still needs work?
    const need = lowers.filter(a => !NAME_CACHE.has(a) && !INFLIGHT.has(a))
    if (!need.length) return

    const p = (async () => {
      // 1) resolve embedded -> identity in one shot
      const map = await mapEmbeddedToIdentityBatch(need)
      // 2) fetch usernames for identities and cache under the *embedded* keys
      for (const embedded of need) {
        const identity = map?.[embedded] || embedded
        const name = await fetchOne(identity)
        NAME_CACHE.set(embedded, name)
      }
      if (mounted.current) pushCached()
    })()

    for (const a of need) INFLIGHT.set(a, p)
    p.finally(() => need.forEach(a => INFLIGHT.delete(a)))

  // stable dep without re-running unnecessarily
  }, [Array.isArray(addresses) ? addresses.map(a => a?.toLowerCase?.() || a).join('|') : ''])
}
