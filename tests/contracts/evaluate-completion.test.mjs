// Fixture tests for the minimal §12.1 completion rule (T32, T34). executionLayer=offline_fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompletion } from '../../scripts/evaluate-completion.mjs';

const plan = () => ({ status: 'confirmed', taskType: 'extend', requiredCells: [{ key: 'a.default', screenKey: 'a', applicable: true, evidence: ['structure', 'screenshot'] }] });
const gates = (over = {}) => ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map(id => ({ id, status: 'pass', ...(over[id] || {}) }));
const audit = (over = {}) => ({
  gates: gates(),
  findings: [],
  acceptedExceptions: [],
  evidence: [
    { id: 'ev-1', kind: 'structure', screenKey: 'a', toolRef: { tool: 't' }, validity: 'current' },
    { id: 'ev-2', kind: 'screenshot', screenKey: 'a', toolRef: { tool: 't' }, validity: 'current' },
  ],
  ...over,
});
const ledger = (over = {}) => ({ pendingQuestions: [], pendingOperations: [], ...over });

test('all gates pass with current evidence -> complete', () => {
  const r = evaluateCompletion(plan(), audit(), ledger());
  assert.equal(r.result, 'complete');
  assert.equal(r.eligible, true);
});

test('missing gate, dangling evidenceRef, superseded screenshot -> not complete (T32)', () => {
  const a = audit({ gates: gates({ G4: { evidenceRefs: ['ev-9'] } }).filter(g => g.id !== 'G5') });
  a.evidence[1].validity = 'superseded';
  const r = evaluateCompletion(plan(), a, ledger());
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.some(x => x.startsWith('G5: expected exactly one')));
  assert.ok(r.reasons.some(x => x.includes('dangling evidenceRef ev-9')));
  assert.ok(r.reasons.some(x => x.includes('missing current evidence screenshot')));
});

test('pending question -> awaiting_user; unknown_outcome op -> blocked', () => {
  assert.equal(evaluateCompletion(plan(), audit(), ledger({ pendingQuestions: [{ id: 'dec-010' }] })).result, 'awaiting_user');
  assert.equal(evaluateCompletion(plan(), audit(), ledger({ pendingOperations: [{ operationId: 'op-1', status: 'unknown_outcome' }] })).result, 'blocked');
});

test('not_verified gate or open major finding blocks completion regardless of score (T34)', () => {
  const r1 = evaluateCompletion(plan(), audit({ gates: gates({ G5: { status: 'not_verified' } }), score: 99 }), ledger());
  assert.equal(r1.eligible, false);
  const r2 = evaluateCompletion(plan(), audit({ findings: [{ id: 'F-1', severity: 'major', status: 'open', affectsDelivery: true }] }), ledger());
  assert.equal(r2.eligible, false);
  const r3 = evaluateCompletion(plan(), audit({ findings: [{ id: 'F-2', severity: 'minor', status: 'open' }] }), ledger());
  assert.equal(r3.result, 'complete', 'open minor finding alone does not block (§12.1 item 4)');
});

test('exception with decisionRef -> complete_with_exceptions; without -> not complete', () => {
  assert.equal(evaluateCompletion(plan(), audit({ acceptedExceptions: [{ id: 'x', decisionRef: 'dec-1' }] }), ledger()).result, 'complete_with_exceptions');
  assert.equal(evaluateCompletion(plan(), audit({ acceptedExceptions: [{ id: 'x' }] }), ledger()).eligible, false);
});
