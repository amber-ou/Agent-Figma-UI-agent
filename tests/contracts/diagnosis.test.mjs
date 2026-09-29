// On-demand environment diagnosis (v1.6, A06). executionLayer=offline_fixture: the decision logic and
// fingerprint are tested; the real claude CLI is not called. Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decideReuse, digest, environmentFingerprint, checkHooks, readPluginRecord, currentSession, CACHE_VERSION } from '../../scripts/verify-installation.mjs';
import { validateSchema } from '../../scripts/validate-artifacts.mjs';
import { buildCapabilities } from '../../scripts/preflight.mjs';
import { repo, tmpRoot } from '../helpers.mjs';

const fp = (extra = {}) => ({ claudeCodeVersion: '2.1.283', node: 'v22.17.0', os: 'win32-x64', figmaPlugin: { name: 'figma@synced', version: '2.2.118' }, figmaMcp: { name: 'figma', url: 'https://mcp.figma.com/mcp', type: 'http' }, settings: 'aaaa', lockfile: 'bbbb', skill: 'cccc', dependencies: true, ...extra });
const cacheOf = (fingerprint, extra = {}) => ({ version: CACHE_VERSION, fingerprint, fingerprintDigest: digest(fingerprint), sessionId: 'sess-1', report: { problems: [] }, checkedAt: '2026-09-29T10:00:00.000Z', ...extra });
const at = new Date('2026-09-29T10:20:00.000Z');

test('A06: same session and unchanged environment reuses the diagnosis', () => {
  const d = decideReuse(cacheOf(fp()), { fingerprint: fp(), sessionId: 'sess-1', now: at });
  assert.equal(d.reuse, true);
});

test('A06: a new session, any version or config change, or a forced run re-diagnoses', () => {
  assert.match(decideReuse(cacheOf(fp()), { fingerprint: fp(), sessionId: 'sess-2', now: at }).reason, /first diagnosis in this session/);
  assert.match(decideReuse(cacheOf(fp()), { fingerprint: fp({ figmaPlugin: { name: 'figma@synced', version: '2.2.123' } }), sessionId: 'sess-1', now: at }).reason, /environment changed: figmaPlugin/);
  assert.match(decideReuse(cacheOf(fp()), { fingerprint: fp({ claudeCodeVersion: '2.1.290' }), sessionId: 'sess-1', now: at }).reason, /claudeCodeVersion/);
  assert.match(decideReuse(cacheOf(fp()), { fingerprint: fp({ settings: 'changed' }), sessionId: 'sess-1', now: at }).reason, /settings/);
  assert.equal(decideReuse(cacheOf(fp()), { fingerprint: fp(), sessionId: 'sess-1', now: at, force: true }).reuse, false);
});

test('A06: a damaged, unreadable or failing previous diagnosis is never reused', () => {
  assert.match(decideReuse(null, { fingerprint: fp(), sessionId: 'sess-1', now: at }).reason, /no previous diagnosis/);
  assert.match(decideReuse({ version: 0 }, { fingerprint: fp(), sessionId: 'sess-1', now: at }).reason, /unreadable/);
  const damaged = cacheOf(fp());
  damaged.fingerprint.settings = 'edited by hand';
  assert.match(decideReuse(damaged, { fingerprint: fp({ settings: 'edited by hand' }), sessionId: 'sess-1', now: at }).reason, /damaged/);
  assert.match(decideReuse(cacheOf(fp(), { report: { problems: ['Figma MCP server is not connected'] } }), { fingerprint: fp(), sessionId: 'sess-1', now: at }).reason, /found problems/);
  assert.match(decideReuse(cacheOf(fp({ claudeCodeVersion: null })), { fingerprint: fp({ claudeCodeVersion: null }), sessionId: 'sess-1', now: at }).reason, /version unknown/);
});

test('A06: without a session id reuse is limited to a short window', () => {
  const cache = cacheOf(fp(), { sessionId: null });
  assert.equal(decideReuse(cache, { fingerprint: fp(), sessionId: null, now: at, maxAgeMin: 60 }).reuse, true);
  assert.equal(decideReuse(cache, { fingerprint: fp(), sessionId: null, now: new Date('2026-09-29T12:00:00.000Z'), maxAgeMin: 60 }).reuse, false);
});

test('A06: the fingerprint reads Claude Code files without CLI calls; the session comes from the hooks', () => {
  const home = tmpRoot();
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'figma@synced': [{ version: '2.2.118' }] } }));
  assert.deepEqual(readPluginRecord(home), { name: 'figma@synced', version: '2.2.118' });
  const f = environmentFingerprint(repo, { claudeVersion: '2.1.283', home });
  assert.equal(f.figmaPlugin.version, '2.2.118');
  assert.equal(typeof f.settings, 'string');

  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.figma-ui'), { recursive: true });
  fs.writeFileSync(path.join(root, '.figma-ui', 'session.json'), JSON.stringify({ sessionId: 's-9', seenAt: '2026-09-29T10:10:00.000Z' }));
  assert.equal(currentSession(root, at), 's-9');
  assert.equal(currentSession(root, new Date('2026-09-29T11:30:00.000Z')), null, 'an old session record is not trusted');
});

test('A06: the hook check needs the write-path hooks themselves; the logging hook alone does not pass', () => {
  assert.deepEqual(checkHooks(repo), { PreToolUse: true, PostToolUse: true, PostToolUseFailure: true });
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  const log = { matcher: 'mcp__.*figma.*__.*', hooks: [{ type: 'command', command: 'node scripts/hooks/log-figma-call.mjs' }] };
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [], PostToolUse: [log], PostToolUseFailure: [log] } }));
  assert.deepEqual(checkHooks(root), { PreToolUse: false, PostToolUse: false, PostToolUseFailure: false });
});

test('A06: a reused diagnosis never stands in for this run: carried-over (history) results cannot be marked verified', () => {
  const caps = buildCapabilities({
    runId: 'ui-20260929-009', runtime: { claudeCodeVersion: '2.1.283' }, server: { name: 'figma', url: 'https://mcp.figma.com/mcp', toolPrefix: 'mcp__figma__' }, tools: ['mcp__figma__use_figma'],
    features: { resolveForConsumer: { status: 'verified', evidence: ['M1 probe-05'], basis: 'history' } },
  });
  caps.environmentDiagnosis = { mode: 'reused', checkedAt: '2026-09-29T10:20:00.000Z', cachedAt: '2026-09-29T10:00:00.000Z' };
  assert.ok(validateSchema('capabilities', caps).some(e => /features\/resolveForConsumer/.test(e)), 'history cannot be verified');
  caps.features.resolveForConsumer = { status: 'available_unverified', basis: 'history', notes: 'verified in M1; not called in this run' };
  assert.deepEqual(validateSchema('capabilities', caps), []);
});
