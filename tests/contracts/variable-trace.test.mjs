// Manual alias tracer (spec §6.3): T25 cross-collection modes, T26 cycle / missing / depth, runtime wins.
// executionLayer=offline_fixture. Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceAlias, reconcileWithRuntime } from '../../scripts/variable-trace.mjs';

const alias = id => ({ type: 'VARIABLE_ALIAS', id });
const vars = {
  'sem/surface': { id: 'sem/surface', variableCollectionId: 'semantic', valuesByMode: { light: alias('prim/white'), dark: alias('prim/gray-900') } },
  'prim/white': { id: 'prim/white', variableCollectionId: 'primitive', valuesByMode: { base: { r: 1, g: 1, b: 1, a: 1 } } },
  'prim/gray-900': { id: 'prim/gray-900', variableCollectionId: 'primitive', valuesByMode: { base: { r: 0.1, g: 0.1, b: 0.1, a: 1 } } },
  'loop/a': { id: 'loop/a', variableCollectionId: 'semantic', valuesByMode: { light: alias('loop/b') } },
  'loop/b': { id: 'loop/b', variableCollectionId: 'semantic', valuesByMode: { light: alias('loop/a') } },
  'remote/alias': { id: 'remote/alias', variableCollectionId: 'semantic', valuesByMode: { light: alias('remote/unreadable') } },
};
const get = id => vars[id] || null;

test('T25: each collection uses its own active mode; one mode id is never applied to all collections', () => {
  const light = traceAlias('sem/surface', get, { semantic: 'light', primitive: 'base' });
  assert.equal(light.valueStatus, 'verified');
  assert.equal(light.traceStatus, 'complete');
  assert.deepEqual(light.chain, ['sem/surface', 'prim/white']);
  assert.deepEqual(light.value, { r: 1, g: 1, b: 1, a: 1 });

  const dark = traceAlias('sem/surface', get, { semantic: 'dark', primitive: 'base' });
  assert.deepEqual(dark.value, { r: 0.1, g: 0.1, b: 0.1, a: 1 });

  // using the semantic mode id for the primitive collection must not "work"
  const wrong = traceAlias('sem/surface', get, { semantic: 'light', primitive: 'light' });
  assert.equal(wrong.valueStatus, 'unresolved');
  assert.match(wrong.error, /no value for mode light in prim\/white/);
});

test('T26: cycles and depth are bounded; unreadable remote alias is trace-unavailable, not a fake value', () => {
  const cycle = traceAlias('loop/a', get, { semantic: 'light' });
  assert.equal(cycle.valueStatus, 'unresolved');
  assert.match(cycle.error, /cycle at loop\/a/);

  const deep = traceAlias('sem/surface', get, { semantic: 'light', primitive: 'base' }, { maxDepth: 0 });
  assert.match(deep.error, /max depth/);

  const remote = traceAlias('remote/alias', get, { semantic: 'light' });
  assert.equal(remote.valueStatus, 'unavailable');
  assert.equal(remote.traceStatus, 'partial');
  assert.equal(remote.value, null);
});

test('runtime resolveForConsumer wins; trace unavailable does not make the value unknown; mismatch is reported', () => {
  const remote = traceAlias('remote/alias', get, { semantic: 'light' });
  const merged = reconcileWithRuntime({ r: 0, g: 0.4, b: 0.9, a: 1 }, remote);
  assert.equal(merged.source, 'runtime');
  assert.equal(merged.valueStatus, 'verified');
  assert.equal(merged.traceStatus, 'partial');
  assert.equal(merged.mismatch, undefined);

  const light = traceAlias('sem/surface', get, { semantic: 'light', primitive: 'base' });
  const conflict = reconcileWithRuntime({ r: 0.9, g: 0.9, b: 0.9, a: 1 }, light);
  assert.deepEqual(conflict.value, { r: 0.9, g: 0.9, b: 0.9, a: 1 });
  assert.ok(conflict.mismatch);
});
