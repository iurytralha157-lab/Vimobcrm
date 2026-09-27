/** Generate a reviewable patch without editing the production stack. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const deployDir = dirname(fileURLToPath(import.meta.url))
const stackPath = join(deployDir, 'portainer-stack.yml')
const patchPath = join(deployDir, 'portainer-whatsapp-webhook-bridge.patch')

const bridgeService = `  whatsapp_webhook_bridge:
    # Pin independently from VIMOB_API_IMAGE so a production API rollout does
    # not replace both HTTP ingress targets in the same stack update.
    image: \${VIMOB_WHATSAPP_WEBHOOK_BRIDGE_IMAGE:?VIMOB_WHATSAPP_WEBHOOK_BRIDGE_IMAGE is required}
    deploy:
      replicas: 1
      update_config:
        parallelism: 1
        order: start-first
        failure_action: pause
        monitor: 8m
      restart_policy:
        condition: any
        delay: 5s
      labels:
        # Keep the bridge private until /readyz and ingress probes pass.
        - traefik.enable=\${VIMOB_WHATSAPP_WEBHOOK_BRIDGE_ENABLED:-false}
        - traefik.docker.network=\${TRAEFIK_NETWORK:-public}
        - traefik.http.routers.vimob-whatsapp-webhook-bridge.rule=Host(\`\${VIMOB_API_DOMAIN:-api.vimobcrm.com.br}\`) && Path(\`/v1/whatsapp/webhook/evolution-go\`)
        - traefik.http.routers.vimob-whatsapp-webhook-bridge.priority=1000
        - traefik.http.routers.vimob-whatsapp-webhook-bridge.entrypoints=\${TRAEFIK_HTTPS_ENTRYPOINT:-websecure}
        - traefik.http.routers.vimob-whatsapp-webhook-bridge.tls=true
        - traefik.http.routers.vimob-whatsapp-webhook-bridge.tls.certresolver=\${TRAEFIK_CERT_RESOLVER:-letsencryptresolver}
        - traefik.http.routers.vimob-whatsapp-webhook-bridge.service=vimob-whatsapp-webhook-bridge
        - traefik.http.services.vimob-whatsapp-webhook-bridge.loadbalancer.server.port=8081
    environment:
      <<: *vimob_api_environment
      API_BACKGROUND_WORKERS_ENABLED: "false"
      API_WHATSAPP_CALL_RECORDING_ONLY_WORKER_ENABLED: "false"
      DATABASE_MAX_CONNS: \${VIMOB_WHATSAPP_WEBHOOK_BRIDGE_DATABASE_MAX_CONNS:-4}
    secrets: *vimob_api_secrets
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:8081/readyz || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 3m
    networks:
      - vimob
      - traefik-public
`

function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) {
    throw new Error(`Expected exactly one occurrence of ${needle}`)
  }
  return source.replace(needle, replacement)
}

function buildUpdatedStack(original) {
  let updated = replaceOnce(
    original,
    '    environment:\n      API_ENV: production\n',
    '    environment: &vimob_api_environment\n      API_ENV: production\n',
  )
  updated = replaceOnce(
    updated,
    '    secrets:\n      - vimob_evogo_canary_api_key\n',
    '    secrets: &vimob_api_secrets\n      - vimob_evogo_canary_api_key\n',
  )
  return replaceOnce(updated, '\n\nsecrets:\n', `\n${bridgeService}secrets:\n`)
}

function gitPatch(original, updated) {
  const directory = mkdtempSync(join(tmpdir(), 'vimob-bridge-'))
  try {
    const before = join(directory, 'before.yml')
    const after = join(directory, 'after.yml')
    writeFileSync(before, original)
    writeFileSync(after, updated)
    let output
    try {
      output = execFileSync('git', ['diff', '--no-index', '--', before, after], { encoding: 'utf8' })
    } catch (error) {
      if (error.status !== 1) throw error
      output = error.stdout
    }
    const patch = output.replace(
      /^diff --git[^\n]*\n(?:index [^\n]*\n)?--- [^\n]*\n\+\+\+ [^\n]*\n/,
      'diff --git a/deploy/portainer-stack.yml b/deploy/portainer-stack.yml\n--- a/deploy/portainer-stack.yml\n+++ b/deploy/portainer-stack.yml\n',
    )
    if (!patch.startsWith('diff --git a/deploy/portainer-stack.yml')) {
      throw new Error('Could not normalize git diff headers')
    }
    return patch
  } finally {
    const resolved = resolve(directory)
    if (!resolved.startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('Refusing to remove unexpected temporary directory')
    }
    rmSync(resolved, { recursive: true, force: true })
  }
}

function validatePatch(original, patch) {
  const directory = mkdtempSync(join(tmpdir(), 'vimob-bridge-check-'))
  try {
    const deploy = join(directory, 'deploy')
    mkdirSync(deploy)
    const target = join(deploy, 'portainer-stack.yml')
    const patchTarget = join(directory, 'bridge.patch')
    writeFileSync(target, original)
    writeFileSync(patchTarget, patch)
    execFileSync('git', ['-C', directory, 'apply', patchTarget], { encoding: 'utf8' })
    const updated = readFileSync(target, 'utf8')
    const sourceModel = yaml.load(original)
    const bridgeModel = yaml.load(updated)
    assert.deepEqual(bridgeModel.services.api, sourceModel.services.api)
    assert.deepEqual(bridgeModel.services.web, sourceModel.services.web)
    const bridge = bridgeModel.services.whatsapp_webhook_bridge
    assert.equal(bridge.environment.API_BACKGROUND_WORKERS_ENABLED, 'false')
    assert.equal(bridge.environment.API_WHATSAPP_CALL_RECORDING_ONLY_WORKER_ENABLED, 'false')
    assert.equal(bridge.environment.EVOLUTION_GO_API_URL, sourceModel.services.api.environment.EVOLUTION_GO_API_URL)
    assert.equal(bridge.environment.EVOLUTION_GO_API_KEY, sourceModel.services.api.environment.EVOLUTION_GO_API_KEY)
    assert.equal(bridge.environment.DATABASE_URL, sourceModel.services.api.environment.DATABASE_URL)
    assert.deepEqual(bridge.secrets, sourceModel.services.api.secrets)
    assert.equal(bridge.deploy.replicas, 1)
    assert.match(bridge.deploy.labels.join('\n'), /Path\(`\/v1\/whatsapp\/webhook\/evolution-go`\)/)
    assert.match(bridge.deploy.labels.join('\n'), /traefik\.enable=\$\{VIMOB_WHATSAPP_WEBHOOK_BRIDGE_ENABLED:-false\}/)
    assert.equal(bridge.healthcheck.test[1].includes('/readyz'), true)
    const rendered = execFileSync('docker', ['stack', 'config', '--compose-file', target, '--skip-interpolation'], { encoding: 'utf8' })
    assert.match(rendered, /whatsapp_webhook_bridge:/)
    assert.match(rendered, /vimob-whatsapp-webhook-bridge\.priority: "1000"/)
    process.stdout.write('Bridge stack parses in Docker; existing API/Web service specs are unchanged\n')
  } finally {
    const resolved = resolve(directory)
    if (!resolved.startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('Refusing to remove unexpected temporary directory')
    }
    rmSync(resolved, { recursive: true, force: true })
  }
}

const original = readFileSync(stackPath, 'utf8')
const patch = gitPatch(original, buildUpdatedStack(original))
if (process.argv.includes('--validate')) {
  validatePatch(original, patch)
} else if (process.argv.includes('--check')) {
  if (readFileSync(patchPath, 'utf8') !== patch) {
    throw new Error('Bridge patch differs from the current production stack template')
  }
  process.stdout.write('Bridge patch matches current stack template\n')
} else {
  writeFileSync(patchPath, patch)
  process.stdout.write('Wrote deploy/portainer-whatsapp-webhook-bridge.patch\n')
}
