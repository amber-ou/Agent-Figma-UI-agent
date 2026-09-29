// Fixture tests for scripts/hooks (spec §4.5, T19/T39/T40). executionLayer=offline_fixture.
// Run: node --test "tests/**/*.test.mjs"
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRE = path.join(repo, 'scripts', 'hooks', 'pre-figma-call.mjs');
const POST = path.join(repo, 'scripts', 'hooks', 'post-figma-call.mjs');
const TOOL = 'mcp__figma__use_figma';
const OUT_KEY = 'B0FKsPFvTG11Tt1P7ZXxxn';
const OTHER_KEY = 'IBq10PHhCxczFX6hBzQvaC';
const RUN = 'r1';

let root;

function run(script, input) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

function pre(input) {
  const out = run(PRE, { tool_name: TOOL, tool_use_id: 'tu', ...input });
  if (out === '') return { decision: 'pass' };
  const parsed = JSON.parse(out).hookSpecificOutput;
  return { decision: parsed.permissionDecision, reason: parsed.permissionDecisionReason };
}

const call = (op, mode, fileKey = OUT_KEY) => ({ tool_input: { fileKey, code: `// figma-ui run=${RUN} op=${op} mode=${mode}\nreturn 1` } });
const runDir = () => path.join(root, 'design-runs', RUN);
const journal = () => path.join(runDir(), 'operations.jsonl');
const writeJson = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); };
const appendOp = (rec) => fs.appendFileSync(journal(), JSON.stringify(rec) + '\n');
const records = () => fs.readFileSync(journal(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const latest = (id) => records().filter(r => r.operationId === id).reduce((a, r) => ({ ...a, ...r }), null);

function activate() {
  writeJson(path.join(root, '.figma-ui', 'active-run.json'), { runId: RUN, ownerToken: 'tok' });
  fs.mkdirSync(runDir(), { recursive: true });
  fs.writeFileSync(journal(), '');
}
function confirmBrief() {
  writeJson(path.join(runDir(), 'brief.json'), { stage: 'confirmed', output: { fileKey: OUT_KEY, writeAllowed: true, decisionRef: 'dec-000' } });
}
function takeLock() {
  writeJson(path.join(root, '.figma-ui', 'locks', `${OUT_KEY}.json`), { runId: RUN, ownerToken: 'tok' });
}
function ready() { activate(); confirmBrief(); takeLock(); }
const planned = (id, extra = {}) => appendOp({ operationId: id, runId: RUN, mode: 'write', fileKey: OUT_KEY, status: 'planned', basisRefs: ['dec-001'], ...extra });

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-ui-hooks-')); });

// ---- Fix 1: passing never emits permissionDecision "allow" ----
test('pass emits no decision output (no active run, read, planned write)', () => {
  assert.deepEqual(pre(call('x', 'write')), { decision: 'pass' }, 'no active run');
  ready();
  assert.deepEqual(pre(call('rd-1', 'read')), { decision: 'pass' }, 'read');
  planned('op-1');
  assert.deepEqual(pre(call('op-1', 'write')), { decision: 'pass' }, 'planned write');
  const src = fs.readFileSync(PRE, 'utf8');
  assert.ok(!/permissionDecision:\s*['"]allow['"]/.test(src), 'source must not emit allow');
});

// ---- Fix 2: read must not reuse a write operationId ----
test('read reusing a write operationId is denied and does not clear unknown_outcome', () => {
  ready();
  planned('op-1');
  assert.equal(pre(call('op-1', 'write')).decision, 'pass');
  run(POST, { hook_event_name: 'PostToolUseFailure', tool_name: TOOL, tool_use_id: 'tu', error: 'timeout', ...call('op-1', 'write') });
  assert.equal(latest('op-1').status, 'unknown_outcome');

  const r = pre(call('op-1', 'read'));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /belongs to a write operation/);
  assert.equal(latest('op-1').status, 'unknown_outcome', 'status must stay unknown_outcome');
  assert.equal(latest('op-1').mode, 'write');

  // A distinct read id is still allowed for reconciliation.
  assert.equal(pre(call('rd-reconcile', 'read')).decision, 'pass');
});

// ---- Fix 3: planned record must be a write for the authorized fileKey; dispatched carries mode+fileKey ----
test('planned record with mode!=write or foreign fileKey is denied; dispatched records mode and fileKey', () => {
  ready();
  planned('op-read', { mode: 'read' });
  let r = pre(call('op-read', 'write'));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /must have mode=write/);

  planned('op-other', { fileKey: OTHER_KEY });
  r = pre(call('op-other', 'write'));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /must have mode=write and fileKey=/);

  planned('op-ok');
  assert.equal(pre(call('op-ok', 'write')).decision, 'pass');
  const dispatched = records().filter(x => x.operationId === 'op-ok' && x.status === 'dispatched');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].mode, 'write');
  assert.equal(dispatched[0].fileKey, OUT_KEY);
});

// ---- Previously smoke-tested behaviour, kept as regression tests ----
test('active run: missing header, wrong run, non-use_figma tool are denied', () => {
  activate();
  assert.equal(pre({ tool_input: { fileKey: OUT_KEY, code: 'return 1' } }).decision, 'deny');
  assert.equal(pre({ tool_input: { fileKey: OUT_KEY, code: '// figma-ui run=other op=a mode=read\n' } }).decision, 'deny');
  assert.equal(pre({ tool_name: 'mcp__figma__upload_assets', tool_input: { fileKey: OUT_KEY } }).decision, 'deny');
});

test('write gates: unconfirmed brief, wrong fileKey, missing lock, not planned, empty basisRefs', () => {
  activate();
  assert.match(pre(call('op-1', 'write')).reason, /not confirmed/);
  confirmBrief();
  assert.match(pre(call('op-1', 'write', OTHER_KEY)).reason, /not the authorized output/);
  assert.match(pre(call('op-1', 'write')).reason, /lock/);
  takeLock();
  assert.match(pre(call('op-1', 'write')).reason, /status=planned/);
  planned('op-1', { basisRefs: [] });
  assert.match(pre(call('op-1', 'write')).reason, /basisRefs/);
});

test('dispatched or unknown_outcome write blocks further writes on the file (T19/T40)', () => {
  ready();
  planned('op-1'); planned('op-2');
  assert.equal(pre(call('op-1', 'write')).decision, 'pass');
  assert.match(pre(call('op-2', 'write')).reason, /op-1=dispatched/);
  run(POST, { hook_event_name: 'PostToolUseFailure', tool_name: TOOL, tool_use_id: 'tu', error: 'timeout', ...call('op-1', 'write') });
  assert.match(pre(call('op-2', 'write')).reason, /op-1=unknown_outcome/);
});

test('post: success -> applied; failure with safeToRetryWithoutCanvasRead=true -> failed_known', () => {
  ready();
  planned('op-1'); planned('op-2');
  pre(call('op-1', 'write'));
  run(POST, { hook_event_name: 'PostToolUse', tool_name: TOOL, tool_use_id: 'tu', tool_response: { ok: true }, ...call('op-1', 'write') });
  assert.equal(latest('op-1').status, 'applied');
  pre(call('op-2', 'write'));
  run(POST, { hook_event_name: 'PostToolUseFailure', tool_name: TOOL, tool_use_id: 'tu', error: '{"safeToRetryWithoutCanvasRead": true}', ...call('op-2', 'write') });
  assert.equal(latest('op-2').status, 'failed_known');
  assert.equal(latest('op-2').safeToRetryWithoutCanvasRead, true);
});

test('truncated journal tail blocks writes but still passes reads', () => {
  ready();
  planned('op-1');
  fs.appendFileSync(journal(), '{"operationId":"x","sta');
  assert.match(pre(call('op-1', 'write')).reason, /truncated last line/);
  assert.equal(pre(call('rd-1', 'read')).decision, 'pass');
});

// ---- v1.3 / M2 ----
test('T44: every pass path (no active run, read, planned write) emits no permission decision; only deny emits one', () => {
  const quiet = input => run(PRE, { tool_name: TOOL, tool_use_id: 'tu', ...input });
  assert.equal(quiet(call('x', 'write')), '', 'no active run');
  ready();
  assert.equal(quiet(call('rd-1', 'read')), '', 'read');
  planned('op-1');
  assert.equal(quiet(call('op-1', 'write')), '', 'planned write');
  const denied = JSON.parse(quiet(call('op-2', 'write'))).hookSpecificOutput;
  assert.equal(denied.permissionDecision, 'deny');
});

test('a truncated write response ("// truncated to 20kb") is recorded as unknown_outcome, a truncated read stays applied', () => {
  ready();
  planned('op-1');
  pre(call('op-1', 'write'));
  run(POST, { hook_event_name: 'PostToolUse', tool_name: TOOL, tool_use_id: 'tu', tool_response: [{ type: 'text', text: '{"createdNodeIds":["1:2","1:3"... // truncated to 20kb' }], ...call('op-1', 'write') });
  assert.equal(latest('op-1').status, 'unknown_outcome');
  assert.equal(latest('op-1').effectSummary.responseTruncated, true);
  pre(call('rd-9', 'read'));
  run(POST, { hook_event_name: 'PostToolUse', tool_name: TOOL, tool_use_id: 'tu', tool_response: 'xxxx// truncated to 20kb', ...call('rd-9', 'read') });
  assert.equal(latest('rd-9').status, 'applied');
});

test('T51: a truncated write response becomes unknown_outcome and blocks the next write on the file until reconciled; reads still pass', () => {
  ready();
  planned('op-1');
  planned('op-2');
  assert.equal(pre(call('op-1', 'write')).decision, 'pass');
  run(POST, { hook_event_name: 'PostToolUse', tool_name: TOOL, tool_use_id: 'tu', tool_response: [{ type: 'text', text: '{"createdNodeIds":["1:2"... // truncated to 20kb' }], ...call('op-1', 'write') });
  assert.equal(latest('op-1').status, 'unknown_outcome');
  const blocked = pre(call('op-2', 'write'));
  assert.equal(blocked.decision, 'deny');
  assert.match(blocked.reason, /op-1=unknown_outcome; reconcile first/);
  assert.equal(latest('op-2').status, 'planned', 'the blocked write was never dispatched');
  assert.equal(pre(call('rd-1', 'read')).decision, 'pass', 'read-only reconciliation stays possible');
});

// ---- M3: PostToolUseFailure event log records field values, not only keys ----
test('post failure log records isInterrupt, errorType and the first 500 chars of error', () => {
  ready();
  const events = () => fs.readFileSync(path.join(root, '.figma-ui', 'hook-events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  run(POST, { hook_event_name: 'PostToolUseFailure', tool_name: TOOL, tool_use_id: 'tu', error: 'x'.repeat(800), is_interrupt: false, ...call('rd-1', 'read') });
  let e = events().at(-1);
  assert.equal(e.event, 'PostToolUseFailure');
  assert.equal(e.isInterrupt, false);
  assert.equal(e.errorType, 'string');
  assert.equal(e.errorHead.length, 500);
  run(POST, { hook_event_name: 'PostToolUseFailure', tool_name: TOOL, tool_use_id: 'tu', error: { message: 'boom' }, ...call('rd-2', 'read') });
  e = events().at(-1);
  assert.equal(e.isInterrupt, null);
  assert.equal(e.errorType, 'object');
  assert.equal(e.errorHead, '{"message":"boom"}');
  run(POST, { hook_event_name: 'PostToolUse', tool_name: TOOL, tool_use_id: 'tu', tool_response: 'ok', ...call('rd-3', 'read') });
  e = events().at(-1);
  assert.ok(!('errorHead' in e) && !('isInterrupt' in e), 'success events stay unchanged');
});

// ---- v1.6 (A06/A07): logging-only hook for every Figma tool ----
const LOG = path.join(repo, 'scripts', 'hooks', 'log-figma-call.mjs');
test('log hook records the session and non-write-path Figma calls (duration, category) without content, and never double-logs use_figma', () => {
  ready();
  const events = () => fs.readFileSync(path.join(root, '.figma-ui', 'hook-events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(run(LOG, { hook_event_name: 'PostToolUse', tool_name: 'mcp__figma__get_screenshot', tool_use_id: 't1', session_id: 'sess-7', duration_ms: 1300, tool_input: { nodeId: '1:2' }, tool_response: [{ type: 'image', data: 'AAAA' }] }), '', 'never emits a decision');
  const e = events().at(-1);
  assert.deepEqual([e.toolName, e.category, e.durationMs, e.sessionId, e.activeRun], ['mcp__figma__get_screenshot', 'screenshot', 1300, 'sess-7', RUN]);
  assert.ok(!JSON.stringify(e).includes('AAAA') && !JSON.stringify(e).includes('1:2'), 'no tool input or response content is stored');
  const session = JSON.parse(fs.readFileSync(path.join(root, '.figma-ui', 'session.json'), 'utf8'));
  assert.equal(session.sessionId, 'sess-7');
  const before = events().length;
  run(LOG, { hook_event_name: 'PostToolUse', tool_name: TOOL, tool_use_id: 't2', session_id: 'sess-7', duration_ms: 50, ...call('rd-1', 'read') });
  assert.equal(events().length, before, 'use_figma is logged by post-figma-call.mjs only');
  run(POST, { hook_event_name: 'PostToolUse', tool_name: TOOL, tool_use_id: 't2', session_id: 'sess-7', duration_ms: 50, tool_response: 'x // truncated to 20kb', ...call('rd-1', 'read') });
  const p = events().at(-1);
  assert.deepEqual([p.durationMs, p.sessionId, p.truncatedResponse], [50, 'sess-7', true]);
});
