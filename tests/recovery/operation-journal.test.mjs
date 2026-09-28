// Operation journal: planned/verified/cancel/reconcile and the resume summary (T16, T27, T40, T41).
// executionLayer=offline_fixture. Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planOperation, verifyOperation, cancelOperation, reconcileOperation, journalSummary } from '../../scripts/operation-journal.mjs';
import { copyM1, appendOp } from '../helpers.mjs';

const OUT = 'FixtureOutputFile00001';
const op = (id, extra = {}) => ({ operationId: id, runId: 'ui-20260928-m1', logicalKey: 'm1.extra', kind: 'modify_owned', mode: 'write', fileKey: OUT, basisRefs: ['dec-008'], preconditions: { expectedFingerprint: 'fp1:d9899c64' }, ...extra });

test('the M1 journal summary says there is nothing to do', () => {
  const s = journalSummary(copyM1());
  assert.equal(s.nextStep, 'none');
  assert.equal(s.lastVerifiedOperationId, 'op-0007');
});

test('T41: planning a write validates schema and basisRefs (unanswered decisions rejected)', () => {
  const dir = copyM1({ plan: p => { p.designDecisions.push({ id: 'dec-050', question: 'shadow?', options: ['yes', 'no'], recommendation: null, answer: null, source: 'user', evidenceRefs: [], decidedAt: null }); } });
  assert.throws(() => planOperation(dir, op('op-0100', { basisRefs: [] })), /basisRefs/);
  assert.throws(() => planOperation(dir, op('op-0100', { basisRefs: ['dec-050'] })), /unanswered design decision/);
  assert.throws(() => planOperation(dir, op('op-0007')), /already exists/);
  const rec = planOperation(dir, op('op-0100'));
  assert.equal(rec.status, 'planned');
  assert.ok(rec.timestamps.plannedAt);
});

test('verify only after applied, with evidence; cancel only while planned', () => {
  const dir = copyM1();
  planOperation(dir, op('op-0100'));
  assert.throws(() => verifyOperation(dir, 'op-0100', { evidenceRefs: ['rd-0100'] }), /only applied/);
  appendOp(dir, { operationId: 'op-0100', status: 'dispatched', timestamps: { dispatchedAt: new Date().toISOString() } });
  assert.throws(() => cancelOperation(dir, 'op-0100'), /may still have run remotely/);
  appendOp(dir, { operationId: 'op-0100', status: 'applied', timestamps: { appliedAt: new Date().toISOString() } });
  assert.equal(journalSummary(dir).nextStep, 'verify');
  assert.throws(() => verifyOperation(dir, 'op-0100', {}), /evidenceRef/);
  verifyOperation(dir, 'op-0100', { evidenceRefs: ['rd-0100'], fingerprint: 'fp1:0000abcd' });
  assert.equal(journalSummary(dir).nextStep, 'none');

  planOperation(dir, op('op-0101'));
  assert.equal(cancelOperation(dir, 'op-0101').status, 'cancelled');
});

test('T40 / T27: dispatched without follow-up or unknown_outcome -> reconcile first; reconciliation needs read-back evidence', () => {
  const dir = copyM1();
  planOperation(dir, op('op-0100'));
  appendOp(dir, { operationId: 'op-0100', status: 'dispatched', timestamps: { dispatchedAt: new Date().toISOString() } });
  let s = journalSummary(dir);
  assert.equal(s.nextStep, 'reconcile');
  assert.deepEqual(s.unresolved.map(u => u.operationId), ['op-0100']);
  assert.throws(() => reconcileOperation(dir, 'op-0100', { outcome: 'applied' }), /read-back/);
  assert.throws(() => reconcileOperation(dir, 'op-0100', { outcome: 'verified', evidenceRefs: ['rd-1'] }), /applied or failed_known/);
  reconcileOperation(dir, 'op-0100', { outcome: 'applied', evidenceRefs: ['rd-0101'], createdNodeIds: ['1:23'], note: 'unique owned candidate under parent' });
  s = journalSummary(dir);
  assert.equal(s.nextStep, 'verify');
  assert.throws(() => reconcileOperation(dir, 'op-0100', { outcome: 'applied', evidenceRefs: ['rd-2'] }), /nothing to reconcile/);
});

test('T16: a torn last journal line blocks planning and forces reconcile', () => {
  const dir = copyM1();
  fs.appendFileSync(path.join(dir, 'operations.jsonl'), '{"operationId":"op-0100","sta');
  assert.equal(journalSummary(dir).truncatedTail, true);
  assert.equal(journalSummary(dir).nextStep, 'reconcile');
  assert.throws(() => planOperation(dir, op('op-0100')), /truncated/);
});
