import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8')
}

function workflowStep(workflow, name) {
  const marker = `      - name: ${name}`
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1, `workflow step not found: ${name}`)
  const end = workflow.indexOf('\n      - name:', start + marker.length)
  return workflow.slice(start, end === -1 ? workflow.length : end)
}

test('docker workflow requires an explicitly configured Supabase build target', async () => {
  const workflow = await readRepositoryFile('.github/workflows/docker-images.yml')

  assert.doesNotMatch(workflow, /iemalzlfnbouobyjwlwi/)
  assert.doesNotMatch(workflow, /sb_publishable_AnQ_6OJi0LuPUyxFh7rVwA_biv5WTyf/)
  assert.match(
    workflow,
    /WEB_NEXT_PUBLIC_SUPABASE_URL: \$\{\{ vars\.VIMOB_NEXT_PUBLIC_SUPABASE_URL \|\| secrets\.VIMOB_NEXT_PUBLIC_SUPABASE_URL \}\}/,
  )
  assert.match(
    workflow,
    /WEB_NEXT_PUBLIC_SUPABASE_ANON_KEY: \$\{\{ vars\.VIMOB_NEXT_PUBLIC_SUPABASE_ANON_KEY \|\| secrets\.VIMOB_NEXT_PUBLIC_SUPABASE_ANON_KEY \}\}/,
  )
  assert.match(workflow, /Missing VIMOB_NEXT_PUBLIC_SUPABASE_URL/)
  assert.match(workflow, /Missing VIMOB_NEXT_PUBLIC_SUPABASE_ANON_KEY/)
})

test('API and Web images receive the same immutable release SHA', async () => {
  const [workflow, apiDockerfile, webDockerfile] = await Promise.all([
    readRepositoryFile('.github/workflows/docker-images.yml'),
    readRepositoryFile('Dockerfile.api'),
    readRepositoryFile('Dockerfile.web'),
  ])

  const releaseArgument = /^ARG VIMOB_RELEASE_SHA(?:=[^\s]+)?$/m
  assert.match(apiDockerfile, releaseArgument)
  assert.match(webDockerfile, releaseArgument)

  for (const stepName of ['Build and push API', 'Build and push Web']) {
    assert.match(
      workflowStep(workflow, stepName),
      /^\s+VIMOB_RELEASE_SHA=\$\{\{ github\.sha \}\}$/m,
    )
  }

  const releaseAssignments = workflow.match(/VIMOB_RELEASE_SHA=[^\r\n]+/g) ?? []
  assert.deepEqual(releaseAssignments, [
    'VIMOB_RELEASE_SHA=${{ github.sha }}',
    'VIMOB_RELEASE_SHA=${{ github.sha }}',
  ])
})

test('health and readiness document the immutable release identity without caching', async () => {
  const openapi = await readRepositoryFile('packages/contracts/openapi/v1.yaml')

  assert.match(openapi, /^  \/healthz:\s*$/m)
  assert.match(openapi, /^  \/readyz:\s*$/m)
  assert.match(openapi, /\$ref: "#\/components\/headers\/VimobReleaseSha"/)
  assert.match(openapi, /\$ref: "#\/components\/headers\/HealthCacheControl"/)
  assert.match(openapi, /pattern: "\^\(\?:\[0-9a-f\]\{40\}\|unversioned\)\$"/)
  assert.match(openapi, /const: no-store/)
  assert.match(openapi, /required: \[status, release\]/)
})

for (const stackPath of [
  'deploy/portainer-stack.yml',
  'deploy/portainer-stack.build.yml',
]) {
  test(`${stackPath} keeps the web Supabase secret server-only and required`, async () => {
    const stack = await readRepositoryFile(stackPath)
    const webService = stack.split(/^  api:/m, 1)[0]

    assert.match(
      webService,
      /SUPABASE_SECRET_KEY: \$\{SUPABASE_SECRET_KEY:\?SUPABASE_SECRET_KEY is required for server-side Supabase admin operations\}/,
    )
    assert.doesNotMatch(stack, /NEXT_PUBLIC_SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY/)
  })
}
