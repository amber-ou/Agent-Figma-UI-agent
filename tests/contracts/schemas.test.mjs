// JSON Schema (syntax) tests for the §20 contracts. executionLayer=offline_fixture.
// Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema, validateRun } from '../../scripts/validate-artifacts.mjs';
import { M1_FIXTURE, readFixture } from '../helpers.mjs';

const clone = o => JSON.parse(JSON.stringify(o));
const expectInvalid = (name, doc, pattern) => {
  const errors = validateSchema(name, doc);
  assert.ok(errors.length > 0, `${name} should be invalid`);
  if (pattern) assert.ok(errors.some(e => pattern.test(e)), `expected ${pattern} in:\n${errors.join('\n')}`);
};

test('de-identified M1 run fixture passes every schema and the cross-file checks', () => {
  const { ok, schemaErrors, semanticErrors } = validateRun(M1_FIXTURE);
  assert.deepEqual(schemaErrors, []);
  assert.deepEqual(semanticErrors, []);
  assert.equal(ok, true);
});

test('fixture contains no real file keys, brand or email', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const all = fs.readdirSync(M1_FIXTURE).map(f => fs.readFileSync(path.join(M1_FIXTURE, f), 'utf8')).join('\n');
  assert.ok(!/B0FKsPFvTG11Tt1P7ZXxxn|IBq10PHhCxczFX6hBzQvaC|Aiwow/.test(all));
  assert.ok(!/[\w.+-]+@[\w-]+\.(com|net|org|io)/.test(all));
});

test('brief: wrong enum, missing required and placeholder ids are rejected (§20)', () => {
  const b = readFixture('brief');
  expectInvalid('brief', { ...clone(b), taskType: 'redesign' }, /taskType/);
  const missing = clone(b); delete missing.designSystem;
  expectInvalid('brief', missing, /designSystem/);
  const ph = clone(b); ph.output.scopeRootIds = ['<node-id>'];
  expectInvalid('brief', ph, /scopeRootIds/);
});

test('brief: confirmed design brief needs writeAllowed, decisionRef and no open questions; audit output must be null', () => {
  const b = readFixture('brief');
  expectInvalid('brief', { ...clone(b), openQuestions: ['which page?'] }, /openQuestions/);
  const noWrite = clone(b); noWrite.output.writeAllowed = false;
  expectInvalid('brief', noWrite, /writeAllowed/);
  const audit = clone(b); audit.taskType = 'audit';
  expectInvalid('brief', audit, /output/);
  audit.output = null;
  assert.deepEqual(validateSchema('brief', audit), []);
});

test('intake brief with nulls is a valid draft', () => {
  const b = clone(readFixture('brief'));
  Object.assign(b, { stage: 'intake', openQuestions: ['output page'] });
  Object.assign(b.output, { fileKey: null, pageId: null, writeAllowed: false, decisionRef: null });
  assert.deepEqual(validateSchema('brief', b), []);
});

test('plan: designDecision source must be user|ds|existing_pattern|brief; not-applicable cell needs a reason', () => {
  const p = readFixture('plan');
  const agent = clone(p); agent.designDecisions[0].source = 'agent';
  expectInvalid('plan', agent, /source/);
  const cell = clone(p); cell.requiredCells[0].applicable = false; delete cell.requiredCells[0].reason;
  expectInvalid('plan', cell, /reason/);
});

test('plan: versionCheck=differs requires differences and baselineRef (T46)', () => {
  const p = clone(readFixture('plan'));
  delete p.componentMap[0].versionCheck.baselineRef;
  expectInvalid('plan', p, /baselineRef/);
});

test('plan: verified variable binding must be a runtime-verified value; gap needs gapRef (T45)', () => {
  const p = clone(readFixture('plan'));
  p.variableMap = [{ id: 'vmap-1', usage: 'row.bg', property: 'fills', name: 'surface/default', resolvedType: 'COLOR', sourceKind: 'remote', bindingStatus: 'verified', resolutionMethod: 'manual_trace', valueStatus: 'verified', variableKey: 'aaaaaaaaaaaaaaaaaaaa', consumerNodeId: '1:2' }];
  expectInvalid('plan', p, /resolutionMethod/);
  p.variableMap = [{ id: 'vmap-1', usage: 'row.bg', property: 'fills', name: 'surface/default', resolvedType: 'COLOR', sourceKind: 'remote', bindingStatus: 'gap' }];
  expectInvalid('plan', p, /gapRef/);
});

test('inventory: a confirmed pattern constraint needs measurements and experimentRefs (INVARIANT-16)', () => {
  const inv = clone(readFixture('inventory'));
  inv.patterns[0].constraints[0].status = 'confirmed';
  expectInvalid('inventory', inv, /experimentRefs/);
});

test('capabilities: verified needs evidence; account cannot carry email or handle (CAP-03)', () => {
  const c = clone(readFixture('capabilities'));
  c.features.screenshot = { status: 'verified' };
  expectInvalid('capabilities', c, /evidence/);
  const e = clone(readFixture('capabilities'));
  e.account.email = 'someone@example.com';
  expectInvalid('capabilities', e, /email/);
});

test('operation: write needs non-empty basisRefs, logicalKey, fileKey and preconditions; status enum is closed', () => {
  const op = { schemaVersion: '1.2', operationId: 'op-1', runId: 'r1', logicalKey: 'x', kind: 'k', mode: 'write', status: 'planned', fileKey: 'FixtureOutputFile00001', basisRefs: [], preconditions: {}, timestamps: {} };
  expectInvalid('operation', op, /basisRefs/);
  expectInvalid('operation', { ...op, basisRefs: ['dec-1'], status: 'done' }, /status/);
  assert.deepEqual(validateSchema('operation', { ...op, basisRefs: ['dec-1'] }), []);
  assert.deepEqual(validateSchema('operation', { operationId: 'rd-1', runId: 'r1', mode: 'read', status: 'applied', timestamps: {} }), []);
});

test('audit: no run status field; accepted finding needs decisionRef; exception cannot be hard; evidence needs toolRef or artifactRef', () => {
  const a = readFixture('audit');
  expectInvalid('audit', { ...clone(a), status: 'complete' }, /status/);
  const f = clone(a); delete f.findings.find(x => x.status === 'accepted').decisionRef;
  expectInvalid('audit', f, /decisionRef/);
  const x = clone(a); x.acceptedExceptions[0].hard = true;
  expectInvalid('audit', x, /hard/);
  const ev = clone(a); ev.evidence[0].toolRef = null; ev.evidence[0].artifactRef = null;
  expectInvalid('audit', ev);
});
