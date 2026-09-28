// Snippets pasted into use_figma, run against fake nodes (T35, T36, T37, INVARIANT-12).
// The fingerprint must reproduce the three values recorded in M1. executionLayer=offline_fixture.
// Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repo } from '../helpers.mjs';

const dir = path.join(repo, '.claude', 'skills', 'figma-ui', 'snippets');
const src = ['mark-owned.js', 'fingerprint.js', 'precondition-guard.js', 'op-header.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

function load(fakeFigma) {
  // eslint-disable-next-line no-new-func
  return new Function('figma', `${src}\nreturn { figmaUiFingerprint, figmaUiGuard, figmaUiMarkOwned, figmaUiReadOwner, figmaUiFindOwned, figmaUiOpHeader };`)(fakeFigma);
}

// Minimal fake Figma nodes with only what the snippets use.
function node(props) {
  const data = {};
  const n = {
    width: 0, height: 0, fills: [], children: undefined,
    setSharedPluginData(ns, k, v) { data[`${ns}/${k}`] = v; },
    getSharedPluginData(ns, k) { return data[`${ns}/${k}`] ?? ''; },
    getSharedPluginDataKeys(ns) { return Object.keys(data).filter(k => k.startsWith(`${ns}/`)).map(k => k.slice(ns.length + 1)); },
    ...props,
  };
  if (!('children' in props)) delete n.children;
  return n;
}
function instance(id, mainKey, text) {
  return node({ id, type: 'INSTANCE', getMainComponentAsync: async () => ({ key: mainKey }), findAllWithCriteria: () => [{ characters: text }] });
}
function m1Row(children) {
  return node({
    id: '34016:68', type: 'FRAME', name: 'M1/ButtonRow', width: 300, height: 81,
    layoutMode: 'HORIZONTAL', paddingTop: 12, paddingRight: 16, paddingBottom: 24, paddingLeft: 16, itemSpacing: 8,
    primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', fills: [], children,
  });
}
const DEFAULT = '20af3af69b2d3a83291e7a575cf8a151b801f884';
const SECONDARY = 'ac6e4eae8d0ce8f64e3662755e68fd890e15205b';
const ACTIVE = 'ed7f7980af604a7434f2d54def727a839df06dd0';

test('fingerprint.js reproduces the M1 fingerprints fp1:3b000d57, fp1:38e19867 and fp1:d9899c64', async () => {
  const { figmaUiFingerprint } = load({});
  assert.equal(await figmaUiFingerprint(m1Row([instance('34016:69', DEFAULT, '主要按鈕'), instance('34016:73', SECONDARY, '次要按鈕')])), 'fp1:3b000d57');
  assert.equal(await figmaUiFingerprint(m1Row([instance('34016:69', DEFAULT, '次要按鈕'), instance('34016:73', ACTIVE, '主要按鈕')])), 'fp1:38e19867');
  assert.equal(await figmaUiFingerprint(m1Row([instance('34016:69', DEFAULT, '取消'), instance('34016:73', ACTIVE, '確認')])), 'fp1:d9899c64');
});

function world(root) {
  const byId = new Map();
  const walk = n => { byId.set(n.id, n); (n.children || []).forEach(walk); };
  walk(root);
  return { getNodeByIdAsync: async id => byId.get(id) || null };
}

async function setup() {
  const row = m1Row([instance('34016:69', DEFAULT, '取消'), instance('34016:73', ACTIVE, '確認')]);
  const api = load(world(row));
  api.figmaUiMarkOwned(row, { runId: 'ui-20260928-m1', operationId: 'op-0003', logicalKey: 'm1.button-row' });
  return { row, api, expected: { runId: 'ui-20260928-m1', expectedFingerprint: 'fp1:d9899c64', expectedChildIds: ['34016:69', '34016:73'] } };
}

test('guard passes when nothing changed', async () => {
  const { api, expected } = await setup();
  const g = await api.figmaUiGuard('34016:68', expected);
  assert.equal(g.ok, true);
});

test('T35: user edited an agent node -> conflict (user_modified), with both fingerprints', async () => {
  const { row, api, expected } = await setup();
  row.children[1] = instance('34016:73', ACTIVE, '送出');
  const g = await api.figmaUiGuard('34016:68', expected);
  assert.equal(g.ok, false);
  assert.equal(g.kind, 'user_modified');
  assert.equal(g.expectedFingerprint, 'fp1:d9899c64');
  assert.notEqual(g.currentFingerprint, 'fp1:d9899c64');
});

test('T36: user added a node inside the agent frame -> conflict (user_added_nodes) listing the foreign node', async () => {
  const { row, api, expected } = await setup();
  row.children.push(node({ id: '99:1', type: 'TEXT', name: 'my note', findAllWithCriteria: () => [] }));
  const g = await api.figmaUiGuard('34016:68', expected);
  assert.equal(g.kind, 'user_added_nodes');
  assert.deepEqual(g.foreignChildren.map(c => c.id), ['99:1']);
});

test('T37: user deleted the agent node or a child -> conflict (deleted / user_removed_nodes), never recreate', async () => {
  const { row, api, expected } = await setup();
  assert.equal((await api.figmaUiGuard('404:404', expected)).kind, 'deleted');
  row.children.pop();
  const g = await api.figmaUiGuard('34016:68', expected);
  assert.equal(g.kind, 'user_removed_nodes');
  assert.deepEqual(g.missingChildren, ['34016:73']);
});

test('guard refuses nodes owned by another run; marker needs runId/operationId/logicalKey; findOwned is scoped to a parent', async () => {
  const { row, api, expected } = await setup();
  assert.equal((await api.figmaUiGuard('34016:68', { ...expected, runId: 'other-run' })).kind, 'not_owned');
  assert.throws(() => api.figmaUiMarkOwned(node({ id: '1:1' }), { runId: 'r' }), /operationId/);
  const section = node({ id: '34014:9', type: 'SECTION', children: [row] });
  assert.deepEqual(api.figmaUiFindOwned(section, { runId: 'ui-20260928-m1', logicalKey: 'm1.button-row' }).map(n => n.id), ['34016:68']);
  assert.deepEqual(api.figmaUiFindOwned(section, { runId: 'ui-20260928-m1', logicalKey: 'other' }), []);
});

test('op-header.js builds the exact header the hook parses', async () => {
  const { figmaUiOpHeader } = load({});
  const { parseOpHeader } = await import('../../scripts/hooks/lib.mjs');
  const line = figmaUiOpHeader('ui-20260929-001', 'rd-0003', 'read');
  assert.deepEqual(parseOpHeader(`${line}\nreturn 1`), { runId: 'ui-20260929-001', operationId: 'rd-0003', mode: 'read' });
  assert.throws(() => figmaUiOpHeader('run', 'op', 'delete'), /mode/);
});
