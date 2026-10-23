import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_FILTER_PANEL_LAYOUT, FilterPanelLayoutCoordinator,
  type FilterPanelRegistrationState,
} from '@/lib/filters/filter-panel-layout';

function fixture() {
  const pending = new Set<() => void>();
  const coordinator = new FilterPanelLayoutCoordinator(callback => {
    pending.add(callback);
    return () => { pending.delete(callback); };
  });
  return { coordinator, pending, flush() {
    for (const callback of [...pending]) { pending.delete(callback); callback(); }
  } };
}

function state(overrides: Partial<FilterPanelRegistrationState> = {}): FilterPanelRegistrationState {
  return { active: true, present: true, mobile: false, panelElement: null, dockElement: null,
    tryClose: () => true, ...overrides };
}

test('no pilot invokes the original chat action immediately', () => {
  const f = fixture(); let opened = 0;
  assert.equal(f.coordinator.requestOpenChat(() => opened++), true);
  assert.equal(opened, 1);
  assert.equal(f.pending.size, 0);
  assert.equal(f.coordinator.getSnapshot(), EMPTY_FILTER_PANEL_LAYOUT);
});

test('validation refusal or an exception leaves the panel and chat untouched', () => {
  for (const tryClose of [() => false, () => { throw new Error('invalid search'); }]) {
    const f = fixture(), panel = f.coordinator.registerPanel('contacts'); let opened = 0;
    panel.update(state({ tryClose }));
    assert.equal(f.coordinator.requestOpenChat(() => opened++), false);
    f.flush();
    assert.equal(opened, 0); assert.equal(f.coordinator.getSnapshot().active, true);
  }
});

test('accepted close waits for actual content exit and coalesces repeat clicks', () => {
  const f = fixture(), panel = f.coordinator.registerPanel('contacts'); let opened = 0, requested = 0;
  panel.update(state({ tryClose: reason => { assert.equal(reason, 'chat'); requested++; return true; } }));
  assert.equal(f.coordinator.requestOpenChat(() => opened++), true);
  assert.equal(f.coordinator.requestOpenChat(() => opened += 100), true);
  panel.update(state({ active: false, present: true })); f.flush();
  assert.equal(opened, 0); assert.equal(requested, 1);
  panel.update(state({ active: false, present: false }));
  assert.equal(opened, 0); assert.equal(f.pending.size, 1);
  f.flush(); f.flush(); assert.equal(opened, 1);
});

test('a synchronous close update is retained until validation returns', () => {
  const f = fixture(), panel = f.coordinator.registerPanel('contacts'); let opened = 0;
  panel.update(state({ tryClose: () => {
    panel.update(state({ active: false, present: false })); return true;
  } }));
  f.coordinator.requestOpenChat(() => opened++); f.flush(); assert.equal(opened, 1);
});

test('reopening the panel before or after exit cancels the old chat request', () => {
  for (const exited of [false, true]) {
    const f = fixture(), panel = f.coordinator.registerPanel('contacts'); let opened = 0;
    panel.update(state()); f.coordinator.requestOpenChat(() => opened++);
    panel.update(state({ active: false, present: !exited }));
    panel.update(state()); f.flush(); assert.equal(opened, 0);
    panel.update(state({ active: false, present: false })); f.flush(); assert.equal(opened, 0);
  }
});

test('scope reset after accepted exit cancels the scheduled callback and stale updates', () => {
  const f = fixture(), panel = f.coordinator.registerPanel('contacts'); let opened = 0;
  panel.update(state()); f.coordinator.requestOpenChat(() => opened++);
  panel.update(state({ active: false, present: false }));
  assert.equal(f.pending.size, 1); f.coordinator.reset();
  panel.update(state()); f.flush();
  assert.equal(opened, 0); assert.equal(f.coordinator.getSnapshot(), EMPTY_FILTER_PANEL_LAYOUT);
});

test('unregistering a route cancels pending chat instead of treating it as a validated exit', () => {
  const f = fixture(), panel = f.coordinator.registerPanel('contacts'); let opened = 0;
  panel.update(state()); f.coordinator.requestOpenChat(() => opened++);
  panel.unregister(); f.flush();
  assert.equal(opened, 0); assert.equal(f.coordinator.getSnapshot(), EMPTY_FILTER_PANEL_LAYOUT);
});

test('new active registrations cancel requests and stale tokens cannot remove the current panel', () => {
  const f = fixture(), oldPanel = f.coordinator.registerPanel('contacts'); let opened = 0;
  oldPanel.update(state()); f.coordinator.requestOpenChat(() => opened++);
  const current = f.coordinator.registerPanel('contacts'); current.update(state({ mobile: true }));
  oldPanel.unregister(); f.flush();
  assert.equal(opened, 0); assert.equal(f.coordinator.getSnapshot().mobile, true);
  current.update(state({ active: false, present: false })); f.flush(); assert.equal(opened, 0);
});

test('equivalent registration updates do not publish, while dock and geometry changes do', () => {
  const f = fixture(), panel = f.coordinator.registerPanel('contacts'); let changed = 0, width = 420;
  const element = { getBoundingClientRect: () => ({ width }) } as HTMLElement;
  const dock = {} as HTMLElement;
  const unsubscribe = f.coordinator.subscribe(() => changed++);
  panel.update(state({ panelElement: element }));
  assert.equal(changed, 1); assert.equal(f.coordinator.getSnapshot().panelWidth, 420);
  panel.update(state({ panelElement: element })); assert.equal(changed, 1);
  width = 460; f.coordinator.refreshGeometry(); assert.equal(changed, 2);
  panel.update(state({ panelElement: element, dockElement: dock, mobile: true }));
  assert.equal(changed, 3); assert.equal(f.coordinator.getSnapshot().dockElement, dock);
  assert.equal(f.coordinator.getSnapshot().panelWidth, 460);
  unsubscribe(); panel.unregister(); assert.equal(changed, 3);
});
