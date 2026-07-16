import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const protectedClientFiles = [
  'lib/api/pipeline-board.ts',
  'lib/api/pipelines.ts',
  'contexts/AuthContext.tsx',
]

test('dados de autorizacao e pipeline passam pela API central', () => {
  for (const relativePath of protectedClientFiles) {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')

    assert.doesNotMatch(source, /\.from\s*\(\s*['"`]/, `${relativePath} must not query Supabase tables directly`)
  }
})
