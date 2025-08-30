import { useEffect, useState } from 'react'

const PROVIDER_ID = 'provider-id'

export function useUsername(user, fallbackAddress) {
  const [username, setUsername] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        // 1) figure out which embedded address we're naming
        let embedded = null
        if (fallbackAddress) embedded = fallbackAddress
        if (!embedded && user?.linkedAccounts?.length) {
          const ca = user.linkedAccounts.find(
            a => a.type === 'cross_app' && a.providerApp?.id === PROVIDER_ID
          )
          // keep your original behavior as a fallback
          if (ca?.embeddedWallets?.length) embedded = ca.embeddedWallets[0].address
        }
        if (!embedded) { setUsername(null); return }

        // 2) resolve to identity address via your KV (/api/recall?addr=embedded)
        let identity = embedded
        try {
          const r = await fetch(`/api/addrmap/get?addr=${embedded}`)
          if (r.ok) {
            const j = await r.json()
            const mapped = j?.value || j?.mapped || j?.idAddress
            if (mapped) identity = mapped
          }
        } catch {}

        // 3) ask Games-ID for the username of the identity address
        const resp = await fetch(
          `https://monad-games-id-site.vercel.app/api/check-wallet?wallet=${identity}`
        )
        if (!resp.ok) throw new Error('username lookup failed')
        const data = await resp.json()
        setUsername(data?.hasUsername ? data.user.username : null)
      } catch {
        setUsername(null)
      }
    })()
  }, [user, fallbackAddress])

  return { username }
}
