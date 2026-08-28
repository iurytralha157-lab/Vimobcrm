import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

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
