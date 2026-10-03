#!/usr/bin/env node
// Installation diagnosis (spec §4.2, v1.6 §5.1 / A06): Claude Code version, the Figma MCP server
// entry, the Figma plugin version, the project hooks, the skill and the dependencies. It cannot list
// MCP tool names (only the running session can); the skill records those in capabilities.json.
//
// On demand (A06): the full diagnosis (claude mcp list / plugin list) runs on the first run of a
// session, after an environment change, after a failure, or with --force. Otherwise the last good
// diagnosis is reused. Reuse is keyed by observable facts only: the Claude Code session id seen by
// the hooks, the Claude Code / Node / OS versions, the Figma plugin and MCP config as recorded in
// Claude Code's own files, and hashes of the project settings, lockfile and skill. Anything missing,
// changed or unreadable → full diagnosis. Without a session id reuse is limited to a short window.
// A reused diagnosis never replaces this run's own checks (whoami, target file access, tool
// availability, write authorisation) — those are done for every run.
//
// v1.8: the Figma plugin version is compared with the latest official one (§4.2.2; never blocks), the
// Figma connections are listed with their tool prefixes and the hook matchers are checked against
// every prefix (§4.2.3).
//
// Usage: node scripts/verify-installation.mjs [--force] [--offline]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, atomicWriteJson, nowIso } from './state-store.mjs';
import { stateDir, readJson } from './hooks/lib.mjs';

export const CACHE_VERSION = 1;
export const SESSION_FRESH_MIN = 30; // session.json older than this is not trusted as "this session"
export const NO_SESSION_MAX_AGE_MIN = Number(process.env.FIGMA_UI_DIAG_MAX_AGE_MIN || 60);

function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}` || String(err.message) };
  }
}

// v1.8: server names may contain ":" and spaces (plugin:figma:figma, claude.ai Figma); the name ends at
// the first ": " followed by the URL.
export function parseMcpList(text) {
  return text.split(/\r?\n/).map(l => l.match(/^(\S.*?):\s+(\S+)(?:\s+\((\w+)\))?\s+-\s+(.*)$/)).filter(Boolean)
    .map(m => ({ name: m[1].trim(), url: m[2], transport: m[3] || null, health: m[4].trim() }));
}

export function parsePluginList(text) {
  const plugins = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^\s*❯\s+(\S+)/);
    if (head) { cur = { name: head[1] }; plugins.push(cur); continue; }
    const kv = line.match(/^\s+(Version|Status):\s+(.*)$/);
    if (cur && kv) cur[kv[1].toLowerCase()] = kv[2].trim();
  }
  return plugins;
}

// v1.8 §4.2.3: tool-name prefix Claude Code gives an MCP server: mcp__<name>__ with every character
// outside [A-Za-z0-9_-] replaced by "_". Measured for manual servers (figma → mcp__figma__) and
// claude.ai connectors (claude.ai Notion → mcp__claude_ai_Notion__); the plugin form
// (plugin:figma:figma → mcp__plugin_figma_figma__) is an assumption until seen in a session.
export const toolPrefixFor = serverName => `mcp__${String(serverName).replace(/[^A-Za-z0-9_-]/g, '_')}__`;
// Prefixes a Figma connection can have on this machine; checked against the hook matchers even when
// the connection is not configured now (a plugin added later must still be guarded).
export const KNOWN_FIGMA_PREFIXES = ['mcp__figma__', 'mcp__plugin_figma_figma__', 'mcp__claude_ai_Figma__', 'mcp__plugin_design_figma__'];
const WRITE_PATH_TOOLS = ['use_figma', 'create_new_file', 'upload_assets'];

// Does each write-path hook (and the logging hook) match <prefix><tool> for every prefix? Matchers are
// tested anchored (the stricter reading). use_figma not covered is a problem; the other write tools
// are only blocked by the hook during an active run, so a gap there is reported as a notice.
export function matcherCoverage(root, prefixes = KNOWN_FIGMA_PREFIXES) {
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const res = { problems: [], notices: [], checked: [...new Set(prefixes)] };
  const matchers = (event, script) => (settings.hooks?.[event] || []).filter(h => h.hooks?.some(x => script.test(x.command))).map(h => h.matcher || '');
  const covers = (list, name) => list.some(m => { try { return new RegExp(`^(?:${m})$`).test(name); } catch { return false; } });
  for (const [event, script] of [['PreToolUse', /pre-figma-call\.mjs/], ['PostToolUse', /post-figma-call\.mjs/], ['PostToolUseFailure', /post-figma-call\.mjs/]]) {
    const list = matchers(event, script);
    for (const p of res.checked) for (const t of WRITE_PATH_TOOLS) {
      if (covers(list, p + t)) continue;
      (t === 'use_figma' ? res.problems : res.notices).push(`${event} hook matcher does not cover ${p}${t}`);
    }
  }
  const log = matchers('PostToolUse', /log-figma-call\.mjs/);
  for (const p of res.checked) if (!covers(log, `${p}get_metadata`)) res.notices.push(`logging hook does not cover ${p}* (metrics only)`);
  return res;
}

// v1.8 §4.2.2: the latest official plugin version is the "version" of .claude-plugin/plugin.json in
// figma/mcp-server-guide (main branch; read 2.2.126 on 2026-10-03).
export const LATEST_PLUGIN_URL = process.env.FIGMA_UI_PLUGIN_LATEST_URL || 'https://raw.githubusercontent.com/figma/mcp-server-guide/main/.claude-plugin/plugin.json';

export function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  return 0;
}

// Pure: the version check result recorded in capabilities.server.pluginVersion.
export function pluginVersionStatus({ name = null, installed = null, latest = null, checkedAt = nowIso(), source = LATEST_PLUGIN_URL, latestError = null } = {}) {
  const synced = /@synced$/.test(name || '');
  const status = !installed ? 'not_installed' : !latest ? 'latest_unknown' : compareVersions(installed, latest) < 0 ? 'outdated' : 'current';
  const note = status === 'latest_unknown' ? `無法確認是否為最新版${latestError ? `（${latestError}）` : ''}；不擋 run`
    : status === 'outdated' && synced ? 'plugin 由 claude.ai 帳號同步（@synced），本機不一定能自行升級' : undefined;
  return { name, installed, latest, status, checkedAt, synced, source, ...(note ? { note } : {}) };
}

export async function fetchLatestPluginVersion({ url = LATEST_PLUGIN_URL, timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { latest: null, error: `HTTP ${res.status}` };
    const doc = await res.json();
    return typeof doc?.version === 'string' ? { latest: doc.version } : { latest: null, error: 'plugin.json has no version' };
  } catch (err) {
    return { latest: null, error: err?.name === 'TimeoutError' ? 'timeout' : String(err?.message || err) };
  }
}

// Each write-path hook must be present (the logging-only hook does not count).
export function checkHooks(root) {
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const script = { PreToolUse: /pre-figma-call\.mjs/, PostToolUse: /post-figma-call\.mjs/, PostToolUseFailure: /post-figma-call\.mjs/ };
  return Object.fromEntries(Object.entries(script).map(([e, re]) => [e, (settings.hooks?.[e] || []).some(h => /figma/.test(h.matcher || '') && h.hooks.some(x => re.test(x.command)))]));
}

const sha = file => {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16); } catch { return null; }
};

// Figma plugin version as Claude Code records it (no CLI call); null when the file is not there.
export function readPluginRecord(home = os.homedir()) {
  const doc = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (!doc) return null;
  const entries = doc.plugins && typeof doc.plugins === 'object' ? doc.plugins : doc;
  for (const [name, v] of Object.entries(entries)) {
    if (!/^figma@/.test(name)) continue;
    const rec = Array.isArray(v) ? v[0] : v;
    // v1.8 §4.2.2: the plugin directory's own .claude-plugin/plugin.json wins when it can be read
    const own = rec?.installPath ? readJson(path.join(rec.installPath, '.claude-plugin', 'plugin.json')) : null;
    return { name, version: own?.version ?? rec?.version ?? null };
  }
  return { name: null, version: null };
}

// MCP server config for figma as written in Claude Code's config files (user and project scope).
export function readMcpRecord(root, home = os.homedir()) {
  const pick = doc => {
    const s = doc?.mcpServers || {};
    const hit = Object.entries(s).find(([n, v]) => /figma/i.test(n + (v?.url || '')));
    return hit ? { name: hit[0], url: hit[1]?.url ?? null, type: hit[1]?.type ?? null } : null;
  };
  const user = readJson(path.join(home, '.claude.json'));
  const projectScoped = user?.projects?.[root] ? pick(user.projects[root]) : null;
  return pick(readJson(path.join(root, '.mcp.json'))) || projectScoped || pick(user) || null;
}

// Cheap, observable facts. claudeCodeVersion is the only CLI call (`claude --version`).
export function environmentFingerprint(root, { claudeVersion, home = os.homedir() } = {}) {
  return {
    claudeCodeVersion: claudeVersion ?? null,
    node: process.version,
    os: `${process.platform}-${process.arch}`,
    figmaPlugin: readPluginRecord(home),
    figmaMcp: readMcpRecord(root, home),
    settings: sha(path.join(root, '.claude', 'settings.json')),
    lockfile: sha(path.join(root, 'package-lock.json')),
    skill: sha(path.join(root, '.claude', 'skills', 'figma-ui', 'SKILL.md')),
    dependencies: fs.existsSync(path.join(root, 'node_modules', 'ajv')),
  };
}

export function digest(fp) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(fp)).digest('hex')}`;
}

// The session id the hooks saw last, if recent enough to be this session.
export function currentSession(root, now = new Date()) {
  const s = readJson(path.join(stateDir(root), 'session.json'));
  if (!s?.sessionId || !s.seenAt) return null;
  return now - new Date(s.seenAt) <= SESSION_FRESH_MIN * 60000 ? s.sessionId : null;
}

// Decide whether the cached diagnosis can be reused. Pure; tested offline.
export function decideReuse(cache, { fingerprint, sessionId, now = new Date(), maxAgeMin = NO_SESSION_MAX_AGE_MIN, force = false }) {
  if (force) return { reuse: false, reason: 'forced (--force)' };
  if (!cache) return { reuse: false, reason: 'no previous diagnosis' };
  if (cache.version !== CACHE_VERSION || !cache.fingerprint || !cache.report || !cache.checkedAt) return { reuse: false, reason: 'previous diagnosis unreadable' };
  if ((cache.report.problems || []).length) return { reuse: false, reason: 'previous diagnosis found problems' };
  if (digest(cache.fingerprint) !== cache.fingerprintDigest) return { reuse: false, reason: 'previous diagnosis damaged (digest mismatch)' };
  const changed = Object.keys({ ...cache.fingerprint, ...fingerprint }).filter(k => JSON.stringify(cache.fingerprint[k] ?? null) !== JSON.stringify(fingerprint[k] ?? null));
  if (changed.length) return { reuse: false, reason: `environment changed: ${changed.join(', ')}` };
  if (!fingerprint.claudeCodeVersion) return { reuse: false, reason: 'Claude Code version unknown' };
  if (sessionId && cache.sessionId === sessionId) return { reuse: true, reason: 'same session and unchanged environment' };
  if (sessionId && cache.sessionId && cache.sessionId !== sessionId) return { reuse: false, reason: 'first diagnosis in this session' };
  const ageMin = (now - new Date(cache.checkedAt)) / 60000;
  if (ageMin <= maxAgeMin) return { reuse: true, reason: `session unknown; unchanged environment diagnosed ${Math.round(ageMin)} min ago (limit ${maxAgeMin})` };
  return { reuse: false, reason: `session unknown and previous diagnosis older than ${maxAgeMin} min` };
}

function fullDiagnosis(root, claudeVersion) {
  const mcp = run('claude', ['mcp', 'list']);
  const plugins = run('claude', ['plugin', 'list']);
  const servers = parseMcpList(mcp.out).filter(s => /figma/i.test(s.name + s.url));
  const figmaPlugin = parsePluginList(plugins.out).find(p => /^figma@/.test(p.name)) || null;
  const report = {
    claudeCodeVersion: claudeVersion,
    node: process.version,
    os: process.platform,
    figmaServers: servers,
    figmaPlugin,
    hooks: checkHooks(root),
    skill: fs.existsSync(path.join(root, '.claude', 'skills', 'figma-ui', 'SKILL.md')),
    dependencies: fs.existsSync(path.join(root, 'node_modules', 'ajv')),
    notes: ['MCP tool names are recorded by the skill from the live session (ToolSearch), not by this script.'],
  };
  const problems = [];
  if (!report.claudeCodeVersion) problems.push('claude CLI not found');
  if (!servers.length) problems.push('no Figma MCP server configured (claude mcp add --transport http figma https://mcp.figma.com/mcp)');
  else if (!servers.some(s => /connected/i.test(s.health))) problems.push('Figma MCP server is not connected; run /mcp and authenticate');
  if (Object.values(report.hooks).some(v => !v)) problems.push('project hooks missing from .claude/settings.json');
  if (!report.dependencies) problems.push('dependencies not installed; run npm install');
  report.problems = problems;
  report.figmaPrefixes = servers.map(s => ({ server: s.name, toolPrefix: toolPrefixFor(s.name), health: s.health }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = projectRoot();
  const cacheFile = path.join(stateDir(root), 'diagnostics.json');
  const version = run('claude', ['--version']);
  const claudeVersion = version.ok ? version.out.trim().split(/\s+/)[0] : null;
  const fingerprint = environmentFingerprint(root, { claudeVersion });
  const sessionId = currentSession(root);
  const cache = readJson(cacheFile);
  const decision = decideReuse(cache, { fingerprint, sessionId, force: process.argv.includes('--force') });
  let report;
  if (decision.reuse) {
    // Local, cheap re-checks still run: they can change without any version change.
    report = { ...cache.report, hooks: checkHooks(root), dependencies: fingerprint.dependencies };
    report.problems = [...(Object.values(report.hooks).some(v => !v) ? ['project hooks missing from .claude/settings.json'] : []), ...(report.dependencies ? [] : ['dependencies not installed; run npm install'])];
    if (report.problems.length) { report = fullDiagnosis(root, claudeVersion); decision.reuse = false; decision.reason = 'local re-check failed; ran the full diagnosis'; }
  } else report = fullDiagnosis(root, claudeVersion);
  // v1.8: checked on every call (also when the diagnosis is reused): the latest version can change
  // without any local change, and the matchers must cover every known and configured prefix.
  const installedPlugin = report.figmaPlugin?.version ? { name: report.figmaPlugin.name, version: report.figmaPlugin.version } : fingerprint.figmaPlugin;
  const latest = process.argv.includes('--offline') ? { latest: null, error: 'offline (--offline)' } : await fetchLatestPluginVersion();
  report.pluginVersion = pluginVersionStatus({ name: installedPlugin?.name ?? null, installed: installedPlugin?.version ?? null, latest: latest.latest, latestError: latest.error });
  const coverage = matcherCoverage(root, [...KNOWN_FIGMA_PREFIXES, ...(report.figmaPrefixes || []).map(p => p.toolPrefix)]);
  report.hookMatcherCoverage = coverage;
  if (coverage.problems.length) report.problems = [...(report.problems || []), ...coverage.problems];
  const pv = report.pluginVersion;
  report.notices = [
    ...(pv.note ? [`Figma plugin: ${pv.note}`] : []),
    ...(pv.status === 'outdated' ? [`Figma plugin ${pv.installed} < latest ${pv.latest}: run-context lists "upgrade first or run on this version" first at Intake`] : []),
    ...coverage.notices,
    ...((report.figmaPrefixes || []).length > 1 ? [`several Figma connections: ${report.figmaPrefixes.map(p => p.toolPrefix).join(', ')}; the user picks one for the run (capabilities.server.toolPrefix)`] : []),
  ];
  const checkedAt = nowIso();
  if (!decision.reuse) atomicWriteJson(cacheFile, { version: CACHE_VERSION, fingerprint, fingerprintDigest: digest(fingerprint), sessionId, report, checkedAt });
  report.diagnosis = {
    mode: decision.reuse ? 'reused' : 'full', reason: decision.reason, checkedAt,
    ...(decision.reuse ? { cachedAt: cache.checkedAt } : {}), fingerprintDigest: digest(fingerprint),
    note: 'Environment diagnosis only. This run still needs whoami, target-file access, tool availability and its own write authorisation.',
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.problems.length ? 1 : 0);
}
