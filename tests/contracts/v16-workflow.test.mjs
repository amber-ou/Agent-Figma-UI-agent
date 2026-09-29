// v1.6 workflow contracts: staged validation and the single completion entry (A02), evidence ↔ cell
// mapping and evidence validity (A03), on-demand flow and new/continue/resume context (A04).
// executionLayer=offline_fixture. Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRun, evaluationIsCurrent, loadRun } from '../../scripts/validate-artifacts.mjs';
import { evaluateRun, recordUserAcceptance } from '../../scripts/evaluate-completion.mjs';
import { planOperation, cancelOperation, reconcileOperation } from '../../scripts/operation-journal.mjs';
import { createRun } from '../../scripts/state-store.mjs';
import { runContext } from '../../scripts/run-context.mjs';
import { copyM1, appendOp, tmpRoot } from '../helpers.mjs';

const OUT = 'FixtureOutputFile00001';
const has = (list, re) => assert.ok(list.some(e => re.test(e)), `expected ${re} in:\n${list.join('\n')}`);
const none = (list, re) => assert.ok(!list.some(e => re.test(e)), `unexpected ${re} in:\n${list.join('\n')}`);
const write = (id, extra = {}) => ({ operationId: id, runId: 'ui-20260928-m1', logicalKey: 'm1.extra', kind: 'modify_owned', mode: 'write', fileKey: OUT, basisRefs: ['dec-008'], preconditions: { expectedFingerprint: 'fp1:d9899c64' }, ...extra });
const later = '2026-09-28T12:00:00.000Z';
const writeFile = (dir, name, fn) => {
  const p = path.join(dir, `${name}.json`);
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  fs.writeFileSync(p, JSON.stringify(fn(doc) ?? doc, null, 2));
};

// ---------------- A02: staged validation ----------------

test('A02: an intake-only run passes the intake stage; the final stage still rejects missing artifacts', () => {
  const root = tmpRoot();
  const { dir } = createRun({ root, goal: 'extend a screen' });
  const intake = validateRun(dir, { stage: 'intake' });
  assert.equal(intake.ok, true, JSON.stringify(intake.schemaErrors.concat(intake.semanticErrors)));
  const final = validateRun(dir);
  assert.equal(final.stage, 'final', 'default stays the full validator');
  assert.equal(final.ok, false);
  has(final.schemaErrors, /plan\.json missing/);
  has(final.schemaErrors, /audit\.json missing/);
  has(final.schemaErrors, /inventory\.json missing/);
});

test('A02: references into artifacts that do not exist yet are deferred, not resolved, and stay unusable for Build', () => {
  const root = tmpRoot();
  const { dir } = createRun({ root });
  writeFile(dir, 'brief', b => { b.decisionRefs = ['dec-001']; });
  const r = validateRun(dir, { stage: 'intake' });
  assert.equal(r.ok, true);
  has(r.deferred, /dec-001 resolves against plan decisions/);
  const build = validateRun(dir, { stage: 'build' });
  assert.equal(build.ok, false);
  has(build.schemaErrors, /plan\.json missing/);
  has(build.semanticErrors, /build: brief\.json and plan\.json are required/);
});

test('A02: the Plan/Build boundary rejects unconfirmed or unresolvable write grounds when a write is planned', () => {
  const cases = [
    [{ brief: b => { b.output.decisionRef = 'dec-999'; } }, /brief\.output\.decisionRef dec-999/],
    [{ plan: p => { p.status = 'draft'; } }, /build: plan is not confirmed/],
    [{ plan: p => { delete p.flow; } }, /build: plan\.flow is missing/],
    [{ capabilities: c => { c.features.nativeWrite = { status: 'available_unverified' }; } }, /nativeWrite must be verified/],
    [{ capabilities: c => { c.account = { ...c.account, status: 'blocked' }; } }, /account must be ok/],
  ];
  for (const [mutate, re] of cases) {
    const dir = copyM1(mutate);
    assert.throws(() => planOperation(dir, write('op-0100')), re);
  }
  // M1 (migrated to the v1.6 contract) passes the boundary and a write can be planned
  const dir = copyM1();
  assert.equal(validateRun(dir, { stage: 'build' }).ok, true);
  assert.equal(planOperation(dir, write('op-0100')).status, 'planned');
});

test('A02: a draft plan is valid at the plan stage', () => {
  const dir = copyM1({ plan: p => { p.status = 'draft'; } });
  const r = validateRun(dir, { stage: 'plan' });
  assert.equal(r.ok, true, JSON.stringify(r.semanticErrors));
});

test('A02: the journal decides — an applied write the ledger summary does not list blocks completion', () => {
  const dir = copyM1();
  appendOp(dir, { schemaVersion: '1.2', ...write('op-0100'), status: 'planned', timestamps: { plannedAt: later } });
  appendOp(dir, { operationId: 'op-0100', status: 'dispatched', timestamps: { dispatchedAt: later } });
  appendOp(dir, { operationId: 'op-0100', status: 'applied', mutatedNodeIds: ['9:9'], timestamps: { appliedAt: later } });
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.eligible, false);
  has(evaluation.reasons, /writes applied but not verified: op-0100/);
});

test('A02: dispatched / unknown_outcome in the journal still block (and must be reconciled first)', () => {
  const dir = copyM1();
  appendOp(dir, { schemaVersion: '1.2', ...write('op-0100'), status: 'planned', timestamps: { plannedAt: later } });
  appendOp(dir, { operationId: 'op-0100', status: 'unknown_outcome', timestamps: { failedAt: later } });
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.result, 'blocked');
  has(evaluation.reasons, /unresolved writes in the journal: op-0100=unknown_outcome/);
  assert.throws(() => planOperation(dir, write('op-0101')), /unresolved writes op-0100=unknown_outcome/);
});

test('A02: failed_known after read-only reconciliation and cancelled writes need no verification', () => {
  const dir = copyM1();
  planOperation(dir, write('op-0100'));
  cancelOperation(dir, 'op-0100');
  planOperation(dir, write('op-0101'));
  appendOp(dir, { operationId: 'op-0101', status: 'dispatched', timestamps: { dispatchedAt: new Date().toISOString() } });
  reconcileOperation(dir, 'op-0101', { outcome: 'failed_known', evidenceRefs: ['rd-0100'], note: 'parent unchanged, no owned node' });
  const { evaluation, contractErrors } = evaluateRun(dir);
  assert.deepEqual(contractErrors, []);
  assert.equal(evaluation.result, 'complete_with_exceptions');
});

test('A02: a planned write left behind (neither sent nor cancelled) keeps the run from completing', () => {
  const dir = copyM1();
  planOperation(dir, write('op-0100'));
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.eligible, false);
  has(evaluation.reasons, /planned writes neither sent nor cancelled: op-0100/);
});

test('A02: the evaluation stores a digest; any later data change makes it stale and acceptance refuses it', () => {
  const dir = copyM1({ audit: a => { a.gates.find(g => g.id === 'G4').status = 'not_verified'; } });
  const { evaluation, run } = evaluateRun(dir);
  assert.match(evaluation.inputDigest, /^sha256:[0-9a-f]{64}$/);
  run.audit.completionEvaluation = evaluation;
  run.ledger.status = evaluation.result;
  fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(run.audit, null, 2));
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(run.ledger, null, 2));
  assert.equal(evaluationIsCurrent(loadRun(dir)).current, true, 'writing the evaluation back does not change the digest');
  writeFile(dir, 'plan', p => { p.decisions.push({ id: 'dec-900', decision: 'accept as test run', scope: 'run', decidedAt: later, source: 'user' }); });
  assert.equal(evaluationIsCurrent(loadRun(dir)).current, false);
  assert.throws(() => recordUserAcceptance(dir, { decisionRef: 'dec-900', note: 'x' }), /not current/);
});

// ---------------- A03: evidence ↔ requiredCell ----------------

// Two cells on the same screen: default and error.
const twoCells = p => {
  p.requiredCells.push({ key: 'm1.button-row.error', screenKey: 'm1.button-row', viewport: 'fixed-300', state: 'error', mode: null, applicable: true, evidence: ['structure', 'screenshot'], deliverable: 'frame' });
};

test('A03: legacy evidence without cellKeys cannot cover a screen with two cells; the reason asks for new evidence', () => {
  const dir = copyM1({ plan: twoCells });
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.eligible, false);
  has(evaluation.reasons, /cell m1\.button-row\.default: missing current evidence .*has no cellKeys and screen m1\.button-row has 2 cells/);
  has(evaluation.reasons, /cell m1\.button-row\.error: missing current evidence/);
});

test('A03: a default screenshot never counts for the error cell; each cell needs its own evidence', () => {
  const dir = copyM1({
    plan: twoCells,
    audit: a => { for (const e of a.evidence) if (e.validity === 'current') { e.cellKeys = ['m1.button-row.default']; e.state = 'default'; } },
  });
  const { evaluation } = evaluateRun(dir);
  none(evaluation.reasons, /cell m1\.button-row\.default: missing/);
  has(evaluation.reasons, /cell m1\.button-row\.error: missing current evidence structure, screenshot/);
  assert.equal(evaluation.coverage.verified, 1);
});

test('A03: cellKeys must resolve and agree with the evidence viewport, state and mode', () => {
  const dir = copyM1({
    plan: twoCells,
    audit: a => {
      const ev = a.evidence.find(e => e.id === 'ev-006');
      ev.cellKeys = ['m1.button-row.error', 'm1.nope'];
      ev.state = 'default';
      ev.viewport = 'mobile-390';
    },
  });
  const errors = validateRun(dir).semanticErrors;
  has(errors, /evidence ev-006: cellKey m1\.nope not found/);
  has(errors, /evidence ev-006: state default does not match cell m1\.button-row\.error \(error\)/);
  has(errors, /evidence ev-006: viewport mobile-390 does not match cell m1\.button-row\.error \(fixed-300\)/);
});

test('A03: evidence that claims a version captured before that write took effect is rejected', () => {
  const dir = copyM1({ audit: a => { a.evidence.find(e => e.id === 'ev-006').subject = { rootNodeId: '34014:9', afterOperationId: 'op-0007' }; a.evidence.find(e => e.id === 'ev-006').toolRef.capturedAt = '2026-09-28T11:20:00.000Z'; } });
  const errors = validateRun(dir).semanticErrors;
  has(errors, /evidence ev-006: captured before op-0007 took effect/);
});

test('A03: a later change to the parent layout (ancestor) or a recorded user change invalidates evidence', () => {
  const ancestor = copyM1({ audit: a => { a.evidence.find(e => e.id === 'ev-005').subject = { rootNodeId: '34016:68', ancestorNodeIds: ['34014:9'], afterOperationId: 'op-0007' }; } });
  appendOp(ancestor, { schemaVersion: '1.2', ...write('op-0100', { mutatedNodeIds: ['34014:9'], scopeRootIds: ['34014:9'] }), status: 'verified', evidenceRefs: ['rd-0100'], timestamps: { plannedAt: later, appliedAt: later, verifiedAt: later } });
  has(validateRun(ancestor).semanticErrors, /evidence ev-005: stale, op-0100 changed 34014:9/);

  const user = copyM1({ ledger: l => { l.entities.find(e => e.nodeId === '34016:68').userChangeDetectedAt = later; } });
  has(validateRun(user).semanticErrors, /evidence ev-005: stale, user change detected on 34016:68/);
});

test('A03: a later write whose target is unknown makes validity undeterminable, never assumed current', () => {
  const dir = copyM1();
  appendOp(dir, { schemaVersion: '1.2', ...write('op-0100'), status: 'verified', evidenceRefs: ['rd-0100'], timestamps: { plannedAt: later, appliedAt: later, verifiedAt: later } });
  const errors = validateRun(dir).semanticErrors;
  has(errors, /evidence ev-005: validity cannot be determined \(op-0100 changed unknown nodes/);
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.eligible, false);
});

test('A03: a write elsewhere (outside the evidence scope and ancestors) leaves the evidence current', () => {
  const dir = copyM1();
  appendOp(dir, { schemaVersion: '1.2', ...write('op-0100', { createdNodeIds: ['50:1'], scopeRootIds: ['50:1'] }), status: 'verified', evidenceRefs: ['rd-0100'], timestamps: { plannedAt: later, appliedAt: later, verifiedAt: later } });
  none(validateRun(dir).semanticErrors, /evidence ev-00[567]/);
});

// ---------------- A04: flow and question context ----------------

const flowPartial = (extra = {}) => p => {
  p.flow = {
    level: 'partial', reason: 'new button leads to a share result', status: 'confirmed', confirmedBy: 'user', decisionRef: 'dec-001',
    sources: [{ kind: 'brief', ref: 'goal' }],
    steps: [
      { id: 'st-1', action: 'tap the primary button', result: 'share sheet', screenKey: 'm1.button-row', state: 'default', branches: [{ condition: 'share fails', to: 'st-2' }] },
      { id: 'st-2', action: 'share fails', result: 'error message', screenKey: 'm1.button-row', state: 'error', end: 'back to default' },
    ],
    ...extra,
  };
};

test('A04: a local style change needs only an unchanged flow with a reason — no steps, no flow interview', () => {
  const dir = copyM1();
  assert.equal(validateRun(dir, { stage: 'build' }).ok, true);
  assert.deepEqual(runContext(dir, 'continue').ask, []);
});

test('A04: an unclear destination for a new button becomes a local flow question that blocks Build and completion', () => {
  const dir = copyM1({ plan: p => { twoCells(p); flowPartial({ unknowns: [{ id: 'fq-1', question: 'Where does the new button go?', status: 'open' }] })(p); } });
  has(validateRun(dir, { stage: 'build' }).semanticErrors, /build: flow unknowns still open: fq-1/);
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.result, 'awaiting_user');
  has(evaluation.reasons, /open flow questions: fq-1/);
  assert.ok(runContext(dir, 'continue').ask.some(a => a.kind === 'flow_unknown' && a.item === 'fq-1'));
});

test('A04: flow branches must map to planned screens and states; unmapped states and dangling branches are rejected', () => {
  const ok = copyM1({ plan: p => { twoCells(p); flowPartial()(p); } });
  none(validateRun(ok, { stage: 'build' }).semanticErrors, /flow step/);
  const bad = copyM1({ plan: p => { flowPartial()(p); p.flow.steps[0].branches[0].to = 'st-9'; } });
  const errors = validateRun(bad, { stage: 'build' }).semanticErrors;
  has(errors, /flow step st-2: m1\.button-row \/ error has no requiredCell/);
  has(errors, /flow step st-1: branch "share fails" goes to unknown step st-9/);
});

test('A04: partial / task_flow need steps and a real source (schema); unconfirmed copy blocks Build', () => {
  const noSource = copyM1({ plan: p => { twoCells(p); flowPartial()(p); p.flow.sources = []; } });
  has(validateRun(noSource, { stage: 'build' }).schemaErrors, /plan\/flow\/sources must NOT have fewer than 1 items/);
  const copy = copyM1({ plan: p => { p.screens[0].copy = [{ id: 'cp-1', role: 'button', text: 'Button', status: 'pending' }]; } });
  has(validateRun(copy, { stage: 'build' }).semanticErrors, /unconfirmed copy cp-1/);
});

test('A04: new / continue / resume ask different things; nothing is re-asked once answered', () => {
  const root = tmpRoot();
  const { dir: fresh } = createRun({ root, goal: 'x' });
  const n = runContext(fresh, 'new');
  assert.ok(n.ask.length > 0 && n.ask.every(a => a.kind === 'intake'));

  const cont = runContext(copyM1(), 'continue');
  assert.deepEqual(cont.ask, [], 'confirmed brief, plan, flow and answered decisions are not asked again');
  assert.ok(cont.confirmed.includes('flow (unchanged)'));

  const resumed = copyM1();
  appendOp(resumed, { schemaVersion: '1.2', ...write('op-0100'), status: 'planned', timestamps: { plannedAt: later } });
  appendOp(resumed, { operationId: 'op-0100', status: 'dispatched', timestamps: { dispatchedAt: later } });
  const r = runContext(resumed, 'resume');
  assert.equal(r.journal.nextStep, 'reconcile');
  assert.match(r.next[0], /reconcile unresolved writes read-only/);
  assert.deepEqual(r.ask, []);
});

// M4: first write of a new run probes nativeWrite (found in the first real v1.6 run, ui-20260929-002)
test('M4: only the first write of a run may probe nativeWrite, and only with basis "history"', () => {
  const fresh = (nativeWrite) => {
    const dir = copyM1({
      capabilities: c => { c.features.nativeWrite = nativeWrite; },
      ledger: l => { l.entities = []; l.lastVerifiedOperationId = null; },
    });
    fs.writeFileSync(path.join(dir, 'operations.jsonl'), '');
    return dir;
  };
  // history basis, no write yet → the first write can be planned
  const ok = fresh({ status: 'available_unverified', basis: 'history' });
  assert.equal(planOperation(ok, write('op-0100')).status, 'planned');
  // once a write has been dispatched, nativeWrite must be verified in this run
  appendOp(ok, { operationId: 'op-0100', status: 'dispatched', mode: 'write' });
  assert.throws(() => planOperation(ok, write('op-0101')), /nativeWrite must be verified/);
  // without a history basis there is nothing to probe from
  assert.throws(() => planOperation(fresh({ status: 'available_unverified' }), write('op-0100')), /nativeWrite must be verified/);
  assert.throws(() => planOperation(fresh({ status: 'unknown', basis: 'history' }), write('op-0100')), /nativeWrite must be verified/);
});
