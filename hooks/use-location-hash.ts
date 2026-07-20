'use client'

import { useEffect, useState } from 'react'

export const LOCATION_HASH_CHANGE_EVENT = 'vimob:location-hash-change'

export function useLocationHash() {
  const [hash, setHash] = useState('')

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash)

    syncHash()
    window.addEventListener('hashchange', syncHash)
    window.addEventListener('popstate', syncHash)
    window.addEventListener(LOCATION_HASH_CHANGE_EVENT, syncHash)

    return () => {
      window.removeEventListener('hashchange', syncHash)
      window.removeEventListener('popstate', syncHash)
      window.removeEventListener(LOCATION_HASH_CHANGE_EVENT, syncHash)
    }
  }, [])

  return hash
}
