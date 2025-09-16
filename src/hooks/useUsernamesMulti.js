// src/hooks/useUsernamesMulti.js
import { useEffect, useMemo, useRef, useState } from 'react'

// cross-session cache (resets on page refresh)
const NAME_CACHE = new Map()   // embeddedLower -> username string ('' = known no-username)
const INFLIGHT   = new Map()   // embeddedLower -> Promise<void>

function fetchWithTimeout(url, opts, timeoutMs) {
  if (!opts) opts = {}
  if (typeof timeoutMs !== 'number') timeoutMs = 10000
  const ctrl = new AbortController()
  const t = setTimeout(function () { ctrl.abort() }, timeoutMs)
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
    .finally(function () { clearTimeout(t) })
}

function mapEmbeddedToIdentityBatch(embeddedList) {
  return fetchWithTimeout('/api/addrmap/get', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys: embeddedList })
  }, 8000)
  .then(function (r) {
    if (!r || !r.ok) return {}
    return r.json()
  })
  .then(function (j) {
    if (!j) return {}
    // support { values: { [embedded]: identity } } or flat { [embedded]: identity }
    return j.values ? j.values : j
  })
  .catch(function () { return {} })
}

function fetchUsernameForIdentity(identityAddr) {
  var url = 'https://monad-games-id-site.vercel.app/api/check-wallet?wallet=' + identityAddr
  return fetchWithTimeout(url, {}, 8000)
    .then(function (r) {
      if (!r || !r.ok) throw new Error('lookup failed')
      return r.json()
    })
    .then(function (j) {
      if (j && j.hasUsername) {
        return (j.user && j.user.username) ? j.user.username : ''
      }
      return ''
    })
    .catch(function () { return '' })
}

function normalizeAddresses(addresses) {
  if (!Array.isArray(addresses)) return []
  var out = []
  var seen = new Set()
  for (var i = 0; i < addresses.length; i++) {
    var a = addresses[i]
    var l = (a && typeof a === 'string') ? a.toLowerCase() : ''
    if (!l || seen.has(l)) continue
    seen.add(l)
    out.push(l)
  }
  return out
}

/**
 * Backward-compatible usernames resolver.
 *
 * Usage (new):
 *   const { names, refresh } = useUsernamesMulti(addresses)
 *
 * Usage (old, still supported):
 *   const [names, setNames] = useState({})
 *   useUsernamesMulti(addresses, setNames)
 *
 * Returned:
 *   { names, namesByAddress, refresh }
 *   - keys are lowercased embedded addresses; value '' if unknown
 */
export function useUsernamesMulti(addresses, setNamesCb) {
  const mounted = useRef(true)
  useEffect(function () {
    return function () { mounted.current = false }
  }, [])

  const lowers = useMemo(function () {
    return normalizeAddresses(addresses)
  }, [addresses])

  const lowersKey = useMemo(function () {
    return lowers.join('|')
  }, [lowers])

  const [names, setNames] = useState(function () {
    var obj = {}
    for (var i = 0; i < lowers.length; i++) {
      var l = lowers[i]
      obj[l] = NAME_CACHE.has(l) ? NAME_CACHE.get(l) : ''
    }
    return obj
  })
  const namesByAddress = names

  // legacy callback support
  useEffect(function () {
    if (typeof setNamesCb === 'function') setNamesCb(names)
  }, [names, setNamesCb])

  // seed from cache when list changes
  useEffect(function () {
    var obj = {}
    for (var i = 0; i < lowers.length; i++) {
      var l = lowers[i]
      obj[l] = NAME_CACHE.has(l) ? NAME_CACHE.get(l) : ''
    }
    setNames(obj)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowersKey])

  function fetchMissing(list) {
    if (!list || !list.length) return Promise.resolve()
    return mapEmbeddedToIdentityBatch(list).then(function (idMap) {
      // fetch in sequence to keep it simple/robust for older environments
      var p = Promise.resolve()
      for (var i = 0; i < list.length; i++) {
        (function (embedded) {
          p = p.then(function () {
            var identity = (idMap && idMap[embedded]) ? idMap[embedded] : embedded
            return fetchUsernameForIdentity(identity).then(function (uname) {
              NAME_CACHE.set(embedded, uname)
            }).catch(function () {
              NAME_CACHE.set(embedded, '')
            })
          })
        })(list[i])
      }
      return p
    })
  }

  // background: populate items not cached/inflight
  useEffect(function () {
    if (!lowers.length) return
    var need = []
    for (var i = 0; i < lowers.length; i++) {
      var a = lowers[i]
      if (!NAME_CACHE.has(a) && !INFLIGHT.has(a)) need.push(a)
    }
    if (!need.length) return

    var p = fetchMissing(need).then(function () {
      if (mounted.current) {
        var obj = {}
        for (var j = 0; j < lowers.length; j++) {
          var l = lowers[j]
          obj[l] = NAME_CACHE.has(l) ? NAME_CACHE.get(l) : ''
        }
        setNames(obj)
      }
    }).finally(function () {
      for (var k = 0; k < need.length; k++) INFLIGHT.delete(need[k])
    })

    for (var m = 0; m < need.length; m++) INFLIGHT.set(need[m], p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowersKey])

  // public refresh
  const refresh = useMemo(function () {
    return function (force) {
      if (!lowers.length) return Promise.resolve()
      var targets = lowers.slice()
      if (force) {
        for (var i = 0; i < targets.length; i++) NAME_CACHE.delete(targets[i])
      }
      var need = []
      for (var j = 0; j < targets.length; j++) {
        var a = targets[j]
        if (!INFLIGHT.has(a)) need.push(a)
      }
      if (!need.length) return Promise.resolve()

      var p = fetchMissing(need).then(function () {
        if (mounted.current) {
          var obj = {}
          for (var k = 0; k < lowers.length; k++) {
            var l = lowers[k]
            obj[l] = NAME_CACHE.has(l) ? NAME_CACHE.get(l) : ''
          }
          setNames(obj)
        }
      }).finally(function () {
        for (var q = 0; q = need.length, q < need.length; q++) INFLIGHT.delete(need[q]) // (safety, but already deleted above)
      })

      for (var m = 0; m < need.length; m++) INFLIGHT.set(need[m], p)
      return p
    }
  }, [lowers])

  return { names: names, namesByAddress: namesByAddress, refresh: refresh }
}

export default useUsernamesMulti
