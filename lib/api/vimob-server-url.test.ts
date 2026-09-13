import assert from 'node:assert/strict'
import test from 'node:test'

import { getVimobServerAPIBaseURL } from './vimob-server-url'

test('prefers the private server URL and removes trailing slashes', () => {
  assert.equal(
    getVimobServerAPIBaseURL({
      VIMOB_API_URL: 'https://internal-api.example///',
      NEXT_PUBLIC_VIMOB_API_URL: 'https://public-api.example',
    }),
    'https://internal-api.example',
  )
})

test('falls back to the public URL and then to the local API', () => {
  assert.equal(
    getVimobServerAPIBaseURL({
      VIMOB_API_URL: '',
      NEXT_PUBLIC_VIMOB_API_URL: 'https://public-api.example/',
    }),
    'https://public-api.example',
  )
  assert.equal(
    getVimobServerAPIBaseURL({
      VIMOB_API_URL: undefined,
      NEXT_PUBLIC_VIMOB_API_URL: undefined,
    }),
    'http://localhost:8081',
  )
})
