// Cross-file (semantic) validation and completion on top of the M1 fixture. executionLayer=offline_fixture.
// Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRun } from '../../scripts/validate-artifacts.mjs';
import { evaluateRun } from '../../scripts/evaluate-completion.mjs';
import { copyM1, appendOp, readFixture, M1_FIXTURE } from '../helpers.mjs';

const semantic = dir => validateRun(dir).semanticErrors;
const has = (errors, re) => assert.ok(errors.some(e => re.test(e)), `expected ${re} in:\n${errors.join('\n')}`);
const OUT = 'FixtureOutputFile00001';
const writeOp = (id, extra = {}) => ({ schemaVersion: '1.2', operationId: id, runId: 'ui-20260928-m1', logicalKey: 'm1.extra', kind: 'modify_owned', mode: 'write', fileKey: OUT, status: 'planned', basisRefs: ['dec-001'], preconditions: {}, timestamps: { plannedAt: '2026-09-28T12:00:00.000Z' }, ...extra });

test('M1 fixture evaluates to complete_with_exceptions through evaluateRun (schema + contract + §12.1)', () => {
  const { evaluation, contractErrors } = evaluateRun(M1_FIXTURE);
  assert.deepEqual(contractErrors, []);
  assert.equal(evaluation.result, 'complete_with_exceptions');
});

test('T41 / T38: write whose basisRefs do not resolve or reference an unanswered design decision is rejected', () => {
  const dir = copyM1({
    plan: p => { p.designDecisions.push({ id: 'dec-099', question: 'gradient header?', options: ['yes', 'no'], recommendation: null, answer: null, source: 'user', evidenceRefs: [], decidedAt: null }); },
  });
  appendOp(dir, writeOp('op-0099', { basisRefs: ['dec-099', 'pattern-missing'] }));
  const errors = semantic(dir);
  has(errors, /op-0099: basisRef dec-099 is an unanswered design decision/);
  has(errors, /op-0099: basisRef pattern-missing does not resolve/);
});

test('T31 / INVARIANT-09: write to a file that is not the authorized output is rejected', () => {
  const dir = copyM1();
  appendOp(dir, writeOp('op-0099', { fileKey: 'FixtureLibraryFile0001' }));
  has(semantic(dir), /op-0099: fileKey FixtureLibraryFile0001 is not the authorized output/);
});

test('T29 / INVARIANT-08: an audit run with a write operation is rejected', () => {
  const dir = copyM1({
    brief: b => { b.taskType = 'audit'; b.output = null; },
    audit: a => { a.taskType = 'audit'; },
    plan: p => { p.taskType = 'audit'; },
  });
  has(semantic(dir), /audit runs must not write to the canvas/);
});

test('T32: dangling evidenceRef, stale evidence and duplicated gate are rejected; completion falls to partial', () => {
  const dir = copyM1({
    audit: a => {
      a.gates.find(g => g.id === 'G4').evidenceRefs = ['ev-404'];
      a.gates.push({ id: 'G1', status: 'pass' });
      a.evidence.find(e => e.id === 'ev-005').toolRef.capturedAt = '2026-09-28T00:00:00.000Z';
    },
  });
  const errors = semantic(dir);
  has(errors, /gate G4: evidenceRef ev-404 not found/);
  has(errors, /evidence ev-005: stale, op-0007 changed 34016:68 after capture/);
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.eligible, false);
  assert.equal(evaluation.result, 'partial');
  assert.ok(evaluation.reasons.some(r => /G1: expected exactly one gate result, found 2/.test(r)));
});

test('T45: remote variable binding without an approved variables library is rejected; gap must resolve', () => {
  const dir = copyM1({
    plan: p => {
      p.variableMap = [
        { id: 'vmap-bg', usage: 'row.bg', property: 'fills', name: 'surface/default', resolvedType: 'COLOR', sourceKind: 'remote', libraryKey: null, bindingStatus: 'planned' },
        { id: 'vmap-gap', usage: 'row.text', property: 'fills', name: 'text/primary', resolvedType: 'COLOR', sourceKind: 'remote', bindingStatus: 'gap', gapRef: 'gap-404' },
      ];
    },
  });
  const errors = semantic(dir);
  has(errors, /vmap-bg: remote variable without an identified source library/);
  has(errors, /vmap-gap: gapRef gap-404 not found/);
});

test('T45: approving only the component library does not approve variables from it', () => {
  const libKey = readFixture('brief').sources.componentLibraryKeys[0];
  const dir = copyM1({
    plan: p => { p.variableMap = [{ id: 'vmap-bg', usage: 'row.bg', property: 'fills', name: 'surface/default', resolvedType: 'COLOR', sourceKind: 'remote', libraryKey: libKey, bindingStatus: 'planned' }]; },
  });
  has(semantic(dir), /vmap-bg: library lk-[0-9a-f]+ is not an approved variables library/);
});

test('T46: version difference must point at an inherited_baseline observation and be listed to the user', () => {
  const dir = copyM1({ plan: p => { p.componentMap[0].versionCheck.baselineRef = 'bl-404'; delete p.componentMap[0].versionCheck.listedToUserRef; } });
  const errors = semantic(dir);
  has(errors, /versionCheck.baselineRef bl-404 not found/);
  has(errors, /version difference not listed to the user/);
});

test('ledger: lastVerifiedOperationId must be verified and unresolved ops must be listed as pending', () => {
  const dir = copyM1();
  appendOp(dir, writeOp('op-0099', { basisRefs: ['dec-001'] }));
  appendOp(dir, { operationId: 'op-0099', status: 'unknown_outcome', timestamps: { failedAt: '2026-09-28T12:05:00.000Z' } });
  has(semantic(dir), /pendingOperations is missing unresolved operation op-0099/);
});

test('writes require a verified nativeWrite capability and an ok account (§4.2.1)', () => {
  const dir = copyM1({ capabilities: c => { c.account.status = 'blocked'; c.features.nativeWrite = { status: 'unknown' }; } });
  const errors = semantic(dir);
  has(errors, /nativeWrite must be verified/);
  has(errors, /account is blocked/);
});
