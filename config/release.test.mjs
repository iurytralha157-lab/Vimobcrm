import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  normalizeReleaseSha,
  UNVERSIONED_RELEASE_SHA,
  VIMOB_RELEASE_HEADER,
} from './release.ts'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('normaliza um SHA Git completo para hexadecimal minúsculo', () => {
  const uppercaseSha = '0123456789ABCDEF0123456789ABCDEF01234567'

  assert.equal(
    normalizeReleaseSha(`  ${uppercaseSha}  `),
    uppercaseSha.toLowerCase(),
  )
})

test('usa unversioned para identificadores ausentes ou inválidos', () => {
  const invalidValues = [
    undefined,
    null,
    '',
    'a'.repeat(39),
    'a'.repeat(41),
    `${'a'.repeat(39)}g`,
    'refs/heads/main',
  ]

  invalidValues.forEach((value) => {
    assert.equal(normalizeReleaseSha(value), UNVERSIONED_RELEASE_SHA)
  })
})

test('mantém o contrato da identidade de release no proxy e na imagem Web', () => {
  const proxySource = readFileSync(resolve(projectRoot, 'proxy.ts'), 'utf8')
  const dockerfileSource = readFileSync(resolve(projectRoot, 'Dockerfile.web'), 'utf8')

  assert.equal(VIMOB_RELEASE_HEADER, 'x-vimob-release-sha')
  assert.match(proxySource, /return withReleaseIdentity\(redirectResponse\)/)
  assert.match(proxySource, /return withReleaseIdentity\(response\)/)
  assert.match(proxySource, /let response = createNextResponse\(request\)/)
  assert.match(proxySource, /response = createNextResponse\(request\)/)
  assert.equal(
    dockerfileSource.match(/^ARG VIMOB_RELEASE_SHA$/gm)?.length,
    2,
  )
  assert.equal(
    dockerfileSource.match(/^ENV NEXT_PUBLIC_VIMOB_RELEASE_SHA=\$VIMOB_RELEASE_SHA$/gm)?.length,
    2,
  )
})
