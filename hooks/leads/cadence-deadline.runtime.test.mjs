import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { countOverdueCadenceTasks, getPendingCadenceDeadlines } from '../../lib/lead-cadence-presentation.ts'

const path = 'hooks/leads/use-cadence-overdue-count.ts'
const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function runtime() {
  const slots = [], timers = new Map(), listeners = new Map()
  let cursor = 0, clock = Date.parse('2026-10-18T12:00:00Z'), timerId = 0
  const changed = (a, b) => !a || b.some((v, i) => !Object.is(v, a[i]))
  const events = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  }
  const dependencies = {
    useState: initial => {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, value => { slots[index].value = value }]
    },
    useMemo: (build, keys) => {
      const index = cursor++
      if (changed(slots[index]?.keys, keys)) slots[index] = { keys, value: build() }
      return slots[index].value
    },
    useEffect: (setup, keys) => {
      const index = cursor++
      if (changed(slots[index]?.keys, keys)) {
        slots[index]?.cleanup?.()
        slots[index] = { keys, cleanup: setup() }
      }
    },
    Date: { now: () => clock }, document: events, window: events,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id },
    clearTimeout: id => timers.delete(id),
    countOverdueCadenceTasks, getPendingCadenceDeadlines,
  }
  const hook = Function(...Object.keys(dependencies), 'exports', code + ';return exports.useCadenceOverdueCount;')(...Object.values(dependencies), {})
  return {
    timers, listeners,
    render(state) { cursor = 0; return hook(state) },
    advance(ms) {
      const end = clock + ms
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        clock = next[1].at; timers.delete(next[0]); next[1].callback()
      }
      clock = end
    },
    jump(ms) { clock += ms },
    event(name) { listeners.get(name)?.() },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
}
const task = { status: 'pending', is_done: false, due_at: '2026-10-18T12:01:00Z' }
const state = { deal_status: 'open', tasks: [task] }

test('prazo vence com o painel aberto sem refetch nem alteracao da tarefa', () => {
  const r = runtime()
  assert.equal(r.render(state), 0)
  r.advance(60_001)
  assert.equal(r.render(state), 1)
  assert.equal(state.tasks[0].status, 'pending')
  assert.equal(r.timers.size, 0)
  r.unmount()
})

test('fechar lead ou desmontar painel cancela timer e listeners', () => {
  const r = runtime()
  r.render(state); r.advance(0)
  assert.equal(r.timers.size, 1)
  assert.equal(r.render({ ...state, deal_status: 'won' }), 0)
  assert.equal(r.timers.size, 0)
  assert.equal(r.listeners.size, 0)
  r.render(state); r.advance(0); r.unmount()
  assert.equal(r.timers.size, 0)
})

test('refoco atualiza apos suspensao do celular e nao duplica timers', () => {
  const r = runtime()
  r.render(state); r.advance(0); r.jump(120_000)
  r.event('focus'); r.event('visibilitychange'); r.advance(0)
  assert.equal(r.render(state), 1)
  assert.equal(r.timers.size, 0)
  r.unmount()
})

test('receber tarefas novas troca o prazo observado e tarefas concluidas nao contam', () => {
  const r = runtime()
  r.render(state); r.advance(0)
  const next = { ...state, tasks: [{ ...task, due_at: '2026-10-18T12:02:00Z' }] }
  r.render(next); r.advance(60_001)
  assert.equal(r.render(next), 0)
  r.advance(60_000)
  assert.equal(r.render(next), 1)
  const done = { ...next, tasks: [{ ...next.tasks[0], is_done: true }] }
  assert.equal(r.render(done), 0)
  assert.equal(r.timers.size, 0)
  r.unmount()
})
