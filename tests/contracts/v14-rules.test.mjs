// v1.4 rules (spec §2.3, §7.4 DEC-07/08, §9.5, §10.1, §10.3, §12.2): T47–T50 and a counter-example for
// each new validator rule. T51 lives in tests/hooks. executionLayer=offline_fixture.
// Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRun, validateSchema } from '../../scripts/validate-artifacts.mjs';
import { evaluateRun, recordUserAcceptance } from '../../scripts/evaluate-completion.mjs';
import { planOperation } from '../../scripts/operation-journal.mjs';
import { tokenBinding, contrastRatio, precheckContrast, requiredContrast, fontCheck } from '../../scripts/quality-metrics.mjs';
import { atomicWriteJson } from '../../scripts/state-store.mjs';
import { copyM1, appendOp, readFixture } from '../helpers.mjs';

const RUN = 'ui-20260928-m1';
const OUT = 'FixtureOutputFile00001';
const has = (errors, re) => assert.ok(errors.some(e => re.test(e)), `expected ${re} in:\n${errors.join('\n')}`);
const none = (errors, re) => assert.ok(!errors.some(e => re.test(e)), `unexpected ${re} in:\n${errors.join('\n')}`);
const semantic = dir => validateRun(dir).semanticErrors;
const all = dir => { const r = validateRun(dir); return [...r.schemaErrors, ...r.semanticErrors]; };
const at = '2026-09-29T01:00:00.000Z';

// ---- T47: DEC-07 delegation, DEC-08 status ----

const delegated = (over = {}) => ({
  id: 'dec-201', question: 'Toast icon', options: ['send', 'check'], recommendation: 'check', answer: 'check', source: 'user',
  evidenceRefs: [], decidedAt: at, status: 'answered', delegation: { decisionRef: 'dec-200', scope: 'run', runId: RUN }, ...over,
});
const skipped = (over = {}) => ({
  id: 'dec-202', question: 'success icon', options: ['circle', 'none'], recommendation: null, answer: null, source: 'user',
  evidenceRefs: [], decidedAt: null, status: 'skipped', ...over,
});
const withDelegation = (extra = p => p) => copyM1({
  plan: p => {
    p.decisions.push({ id: 'dec-200', decision: 'test run: adopt the agent recommendation for design decisions (this run only)', scope: RUN, decidedAt: at, source: 'user' });
    p.designDecisions.push(delegated(), skipped());
    extra(p);
  },
});
const writeOp = (id, basisRefs) => ({ schemaVersion: '1.2', operationId: id, runId: RUN, logicalKey: 'm1.extra', kind: 'modify_owned', mode: 'write', fileKey: OUT, status: 'planned', basisRefs, preconditions: {}, timestamps: { plannedAt: at } });

test('T47: delegated answer (source=user + delegation) is valid; no recommendation -> skipped and the run stays awaiting_user', () => {
  const dir = withDelegation();
  assert.deepEqual(all(dir), []);
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.result, 'awaiting_user');
  assert.ok(evaluation.reasons.some(r => /unanswered design decisions: dec-202=skipped/.test(r)), evaluation.reasons.join('\n'));
  assert.ok(!evaluation.reasons.some(r => /dec-201/.test(r)), 'the delegated answer counts as answered');
});

test('T47 / DEC-08 counter-example: a write that references a skipped decision is rejected (validator and journal)', () => {
  const dir = withDelegation();
  appendOp(dir, writeOp('op-0201', ['dec-202']));
  has(semantic(dir), /op-0201: basisRef dec-202 is a skipped design decision/);
  const dir2 = withDelegation();
  assert.throws(() => planOperation(dir2, writeOp('op-0202', ['dec-202'])), /skipped design decision/);
  assert.doesNotThrow(() => planOperation(dir2, writeOp('op-0203', ['dec-201'])));
});

test('T47 / INVARIANT-18: an agent-decided answer without a recommendation, or a delegation with source != user, is rejected', () => {
  const plan = readFixture('plan');
  plan.designDecisions.push(delegated({ recommendation: null }));
  const errors = validateSchema('plan', plan);
  assert.ok(errors.some(e => /recommendation/.test(e)), errors.join('\n'));
  const plan2 = readFixture('plan');
  plan2.designDecisions.push(delegated({ source: 'ds' }));
  assert.ok(validateSchema('plan', plan2).length > 0);
  const plan3 = readFixture('plan');
  plan3.designDecisions.push(skipped({ answer: 'none, decided by agent' }));
  assert.ok(validateSchema('plan', plan3).length > 0, 'skipped decision cannot carry an answer');
});

test('T47 / INVARIANT-18 counter-example: a delegation from another run (plan copied to a new run) is rejected', () => {
  const dir = withDelegation(p => { p.designDecisions.find(d => d.id === 'dec-201').delegation.runId = 'ui-20260927-001'; });
  has(semantic(dir), /dec-201: delegation belongs to run ui-20260927-001, not ui-20260928-m1/);
  const dir2 = withDelegation(p => { p.designDecisions.find(d => d.id === 'dec-201').delegation.decisionRef = 'dec-999'; });
  has(semantic(dir2), /dec-201: delegation.decisionRef dec-999 is not a user decision/);
});

// ---- T48: accessibility pre-check (§9.5) ----

test('T48: contrast math follows WCAG 2.2 AA; 14px bold is not large text', () => {
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21);
  assert.equal(precheckContrast({ kind: 'text_contrast', foreground: '#767676', background: '#FFFFFF', fontSize: 12 }).status, 'pass');
  const fail = precheckContrast({ kind: 'text_contrast', foreground: '#8A8A8A', background: '#FFFFFF', fontSize: 12 });
  assert.equal(fail.status, 'fail');
  assert.ok(fail.ratio < 4.5);
  assert.equal(requiredContrast({ fontSize: 24 }), 3);
  assert.equal(requiredContrast({ fontSize: 14, bold: true }), 4.5);
  assert.equal(requiredContrast({ fontSize: 19, bold: true }), 3);
  assert.equal(precheckContrast({ kind: 'text_contrast', foreground: '#8A8A8A' }).status, 'not_verified');
});

const a11yItem = (over = {}) => ({ id: 'a11y-01', kind: 'text_contrast', subject: '01-04 subtitle style', styleName: 'Body/Body XS', foreground: '#8A8A8A', background: '#FFFFFF', fontSize: 12, status: 'fail', baselineRef: 'bl-001', decisionRef: 'dec-203', ...over });
const altDecision = { id: 'dec-203', question: 'subtitle style fails contrast on white: which style?', options: ['same family, darker style', 'keep (G5 fails)'], recommendation: 'same family, darker style', answer: null, source: 'user', evidenceRefs: [], decidedAt: null, status: 'pending' };

test('T48: a failing reference style is listed at Plan with a design decision offering alternatives', () => {
  const dir = copyM1({ plan: p => { p.designDecisions.push(altDecision); p.accessibilityPrecheck = [a11yItem()]; } });
  assert.deepEqual(all(dir), []);
  const plan = readFixture('plan');
  plan.accessibilityPrecheck = [a11yItem({ decisionRef: undefined })];
  delete plan.accessibilityPrecheck[0].decisionRef;
  assert.ok(validateSchema('plan', plan).some(e => /decisionRef/.test(e)), 'fail without decisionRef is a schema error');
});

test('T48 counter-examples: wrong status, decisionRef not a designDecision, baseline not inherited_baseline', () => {
  const dir = copyM1({ plan: p => { p.accessibilityPrecheck = [a11yItem({ status: 'pass', decisionRef: 'dec-000' }), a11yItem({ id: 'a11y-02', decisionRef: 'dec-000' })]; p.baseline.observations.push({ id: 'bl-900', kind: 'note', subject: 'x' }); p.accessibilityPrecheck[1].baselineRef = 'bl-900'; } });
  const errors = semantic(dir);
  has(errors, /a11y-01: status pass but #8A8A8A on #FFFFFF is [0-9.]+:1 \(needs 4.5:1\) → fail/);
  has(errors, /a11y-02: failing item needs decisionRef to a designDecision/);
  has(errors, /a11y-02: reference-screen failure must be recorded as inherited_baseline/);
});

test('T48: reusing the failing style in a new screen is introduced; G5 stays fail and cannot be excepted', () => {
  const g5Finding = { id: 'F-201', severity: 'major', subject: 'design', origin: 'inherited_baseline', gate: 'G5', category: 'contrast', nodeId: '34016:68', observed: 'subtitle 3.34:1', status: 'accepted', decisionRef: 'dec-000', evidenceRefs: [] };
  const dir = copyM1({
    audit: a => {
      a.findings.push(g5Finding);
      a.acceptedExceptions.push({ id: 'ex-201', findingId: 'F-201', decisionRef: 'dec-000', hard: false, scope: 'subtitle' });
    },
  });
  const errors = semantic(dir);
  has(errors, /exception ex-201: G5 accessibility finding F-201 is a hard gate/);
  has(errors, /finding F-201: G5 accessibility finding cannot be accepted/);
  has(errors, /finding F-201: node 34016:68 was created by this run, so its accessibility failure is introduced/);
  assert.equal(evaluateRun(dir).evaluation.eligible, false);

  const dir2 = copyM1({ audit: a => { a.findings.push({ ...g5Finding, origin: 'introduced', status: 'open', decisionRef: undefined }); delete a.findings.at(-1).decisionRef; } });
  has(semantic(dir2), /gate G5 pass while G5 finding\(s\) F-201 are open/);
});

// ---- T49: fonts not installed (§10.3) ----

test('T49: fontCheck lists fonts that are not installed and never proposes a substitute', () => {
  const available = [{ fontName: { family: 'Inter', style: 'Bold' } }, { fontName: { family: 'Inter', style: 'Regular' } }];
  const r = fontCheck([{ family: 'SF Pro Text', style: 'Semibold', usedBy: ['Status Bar'] }, { family: 'Inter', style: 'Bold', usedBy: ['Button'] }, { family: 'SF Pro Text', style: 'Semibold', usedBy: ['Top bar'] }], available);
  assert.deepEqual(r.missing, [{ family: 'SF Pro Text', style: 'Semibold', installed: false, usedBy: ['Status Bar', 'Top bar'] }]);
  assert.equal(r.fonts.length, 2);
  assert.ok(r.missing.every(f => !('substitutedWith' in f)));
});

test('T49: a missing font is an inherited_baseline listed at Plan; substitution needs a user decision', () => {
  const font = { family: 'SF Pro Text', style: 'Semibold', installed: false, usedBy: ['Status Bar'], baselineRef: 'bl-001', listedToUserRef: 'dec-000' };
  assert.deepEqual(all(copyM1({ inventory: i => { i.fonts = [font]; } })), []);

  const inv = readFixture('inventory');
  inv.fonts = [{ family: 'SF Pro Text', style: 'Semibold', installed: false }];
  assert.ok(validateSchema('inventory', inv).some(e => /baselineRef/.test(e)));
  inv.fonts = [{ ...font, listedToUserRef: undefined, substitutedWith: 'Inter' }];
  delete inv.fonts[0].listedToUserRef;
  assert.ok(validateSchema('inventory', inv).some(e => /listedToUserRef/.test(e)), 'agent cannot substitute on its own');

  const notListed = { ...font };
  delete notListed.listedToUserRef;
  has(semantic(copyM1({ inventory: i => { i.fonts = [notListed]; } })), /font SF Pro Text Semibold: not installed and not listed to the user/);
  has(semantic(copyM1({ inventory: i => { i.fonts = [{ ...font, baselineRef: 'bl-404' }]; } })), /baselineRef bl-404 not found/);
});

// ---- T50: user acceptance (§2.3, INVARIANT-17) ----

function awaitingRun(extra = {}) {
  const dir = copyM1({ ledger: l => { l.pendingQuestions = [{ id: 'q-201', question: 'contrast fix?', blocking: true }]; }, ...extra });
  const { evaluation, run } = evaluateRun(dir);
  run.audit.completionEvaluation = evaluation;
  run.ledger.status = evaluation.result;
  atomicWriteJson(path.join(dir, 'audit.json'), run.audit);
  atomicWriteJson(path.join(dir, 'ledger.json'), run.ledger);
  return dir;
}
const readJ = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

test('T50: accepting an unfinished run as a test success records userAcceptance and changes neither status nor evaluation', () => {
  const dir = awaitingRun();
  const before = { ledger: readJ(dir, 'ledger.json'), audit: readJ(dir, 'audit.json') };
  assert.equal(before.ledger.status, 'awaiting_user');
  const ua = recordUserAcceptance(dir, { decisionRef: 'dec-000', note: 'flow verified; contrast left open' });
  assert.equal(ua.kind, 'test_run');
  assert.equal(ua.evaluationResult, 'awaiting_user');
  const after = { ledger: readJ(dir, 'ledger.json'), audit: readJ(dir, 'audit.json') };
  assert.equal(after.ledger.status, 'awaiting_user');
  assert.deepEqual(after.audit.completionEvaluation, before.audit.completionEvaluation);
  assert.deepEqual(all(dir), []);
  assert.equal(evaluateRun(dir).evaluation.result, 'awaiting_user', 're-evaluation ignores userAcceptance');

  fs.writeFileSync(path.join(dir, 'handoff.md'), '# handoff\nstatus: awaiting_user\n');
  has(semantic(dir), /handoff.md must list both the completion result \(awaiting_user\) and the user acceptance \(dec-000\)/);
  fs.writeFileSync(path.join(dir, 'handoff.md'), '# handoff\n完成判定：awaiting_user\n使用者接受為測試成功（userAcceptance，dec-000）\n');
  none(semantic(dir), /handoff.md/);
});

test('T50 / INVARIANT-17 counter-example: userAcceptance next to a status rewritten to complete is rejected', () => {
  const dir = awaitingRun();
  recordUserAcceptance(dir, { decisionRef: 'dec-000', note: 'test ok' });
  const ledger = readJ(dir, 'ledger.json');
  ledger.status = 'complete';
  atomicWriteJson(path.join(dir, 'ledger.json'), ledger);
  const errors = semantic(dir);
  has(errors, /userAcceptance must not change the run status \(INVARIANT-17\)/);
  has(errors, /ledger.status complete is not the result of completionEvaluation/);

  const dir2 = awaitingRun();
  const audit = readJ(dir2, 'audit.json');
  audit.completionEvaluation.result = 'complete';
  atomicWriteJson(path.join(dir2, 'audit.json'), audit);
  has(semantic(dir2), /completionEvaluation.result complete with eligible=false/);
});

test('T50: acceptance needs an evaluated, unfinished run and a recorded user decision', () => {
  const complete = copyM1();
  assert.throws(() => recordUserAcceptance(complete, { decisionRef: 'dec-000', note: 'x' }), /nothing to accept/);
  assert.throws(() => recordUserAcceptance(awaitingRun(), { decisionRef: 'dec-999', note: 'x' }), /dec-999 not found/);
  const ledger = readFixture('ledger');
  ledger.userAcceptance = { kind: 'complete', decisionRef: 'dec-000', note: 'x', acceptedAt: at };
  assert.ok(validateSchema('ledger', ledger).length > 0, 'kind is test_run only');
});

// ---- tokenBinding with styles (§10.1, §12.2) ----

const pb = (nodeId, property, binding, over = {}) => ({ nodeId, property, binding, origin: 'introduced', verified: true, ...(binding === 'style' ? { styleId: `S:${property}`, styleKind: property === 'text' ? 'text' : 'paint' } : {}), ...(binding === 'variable' ? { variableId: 'VariableID:1:2' } : {}), ...over });

test('tokenBinding counts variable bindings and style applications separately; raw stays in the denominator', () => {
  const r = tokenBinding([
    pb('1:1', 'fills', 'style'), pb('1:2', 'fills', 'style'), pb('1:3', 'text', 'style'), pb('1:4', 'itemSpacing', 'variable'),
    pb('1:5', 'fills', 'raw', { exceptionRef: 'ex-001' }), pb('1:6', 'strokes', 'raw'),
    pb('1:7', 'fills', 'style', { verified: false }),
    pb('1:8', 'fills', 'raw', { origin: 'inherited_baseline' }),
    pb('1:9', 'effects', 'raw', { eligible: false }),
  ]);
  assert.equal(r.denominator, 7);
  assert.equal(r.bound, 4);
  assert.equal(r.variableBindings, 1);
  assert.deepEqual(r.styleApplications, { total: 3, byKind: { paint: 2, text: 1 } });
  assert.equal(r.raw, 2);
  assert.equal(r.ratio, '4/7');
  assert.equal(r.ratioExcludingAcceptedExceptions, '4/6');
  assert.deepEqual(r.rawUnaccepted, [{ nodeId: '1:6', property: 'strokes' }]);
  assert.equal(r.unverified.length, 1);
  assert.deepEqual(r.inheritedBaseline, { total: 1, bound: 0 });
  assert.equal(r.notEligible, 1);
  assert.equal(r.status, 'incomplete');
  assert.equal(tokenBinding([]).ratio, 'N/A');
  assert.equal(tokenBinding([pb('1:8', 'fills', 'raw', { origin: 'inherited_baseline' })]).status, 'not_applicable');
});

test('propertyBindings: style needs a read-back styleId; exceptionRef must resolve and only applies to raw values', () => {
  const audit = readFixture('audit');
  audit.metrics = { propertyBindings: [{ nodeId: '1:1', property: 'fills', binding: 'style', origin: 'introduced' }] };
  assert.ok(validateSchema('audit', audit).some(e => /styleId|styleKind/.test(e)));
  const dir = copyM1({ audit: a => { a.metrics = { ...(a.metrics || {}), propertyBindings: [pb('34016:68', 'fills', 'raw', { exceptionRef: 'ex-404' }), pb('34016:68', 'strokes', 'style', { exceptionRef: 'ex-001' })] }; } });
  const errors = semantic(dir);
  has(errors, /fills: exceptionRef ex-404 not found/);
  has(errors, /strokes: only raw values take an exceptionRef/);
});
