import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import type { ErrorInfo } from 'next/dist/client/components/error-boundary'
import * as jsxRuntime from 'react/jsx-runtime'
import ts from 'typescript'

const SOURCE_ROOTS = ['app', 'components', 'hooks']
const FORBIDDEN_PUBLIC_COPY = [
  /API demorou/i,
  /Confira se a API local/i,
  /A API do Vimob não está acessível/i,
  /Resposta invalida do backend/i,
  /Inicie apps\/api/i,
  /ajuste NEXT_PUBLIC_VIMOB_API_URL/i,
]

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) return listSourceFiles(absolutePath)
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) {
      return []
    }

    return [absolutePath]
  })
}

test('não expõe instruções de infraestrutura na interface do CRM', () => {
  const violations = SOURCE_ROOTS.flatMap((root) =>
    listSourceFiles(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return FORBIDDEN_PUBLIC_COPY
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${file}: ${pattern}`)
    }),
  )

  assert.deepEqual(violations, [])
})

type RuntimeElement = {
  type?: unknown
  props?: Record<string, unknown>
}

function findRuntimeButton(node: unknown, button: unknown): RuntimeElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRuntimeButton(child, button)
      if (found) return found
    }
    return undefined
  }
  if (!node || typeof node !== 'object') return undefined
  const element = node as RuntimeElement
  return element.type === button ? element : findRuntimeButton(element.props?.children, button)
}

for (const sourceFile of ['app/error.tsx', 'app/(protected)/error.tsx']) {
  test(`error boundary ${sourceFile}: retry click preserves the Next callback and telemetry`, async () => {
    const effects: Array<{ run: () => void; dependencies: unknown[] }> = []
    const reports: Record<string, unknown>[] = []
    const logged: unknown[][] = []
    const Button = () => null
    const Icon = () => null
    const compiledModule = { exports: {} as { default?: (props: ErrorInfo) => unknown } }
    const code = ts.transpileModule(readFileSync(sourceFile, 'utf8'), {
      fileName: sourceFile,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText
    const loadMock = (name: string): unknown => {
      switch (name) {
        case 'react': return { useEffect: (run: () => void, dependencies: unknown[]) => effects.push({ run, dependencies }) }
        case 'react/jsx-runtime': return jsxRuntime
        case 'lucide-react': return { AlertTriangle: Icon, AlertCircle: Icon, RefreshCcw: Icon }
        case '@/components/ui/button': return { Button }
        case '@/lib/api/telemetry': return { reportErrorEvent: async (input: Record<string, unknown>) => { reports.push(input) } }
        case '@/lib/api/vimob-error': return { getTechnicalErrorMessage: (error: Error) => error.message }
        default: throw new Error(`Unexpected error-boundary dependency: ${name}`)
      }
    }
    const location = { href: 'https://synthetic.invalid/dashboard', pathname: '/dashboard', search: '' }
    runInNewContext(code, {
      exports: compiledModule.exports, module: compiledModule, require: loadMock,
      window: { location }, navigator: { userAgent: 'Synthetic boundary test' },
      console: { error: (...args: unknown[]) => logged.push(args) },
    }, { filename: sourceFile, timeout: 1_000 })

    const error = Object.assign(new Error('Synthetic boundary failure'), { digest: 'synthetic-digest' })
    let retryCalls = 0
    let resetCalls = 0
    const component = compiledModule.exports.default
    assert.ok(component)
    const tree = component({ error, retry: () => { retryCalls++ }, reset: () => { resetCalls++ } })
    const button = findRuntimeButton(tree, Button)
    const click = button?.props?.onClick
    assert.ok(typeof click === 'function', 'the recovery button must expose a click handler')
    assert.equal(retryCalls, 0, 'rendering must not invoke recovery')
    click()
    assert.equal(retryCalls, 1, 'the click must invoke the retry supplied by Next')
    assert.equal(resetCalls, 0, 'recovery must use retry rather than only reset the boundary')

    assert.equal(effects.length, 1)
    assert.equal(effects[0].dependencies.length, 1)
    assert.equal(effects[0].dependencies[0], error)
    effects[0].run()
    await Promise.resolve()
    assert.equal(logged.length, 1)
    assert.equal(logged[0][1], error)
    assert.equal(reports.length, 1)
    assert.equal(reports[0].source, 'frontend')
    assert.equal(reports[0].severity, 'error')
    assert.equal(reports[0].category, 'react_error_boundary')
    assert.equal(reports[0].component, sourceFile.replace(/\.tsx$/, ''))
    assert.equal(reports[0].fingerprint, error.digest)
    assert.equal(reports[0].stack, error.stack)
    assert.equal(reports[0].url, location.href)
  })
}
