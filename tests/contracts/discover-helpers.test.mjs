// Discover helpers (v1.6, A05) against fake Figma data. executionLayer=offline_fixture: this proves
// the logic, not the real runtime or any speed-up. Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repo } from '../helpers.mjs';

const src = fs.readFileSync(path.join(repo, '.claude', 'skills', 'figma-ui', 'snippets', 'discover-helpers.js'), 'utf8');
const load = figma => new Function('figma', `${src}\nreturn { figmaUiUtf8Bytes, figmaUiPage, figmaUiFontCheck, figmaUiInstanceGroups };`)(figma); // eslint-disable-line no-new-func

test('A05: UTF-8 byte length matches Buffer for ASCII, CJK and astral characters', () => {
  const { figmaUiUtf8Bytes } = load({});
  for (const s of ['abc', '中文字', 'é', '😀x', '名片分享成功|END']) assert.equal(figmaUiUtf8Bytes(s), Buffer.byteLength(s, 'utf8'), s);
});

test('A05: paging stays under the byte budget, marks completeness and never cuts an oversized item', () => {
  const { figmaUiPage } = load({});
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `1:${i}`, name: '中文名稱'.repeat(20) }));
  let cursor = 0;
  const seen = [];
  let pages = 0;
  for (;;) {
    const p = figmaUiPage(items, { cursor, maxBytes: 2000 });
    assert.ok(Buffer.byteLength(JSON.stringify(p.items), 'utf8') <= 2000);
    seen.push(...p.items);
    pages++;
    if (p.complete) { assert.equal(p.nextCursor, null); break; }
    assert.equal(p.complete, false);
    cursor = p.nextCursor;
  }
  assert.ok(pages > 1);
  assert.deepEqual(seen.map(x => x.id), items.map(x => x.id));

  const big = figmaUiPage([{ text: 'x'.repeat(5000) }, { id: 'small' }], { maxBytes: 1000 });
  assert.equal(big.oversizedItem, 0);
  assert.deepEqual(big.items, []);
  assert.equal(big.complete, false);
});

test('A05: the font check returns only the requested fonts, never the whole installed list', async () => {
  const available = Array.from({ length: 9000 }, (_, i) => ({ fontName: { family: `F${i}`, style: 'Regular' } }))
    .concat([{ fontName: { family: 'Inter', style: 'Bold' } }]);
  const { figmaUiFontCheck } = load({ listAvailableFontsAsync: async () => available });
  const r = await figmaUiFontCheck([
    { family: 'Inter', style: 'Bold', usedBy: ['Button'] },
    { family: 'SF Pro Text', style: 'Semibold', usedBy: ['Status Bar'] },
    { family: 'Inter', style: 'Bold', usedBy: ['Toast'] },
  ]);
  assert.equal(r.checked, 2);
  assert.deepEqual(r.missing.map(f => f.family), ['SF Pro Text']);
  assert.deepEqual(r.fonts.find(f => f.family === 'Inter').usedBy, ['Button', 'Toast']);
  assert.ok(Buffer.byteLength(JSON.stringify(r), 'utf8') < 1000);
});

test('A05: instance groups collapse identical usage but keep different overrides, modes and versions apart', async () => {
  const set = { type: 'COMPONENT_SET', key: 'setkey', name: 'Button' };
  const mainV1 = { id: '1:1', key: 'k-active', name: 'type=Active', remote: true, parent: set };
  const mainV2 = { id: '9:9', key: 'k-active', name: 'type=Active', remote: true, parent: set }; // same key, newer import
  const inst = (id, main, extra = {}) => ({ id, type: 'INSTANCE', getMainComponentAsync: async () => main, overrides: [], componentProperties: {}, explicitVariableModes: {}, ...extra });
  const root = {
    findAllWithCriteria: ({ types }) => (assert.deepEqual(types, ['INSTANCE']), [
      inst('2:1', mainV1), inst('2:2', mainV1), inst('2:3', mainV1),
      inst('2:4', mainV1, { overrides: [{ id: '2:4', overriddenFields: ['characters'] }] }),
      inst('2:5', mainV1, { explicitVariableModes: { 'VariableCollectionId:1': '1:2' } }),
      inst('2:6', mainV2),
    ]),
  };
  const { figmaUiInstanceGroups } = load({});
  const r = await figmaUiInstanceGroups(root, { limit: 10 });
  assert.equal(r.scanned, 6);
  assert.equal(r.groups.length, 4);
  assert.equal(r.groups.find(g => g.count === 3).sampleIds.length, 3);
  assert.ok(r.groups.some(g => g.overrideFields.includes('characters')));
  assert.ok(r.groups.some(g => g.explicitModes.length === 1));
  assert.deepEqual(r.groups.filter(g => g.componentKey === 'k-active').map(g => g.mainComponentId).sort(), ['1:1', '1:1', '1:1', '9:9']);

  const limited = await figmaUiInstanceGroups(root, { limit: 2 });
  assert.equal(limited.limited, true);
  assert.equal(limited.scanned, 2);
});
