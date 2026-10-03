// v1.8 flow fixes, plugin version check and the pinned Figma connection (spec §4.2.2, §4.2.3, §4.5,
// §7.4 DEC-08/09/11, §12.1, §15 item 12, §20): T72–T80. T81 (reply language) is a behaviour rule
// checked in SKILL.md and real runs, not offline. executionLayer=offline_fixture.
// Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validateRun, validateSchema, decisionResolved, nativeWriteReady, CONTRACTS } from '../../scripts/validate-artifacts.mjs';
import { evaluateRun, writeEvaluation, RULE_VERSION } from '../../scripts/evaluate-completion.mjs';
import { verifyOperation } from '../../scripts/operation-journal.mjs';
import { recordPhase, runMetrics, renderHandoff } from '../../scripts/run-report.mjs';
import { runContext } from '../../scripts/run-context.mjs';
import { diagnoseAccount, normalizeWhoami, figmaConnections, buildCapabilities } from '../../scripts/preflight.mjs';
import { pluginVersionStatus, compareVersions, fetchLatestPluginVersion, matcherCoverage, toolPrefixFor, parseMcpList, KNOWN_FIGMA_PREFIXES } from '../../scripts/verify-installation.mjs';
import { skeleton, EXAMPLES } from '../../scripts/artifact-skeleton.mjs';
import { createRun } from '../../scripts/state-store.mjs';
import { copyM1, appendOp, repo, tmpRoot } from '../helpers.mjs';

const RUN = 'ui-20260928-m1';
const OUT = 'FixtureOutputFile00001';
const NOW = '2026-10-03T00:00:00.000Z';
const readJ = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const reasons = dir => evaluateRun(dir).evaluation.reasons.join('\n');

const dd = (id, over = {}) => ({ id, question: `question ${id}`, options: ['A', 'B'], recommendation: null, answer: null, source: 'user', evidenceRefs: [], decidedAt: null, status: 'skipped', ...over });

// ---------------- T72 ----------------
test('T72: a skip the user chose resolves the decision; an agent skip and a legacy skip stay open (INVARIANT-28)', () => {
  assert.equal(RULE_VERSION, '12.1@1.8');
  const base = evaluateRun(copyM1()).evaluation.result;
  assert.equal(base, 'complete_with_exceptions', 'the fixture run is complete before adding decisions');

  const userSkip = dd('dd-11', { skippedBy: 'user', confirmation: 'user_skipped', context: '名片圖與品牌' });
  const byUser = copyM1({ plan: p => { p.designDecisions.push(userSkip); } });
  assert.deepEqual(validateRun(byUser).schemaErrors, []);
  assert.equal(evaluateRun(byUser).evaluation.result, base, 'skippedBy user does not block completion (G7)');
  assert.ok(decisionResolved(userSkip));

  const byAgent = copyM1({ plan: p => { p.designDecisions.push(dd('dd-12', { skippedBy: 'agent' })); } });
  assert.equal(evaluateRun(byAgent).evaluation.result, 'awaiting_user');
  assert.match(reasons(byAgent), /unanswered design decisions: dd-12=skipped\(by agent\)/);

  const legacy = copyM1({ plan: p => { p.designDecisions.push(dd('dd-13')); } });
  assert.equal(evaluateRun(legacy).evaluation.result, 'awaiting_user', 'no skippedBy (before v1.8) counts as agent');
  assert.match(reasons(legacy), /dd-13=skipped\(by agent\)/);

  // schema: skippedBy only on skipped; user_skipped needs skippedBy user; a user skip records user_skipped
  const plan = readJ(path.join(byUser, 'plan.json'));
  const bad = d => validateSchema('plan', { ...plan, designDecisions: [d] });
  assert.ok(bad({ ...userSkip, status: 'answered', answer: 'A', decidedAt: NOW }).length, 'skippedBy on an answered decision');
  assert.ok(bad({ ...userSkip, skippedBy: 'agent' }).length, 'user_skipped with skippedBy agent');
  assert.ok(bad({ ...userSkip, confirmation: undefined }).length, 'skippedBy user without confirmation user_skipped');
  assert.ok(bad({ ...userSkip, skippedBy: 'model' }).length, 'unknown skippedBy');

  // the handoff lists the user skip in item 12 and the agent skip under 待決
  const both = copyM1({ plan: p => { p.designDecisions.push(userSkip, dd('dd-12', { skippedBy: 'agent' })); } });
  writeEvaluation(both);
  const text = renderHandoff(both, { root: tmpRoot() });
  const item12 = text.split('## 未定義，交由實作決定')[1].split('\n## ')[0];
  assert.match(item12, /dd-11：question dd-11（名片圖與品牌）/);
  assert.doesNotMatch(item12, /dd-12/);
  const open = text.split('## 待決與未驗證')[1].split('\n## ')[0];
  assert.match(open, /設計決策 dd-12（skipped，由 agent 標記/);
  assert.doesNotMatch(open, /dd-11/);

  // continue does not re-ask the user's skip, but asks the agent's
  const ctx = runContext(both, 'continue', { pluginVersion: { status: 'current' } });
  assert.ok(ctx.confirmed.includes('dd-11 (skipped by the user)'));
  assert.ok(ctx.ask.some(a => a.item === 'dd-12'));
  assert.ok(!ctx.ask.some(a => a.item === 'dd-11'));
});

// ---------------- T73 ----------------
test('T73: dynamic behaviour is not a designDecision; the handoff lists it as 未定義，交由實作決定', () => {
  const ub = { id: 'ub-01', behavior: 'Toast 停留多久、能否手動關閉', kind: 'timing', screenKey: 'm1' };
  const dir = copyM1({ plan: p => { p.undefinedBehaviors = [ub]; } });
  assert.deepEqual(validateRun(dir).schemaErrors, []);
  const before = evaluateRun(copyM1()).evaluation.result;
  assert.equal(evaluateRun(dir).evaluation.result, before, 'an undefined behaviour never blocks completion');
  const ctx = runContext(dir, 'continue', { pluginVersion: { status: 'current' } });
  assert.ok(!ctx.ask.some(a => a.item === 'ub-01'), 'never asked');
  writeEvaluation(dir);
  const text = renderHandoff(dir, { root: tmpRoot() });
  assert.match(text, /## 未定義，交由實作決定/);
  assert.match(text, /ub-01（m1）：Toast 停留多久、能否手動關閉［timing］/);
  assert.equal(runMetrics(dir, { events: [] }).decisions.undefinedBehaviors, 1);
  // with none: the section still exists and says 無
  const empty = copyM1();
  writeEvaluation(empty);
  assert.match(renderHandoff(empty, { root: tmpRoot() }).split('## 未定義，交由實作決定')[1].split('\n## ')[0], /動態行為[^\n]*\n {2}- 無/);
  // shape: behaviour text is required, ids unique
  const plan = readJ(path.join(dir, 'plan.json'));
  assert.ok(validateSchema('plan', { ...plan, undefinedBehaviors: [{ id: 'ub-02' }] }).length);
  const dup = copyM1({ plan: p => { p.undefinedBehaviors = [ub, ub]; } });
  assert.ok(validateRun(dup).semanticErrors.some(e => /duplicate undefinedBehavior id ub-01/.test(e)));
});

// ---------------- T74 ----------------
test('T74: scope / authorisation rows record confirmation and are counted with design decisions', () => {
  const dir = copyM1({ plan: p => {
    p.decisions = p.decisions.map(d => d.id === 'dec-003' ? { ...d, confirmation: 'user_modified' } : d.id === 'dec-000' ? { ...d, confirmation: 'prefilled_confirmed' } : d);
    p.designDecisions = p.designDecisions.map(d => d.id === 'dec-001' ? { ...d, confirmation: 'prefilled_confirmed' } : d);
  } });
  assert.deepEqual(validateRun(dir).schemaErrors, []);
  const m = runMetrics(dir, { events: [] }).decisions;
  assert.equal(m.userModified, 1, 'the modified library row is counted (it was missed in v1.7)');
  assert.equal(m.prefilledConfirmed, 2);
  assert.deepEqual(m.confirmationByKind.scopeDecisions, { prefilledConfirmed: 1, userModified: 1, userFilled: 0, userSkipped: 0 });
  assert.deepEqual(m.confirmationByKind.designDecisions, { prefilledConfirmed: 1, userModified: 0, userFilled: 0, userSkipped: 0 });
  const plan = readJ(path.join(dir, 'plan.json'));
  assert.ok(validateSchema('plan', { ...plan, decisions: [{ ...plan.decisions[0], confirmation: 'agent_filled' }] }).length, 'no agent-made confirmation');
  writeEvaluation(dir);
  assert.match(renderHandoff(dir, { root: tmpRoot() }), /確認方式（設計決策與範圍／授權列合計）：照預填 2、改過 1、自己填 0、略過 0/);
});

// ---------------- T75 ----------------
test('T75: whoami is read in its raw (wrapped) and flat forms; an unknown format is not an account block', () => {
  const plans = [{ key: 'team::1', tier: 'pro', seat: 'Full', role: 'admin' }];
  const forms = {
    flat: { plans },
    wrapped: { whoami: { id: 'x', plans } },
    mcpContent: [{ type: 'text', text: JSON.stringify({ plans }) }],
    mcpObject: { content: [{ type: 'text', text: JSON.stringify({ whoami: { plans } }) }] },
    jsonString: JSON.stringify({ result: { plans } }),
  };
  for (const [name, raw] of Object.entries(forms)) {
    const r = diagnoseAccount(raw, { targetPlanRef: 'team::1' });
    assert.equal(r.status, 'ok', name);
    assert.deepEqual(r.plans.map(p => p.planRef), ['team::1'], name);
  }
  for (const raw of [{ foo: 1 }, 'not json', null, [{ type: 'text', text: 'hello' }]]) {
    const r = diagnoseAccount(raw);
    assert.equal(r.status, 'unrecognized_format');
    assert.match(r.reasons[0], /格式不符/);
    assert.deepEqual(r.recoverySteps, [], 'no account recovery steps for a format problem');
  }
  assert.equal(normalizeWhoami({ whoami: { plans: [] } }).plans.length, 0);
  assert.equal(diagnoseAccount({ whoami: { plans: [] } }).status, 'blocked', 'a real empty plan list is still blocked');
  // CLI: exit 3 for a format problem, 0 for a wrapped response
  const tmp = tmpRoot();
  const file = path.join(tmp, 'whoami.json');
  fs.writeFileSync(file, JSON.stringify(forms.wrapped));
  assert.equal(spawnSync(process.execPath, [path.join(repo, 'scripts', 'preflight.mjs'), 'diagnose', file], { encoding: 'utf8' }).status, 0);
  fs.writeFileSync(file, '{"nothing":true}');
  assert.equal(spawnSync(process.execPath, [path.join(repo, 'scripts', 'preflight.mjs'), 'diagnose', file], { encoding: 'utf8' }).status, 3);
});

// ---------------- T76 / T77 ----------------
function withAppliedWrite(mutate = {}) {
  const dir = copyM1(mutate);
  appendOp(dir, { schemaVersion: '1.2', runId: RUN, operationId: 'op-0100', logicalKey: 'v18.screen', kind: 'upsert_screen', mode: 'write', fileKey: OUT, status: 'planned', basisRefs: ['dec-001'], scopeRootIds: ['34014:9'], preconditions: {}, createdNodeIds: [], mutatedNodeIds: [], evidenceRefs: [], retry: { attempt: 0, outcomeKnown: false }, timestamps: { plannedAt: '2026-10-03T00:00:00.000Z' } });
  appendOp(dir, { operationId: 'op-0100', status: 'dispatched', timestamps: { dispatchedAt: '2026-10-03T00:00:01.000Z' } });
  appendOp(dir, { operationId: 'op-0100', status: 'applied', timestamps: { appliedAt: '2026-10-03T00:00:02.000Z' } });
  return dir;
}

test('T76: verify writes ledger.entities; the handoff lists the created and modified nodes', () => {
  const dir = withAppliedWrite();
  verifyOperation(dir, 'op-0100', { evidenceRefs: ['rd-0100'], createdNodeIds: ['34100:1', '34100:2'], mutatedNodeIds: ['34014:9'], fingerprint: 'fp1:0123abcd', entity: { type: 'FRAME' } });
  const ledger = readJ(path.join(dir, 'ledger.json'));
  const e = ledger.entities.find(x => x.logicalKey === 'v18.screen');
  assert.deepEqual(e, { logicalKey: 'v18.screen', nodeId: '34100:1', type: 'FRAME', fileKey: OUT, active: true, childNodeIds: ['34100:2', '34014:9'], agentFingerprint: 'fp1:0123abcd', lastOperationId: 'op-0100' });
  assert.equal(ledger.lastVerifiedOperationId, 'op-0100');
  assert.deepEqual(validateSchema('ledger', ledger), []);
  // a later verify of the same logicalKey updates the one entity (never two active ones)
  appendOp(dir, { schemaVersion: '1.2', runId: RUN, operationId: 'op-0101', logicalKey: 'v18.screen', kind: 'upsert_screen', mode: 'write', fileKey: OUT, status: 'applied', basisRefs: ['dec-001'], preconditions: {}, createdNodeIds: [], mutatedNodeIds: ['34100:2'], evidenceRefs: [], timestamps: { plannedAt: NOW, appliedAt: '2026-10-03T00:01:00.000Z' } });
  verifyOperation(dir, 'op-0101', { evidenceRefs: ['rd-0101'], entity: { nodeId: '34100:1' } });
  const after = readJ(path.join(dir, 'ledger.json')).entities.filter(x => x.logicalKey === 'v18.screen');
  assert.equal(after.length, 1);
  assert.equal(after[0].lastOperationId, 'op-0101');
  assert.equal(after[0].type, 'FRAME', 'the type read back earlier is kept for the same root');
  writeEvaluation(dir);
  const text = renderHandoff(dir, { root: tmpRoot() });
  assert.match(text, /v18\.screen（FRAME）：https:\/\/www\.figma\.com\/design\/FixtureOutputFile00001\/\?node-id=34100-1/);
  assert.match(text, /本 run 建立 \d+ 個、修改 \d+ 個節點/);
  assert.doesNotMatch(text, /本 run 沒有建立或修改節點/);
  // without a read-back type the entity is UNKNOWN, never guessed; noChange writes add no entity
  const d2 = withAppliedWrite();
  verifyOperation(d2, 'op-0100', { evidenceRefs: ['rd-0100'], createdNodeIds: ['34100:9'] });
  assert.equal(readJ(path.join(d2, 'ledger.json')).entities.find(x => x.logicalKey === 'v18.screen').type, 'UNKNOWN');
  const d3 = withAppliedWrite();
  verifyOperation(d3, 'op-0100', { evidenceRefs: ['rd-0100'], noChange: true });
  assert.ok(!readJ(path.join(d3, 'ledger.json')).entities.some(x => x.logicalKey === 'v18.screen'));
});

test('T77: the first write probing nativeWrite (basis history) upgrades it to verified for this run on verify', () => {
  const history = c => { c.features.nativeWrite = { status: 'available_unverified', basis: 'history', notes: 'verified in an earlier run' }; };
  const dir = withAppliedWrite({ capabilities: history });
  const run0 = validateRun(dir).run;
  assert.equal(nativeWriteReady(run0), false, 'a write exists, so history alone is no longer enough');
  verifyOperation(dir, 'op-0100', { evidenceRefs: ['rd-0100'], createdNodeIds: ['34100:1'], entity: { type: 'FRAME' } });
  const caps = readJ(path.join(dir, 'capabilities.json'));
  assert.equal(caps.features.nativeWrite.status, 'verified');
  assert.equal(caps.features.nativeWrite.basis, 'this_run');
  assert.deepEqual(caps.features.nativeWrite.evidence, ['op-0100', 'rd-0100']);
  assert.deepEqual(validateSchema('capabilities', caps), []);
  assert.equal(nativeWriteReady(validateRun(dir).run), true);
  assert.ok(!validateRun(dir).semanticErrors.some(e => /nativeWrite/.test(e)), 'no manual capabilities edit needed');
  // a no-change verify proves nothing about writing: nativeWrite stays as it was
  const d2 = withAppliedWrite({ capabilities: history });
  verifyOperation(d2, 'op-0100', { evidenceRefs: ['rd-0100'], noChange: true });
  assert.equal(readJ(path.join(d2, 'capabilities.json')).features.nativeWrite.status, 'available_unverified');
});

// ---------------- T78 ----------------
test('T78: re-entering the same phase is not recorded twice; no negative durations', () => {
  const dir = copyM1();
  recordPhase(dir, 'validate', '2026-09-28T11:30:00.000Z');
  recordPhase(dir, 'handoff', '2026-09-28T11:35:00.000Z');
  recordPhase(dir, 'handoff', '2026-09-28T11:40:00.000Z');
  const l = readJ(path.join(dir, 'ledger.json'));
  assert.deepEqual(l.phaseHistory.map(p => p.phase), ['validate', 'handoff']);
  assert.equal(l.phaseHistory[1].enteredAt, '2026-09-28T11:35:00.000Z', 'the first entry time is kept');
  assert.equal(l.phase, 'handoff');
  const m = runMetrics(dir, { events: [] });
  assert.ok(m.phases.every(p => p.durationMs === null || p.durationMs >= 0));
  // validate → handoff → validate → handoff is real re-work, recorded as such
  recordPhase(dir, 'validate', '2026-09-28T11:36:00.000Z');
  recordPhase(dir, 'handoff', '2026-09-28T11:37:00.000Z');
  assert.equal(readJ(path.join(dir, 'ledger.json')).phaseHistory.length, 4);
  // a duplicate recorded before v1.8, entered after the evaluation: unknown, not negative
  const legacy = copyM1({ ledger: x => { x.phaseHistory = [{ phase: 'handoff', enteredAt: '2026-09-28T11:30:00.000Z' }, { phase: 'handoff', enteredAt: '2026-09-28T11:39:00.000Z' }]; } });
  const lm = runMetrics(legacy, { events: [] });
  assert.equal(lm.phases[1].durationMs, null);
  assert.ok(lm.unknown.some(u => /duration of handoff/.test(u)));
});

// ---------------- T79 ----------------
test('T79: an outdated plugin is asked first at Intake for this run only; unknown latest only notes; synced options', async () => {
  assert.equal(compareVersions('2.2.118', '2.2.126'), -1);
  assert.equal(compareVersions('2.2.126', '2.2.126'), 0);
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
  const synced = pluginVersionStatus({ name: 'figma@synced', installed: '2.2.118', latest: '2.2.126', checkedAt: NOW });
  assert.equal(synced.status, 'outdated');
  assert.equal(synced.synced, true);
  assert.match(synced.note, /本機不一定能自行升級/);
  assert.equal(pluginVersionStatus({ name: 'figma@claude-plugins-official', installed: '2.2.126', latest: '2.2.126', checkedAt: NOW }).status, 'current');
  const unknown = pluginVersionStatus({ name: 'figma@synced', installed: '2.2.118', latest: null, latestError: 'timeout', checkedAt: NOW });
  assert.equal(unknown.status, 'latest_unknown');
  assert.match(unknown.note, /無法確認是否為最新版（timeout）/);
  assert.equal(pluginVersionStatus({ installed: null, checkedAt: NOW }).status, 'not_installed');

  // latest version from figma/mcp-server-guide; failures never throw
  assert.deepEqual(await fetchLatestPluginVersion({ fetchImpl: async () => ({ ok: true, json: async () => ({ name: 'figma', version: '2.2.126' }) }) }), { latest: '2.2.126' });
  assert.equal((await fetchLatestPluginVersion({ fetchImpl: async () => ({ ok: false, status: 404 }) })).latest, null);
  assert.equal((await fetchLatestPluginVersion({ fetchImpl: async () => { throw new Error('offline'); } })).error, 'offline');

  // recorded in capabilities.server.pluginVersion (schema), from the diagnosis when the facts omit it
  const caps = buildCapabilities({ runId: RUN, runtime: { claudeCodeVersion: '2.1.283' }, server: { name: 'figma', url: 'https://mcp.figma.com/mcp', toolPrefix: 'mcp__figma__' }, tools: ['mcp__figma__use_figma'], pluginVersion: synced });
  assert.deepEqual(validateSchema('capabilities', caps), []);
  assert.equal(caps.server.pluginVersion.installed, '2.2.118');

  const root = tmpRoot();
  const { dir } = createRun({ runId: 'ui-20261003-001', goal: 'x', root });
  let ctx = runContext(dir, 'new', { root, pluginVersion: synced });
  assert.equal(ctx.ask[0].kind, 'plugin_version', 'first row of the Intake list');
  assert.match(ctx.ask[0].question, /claude\.ai 帳號同步/);
  assert.ok(ctx.ask[0].options.some(o => /wait_for_sync/.test(o)) && !ctx.ask[0].options.some(o => /upgrade_first/.test(o)), 'synced: wait for sync or run as is');
  const local = pluginVersionStatus({ name: 'figma@claude-plugins-official', installed: '2.2.118', latest: '2.2.126', checkedAt: NOW });
  assert.ok(runContext(dir, 'new', { root, pluginVersion: local }).ask[0].options.some(o => /upgrade_first/.test(o)));

  // the answer lives in this run's brief only
  const brief = readJ(path.join(dir, 'brief.json'));
  brief.pluginVersionChoice = { installed: '2.2.118', latest: '2.2.126', choice: 'use_current', synced: true, confirmation: 'prefilled_confirmed', decidedAt: NOW };
  assert.deepEqual(validateSchema('brief', brief), []);
  writeJ(path.join(dir, 'brief.json'), brief);
  ctx = runContext(dir, 'continue', { root, pluginVersion: synced });
  assert.ok(!ctx.ask.some(a => a.kind === 'plugin_version'));
  assert.ok(ctx.confirmed.some(c => /use_current/.test(c)));
  // a newer latest version asks again; so does the next run
  assert.ok(runContext(dir, 'continue', { root, pluginVersion: { ...synced, latest: '2.2.130' } }).ask.some(a => a.kind === 'plugin_version'));
  const { dir: next } = createRun({ runId: 'ui-20261003-002', goal: 'y', root });
  assert.equal(runContext(next, 'new', { root, pluginVersion: synced }).ask[0].kind, 'plugin_version', 'the next run is asked again');

  // latest unknown → one notice, no question, nothing blocks
  ctx = runContext(next, 'new', { root, pluginVersion: unknown });
  assert.ok(!ctx.ask.some(a => a.kind === 'plugin_version'));
  assert.ok(ctx.notices.some(n => /無法確認 Figma plugin 是否為最新版/.test(n)));
  // without an explicit version the last diagnosis in .figma-ui is used
  writeJ(path.join(root, '.figma-ui', 'diagnostics.json'), { report: { pluginVersion: synced } });
  assert.equal(runContext(next, 'new', { root }).ask[0].kind, 'plugin_version');
});

// ---------------- T80 ----------------
const PRE = path.join(repo, 'scripts', 'hooks', 'pre-figma-call.mjs');
function hookRoot({ toolPrefix = 'mcp__figma__' } = {}) {
  const root = tmpRoot();
  const runDir = path.join(root, 'design-runs', 'r1');
  writeJ(path.join(root, '.figma-ui', 'active-run.json'), { runId: 'r1', ownerToken: 'tok' });
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'operations.jsonl'), JSON.stringify({ operationId: 'op-0001', runId: 'r1', mode: 'write', fileKey: 'B0FKsPFvTG11Tt1P7ZXxxn', status: 'planned', basisRefs: ['dec-001'] }) + '\n');
  writeJ(path.join(runDir, 'brief.json'), { stage: 'confirmed', output: { fileKey: 'B0FKsPFvTG11Tt1P7ZXxxn', writeAllowed: true, decisionRef: 'dec-000' } });
  writeJ(path.join(root, '.figma-ui', 'locks', 'B0FKsPFvTG11Tt1P7ZXxxn.json'), { runId: 'r1', ownerToken: 'tok' });
  if (toolPrefix) writeJ(path.join(runDir, 'capabilities.json'), { server: { toolPrefix } });
  return root;
}
function pre(root, tool, op, mode) {
  const r = spawnSync(process.execPath, [PRE], { input: JSON.stringify({ tool_name: tool, tool_use_id: 'tu', tool_input: { fileKey: 'B0FKsPFvTG11Tt1P7ZXxxn', code: `// figma-ui run=r1 op=${op} mode=${mode}\nreturn 1` } }), env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout === '') return { decision: 'pass' };
  const o = JSON.parse(r.stdout).hookSpecificOutput;
  assert.notEqual(o.permissionDecision, 'allow', 'INVARIANT-14');
  return { decision: o.permissionDecision, reason: o.permissionDecisionReason };
}
const events = root => fs.readFileSync(path.join(root, '.figma-ui', 'hook-events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('T80: during an active run a write through another Figma connection, or before toolPrefix is recorded, is denied; reads are only recorded', () => {
  let root = hookRoot();
  const other = pre(root, 'mcp__claude_ai_Figma__use_figma', 'op-0001', 'write');
  assert.equal(other.decision, 'deny');
  assert.match(other.reason, /uses mcp__figma__ .*INVARIANT-27.*mcp__figma__use_figma/);
  assert.equal(pre(root, 'mcp__claude_ai_Figma__create_new_file', 'op-0001', 'write').decision, 'deny');
  const read = pre(root, 'mcp__claude_ai_Figma__use_figma', 'rd-0001', 'read');
  assert.equal(read.decision, 'pass');
  assert.ok(events(root).some(e => e.event === 'PreToolUse:otherConnection' && e.prefix === 'mcp__claude_ai_Figma__' && e.runPrefix === 'mcp__figma__'));
  assert.equal(pre(root, 'mcp__figma__use_figma', 'op-0001', 'write').decision, 'pass', 'the run connection still writes');

  root = hookRoot({ toolPrefix: null });
  const noPrefix = pre(root, 'mcp__figma__use_figma', 'op-0001', 'write');
  assert.equal(noPrefix.decision, 'deny');
  assert.match(noPrefix.reason, /toolPrefix is not recorded/);
  assert.equal(pre(root, 'mcp__figma__use_figma', 'rd-0001', 'read').decision, 'pass', 'reads are not blocked before Preflight');
});

test('T80: Preflight lists every Figma connection; the hook matchers cover every prefix', () => {
  const tools = ['mcp__figma__use_figma', 'mcp__figma__whoami', 'mcp__claude_ai_Figma__use_figma', 'mcp__claude_ai_Notion__notion-fetch', 'mcp__plugin_design_slack__authenticate', 'Bash'];
  const c = figmaConnections(tools);
  assert.deepEqual(c.prefixes.map(p => p.prefix), ['mcp__figma__', 'mcp__claude_ai_Figma__']);
  assert.equal(c.needsUserChoice, true);
  assert.equal(c.recommended, null, 'several connections: the user picks');
  assert.equal(figmaConnections(tools, { accountOkPrefix: 'mcp__figma__' }).recommended, 'mcp__figma__');
  assert.equal(figmaConnections(['mcp__figma__use_figma']).recommended, 'mcp__figma__');

  assert.equal(toolPrefixFor('figma'), 'mcp__figma__');
  assert.equal(toolPrefixFor('claude.ai Figma'), 'mcp__claude_ai_Figma__');
  assert.equal(toolPrefixFor('plugin:figma:figma'), 'mcp__plugin_figma_figma__');
  const listed = parseMcpList('plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ✓ Connected\nclaude.ai Figma: https://mcp.figma.com/mcp - ✓ Connected\nfigma: https://mcp.figma.com/mcp (HTTP) - ✓ Connected');
  assert.deepEqual(listed.map(s => s.name), ['plugin:figma:figma', 'claude.ai Figma', 'figma']);

  const cov = matcherCoverage(repo, [...KNOWN_FIGMA_PREFIXES, 'mcp__design__']);
  assert.deepEqual(cov.problems, [], 'use_figma is covered for every prefix, including a server name without "figma"');
  // the v1.7 matcher missed the capitalised claude.ai connector
  const old = tmpRoot();
  writeJ(path.join(old, '.claude', 'settings.json'), { hooks: Object.fromEntries(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].map(e => [e, [{ matcher: 'mcp__.*figma.*__(use_figma|create_new_file|upload_assets)', hooks: [{ type: 'command', command: `node scripts/hooks/${e === 'PreToolUse' ? 'pre' : 'post'}-figma-call.mjs` }] }]])) });
  assert.ok(matcherCoverage(old).problems.some(p => /mcp__claude_ai_Figma__use_figma/.test(p)));
});

// ---------------- §20 automation: schema hints and skeletons ----------------
test('v1.8 §20: schema errors show the correct format; every artifact skeleton validates', () => {
  for (const c of CONTRACTS) assert.deepEqual(validateSchema(c, skeleton(c, 'ui-20261003-001', { now: NOW })), [], c);
  const brief = skeleton('brief', 'ui-20261003-001');
  assert.deepEqual(validateSchema('brief', { ...brief, ...EXAMPLES.brief }), []);
  assert.match(validateSchema('brief', { ...brief, viewports: ['390x844'] }).join('\n'), /viewports\/0 must be object — hint: each viewport is an object, e\.g\. \{"name":"mobile","width":390/);
  const caps = skeleton('capabilities', 'ui-20261003-001', { now: NOW });
  assert.deepEqual(validateSchema('capabilities', { ...caps, ...EXAMPLES.capabilities }), [], 'environmentDiagnosis.note is accepted');
  assert.match(validateSchema('capabilities', { ...caps, limits: { useFigmaReturnBytes: 20480 } }).join('\n'), /hint: limits\.useFigmaReturnBytes .* are objects, e\.g\. \{"status":"verified"/);
  const plan = skeleton('plan', 'ui-20261003-001');
  assert.deepEqual(validateSchema('plan', { ...plan, designDecisions: [EXAMPLES.plan.designDecisionSkippedByUser], decisions: [EXAMPLES.plan.scopeDecision], undefinedBehaviors: [EXAMPLES.plan.undefinedBehavior] }), []);
  // evidence toolRef: the read operationId goes into "operation"
  const dir = copyM1({ audit: a => { a.evidence[0].toolRef = { ...a.evidence[0].toolRef, readOperationId: 'rd-0006' }; } });
  assert.match(validateRun(dir).schemaErrors.join('\n'), /toolRef must NOT have additional properties \(readOperationId\) — hint: toolRef is \{"tool":"mcp__figma__use_figma","operation":"rd-0006"/);
  // CLI: --write never overwrites an artifact
  const root = tmpRoot();
  const cli = args => spawnSync(process.execPath, [path.join(repo, 'scripts', 'artifact-skeleton.mjs'), ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });
  assert.equal(cli(['plan', 'ui-20261003-001', '--write']).status, 0);
  assert.ok(fs.existsSync(path.join(root, 'design-runs', 'ui-20261003-001', 'plan.json')));
  assert.equal(cli(['plan', 'ui-20261003-001', '--write']).status, 1);
});
