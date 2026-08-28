/**
 * Vimob self-hosted Edge Functions router.
 *
 * Derived from Supabase's Apache-2.0 self-hosted router and extended to apply
 * verify_jwt per function using production-manifest.json. Unknown functions
 * are denied by default.
 */
import * as jose from 'jsr:@panva/jose@6'

type FunctionManifest = {
  functions?: Array<{ slug?: string; verify_jwt?: boolean }>
}

const FUNCTIONS_ROOT = '/home/deno/functions'
const manifest = await loadManifest()
const jwtPolicy = new Map(
  (manifest.functions ?? [])
    .filter((item) => typeof item.slug === 'string')
    .map((item) => [item.slug as string, item.verify_jwt !== false]),
)

const jwtSecret = Deno.env.get('JWT_SECRET')
const jwks = parseJwks(Deno.env.get('SUPABASE_JWKS'))
const localJwks = jwks ? jose.createLocalJWKSet(jwks) : null

async function loadManifest(): Promise<FunctionManifest> {
  try {
    const raw = await Deno.readTextFile(`${FUNCTIONS_ROOT}/production-manifest.json`)
    return JSON.parse(raw) as FunctionManifest
  } catch (error) {
    console.error('Unable to load production function manifest', error)
    return { functions: [] }
  }
}

function parseJwks(raw: string | undefined): jose.JSONWebKeySet | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    return parsed?.keys && Array.isArray(parsed.keys)
      ? (parsed as jose.JSONWebKeySet)
      : null
  } catch {
    return null
  }
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) throw new Error('Missing bearer token')
  return match[1]
}

async function isValidJwt(token: string): Promise<boolean> {
  try {
    const { alg } = jose.decodeProtectedHeader(token)
    if (alg === 'HS256') {
      if (!jwtSecret) return false
      await jose.jwtVerify(token, new TextEncoder().encode(jwtSecret))
      return true
    }

    if ((alg === 'ES256' || alg === 'RS256') && localJwks) {
      await jose.jwtVerify(token, localJwks)
      return true
    }

    return false
  } catch (error) {
    console.error('JWT verification failed', error)
    return false
  }
}

async function existingImportMap(servicePath: string): Promise<string | null> {
  for (const name of ['deno.json', 'deno.jsonc', 'import_map.json']) {
    const candidate = `${servicePath}/${name}`
    try {
      const stat = await Deno.stat(candidate)
      if (stat.isFile) return candidate
    } catch {
      // Continue with the next supported file name.
    }
  }
  return null
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

Deno.serve(async (request: Request) => {
  const pathname = new URL(request.url).pathname
  const functionName = pathname.split('/').filter(Boolean)[0]

  if (!functionName || !jwtPolicy.has(functionName)) {
    return json(404, { message: 'Function not found' })
  }

  if (request.method !== 'OPTIONS' && jwtPolicy.get(functionName)) {
    try {
      if (!(await isValidJwt(getBearerToken(request)))) {
        return json(401, { message: 'Invalid JWT' })
      }
    } catch {
      return json(401, { message: 'Missing or invalid authorization' })
    }
  }

  const servicePath = `${FUNCTIONS_ROOT}/${functionName}`
  const importMapPath = await existingImportMap(servicePath)
  const environment = Deno.env.toObject()

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 150,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      importMapPath,
      envVars: Object.entries(environment),
    })
    return await worker.fetch(request)
  } catch (error) {
    console.error(`Function ${functionName} failed`, error)
    return json(500, { message: 'Function execution failed' })
  }
})

