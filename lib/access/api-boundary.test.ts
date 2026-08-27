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

test('distribuicao reconhece formularios Meta por uma leitura propria e limitada', () => {
  const appSource = readFileSync(resolve(process.cwd(), 'apps/api/internal/app/app.go'), 'utf8')
  const editorSource = readFileSync(
    resolve(process.cwd(), 'components/features/round-robin/DistributionQueueEditor.tsx'),
    'utf8',
  )
  const tabSource = readFileSync(
    resolve(process.cwd(), 'components/features/crm-management/DistributionTab.tsx'),
    'utf8',
  )

  assert.match(
    appSource,
    /GET \/v1\/round-robin-meta-forms[^\n]+permissions\.DistributionManage/,
  )
  for (const source of [editorSource, tabSource]) {
    assert.match(source, /useRoundRobinMetaForms/)
    assert.doesNotMatch(source, /useMetaFormConfigs|useMetaIntegrations/)
  }
})
