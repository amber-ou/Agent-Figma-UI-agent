// v1.7 product policies, memory layers and the prefilled list (spec §4.6, §7.1 REQ-05/06, §7.4 DEC-09/10,
// §7.5 POL-01–06, §9.5, §12.1, §15 item 11): T64–T71. executionLayer=offline_fixture.
// Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRun, validateSchema } from '../../scripts/validate-artifacts.mjs';
import { evaluateCompletion, evaluateRun, writeEvaluation } from '../../scripts/evaluate-completion.mjs';
import { planOperation } from '../../scripts/operation-journal.mjs';
import { createRun, atomicWriteJson } from '../../scripts/state-store.mjs';
import { runContext } from '../../scripts/run-context.mjs';
import { recordQuestionRound, recordAnswered, runMetrics, renderHandoff } from '../../scripts/run-report.mjs';
import {
  applyToRun, loadPolicy, validatePolicy, writePolicy, suggestFromRun, initProduct, contrastPolicy,
  intakeLine, historyAppendOnlyErrors, validateLocal, policyDigest,
} from '../../scripts/product-policy.mjs';
import { repo, M1_FIXTURE, tmpRoot } from '../helpers.mjs';

const AIWOW = JSON.parse(fs.readFileSync(path.join(repo, 'product-policies', 'aiwow.json'), 'utf8'));
const readJ = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

function rootWithPolicies(policies = { aiwow: AIWOW }) {
  const root = tmpRoot();
  for (const [id, p] of Object.entries(policies)) writeJ(path.join(root, 'product-policies', `${id}.json`), p);
  return root;
}
// The de-identified M1 run placed inside <root>/design-runs so the product policies of <root> resolve.
function m1In(root, mutate = {}) {
  const dir = path.join(root, 'design-runs', 'ui-20260928-m1');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(M1_FIXTURE)) fs.copyFileSync(path.join(M1_FIXTURE, f), path.join(dir, f));
  for (const [name, fn] of Object.entries(mutate)) { const p = path.join(dir, `${name}.json`); const d = readJ(p); writeJ(p, fn(d) ?? d); }
  return dir;
}
const aiwowProduct = (root) => ({ productId: 'aiwow', displayName: 'Aiwow', source: 'request', policyDigest: loadPolicy('aiwow', { root }).digest, appliedPolicies: [{ policyRef: 'aiwow#policies/accessibility.contrast', summary: '對比：不適用' }] });
const NOW = '2026-10-03T00:00:00.000Z';

// ---------------- T64 ----------------
test('T64: a new run without a product asks the product first and does not infer it from an earlier run', () => {
  const root = rootWithPolicies();
  const first = createRun({ runId: 'ui-20261003-001', goal: 'Aiwow 名片列表', root });
  applyToRun(first.dir, 'aiwow', { root });
  assert.equal(readJ(path.join(first.dir, 'brief.json')).product.productId, 'aiwow');

  const second = createRun({ runId: 'ui-20261003-002', goal: '新增一個畫面', root });
  const brief = readJ(path.join(second.dir, 'brief.json'));
  assert.equal(brief.product.productId, null, 'not inherited from the previous run (INVARIANT-01, 25)');
  const ctx = runContext(second.dir, 'new', { root });
  assert.equal(ctx.ask[0].item, 'product (REQ-05)', 'product is asked first');
  assert.equal(ctx.ask.filter(a => /product/.test(a.item)).length, 1, 'asked once');

  // confirming intake without a product is refused
  const b = readJ(path.join(second.dir, 'brief.json'));
  b.stage = 'confirmed'; b.openQuestions = [];
  writeJ(path.join(second.dir, 'brief.json'), b);
  const r = validateRun(second.dir, { stage: 'intake', root });
  assert.ok(r.semanticErrors.some(e => /productId is not determined/.test(e)), JSON.stringify(r.semanticErrors));
});

// ---------------- T65 ----------------
test('T65: a known product policy is applied at intake, summarised in one line, recorded in brief.product and not asked again', () => {
  const root = rootWithPolicies();
  const { dir } = createRun({ runId: 'ui-20261003-003', goal: 'Aiwow 名片分享', root });
  const out = applyToRun(dir, 'aiwow', { root, at: NOW });
  assert.match(out.intakeLine, /^已套用產品政策：Aiwow — 對比：不適用/);
  const brief = readJ(path.join(dir, 'brief.json'));
  assert.equal(brief.product.productId, 'aiwow');
  assert.equal(brief.product.policyDigest, policyDigest(AIWOW));
  assert.deepEqual(brief.product.appliedPolicies.map(a => a.policyRef), ['aiwow#policies/accessibility.contrast']);
  assert.ok(!brief.openQuestions.includes('product (REQ-05)'));
  assert.deepEqual(validateSchema('brief', brief), []);
  const ctx = runContext(dir, 'new', { root });
  assert.ok(ctx.applied.some(a => a.startsWith('aiwow#policies/accessibility.contrast')));
  assert.ok(!ctx.ask.some(a => a.kind === 'product_policy' || /product/.test(a.item)), 'nothing about the product or contrast is asked');
  // a policy change during the run is reported
  const changed = structuredClone(AIWOW); changed.displayName = 'Aiwow!';
  writeJ(path.join(root, 'product-policies', 'aiwow.json'), changed);
  assert.ok(validateRun(dir, { stage: 'intake', root }).notices.some(n => /changed after it was applied/.test(n)));
});

// ---------------- T66 ----------------
test('T66: contrast.required=false — no contrast checks or findings, G5 contrast not_applicable by policyRef, other checks stay, handoff says so', () => {
  const root = rootWithPolicies();
  const withG5 = (g5) => a => { a.gates = a.gates.map(g => g.id === 'G5' ? { ...g, ...g5 } : g); };
  const base = { brief: b => { b.product = aiwowProduct(root); } };

  // G5 must record the policy
  let dir = m1In(root, base);
  assert.ok(validateRun(dir).semanticErrors.some(e => /record contrast as not_applicable with policyRef aiwow#policies\/accessibility\.contrast/.test(e)));

  dir = m1In(root, { ...base, audit: withG5({ contrast: { status: 'not_applicable', policyRef: 'aiwow#policies/accessibility.contrast' } }) });
  let r = validateRun(dir);
  assert.deepEqual(r.semanticErrors, [], JSON.stringify(r.semanticErrors));

  // a contrast pre-check item or a contrast finding is refused under this policy
  dir = m1In(root, { ...base, audit: a => { withG5({ contrast: { status: 'not_applicable', policyRef: 'aiwow#policies/accessibility.contrast' } })(a); a.findings.push({ id: 'F-099', severity: 'major', subject: 'design', origin: 'introduced', affectsDelivery: true, category: 'contrast', status: 'open', gate: 'G5' }); },
    plan: p => { p.accessibilityPrecheck = [{ id: 'a11y-1', kind: 'text_contrast', subject: 'x', foreground: '#777777', background: '#ffffff', fontSize: 12, bold: false, status: 'pass' }, { id: 'a11y-2', kind: 'target_size', subject: 'button', status: 'pass' }]; } });
  r = validateRun(dir);
  assert.ok(r.semanticErrors.some(e => /accessibilityPrecheck a11y-1: product policy/.test(e)));
  assert.ok(!r.semanticErrors.some(e => /a11y-2/.test(e)), 'target size is still checked normally');
  assert.ok(r.semanticErrors.some(e => /finding F-099: product policy .* no contrast findings/.test(e)));

  // G5 not_applicable as a whole is accepted by the evaluator only with a policyRef (or plan basis)
  const plan = readJ(path.join(M1_FIXTURE, 'plan.json'));
  const audit = readJ(path.join(M1_FIXTURE, 'audit.json'));
  const ledger = readJ(path.join(M1_FIXTURE, 'ledger.json'));
  const g5 = g => ({ ...audit, gates: audit.gates.map(x => x.id === 'G5' ? g : x) });
  assert.equal(evaluateCompletion(plan, g5({ id: 'G5', status: 'not_applicable', policyRef: 'aiwow#policies/accessibility.contrast' }), ledger).reasons.filter(x => /^G5/.test(x)).length, 0);
  assert.ok(evaluateCompletion(plan, g5({ id: 'G5', status: 'not_applicable' }), ledger).reasons.some(x => /^G5 not_applicable/.test(x)));
  assert.equal(evaluateRun(m1In(root, base)).evaluation.ruleVersion, '12.1@1.8');

  // a policyRef that does not make contrast not applicable is refused
  const strict = structuredClone(AIWOW); strict.productId = 'strict'; strict.displayName = 'Strict'; strict.policies['accessibility.contrast'].value.required = true; strict.history[0].to = { required: true };
  writeJ(path.join(root, 'product-policies', 'strict.json'), strict);
  dir = m1In(root, { brief: b => { b.product = { productId: 'strict', policyDigest: policyDigest(strict), appliedPolicies: [] }; }, audit: withG5({ contrast: { status: 'not_applicable', policyRef: 'strict#policies/accessibility.contrast' } }) });
  assert.ok(validateRun(dir).semanticErrors.some(e => /does not make contrast not applicable/.test(e)));

  // handoff says contrast was not checked
  dir = m1In(root, { ...base, audit: withG5({ contrast: { status: 'not_applicable', policyRef: 'aiwow#policies/accessibility.contrast' } }) });
  writeEvaluation(dir);
  const text = renderHandoff(dir, { root });
  assert.match(text, /## 產品政策/);
  assert.match(text, /依產品政策未檢查對比.*aiwow#policies\/accessibility\.contrast/);
  assert.match(text, /spec v1\.8/);
});

// ---------------- T67 ----------------
test('T67: a product without a contrast policy gets the policy question first; the answer is written once and never asked again (also "no")', () => {
  const root = rootWithPolicies({ aiwow: AIWOW });
  const { dir } = createRun({ runId: 'ui-20261003-010', goal: 'Neo 首頁', root });
  writeJ(path.join(dir, 'plan.json'), { decisions: [{ id: 'dec-000', decision: 'create product neo', scope: 'product', decidedAt: NOW, source: 'user' }] });
  initProduct(dir, 'neo', 'Neo', { decisionRef: 'dec-000', root, at: NOW });
  applyToRun(dir, 'neo', { root });
  const p = readJ(path.join(dir, 'plan.json'));
  p.designDecisions = [{ id: 'dec-101', question: '按鈕位置', options: ['A', 'B'], recommendation: 'A', answer: null, source: 'user', evidenceRefs: [], decidedAt: null, status: 'pending' }];
  writeJ(path.join(dir, 'plan.json'), p);
  let ctx = runContext(dir, 'new', { root });
  assert.equal(ctx.ask[0].kind, 'product_policy');
  assert.equal(ctx.ask[0].label, '產品政策');
  assert.ok(ctx.ask.findIndex(a => a.item === 'dec-101') > 0, 'policy question before other design decisions');
  assert.match(intakeLine(loadPolicy('neo', { root })), /待問政策題：accessibility\.contrast/);

  // the user answers "no": written with history and a run decision; then never asked again
  p.decisions.push({ id: 'dec-001', decision: 'Neo DS does not follow WCAG contrast (policy question)', scope: 'product policy', decidedAt: NOW, source: 'user' });
  writeJ(path.join(dir, 'plan.json'), p);
  const w = writePolicy(dir, 'neo', { action: 'add', target: 'policies/accessibility.contrast', value: { required: false }, origin: 'policy_question', decisionRef: 'dec-001' }, { root, at: NOW });
  assert.equal(w.policyRef, 'neo#policies/accessibility.contrast');
  const neo = readJ(path.join(root, 'product-policies', 'neo.json'));
  assert.equal(neo.policies['accessibility.contrast'].value.required, false);
  assert.equal(neo.history.at(-1).decisionRef, 'dec-001');
  assert.deepEqual(validatePolicy(neo, { fileName: 'neo.json' }), []);
  assert.ok(readJ(path.join(dir, 'plan.json')).decisions.some(d => d.policyRef === 'neo#policies/accessibility.contrast'));
  ctx = runContext(dir, 'continue', { root });
  assert.ok(!ctx.ask.some(a => a.kind === 'product_policy'));
  const { dir: next } = createRun({ runId: 'ui-20261003-011', goal: 'Neo 設定頁', root });
  applyToRun(next, 'neo', { root });
  assert.ok(!runContext(next, 'new', { root }).ask.some(a => a.kind === 'product_policy'), 'a later run of the product is not asked');
  assert.equal(contrastPolicy('neo', { root }).required, false);
});

// ---------------- T68 ----------------
test('T68: prefilled list — pending until confirmed, confirmation recorded, blanks never filled by the agent, skipped not referenceable, rows counted', () => {
  const root = rootWithPolicies();
  const dir = m1In(root, { plan: p => { p.designDecisions.push({ id: 'dec-120', question: '卡片圓角', options: ['8', '12'], recommendation: '12', answer: null, source: 'user', evidenceRefs: [], decidedAt: null, status: 'pending' }); } });
  const write = id => ({ operationId: id, runId: 'ui-20260928-m1', logicalKey: 'x', kind: 'upsert', mode: 'write', fileKey: 'FixtureOutputFile00001', basisRefs: ['dec-120'], scopeRootIds: ['34014:9'], preconditions: {} });
  assert.throws(() => planOperation(dir, write('op-0100')), /dec-120/);

  const plan = readJ(path.join(dir, 'plan.json'));
  const d = plan.designDecisions.find(x => x.id === 'dec-120');
  for (const c of ['prefilled_confirmed', 'user_modified', 'user_filled']) assert.deepEqual(validateSchema('plan', { ...plan, designDecisions: [{ ...d, status: 'answered', answer: '12', decidedAt: NOW, confirmation: c }] }).filter(e => /designDecisions/.test(e)), []);
  assert.ok(validateSchema('plan', { ...plan, designDecisions: [{ ...d, status: 'answered', answer: '12', decidedAt: NOW, confirmation: 'agent_filled' }] }).length > 0, 'no agent-made confirmation value');
  assert.ok(validateSchema('plan', { ...plan, designDecisions: [{ ...d, status: 'pending', answer: '12' }] }).length > 0, 'a pending row has no answer: the prefill stays a recommendation');
  // skipped cannot be referenced
  plan.designDecisions = plan.designDecisions.map(x => x.id === 'dec-120' ? { ...x, status: 'skipped' } : x);
  writeJ(path.join(dir, 'plan.json'), plan);
  assert.throws(() => planOperation(dir, write('op-0101')), /dec-120/);

  // one list = one round; prefilled and blank rows counted separately; metrics keep them apart
  assert.throws(() => recordQuestionRound(dir, 5, NOW, { prefilled: 3, blank: 3 }), /must equal questionCount/);
  recordQuestionRound(dir, 5, NOW, { prefilled: 4, blank: 1 });
  recordAnswered(dir, '2026-10-03T00:05:00.000Z');
  const m = runMetrics(dir, { root, events: [] });
  assert.equal(m.questions.prefilledRows, 4);
  assert.equal(m.questions.blankRows, 1);
});

// ---------------- T69 ----------------
test('T69: the handoff lists policy suggestions without run-only settings; nothing is written unless the user ticks it', () => {
  const root = rootWithPolicies();
  const before = fs.readFileSync(path.join(root, 'product-policies', 'aiwow.json'), 'utf8');
  const dir = m1In(root, {
    brief: b => { b.product = aiwowProduct(root); },
    audit: a => { a.gates = a.gates.map(g => g.id === 'G5' ? { ...g, contrast: { status: 'not_applicable', policyRef: 'aiwow#policies/accessibility.contrast' } } : g); },
    plan: p => {
      p.decisions.push(
        { id: 'dec-050', decision: 'User: Aiwow screens always say 名片夾, never 收藏', scope: 'copy', decidedAt: NOW, source: 'user', policySuggestion: { text: '介面一律用「名片夾」，不用「收藏」', appliesTo: 'naming' } },
        { id: 'dec-051', decision: 'This round only: contrast not blocking', scope: 'run', decidedAt: NOW, source: 'user', runOnly: true, policySuggestion: { text: 'contrast not blocking', appliesTo: 'accessibility.contrast' } },
      );
      p.designDecisions[0] = { ...p.designDecisions[0], delegation: { decisionRef: 'dec-000', scope: 'run', runId: 'ui-20260928-m1' } };
    },
  });
  const s = suggestFromRun(dir, { root });
  assert.deepEqual(s.suggestions.map(x => x.source), ['dec-050']);
  assert.ok(s.excluded.some(x => x.ref === 'dec-051'));
  assert.ok(s.excluded.some(x => /delegation/.test(x.reason)));
  writeEvaluation(dir);
  const text = renderHandoff(dir, { root });
  assert.match(text, /- \[ \] ps-1：介面一律用「名片夾」/);
  assert.ok(!/contrast not blocking/.test(text));
  assert.equal(fs.readFileSync(path.join(root, 'product-policies', 'aiwow.json'), 'utf8'), before, 'not ticked → policy file unchanged');

  // the agent cannot write without a user decision, nor from a run-only setting
  assert.throws(() => writePolicy(dir, 'aiwow', { action: 'add', target: 'rules/naming-01', rule: { text: 'x', appliesTo: 'naming' }, origin: 'handoff_suggestion', decisionRef: 'dec-999' }, { root }), /not found/);
  assert.throws(() => writePolicy(dir, 'aiwow', { action: 'add', target: 'rules/naming-01', rule: { text: 'x', appliesTo: 'naming' }, origin: 'handoff_suggestion', decisionRef: 'dec-051' }, { root }), /run-only/);
  // ticked by the user (recorded as a decision) → written with history
  const plan = readJ(path.join(dir, 'plan.json'));
  plan.decisions.push({ id: 'dec-060', decision: 'User ticked ps-1 in the handoff', scope: 'product policy', decidedAt: NOW, source: 'user', evidenceRefs: ['dec-050'] });
  writeJ(path.join(dir, 'plan.json'), plan);
  writePolicy(dir, 'aiwow', { action: 'add', target: 'rules/naming-01', rule: { text: '介面一律用「名片夾」，不用「收藏」', appliesTo: 'naming' }, origin: 'handoff_suggestion', decisionRef: 'dec-060' }, { root, at: NOW });
  const after = readJ(path.join(root, 'product-policies', 'aiwow.json'));
  assert.equal(after.rules[0].id, 'naming-01');
  assert.deepEqual(historyAppendOnlyErrors(AIWOW, after), []);
  assert.equal(after.history.length, AIWOW.history.length + 1);
});

// ---------------- T70 ----------------
test('T70: no library provided → asked (REQ-06); local product file entries are only prefill candidates', () => {
  const root = rootWithPolicies();
  writeJ(path.join(root, '.figma-ui', 'products', 'aiwow.local.json'), { schemaVersion: '1.0', productId: 'aiwow', libraries: [{ name: 'Aiwow Library', provides: ['components'], libraryKey: 'lk-0000' }], files: [{ role: 'reference', fileUrl: 'https://www.figma.com/design/AAAAAAAAAAAAAAAAAAAAAA/x', fileKey: 'AAAAAAAAAAAAAAAAAAAAAA' }] });
  assert.deepEqual(validateLocal(readJ(path.join(root, '.figma-ui', 'products', 'aiwow.local.json')), { fileName: 'aiwow.local.json' }), []);
  const { dir } = createRun({ runId: 'ui-20261003-020', goal: 'Aiwow', root });
  applyToRun(dir, 'aiwow', { root });
  const b = readJ(path.join(dir, 'brief.json'));
  b.stage = 'confirmed'; b.openQuestions = [];
  writeJ(path.join(dir, 'brief.json'), b);
  const ctx = runContext(dir, 'continue', { root });
  const lib = ctx.ask.find(a => a.kind === 'library');
  assert.ok(lib, 'library is asked');
  assert.deepEqual(lib.prefillCandidates, ['Aiwow Library']);
  assert.deepEqual(readJ(path.join(dir, 'brief.json')).sources.componentLibraryKeys, [], 'a candidate is not applied by itself');
  // once the user confirms a library it is no longer asked
  b.sources.componentLibraryKeys = ['lk-0000']; b.sources.approvedLibraryKeys = ['lk-0000'];
  writeJ(path.join(dir, 'brief.json'), b);
  assert.ok(!runContext(dir, 'continue', { root }).ask.some(a => a.kind === 'library'));
});

// ---------------- T71 ----------------
test('T71: a policy file with a Figma URL or fileKey is refused; history is append-only; a conflicting instruction stays in the run and is suggested', () => {
  const withUrl = structuredClone(AIWOW); withUrl.policies['accessibility.contrast'].note = 'see https://www.figma.com/design/abc';
  assert.ok(validatePolicy(withUrl, { fileName: 'aiwow.json' }).some(e => /Figma URLs are not allowed/.test(e)));
  const withKey = structuredClone(AIWOW); withKey.rules.push({ id: 'r1', text: 't', appliesTo: 'other', decidedBy: 'user', decidedAt: '2026-10-02', origin: 'user_instruction', runId: null, fileKey: 'AAAAAAAAAAAAAAAAAAAAAA' });
  const keyErrors = validatePolicy(withKey, { fileName: 'aiwow.json' });
  assert.ok(keyErrors.some(e => /fileKey \/ fileUrl fields are not allowed/.test(e)), JSON.stringify(keyErrors));
  assert.ok(validatePolicy({ ...AIWOW }, { fileName: 'other.json' }).some(e => /does not match file name/.test(e)));
  const rewritten = structuredClone(AIWOW); rewritten.history[0].to = { required: true };
  assert.ok(historyAppendOnlyErrors(AIWOW, rewritten).length > 0);
  assert.ok(validatePolicy({ ...AIWOW, history: [] }, { fileName: 'aiwow.json', previous: AIWOW }).some(e => /shrank|no history entry/.test(e)));
  // the repo's own policy file passes and is unchanged in content
  assert.deepEqual(validatePolicy(AIWOW, { fileName: 'aiwow.json' }), []);
  assert.equal(AIWOW.policies['accessibility.contrast'].value.required, false);

  // this run's explicit instruction overrides the policy for this run only and is listed as a suggestion
  const root = rootWithPolicies();
  const dir = m1In(root, {
    brief: b => { b.product = aiwowProduct(root); },
    plan: p => { p.decisions.push({ id: 'dec-070', decision: 'This run: check contrast after all', scope: 'run', decidedAt: NOW, source: 'user', policySuggestion: { text: '對比改為依 WCAG 檢查', appliesTo: 'accessibility.contrast', value: { required: true }, conflictsWith: 'aiwow#policies/accessibility.contrast' } }); },
  });
  const s = suggestFromRun(dir, { root });
  assert.equal(s.suggestions[0].kind, 'conflict_with_policy');
  assert.equal(readJ(path.join(root, 'product-policies', 'aiwow.json')).policies['accessibility.contrast'].value.required, false);
});

test('T65/DEC-06: source product_policy needs a policyRef that resolves to this run\'s product', () => {
  const root = rootWithPolicies();
  const dd = ref => p => { p.designDecisions.push({ id: 'dec-130', question: '對比', options: [], recommendation: null, answer: '不檢查', source: 'product_policy', ...(ref ? { policyRef: ref } : {}), evidenceRefs: [], decidedAt: NOW, status: 'answered' }); };
  const brief = b => { b.product = aiwowProduct(root); };
  assert.ok(validateRun(m1In(root, { brief, plan: dd(null) })).schemaErrors.some(e => /policyRef/.test(e)));
  assert.ok(validateRun(m1In(root, { brief, plan: dd('aiwow#rules/none') })).semanticErrors.some(e => /rule none not found/.test(e)));
  const other = structuredClone(AIWOW); other.productId = 'other'; other.displayName = 'Other';
  writeJ(path.join(root, 'product-policies', 'other.json'), other);
  assert.ok(validateRun(m1In(root, { brief, plan: dd('other#policies/accessibility.contrast') })).semanticErrors.some(e => /belongs to other/.test(e)));
  // runs created before v1.7 (no brief.product) are only reminded, not refused
  const old = validateRun(m1In(root));
  assert.ok(old.notices.some(n => /before v1\.7/.test(n)));
  assert.ok(!old.semanticErrors.some(e => /product/.test(e)));
});
