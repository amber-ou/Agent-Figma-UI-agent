// M4: writes that a guard stopped (read-back confirmed: nothing changed) must not make earlier evidence
// undeterminable; writes with an unknown effect still must. executionLayer=offline_fixture.
// Found in the first real v1.6 re-evaluation of ui-20260929-001 (T35-T37 guard conflicts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evidenceValidity, isConfirmedNoChange, validateRun } from '../../scripts/validate-artifacts.mjs';
import { verifyOperation, confirmNoChange } from '../../scripts/operation-journal.mjs';
import { copyM1, appendOp } from '../helpers.mjs';

const evidence = { id: 'ev-1', nodeId: '1:1', toolRef: { capturedAt: '2026-09-29T02:00:00.000Z' }, subject: { rootNodeId: '1:1' } };
const guardWrite = (extra = {}) => ({ operationId: 'op-9', mode: 'write', status: 'verified', createdNodeIds: [], mutatedNodeIds: [], scopeRootIds: ['1:1'], evidenceRefs: ['rd-9'], timestamps: { appliedAt: '2026-09-29T02:05:00.000Z' }, ...extra });

test('confirmed no-change write after capture keeps earlier evidence valid, even with scopeRootIds on it', () => {
  const op = guardWrite({ effectSummary: { noChange: true } });
  assert.equal(isConfirmedNoChange(op), true);
  assert.deepEqual(evidenceValidity(evidence, [op]), { status: 'valid' });
});

test('write with no IDs and no no-change confirmation stays undeterminable; one that touched the scope is stale', () => {
  assert.equal(evidenceValidity(evidence, [guardWrite({ scopeRootIds: [] })]).status, 'undeterminable');
  assert.equal(evidenceValidity(evidence, [guardWrite()]).status, 'stale');
  // noChange is ignored when the op lists touched nodes or is not verified
  assert.equal(evidenceValidity(evidence, [guardWrite({ effectSummary: { noChange: true }, mutatedNodeIds: ['1:1'] })]).status, 'stale');
  assert.equal(evidenceValidity(evidence, [guardWrite({ status: 'unknown_outcome', effectSummary: { noChange: true }, timestamps: { dispatchedAt: '2026-09-29T02:05:00.000Z' } })]).status, 'undeterminable');
  assert.equal(isConfirmedNoChange(guardWrite({ effectSummary: { noChange: true }, evidenceRefs: [] })), false);
});

function runWith(ops) {
  const dir = copyM1();
  fs.writeFileSync(path.join(dir, 'operations.jsonl'), '');
  for (const o of ops) appendOp(dir, o);
  return dir;
}
const applied = { operationId: 'op-0100', runId: 'ui-20260928-m1', mode: 'write', fileKey: 'FixtureOutputFile00001', status: 'applied', basisRefs: ['dec-000'], createdNodeIds: [], mutatedNodeIds: [], timestamps: { plannedAt: '2026-09-29T02:00:00.000Z', appliedAt: '2026-09-29T02:05:00.000Z' } };

test('verify --noChange records the confirmation and refuses when node IDs were touched', () => {
  const dir = runWith([applied]);
  assert.throws(() => verifyOperation(dir, 'op-0100', { evidenceRefs: ['rd-1'], noChange: true, mutatedNodeIds: ['1:1'] }), /noChange requires empty/);
  const patch = verifyOperation(dir, 'op-0100', { evidenceRefs: ['rd-1'], noChange: true, note: 'guard conflict' });
  assert.equal(patch.effectSummary.noChange, true);
  assert.equal(patch.effectSummary.note, 'guard conflict');
});

test('confirm-no-change annotates an already verified write with its own evidence, never other statuses', () => {
  const dir = runWith([{ ...applied, status: 'verified', evidenceRefs: ['rd-1'] }, { ...applied, operationId: 'op-0101' }]);
  assert.throws(() => confirmNoChange(dir, 'op-0100', {}), /needs a read-back evidenceRef/);
  assert.throws(() => confirmNoChange(dir, 'op-0101', { evidenceRefs: ['rd-2'] }), /only verified writes/);
  const patch = confirmNoChange(dir, 'op-0100', { evidenceRefs: ['rd-2'] });
  assert.equal(patch.effectSummary.noChange, true);
  assert.deepEqual(patch.evidenceRefs, ['rd-1', 'rd-2']);
  assert.equal(patch.status, undefined, 'status is not changed');
});

test('validator flags noChange that contradicts created/mutated IDs', () => {
  const dir = runWith([{ ...applied, status: 'verified', evidenceRefs: ['rd-1'], mutatedNodeIds: ['1:1'], effectSummary: { noChange: true } }]);
  const r = validateRun(dir);
  assert.ok(r.schemaErrors.concat(r.semanticErrors).some(e => /noChange contradicts/.test(e)), JSON.stringify(r));
});
