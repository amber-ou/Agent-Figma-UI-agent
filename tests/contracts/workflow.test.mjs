// Preflight (T43), entry points new/continue/resume (T33), fresh intake (T21) and the local lock (T19).
// executionLayer=offline_fixture. Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { diagnoseAccount, buildCapabilities, RECOVERY_STEPS } from '../../scripts/preflight.mjs';
import { parseInvocation, resolveRunId, createRun, activateRun, releaseRun, readActiveRun } from '../../scripts/state-store.mjs';
import { validateSchema } from '../../scripts/validate-artifacts.mjs';
import { tmpRoot } from '../helpers.mjs';

const whoami = plans => ({ handle: 'someone', email: 'someone@example.com', plans });

test('T43: View / Dev seat or denied read -> blocked with the §4.2.1 recovery steps; no email stored', () => {
  const view = diagnoseAccount(whoami([{ name: 'Team', seat: 'View', tier: 'starter', key: 'team::1', role: 'admin' }]));
  assert.equal(view.status, 'blocked');
  assert.deepEqual(view.recoverySteps, RECOVERY_STEPS);
  assert.ok(view.reasons.some(r => /no Full seat/.test(r)));
  assert.ok(!JSON.stringify(view).includes('someone'));

  const dev = diagnoseAccount(whoami([{ seat: 'Dev', tier: 'org', key: 'organization::2' }]), { targetPlanRef: 'organization::2' });
  assert.equal(dev.status, 'blocked');

  const denied = diagnoseAccount(whoami([{ seat: 'Full', tier: 'pro', key: 'team::3' }]), { accessDenied: true });
  assert.equal(denied.status, 'blocked');
  assert.ok(denied.reasons.some(r => /do not retry/.test(r)));
});

test('T43: Full seat on the target plan -> ok; target plan the account is not in -> blocked; read-only audit does not need Full', () => {
  const plans = [{ seat: 'Full', tier: 'pro', key: 'team::1' }, { seat: 'View', tier: 'org', key: 'organization::9' }];
  assert.equal(diagnoseAccount(whoami(plans), { targetPlanRef: 'team::1' }).status, 'ok');
  assert.equal(diagnoseAccount(whoami(plans), { targetPlanRef: 'organization::9' }).status, 'blocked');
  assert.equal(diagnoseAccount(whoami(plans), { targetPlanRef: 'team::404' }).status, 'blocked');
  assert.equal(diagnoseAccount(whoami(plans), { targetPlanRef: 'organization::9', requireWrite: false }).status, 'ok');
});

test('capabilities built by preflight validate against the schema; tools start unverified (CAP-02)', () => {
  const account = diagnoseAccount(whoami([{ seat: 'Full', tier: 'pro', key: 'team::1' }]));
  const caps = buildCapabilities({
    runId: 'ui-20260929-001',
    runtime: { claudeCodeVersion: '2.1.283', os: 'win32' },
    server: { name: 'figma', url: 'https://mcp.figma.com/mcp', toolPrefix: 'mcp__figma__' },
    account,
    tools: ['mcp__figma__use_figma', 'mcp__figma__whoami'],
    verifiedTools: { mcp__figma__whoami: ['preflight whoami'] },
    features: { useFigmaReturnLimit: { status: 'verified', evidence: ['rd-limit-pos'], value: 20480 } },
  });
  assert.deepEqual(validateSchema('capabilities', caps), []);
  assert.equal(caps.tools.find(t => t.name === 'mcp__figma__use_figma').status, 'available_unverified');
});

test('T33: /figma-ui arguments parse into new / continue / resume', () => {
  assert.deepEqual(parseInvocation('延伸做一個成員管理頁'), { mode: 'new', runId: null, request: '延伸做一個成員管理頁' });
  assert.deepEqual(parseInvocation(''), { mode: 'new', runId: null, request: '' });
  assert.deepEqual(parseInvocation(['continue', 'ui-20260929-001', '調整列表間距']), { mode: 'continue', runId: 'ui-20260929-001', request: '調整列表間距' });
  assert.deepEqual(parseInvocation('resume ui-20260929-001'), { mode: 'resume', runId: 'ui-20260929-001', request: '' });
  assert.deepEqual(parseInvocation('Resume'), { mode: 'resume', runId: null, request: '' });
});

test('T33: run id resolution — exact, unique prefix, ambiguous and missing all behave distinctly (ask, never start another run)', () => {
  const root = tmpRoot();
  for (const id of ['ui-20260929-001', 'ui-20260929-002', 'ui-20260930-001']) fs.mkdirSync(path.join(root, 'design-runs', id), { recursive: true });
  assert.deepEqual(resolveRunId('ui-20260929-001', root), { status: 'found', runId: 'ui-20260929-001' });
  assert.deepEqual(resolveRunId('ui-20260930', root), { status: 'found', runId: 'ui-20260930-001' });
  assert.equal(resolveRunId('ui-20260929', root).status, 'ambiguous');
  assert.equal(resolveRunId('ui-2025', root).status, 'not_found');
  assert.equal(resolveRunId(null, root).status, 'missing');
});

test('T21: a new run starts from a fresh intake brief and does not inherit the previous run', () => {
  const root = tmpRoot();
  const first = createRun({ runId: 'ui-20260929-001', goal: 'A', root });
  const prev = JSON.parse(fs.readFileSync(path.join(first.dir, 'brief.json'), 'utf8'));
  Object.assign(prev, { platform: 'ios', stage: 'confirmed' });
  prev.sources.componentLibraryKeys = ['lk-0000000000000000aaaa'];
  fs.writeFileSync(path.join(first.dir, 'brief.json'), JSON.stringify(prev));

  const second = createRun({ runId: 'ui-20260929-002', goal: 'B', root });
  const brief = JSON.parse(fs.readFileSync(path.join(second.dir, 'brief.json'), 'utf8'));
  assert.equal(brief.stage, 'intake');
  assert.equal(brief.platform, null);
  assert.deepEqual(brief.sources.componentLibraryKeys, []);
  assert.deepEqual(brief.sources.variableLibraryKeys, []);
  assert.ok(brief.openQuestions.includes('variables library'));
  assert.deepEqual(validateSchema('brief', brief), []);
  assert.throws(() => createRun({ runId: 'ui-20260929-001', root }), /already exists/);
});

test('T19: lock is exclusive per file; release needs the owning run and removes active-run.json', () => {
  const root = tmpRoot();
  const key = 'FixtureOutputFile00001';
  for (const id of ['r1', 'r2']) createRun({ runId: id, root });
  const a = activateRun({ runId: 'r1', fileKey: key, root });
  assert.equal(a.ok, true);
  assert.equal(activateRun({ runId: 'r1', fileKey: key, root }).reused, true);
  const b = activateRun({ runId: 'r2', fileKey: key, root });
  assert.equal(b.ok, false);
  assert.match(b.reason, /another run is active: r1/);
  assert.equal(releaseRun({ runId: 'r2', root }).ok, false);
  const rel = releaseRun({ runId: 'r1', root });
  assert.deepEqual(rel.fileKeys, [key]);
  assert.equal(readActiveRun(root), null);
  assert.ok(!fs.existsSync(path.join(root, '.figma-ui', 'locks', `${key}.json`)));
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'design-runs', 'r1', 'ledger.json'), 'utf8'));
  assert.equal(ledger.lock.released, true);
  assert.deepEqual(validateSchema('ledger', ledger), []);
  // after release another run may take the file
  assert.equal(activateRun({ runId: 'r2', fileKey: key, root }).ok, true);
});

test('T28 (P1 subset): a lock left by another run is never taken over automatically', () => {
  const root = tmpRoot();
  const key = 'FixtureOutputFile00001';
  createRun({ runId: 'r2', root });
  fs.mkdirSync(path.join(root, '.figma-ui', 'locks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.figma-ui', 'locks', `${key}.json`), JSON.stringify({ ownerToken: 'x', runId: 'dead-run', pid: 999999 }));
  const r = activateRun({ runId: 'r2', fileKey: key, root });
  assert.equal(r.ok, false);
  assert.match(r.reason, /held by run dead-run/);
});
