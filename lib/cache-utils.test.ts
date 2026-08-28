import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSupabaseAuthStorageKey,
  performFullCacheClear,
} from './cache-utils'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const STORAGE_KEY_CASES = [
  {
    label: 'managed source URL',
    url: 'https://iemalzlfnbouobyjwlwi.supabase.co',
    expected: 'sb-iemalzlfnbouobyjwlwi-auth-token',
  },
  {
    label: 'another managed project URL',
    url: ' https://newprojectref.supabase.co/ ',
    expected: 'sb-newprojectref-auth-token',
  },
  {
    label: 'custom self-hosted destination URL',
    url: 'https://supabase.vimobcrm.com.br',
    expected: 'sb-supabase-auth-token',
  },
] as const

function installBrowserStorage() {
  const descriptors = new Map(
    ['window', 'navigator', 'localStorage', 'sessionStorage'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  )
  const local = new MemoryStorage()
  const session = new MemoryStorage()

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        href: 'https://app.vimobcrm.com.br/dashboard',
        origin: 'https://app.vimobcrm.com.br',
        pathname: '/dashboard',
        replace() {},
      },
    },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {},
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: local,
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: session,
  })

  return {
    local,
    session,
    restore() {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor)
        } else {
          Reflect.deleteProperty(globalThis, name)
        }
      }
    },
  }
}

function seedStorage(storage: Storage, activeStorageKey: string) {
  storage.setItem(activeStorageKey, 'active-session')
  storage.setItem(`${activeStorageKey}-code-verifier`, 'active-pkce')
  storage.setItem('sb-legacy-project-auth-token', 'legacy-session')
  storage.setItem('impersonating', 'true')
  storage.setItem('remember_me', 'true')
  storage.setItem('remembered_email', 'user@example.com')
  storage.setItem('theme', 'light')
  storage.setItem('vimob-web-push-opt-out:user:organization', '1')
  storage.setItem('vimob-current-push-endpoint', 'native:android:test-token')
  storage.setItem('unrelated-cache-entry', 'remove-me')
}

test('derives the same auth storage key convention as supabase-js', () => {
  for (const { label, url, expected } of STORAGE_KEY_CASES) {
    assert.equal(getSupabaseAuthStorageKey(url), expected, label)
  }

  assert.equal(getSupabaseAuthStorageKey(undefined), null)
  assert.equal(getSupabaseAuthStorageKey(''), null)
  assert.equal(getSupabaseAuthStorageKey('not a URL'), null)
})

test('preserves only the configured Supabase session when clearAuth is false', async (context) => {
  for (const { label, url, expected } of STORAGE_KEY_CASES) {
    await context.test(label, async (childContext) => {
      const browser = installBrowserStorage()
      const previousURL = process.env.NEXT_PUBLIC_SUPABASE_URL
      process.env.NEXT_PUBLIC_SUPABASE_URL = url.trim()

      childContext.after(() => {
        if (previousURL === undefined) {
          delete process.env.NEXT_PUBLIC_SUPABASE_URL
        } else {
          process.env.NEXT_PUBLIC_SUPABASE_URL = previousURL
        }
        browser.restore()
      })

      for (const storage of [browser.local, browser.session]) {
        seedStorage(storage, expected)
      }

      await performFullCacheClear({ clearAuth: false })

      for (const storage of [browser.local, browser.session]) {
        assert.equal(storage.getItem(expected), 'active-session')
        assert.equal(storage.getItem(`${expected}-code-verifier`), 'active-pkce')
        assert.equal(storage.getItem('sb-legacy-project-auth-token'), null)
        assert.equal(storage.getItem('impersonating'), 'true')
        assert.equal(storage.getItem('remember_me'), 'true')
        assert.equal(storage.getItem('remembered_email'), 'user@example.com')
        assert.equal(storage.getItem('theme'), 'light')
        assert.equal(storage.getItem('vimob-web-push-opt-out:user:organization'), '1')
        assert.equal(storage.getItem('vimob-current-push-endpoint'), 'native:android:test-token')
        assert.equal(storage.getItem('unrelated-cache-entry'), null)
      }
    })
  }
})

test('clearAuth true still removes active auth and impersonation state', async (context) => {
  const browser = installBrowserStorage()
  const previousURL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const activeStorageKey = 'sb-supabase-auth-token'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.vimobcrm.com.br'

  context.after(() => {
    if (previousURL === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousURL
    }
    browser.restore()
  })

  for (const storage of [browser.local, browser.session]) {
    seedStorage(storage, activeStorageKey)
  }

  await performFullCacheClear({ clearAuth: true })

  for (const storage of [browser.local, browser.session]) {
    assert.equal(storage.getItem(activeStorageKey), null)
    assert.equal(storage.getItem(`${activeStorageKey}-code-verifier`), null)
    assert.equal(storage.getItem('impersonating'), null)
    assert.equal(storage.getItem('remember_me'), 'true')
    assert.equal(storage.getItem('remembered_email'), 'user@example.com')
    assert.equal(storage.getItem('theme'), 'light')
    assert.equal(storage.getItem('vimob-web-push-opt-out:user:organization'), null)
    assert.equal(storage.getItem('vimob-current-push-endpoint'), null)
  }
})

test('routine cache refresh preserves push registration while logout removes it', async (context) => {
  const browser = installBrowserStorage()
  const calls = { update: 0, unsubscribe: 0, unregister: 0 }
  const registration = {
    pushManager: {
      async getSubscription() {
        return {
          async unsubscribe() {
            calls.unsubscribe += 1
            return true
          },
        }
      },
    },
    async update() {
      calls.update += 1
    },
    async unregister() {
      calls.unregister += 1
      return true
    },
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        async getRegistrations() {
          return [registration]
        },
      },
    },
  })
  context.after(browser.restore)

  await performFullCacheClear({ clearAuth: false })
  assert.deepEqual(calls, { update: 1, unsubscribe: 0, unregister: 0 })

  await performFullCacheClear({ clearAuth: true })
  assert.deepEqual(calls, { update: 1, unsubscribe: 1, unregister: 1 })
})
