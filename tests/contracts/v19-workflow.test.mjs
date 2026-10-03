// v1.9 question flow phase 1 and common design rules (spec §7.4 DEC-12–15, §8.1 EXT-01 / step 6b, §9.6,
// §10.3, §14, §15 item 13, §20): T82–T94. executionLayer=offline_fixture.
// Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRun, validateSchema, DELEGABLE_KINDS, EXCLUDED_TOPICS } from '../../scripts/validate-artifacts.mjs';
import { evaluateRun, writeEvaluation, RULE_VERSION } from '../../scripts/evaluate-completion.mjs';
import { runMetrics, renderHandoff, recordRework } from '../../scripts/run-report.mjs';
import { runContext } from '../../scripts/run-context.mjs';
import { createRun } from '../../scripts/state-store.mjs';
import { loadPolicy } from '../../scripts/product-policy.mjs';
import { copyM1, repo, M1_FIXTURE, tmpRoot } from '../helpers.mjs';

const RUN = 'ui-20260928-m1';
const NOW = '2026-10-03T00:00:00.000Z';
const LATER = '2026-10-03T00:05:00.000Z';
const readJ = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const has = (list, re) => assert.ok(list.some(e => re.test(e)), `expected ${re} in\n${list.join('\n')}`);
const none = (list, re) => assert.ok(!list.some(e => re.test(e)), `did not expect ${re} in\n${list.join('\n')}`);
const sem = (dir, stage) => validateRun(dir, stage ? { stage } : {}).semanticErrors;

const direction = (over = {}) => ({ id: 'dd-20', kind: 'direction', topic: 'layout', question: '方向：歡迎頁採參考畫面 A 的置中版型', options: ['A 置中', 'B 上下分區'], recommendation: 'A 置中', answer: 'A 置中', source: 'user', evidenceRefs: [], decidedAt: NOW, status: 'answered', confirmation: 'prefilled_confirmed', ...over });
const auth = (over = {}) => ({ id: 'dec-020', decision: '核准方向內的尺寸、留白、對齊、元件寬度、佔位尺寸交給 agent 決定並驗證', scope: 'run', decidedAt: NOW, source: 'user', runOnly: true, confirmation: 'prefilled_confirmed', delegation: { allowedKinds: [...DELEGABLE_KINDS], excludedKinds: [...EXCLUDED_TOPICS] }, ...over });
const detail = (over = {}) => ({ id: 'dd-21', kind: 'spacing', topic: 'detail', question: '卡片內距', options: ['16', '24'], recommendation: '16', answer: '16', source: 'user', evidenceRefs: [], decidedAt: NOW, status: 'answered', directionRef: 'dd-20', delegation: { decisionRef: 'dec-020', scope: 'run', runId: RUN }, ...over });
const child = (over = {}) => ({ id: 'dd-22', kind: 'other', topic: 'visual', question: '背景：沿用參考畫面的淺灰底', options: ['淺灰', '白'], recommendation: '淺灰', answer: '淺灰', source: 'user', evidenceRefs: [], decidedAt: NOW, status: 'answered', dependsOn: 'dd-20', confirmedWith: 'direction', ...over });
const withPlan = fn => copyM1({ plan: p => { fn(p); } });
const delegated = (...dds) => withPlan(p => { p.decisions.push(auth()); p.designDecisions.push(direction(), ...dds); });

// ---------------- T82 ----------------
test('T82: a delegated detail of an allowed kind inside a confirmed direction passes; plan summary data and handoff list it', () => {
  assert.equal(RULE_VERSION, '12.1@1.9');
  const dir = delegated(detail(), detail({ id: 'dd-23', kind: 'component_width', question: '登入按鈕寬度', options: ['Fill', 'Hug'], recommendation: 'Fill', answer: 'Fill' }));
  const r = validateRun(dir);
  assert.deepEqual(r.schemaErrors, []);
  assert.deepEqual(r.semanticErrors, []);
  none(r.notices, /delegation does not list/);

  const m = runMetrics(dir, { root: tmpRoot(), events: [] });
  assert.equal(m.decisions.delegatedDetails, 2);
  assert.equal(m.decisions.directionProposals, 1);
  assert.equal(m.decisions.substantive, 8 + 1, 'M1 has 8 user decisions; the direction counts, delegated details do not');

  writeEvaluation(dir);
  const text = renderHandoff(dir, { root: tmpRoot() });
  const item13 = text.split('## 委派、擬稿與外部規範')[1].split('\n## ')[0];
  assert.match(item13, /dd-21［spacing］卡片內距：16（方向 dd-20，授權 dec-020）/);
  assert.match(item13, /dd-23［component_width］登入按鈕寬度：Fill/);
  assert.match(text, /實質決策 9（委派 2、方向方案 1）/);
});

// ---------------- T83 ----------------
test('T83: delegation outside the authorised kinds, into an excluded topic or an unconfirmed direction is refused (INVARIANT-29)', () => {
  const cases = [
    [delegated(detail({ topic: 'copy', kind: 'other', question: '條款文案' })), [/kind other is not delegated by dec-020/, /topic copy can never be delegated/]],
    [delegated(detail({ topic: 'brand_asset' })), [/topic brand_asset can never be delegated/]],
    [delegated(detail({ topic: 'new_component' })), [/topic new_component can never be delegated/]],
    [delegated(detail({ topic: 'raw_value_exception' })), [/topic raw_value_exception/]],
    [delegated(detail({ kind: undefined })), [/delegated under dec-020 without kind/]],
    [delegated(detail({ directionRef: undefined })), [/without directionRef/]],
    [delegated(detail({ directionRef: 'dd-21' })), [/directionRef dd-21 is not a kind:direction/]],
    [withPlan(p => { p.decisions.push(auth({ delegation: { allowedKinds: ['size'], excludedKinds: [...EXCLUDED_TOPICS] } })); p.designDecisions.push(direction(), detail()); }), [/kind spacing is not delegated by dec-020 \(allowed: size\)/]],
    [withPlan(p => { p.decisions.push(auth()); p.designDecisions.push(direction({ status: 'pending', answer: null, decidedAt: null, confirmation: undefined }), detail()); }), [/direction dd-20 is not confirmed/]],
  ];
  for (const [dir, res] of cases) { const errs = sem(dir); for (const re of res) has(errs, re); }

  // the schema only lets the five detail kinds into allowedKinds; a delegation is run-scoped
  const plan = readJ(path.join(M1_FIXTURE, 'plan.json'));
  assert.ok(validateSchema('plan', { ...plan, decisions: [auth({ delegation: { allowedKinds: ['direction'], excludedKinds: [] } })] }).length);
  assert.ok(validateSchema('plan', { ...plan, decisions: [auth({ scope: 'product' })] }).length, 'a delegation is never product scope');
  assert.ok(validateSchema('plan', { ...plan, decisions: [auth({ runOnly: undefined })] }).length, 'a delegation is runOnly');
  // a delegation that does not list the fixed exclusions is a notice (they are excluded anyway)
  const loose = withPlan(p => { p.decisions.push(auth({ delegation: { allowedKinds: ['spacing'], excludedKinds: ['copy'] } })); p.designDecisions.push(direction(), detail({ topic: 'platform' })); });
  const r = validateRun(loose);
  has(r.notices, /delegation does not list brand_asset/);
  has(r.semanticErrors, /topic platform can never be delegated/);
});

// ---------------- T84 ----------------
test('T84: a new run has no delegation; details go back to the prefilled list and another run\'s delegation is refused', () => {
  const root = tmpRoot();
  const { dir } = createRun({ root, goal: 'new screen' });
  const ctx = runContext(dir, 'new', { root, pluginVersion: { status: 'current' } });
  assert.ok(!ctx.confirmed.some(c => /delegation/.test(c)), 'a new run never starts with a delegation');

  // continue on the same run reuses it
  const same = delegated(detail());
  assert.ok(runContext(same, 'continue', { pluginVersion: { status: 'current' } }).confirmed.some(c => /dec-020 delegation \(size, spacing, alignment, component_width, placeholder_size; this run only\)/.test(c)));

  // a delegated decision carrying an earlier run's authorisation is refused (INVARIANT-18)
  const other = delegated(detail({ delegation: { decisionRef: 'dec-020', scope: 'run', runId: 'ui-20261003-001' } }));
  has(sem(other), /delegation belongs to run ui-20261003-001/);
  // without a delegation the detail is an ordinary pending row (A mode)
  const noAuth = withPlan(p => { p.designDecisions.push(direction(), { ...detail(), delegation: undefined, directionRef: undefined, status: 'pending', answer: null, decidedAt: null }); });
  assert.equal(evaluateRun(noAuth).evaluation.result, 'awaiting_user');
});

// ---------------- T85 ----------------
test('T85: platform, write scope, brand assets, copy and external requirements cannot be bundled into a direction', () => {
  for (const topic of ['platform', 'write_scope', 'brand_asset', 'copy', 'external_requirement']) {
    has(sem(withPlan(p => { p.designDecisions.push(direction(), child({ topic })); })), new RegExp(`${topic} cannot be bundled into direction dd-20`));
  }
  none(sem(withPlan(p => { p.designDecisions.push(direction(), child()); })), /cannot be bundled/);
  has(sem(withPlan(p => { p.designDecisions.push(direction(), child({ dependsOn: 'dec-001' })); })), /dependsOn dec-001 is not a kind:direction/);
  // a direction is not itself a sub-choice (schema)
  const plan = readJ(path.join(M1_FIXTURE, 'plan.json'));
  assert.ok(validateSchema('plan', { ...plan, designDecisions: [direction({ dependsOn: 'dd-19' })] }).length);
  assert.ok(validateSchema('plan', { ...plan, designDecisions: [direction(), { ...child(), dependsOn: undefined }] }).length, 'confirmedWith only on sub-choices');
});

// ---------------- T86 ----------------
test('T86: sub-choices are confirmed with the direction; when the user changes direction they become single rows', () => {
  // accepted as proposed: the child is confirmed with the bundle and is not a separate substantive decision
  const accepted = withPlan(p => { p.designDecisions.push(direction(), child()); });
  assert.deepEqual(sem(accepted), []);
  assert.equal(runMetrics(accepted, { root: tmpRoot(), events: [] }).decisions.substantive, 9);

  // the user changed the direction: confirming the child with the bundle is refused; a single row passes
  const changed = d => withPlan(p => { p.designDecisions.push(direction({ confirmation: 'user_modified', answer: 'B 上下分區' }), d); });
  has(sem(changed(child())), /the user changed direction dd-20; ask its sub-choices as single rows/);
  const row = changed(child({ confirmedWith: 'row', confirmation: 'user_filled', decidedAt: LATER }));
  assert.deepEqual(sem(row), []);
  assert.equal(runMetrics(row, { root: tmpRoot(), events: [] }).decisions.substantive, 10, 'a sub-choice asked as its own row counts');

  // a child cannot be answered before its direction; pending children are asked with their parent named
  has(sem(withPlan(p => { p.designDecisions.push(direction({ status: 'pending', answer: null, decidedAt: null, confirmation: undefined }), child()); })), /answered while its direction dd-20 is not confirmed/);
  const pending = withPlan(p => { p.designDecisions.push(direction({ confirmation: 'user_modified' }), child({ status: 'pending', answer: null, decidedAt: null, confirmedWith: undefined })); });
  const ask = runContext(pending, 'continue', { pluginVersion: { status: 'current' } }).ask.find(a => a.item === 'dd-22');
  assert.equal(ask.dependsOn, 'dd-20');
});

// ---------------- T87 ----------------
test('T87: unconfirmed draft copy stops at the Build boundary; an example inside a question is not the user\'s text (INVARIANT-30)', () => {
  const withCopy = (...copy) => withPlan(p => { p.screens[0].copy = copy; });
  const draft = { id: 'cp-04', role: 'terms note', text: '登入即表示同意服務條款', status: 'pending', origin: 'draft' };

  has(sem(withCopy(draft), 'build'), /draft copy \(擬稿\) cp-04 the user has not confirmed \(INVARIANT-30, DEC-14\)/);
  // a confirmed draft needs the decision that confirmed it, and keeps origin draft
  const plan = readJ(path.join(M1_FIXTURE, 'plan.json'));
  const scr = c => ({ ...plan, screens: [{ ...plan.screens[0], copy: [c] }] });
  assert.ok(validateSchema('plan', scr({ ...draft, status: 'confirmed' })).length, 'confirmed draft without decisionRef');
  assert.deepEqual(validateSchema('plan', scr({ ...draft, status: 'confirmed', decisionRef: 'dec-001' })), []);
  assert.ok(validateSchema('plan', scr({ ...draft, origin: 'user' })).length, 'user copy names its source');
  assert.ok(validateSchema('plan', scr({ ...draft, origin: 'existing' })).length, 'existing copy names its source');
  assert.equal(validateRun(withCopy({ ...draft, status: 'confirmed', decisionRef: 'dec-001' }), { stage: 'build' }).ok, true);

  // the user said "include it" without giving the text: the question's example is not the answer
  const dd08 = { id: 'dd-08', question: '按鈕下方要不要放條款說明？例如「登入即表示同意服務條款」', options: ['放', '不放'], recommendation: '放', answer: '放', source: 'user', evidenceRefs: [], decidedAt: NOW, status: 'answered' };
  const example = withPlan(p => { p.designDecisions.push(dd08); p.screens[0].copy = [{ ...draft, status: 'confirmed', origin: 'user', sourceRef: 'dd-08' }]; });
  has(sem(example), /origin user but "登入即表示同意服務條款" is not in the answer of dd-08; it only appears in the question/);
  const own = withPlan(p => { p.designDecisions.push({ ...dd08, answer: '放：登入即表示同意服務條款與隱私權政策' }); p.screens[0].copy = [{ ...draft, text: '登入即表示同意服務條款與隱私權政策', status: 'confirmed', origin: 'user', sourceRef: 'dd-08' }]; });
  none(sem(own), /origin user/);

  // handoff item 13 lists drafts, confirmed or not; legacy copy without origin is only a notice
  const d = withCopy({ ...draft, status: 'confirmed', decisionRef: 'dec-001' });
  writeEvaluation(d);
  assert.match(renderHandoff(d, { root: tmpRoot() }), /m1\.button-row\/cp-04（terms note）「登入即表示同意服務條款」：使用者已確認（dec-001）/);
  has(validateRun(withCopy({ id: 'cp-01', role: 'label', text: 'Aiwow', status: 'confirmed' })).notices, /without origin \(written before v1\.9/);
});

// ---------------- T88 ----------------
test('T88: external requirements carry url, checkedAt and status; unverified ones are never facts and block a delivery that depends on them', () => {
  const req = (over = {}) => ({ id: 'ext-01', subject: 'LINE Login button', url: 'https://developers.line.biz/en/docs/line-login/login-button/', checkedAt: NOW, appliesWhen: '畫面提供 LINE 登入', requirement: '使用 LINE 官方按鈕樣式與色彩', inference: '本案按鈕需改為官方樣式', status: 'verified', sourceKind: 'official', ...over });
  const inv = readJ(path.join(M1_FIXTURE, 'inventory.json'));
  const check = r => validateSchema('inventory', { ...inv, externalRequirements: [r] });
  assert.deepEqual(check(req()), []);
  assert.ok(check(req({ url: null })).length, 'verified needs the url');
  assert.ok(check(req({ checkedAt: null })).length, 'verified needs checkedAt');
  assert.ok(check(req({ sourceKind: 'secondary' })).length, 'second-hand material is not verified');
  assert.deepEqual(check(req({ status: 'unverified', url: null, checkedAt: null, sourceKind: 'none' })), []);

  const withReq = (r, planFn = () => {}) => copyM1({ inventory: i => { i.externalRequirements = [r]; }, plan: p => { planFn(p); } });
  const unverified = req({ status: 'unverified', url: null, checkedAt: null, sourceKind: 'none', affectsDelivery: true });
  has(sem(withReq(unverified), 'build'), /external requirement ext-01 \(LINE Login button\) is unverified and this delivery depends on it/);
  assert.equal(validateRun(withReq({ ...unverified, decisionRef: 'dec-000' }), { stage: 'build' }).ok, true);
  assert.equal(validateRun(withReq({ ...unverified, affectsDelivery: false }), { stage: 'build' }).ok, true, 'a requirement for later release does not block the draft');
  has(sem(withReq(req(), p => { p.designDecisions.push({ ...direction(), requirementRefs: ['ext-09'] }); })), /requirementRef ext-09 not found/);

  const dir = withReq(unverified);
  writeEvaluation(dir);
  assert.match(renderHandoff(dir, { root: tmpRoot() }), /ext-01 LINE Login button：\*\*未驗證\*\*：使用 LINE 官方按鈕樣式與色彩；本案推論：本案按鈕需改為官方樣式；本次交付依賴此項/);
});

// ---------------- T89 ----------------
test('T89: component and style keys that do not import are found before Plan, with the fallback listed', () => {
  const ic = (over = {}) => ({ id: 'imp-01', kind: 'component_set', componentMapRef: 'cmap-Button', status: 'importable', method: 'import_by_key', evidenceRefs: ['rd-0003'], ...over });
  const withChecks = (...checks) => withPlan(p => { p.importChecks = checks; });
  assert.deepEqual(sem(withChecks(ic())), []);
  has(validateRun(copyM1()).notices, /plan\.importChecks missing \(before v1\.9\)/);

  const plan = readJ(path.join(M1_FIXTURE, 'plan.json'));
  assert.ok(validateSchema('plan', { ...plan, importChecks: [ic({ status: 'not_importable' })] }).length, 'not_importable needs a fallback');
  assert.ok(validateSchema('plan', { ...plan, importChecks: [ic({ kind: 'style', componentMapRef: undefined })] }).length, 'a style check names the style');

  const style = { id: 'imp-02', kind: 'style', styleName: 'Subtitle/Subtitle 2', status: 'not_importable', fallback: '沿用參考畫面上已在使用的同一份 style（從既有節點取 textStyleId）' };
  has(sem(withChecks(ic(), style)), /importCheck imp-02: not importable and the fallback was not listed to the user/);
  assert.deepEqual(sem(withChecks(ic(), { ...style, listedToUserRef: 'dec-003' })), []);
  has(sem(withChecks({ ...style, listedToUserRef: 'dec-003' })), /componentMap cmap-Button: no importCheck/);
  has(sem(withChecks(ic({ status: 'not_checked' })), 'build'), /build: import not checked for imp-01/);
});

// ---------------- T90 ----------------
test('T90: fonts of a new instance come from its main component, not from an overridden reference instance', () => {
  const fonts = [{ family: 'SF Pro Text', style: 'Semibold', installed: false, usedBy: ['Status Bar'], baselineRef: 'obs-font', listedToUserRef: 'dec-003' }, { family: 'Inter', style: 'Bold', installed: true }];
  const setup = (checks) => copyM1({
    inventory: i => { i.fonts = fonts; i.componentFontChecks = checks; },
    plan: p => { p.baseline.observations = [...(p.baseline.observations || []), { id: 'obs-font', kind: 'inherited_baseline', statement: 'SF Pro Text 未安裝' }]; },
  });
  const plan = readJ(path.join(M1_FIXTURE, 'plan.json'));
  assert.ok(plan.baseline, 'fixture has a baseline');

  has(sem(setup([{ componentMapRef: 'cmap-Button', source: 'reference_instance', fonts: [{ family: 'Inter', style: 'Bold' }] }])), /componentMap cmap-Button: fonts not read from the main component \(a reference instance may carry font overrides/);
  has(sem(setup([{ componentMapRef: 'cmap-Button', source: 'main_component', mainComponentNodeId: '1:2', fonts: [{ family: 'SF Pro Text', style: 'Regular' }] }])), /font SF Pro Text Regular is not in inventory\.fonts/);
  const ok = setup([{ componentMapRef: 'cmap-Button', source: 'main_component', mainComponentNodeId: '1:2', fonts: [{ family: 'SF Pro Text', style: 'Semibold' }, { family: 'Inter', style: 'Bold' }] }]);
  none(sem(ok), /componentFontCheck|fonts not read/);
  has(validateRun(copyM1()).notices, /componentFontChecks missing \(before v1\.9\)/);
});

// ---------------- T91 ----------------
test('T91: SPACE-001 — new nodes snap (ties go up, the next candidate when the layout breaks); reference values and existing nodes stay', () => {
  const src = fs.readFileSync(path.join(repo, '.claude', 'skills', 'figma-ui', 'snippets', 'spacing.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  const figmaUiSpacing = new Function(`${src}\nreturn figmaUiSpacing;`)();

  assert.equal(figmaUiSpacing({ value: 14, origin: 'new', property: 'padding' }).value, 16, '14 → 16 (tie goes to the larger value)');
  const broke = figmaUiSpacing({ value: 14, origin: 'new', property: 'padding', fits: v => v !== 16 });
  assert.deepEqual([broke.value, broke.source, broke.tried], [12, 'scale', [16]], '16 breaks the layout → 12, recorded');
  assert.match(broke.reason, /broke the layout/);
  assert.deepEqual([13, 'pattern'], (r => [r.value, r.source])(figmaUiSpacing({ value: 13, origin: 'reference', property: 'gap' })), 'copied from the reference: keep 13');
  assert.deepEqual([15, 'unchanged'], (r => [r.value, r.source])(figmaUiSpacing({ value: 15, origin: 'existing', property: 'gap' })), 'existing node: never changed');

  // tokens win over the scale; an applicable pattern wins over tokens
  const tok = figmaUiSpacing({ value: 14, origin: 'new', property: 'gap', tokens: [{ name: 'space/sm', value: 12 }, { name: 'space/md', value: 18 }] });
  assert.deepEqual([tok.value, tok.source, tok.token], [12, 'token', 'space/sm']);
  assert.equal(figmaUiSpacing({ value: 14, origin: 'new', property: 'gap', patternValue: 13, tokens: [{ name: 'a', value: 12 }] }).value, 13);
  // never rounded: font sizes, strokes, auto gap; negative spacing is an exception
  for (const property of ['font_size', 'stroke', 'auto_gap', 'ratio', 'safe_area']) assert.equal(figmaUiSpacing({ value: 13, origin: 'new', property }).value, 13, property);
  assert.equal(figmaUiSpacing({ value: -4, origin: 'new', property: 'gap' }).value, -4);
  // exact values stay; 0 is allowed; no candidate fits → keep and report
  assert.equal(figmaUiSpacing({ value: 24, origin: 'new', property: 'gap' }).value, 24);
  assert.equal(figmaUiSpacing({ value: 1, origin: 'new', property: 'gap' }).value, 0);
  const stuck = figmaUiSpacing({ value: 14, origin: 'new', property: 'gap', fits: () => false });
  assert.deepEqual([stuck.value, stuck.revert, stuck.source], [14, true, 'unchanged']);
  assert.equal(figmaUiSpacing({ value: 10, origin: 'new', property: 'gap' }).value, 12, '10 is between 8 and 12 → larger');
  assert.equal(figmaUiSpacing({ value: 28.004, origin: 'new', property: 'gap' }).value, 32, 'tolerance: 28.004 is a tie between 24 and 32 → larger');
});

// ---------------- T92 ----------------
test('T92: rule checks — not_tested goes to implementation verification, needs_review keeps the run awaiting_user, not_applicable needs a reason; gate statuses unchanged', () => {
  const withChecks = (checks, ivr) => copyM1({ audit: a => { a.ruleChecks = checks; if (ivr) a.implementationVerificationRequired = ivr; } });
  const audit = readJ(path.join(M1_FIXTURE, 'audit.json'));
  const base = evaluateRun(copyM1()).evaluation.result;

  assert.ok(validateSchema('audit', { ...audit, ruleChecks: [{ ruleId: 'UX-04', status: 'not_applicable' }] }).length, 'not_applicable needs a reason');
  assert.ok(validateSchema('audit', { ...audit, ruleChecks: [{ ruleId: 'CORE-01', status: 'fail', affectsDelivery: true }] }).length, 'a delivery-affecting fail needs a finding');
  assert.ok(validateSchema('audit', { ...audit, ruleChecks: [{ ruleId: 'CONTRAST-01', status: 'pass' }] }).length, 'only rules of common-rules.md');
  assert.ok(validateSchema('audit', { ...audit, gates: audit.gates.map(g => g.id === 'G4' ? { ...g, status: 'needs_review' } : g) }).length, 'gate statuses stay pass|fail|not_applicable|not_verified');

  const notTested = { ruleId: 'CORE-03', status: 'not_tested', reason: '鍵盤與焦點順序要在實作測試', verification: 'Tab / Shift+Tab / Escape' };
  has(sem(withChecks([notTested])), /ruleCheck CORE-03: not_tested must be listed in implementationVerificationRequired/);
  const listed = withChecks([notTested, { ruleId: 'UX-04', status: 'not_applicable', reason: '只交付 default 狀態' }, { ruleId: 'SPACE-001', status: 'pass', nodeIds: ['1:2'], before: 14, after: 16 }], ['keyboard-navigation', 'screen-reader', 'CORE-03 keyboard and focus order']);
  assert.deepEqual(sem(listed), []);
  assert.equal(evaluateRun(listed).evaluation.result, base, 'not_tested does not block, and is not counted as pass either');

  const review = withChecks([{ ruleId: 'CORE-01', status: 'needs_review', nodeIds: ['1:2'], reason: '浮層可能遮住錯誤訊息' }]);
  assert.equal(evaluateRun(review).evaluation.result, 'awaiting_user');
  assert.match(evaluateRun(review).evaluation.reasons.join('\n'), /rule checks needing review: CORE-01\(1:2\)/);

  has(sem(withChecks([{ ruleId: 'SYS-06', status: 'fail', reason: '圓角不一致' }])), /fail must say whether it affects delivery/);
  has(sem(withChecks([{ ruleId: 'SYS-06', status: 'fail', affectsDelivery: true, findingRef: 'F-404' }])), /findingRef F-404 not found/);
  assert.deepEqual(sem(withChecks([{ ruleId: 'SYS-06', status: 'fail', affectsDelivery: true, findingRef: 'F-001' }])), []);

  // handoff item 13 lists fail / needs_review / not_tested
  writeEvaluation(review);
  assert.match(renderHandoff(review, { root: tmpRoot() }), /CORE-01 needs_review（1:2）：浮層可能遮住錯誤訊息/);
});

// ---------------- T93 ----------------
test('T93: an automatic fix outside the delegated kinds is not delegated; the skill sends it back to §7.4', () => {
  // e.g. a corner radius "fix" recorded as a delegated decision: kind other is never delegable
  has(sem(delegated(detail({ kind: 'other', topic: 'visual', question: '修正：卡片圓角改 12', options: ['8', '12', '16'], recommendation: '12', answer: '12' }))), /kind other is not delegated by dec-020/);
  const rules = fs.readFileSync(path.join(repo, '.claude', 'skills', 'figma-ui', 'references', 'common-rules.md'), 'utf8');
  assert.match(rules, /A \| 可自動修正，\*\*只限\*\*：屬於本 run 委派的類型（DEC-12），或只有一種合理修法（§8\.3）/);
  const quality = fs.readFileSync(path.join(repo, '.claude', 'skills', 'figma-ui', 'references', 'design-quality.md'), 'utf8');
  assert.match(quality, /common-rules\.md/);
  assert.match(quality, /多種合理修法/);
});

// ---------------- T94 ----------------
test('T94: with the product contrast policy not applicable, common rules add no contrast item (SYS-08 checks modes only)', () => {
  const root = tmpRoot();
  writeJ(path.join(root, 'product-policies', 'aiwow.json'), readJ(path.join(repo, 'product-policies', 'aiwow.json')));
  const runIn = audit => {
    const dir = path.join(root, 'design-runs', `${RUN}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(M1_FIXTURE)) fs.copyFileSync(path.join(M1_FIXTURE, f), path.join(dir, f));
    const b = readJ(path.join(dir, 'brief.json'));
    b.product = { productId: 'aiwow', displayName: 'Aiwow', source: 'request', policyDigest: loadPolicy('aiwow', { root }).digest, appliedPolicies: [{ policyRef: 'aiwow#policies/accessibility.contrast', summary: '對比：不適用' }] };
    writeJ(path.join(dir, 'brief.json'), b);
    const a = readJ(path.join(dir, 'audit.json'));
    a.gates = a.gates.map(g => g.id === 'G5' ? { ...g, contrast: { status: 'not_applicable', policyRef: 'aiwow#policies/accessibility.contrast' } } : g);
    audit(a);
    writeJ(path.join(dir, 'audit.json'), a);
    return dir;
  };
  const modes = runIn(a => { a.ruleChecks = [{ ruleId: 'SYS-08', status: 'pass', reason: 'light mode 的 token 解析與狀態語意正確', verification: 'mode 截圖' }]; });
  assert.deepEqual(validateRun(modes, { root }).semanticErrors, []);
  const contrast = runIn(a => { a.ruleChecks = [{ ruleId: 'SYS-08', status: 'fail', affectsDelivery: false, reason: 'dark mode 說明文字對比 3.2:1' }]; });
  has(validateRun(contrast, { root }).semanticErrors, /ruleCheck SYS-08: product policy aiwow#policies\/accessibility\.contrast says contrast is not checked/);
});

// ---------------- §14 rework ----------------
test('v1.9 §14: a change asked after the handoff is one rework round; continue reminds to record it', () => {
  const before = copyM1({ ledger: l => { delete l.completionEvaluatedAt; } });
  assert.throws(() => recordRework(before, '按鈕改官方樣式'), /not handed off yet/);
  const dir = copyM1();
  writeEvaluation(dir);
  assert.match(runContext(dir, 'continue', { pluginVersion: { status: 'current' } }).next[0], /record the change first with run-report\.mjs rework/);
  const l = recordRework(dir, '登入按鈕改成符合 LINE 官方登入按鈕規範的樣式', LATER);
  assert.deepEqual(l.reworkRounds, [{ id: 'rw-001', requestedAt: LATER, request: '登入按鈕改成符合 LINE 官方登入按鈕規範的樣式', previousResult: 'complete_with_exceptions' }]);
  assert.equal(runMetrics(dir, { root: tmpRoot(), events: [] }).reworks, 1);
  const fresh = runMetrics(copyM1(), { root: tmpRoot(), events: [] });
  assert.equal(fresh.reworks, null, 'not recorded is unknown, never 0');
  assert.ok(fresh.unknown.some(u => /rework rounds/.test(u)));
});
