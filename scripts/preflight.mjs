#!/usr/bin/env node
// Preflight (spec §4.2.1, §5.1): account / seat diagnosis and the capabilities snapshot.
// Input is the JSON returned by the Figma `whoami` tool; email and handle are never stored (CAP-03).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDirFor, stateDir, readJson } from './hooks/lib.mjs';
import { validateSchema, SKELETON_HINT } from './validate-artifacts.mjs';
import { atomicWriteJson, projectRoot, nowIso } from './state-store.mjs';

export const RECOVERY_STEPS = [
  'In Claude Code run /mcp, choose figma, then Clear authentication.',
  'In your default browser (or a private window) confirm figma.com is signed in as the account that owns the target files.',
  'Run /mcp, choose figma, Authenticate, and check the account on the consent page before allowing.',
  'If the old account comes back, restart Claude Code (claude --continue); if needed run claude mcp remove figma and add it again.',
  'Optional: copy the authorization URL from the terminal into a private window that is signed in only as the right account (the callback is localhost).',
  'After authorizing, run whoami again; the account is not considered switched until whoami shows it.',
];

// v1.8 (§20, T75): accept the whoami response as the tool returned it and as a flat object. Recognised:
// {plans:[…]}, an outer wrapper ({whoami:{…}}, {result:{…}}, {data:{…}}), MCP content
// ([{type:"text",text:"{…}"}] or {content:[…]}) and a JSON string of any of these. Returns null when
// no plans array can be found, so a format problem is never reported as an account problem.
export function normalizeWhoami(raw, depth = 0) {
  if (depth > 4 || raw == null) return null;
  if (typeof raw === 'string') { try { return normalizeWhoami(JSON.parse(raw), depth + 1); } catch { return null; } }
  if (Array.isArray(raw)) {
    for (const item of raw) { const hit = normalizeWhoami(item?.type === 'text' ? item.text : item, depth + 1); if (hit) return hit; }
    return null;
  }
  if (typeof raw !== 'object') return null;
  if (Array.isArray(raw.plans)) return raw;
  for (const k of ['whoami', 'result', 'data', 'structuredContent', 'content', 'response', 'tool_response']) {
    if (raw[k] !== undefined) { const hit = normalizeWhoami(raw[k], depth + 1); if (hit) return hit; }
  }
  return null;
}

// requireWrite: extend/modify tasks need a Full seat on the plan that owns the target file.
export function diagnoseAccount(whoami, { requireWrite = true, targetPlanRef = null, accessDenied = false } = {}) {
  const flat = normalizeWhoami(whoami);
  if (!flat) {
    return { status: 'unrecognized_format', plans: [], targetPlanRef, reasons: ['格式不符：whoami 回應裡找不到 plans 陣列（接受 {plans:[…]}、外層包裝或 MCP text content）；這不是帳號問題，請存原始回應後重跑'], recoverySteps: [], checkedAt: nowIso() };
  }
  const plans = flat.plans.map(p => ({ planRef: p.key ?? p.planRef ?? p.id, tier: p.tier, seat: p.seat, role: p.role }));
  const reasons = [];
  if (!plans.length) reasons.push('whoami returned no plans');
  if (accessDenied) reasons.push('a read of the target file was denied; do not retry reads with this account (quota)');
  const candidates = targetPlanRef ? plans.filter(p => p.planRef === targetPlanRef) : plans;
  if (targetPlanRef && !candidates.length) reasons.push(`the account is not a member of the target plan ${targetPlanRef}`);
  if (requireWrite && candidates.length && !candidates.some(p => p.seat === 'Full')) {
    reasons.push(`no Full seat on ${targetPlanRef ? 'the target plan' : 'any plan'} (seats: ${candidates.map(p => `${p.planRef}=${p.seat}`).join(', ')}); View/Dev seats cannot write`);
  }
  const status = reasons.length ? 'blocked' : 'ok';
  return { status, plans, targetPlanRef, reasons, recoverySteps: status === 'blocked' ? RECOVERY_STEPS : [], checkedAt: nowIso() };
}

// v1.8 §4.2.3: Figma connections visible in the session. Input: the MCP tool names the session can
// see (ToolSearch). A prefix is a Figma connection when it has use_figma or whoami, or its server name
// contains "figma". Returns every prefix and the recommended one (the prefix whose account check
// passed, else the only one). With several prefixes the user confirms which one this run uses.
export const prefixOf = toolName => { const i = String(toolName).lastIndexOf('__'); return i > 4 ? toolName.slice(0, i + 2) : null; };
export function figmaConnections(toolNames = [], { accountOkPrefix = null } = {}) {
  const by = new Map();
  for (const t of toolNames) {
    const p = prefixOf(t);
    if (!p || !p.startsWith('mcp__')) continue;
    if (!by.has(p)) by.set(p, []);
    by.get(p).push(t.slice(p.length));
  }
  const prefixes = [...by.entries()].filter(([p, tools]) => /figma/i.test(p) || tools.includes('use_figma') || tools.includes('whoami')).map(([p, tools]) => ({ prefix: p, tools: tools.length, hasUseFigma: tools.includes('use_figma') }));
  const recommended = accountOkPrefix && prefixes.some(x => x.prefix === accountOkPrefix) ? accountOkPrefix : prefixes.length === 1 ? prefixes[0].prefix : null;
  return { prefixes, recommended, needsUserChoice: prefixes.length > 1, note: prefixes.length > 1 ? 'Several Figma connections: ask the user which one this run uses (prefill the one whose whoami passed); OAuth is separate per connection.' : null };
}

// Build capabilities.json from facts gathered in the session. Tool statuses start as
// available_unverified; only calls that actually succeeded become verified (CAP-02).
// v1.6 (A06): environmentDiagnosis is the (possibly reused) installation diagnosis; it is kept apart
// from this run's own facts — account (whoami), target file access and tool calls — which are
// checked for every run. Features carried over from earlier runs use basis=history and stay
// available_unverified.
// v1.8: server.pluginVersion (§4.2.2) comes from the facts or, when absent, from the last installation
// diagnosis; server.toolPrefix (§4.2.3) is the connection this run uses.
export function buildCapabilities({ runId, runtime, server, account, tools = [], verifiedTools = {}, features = {}, limits = {}, unverified = [], environmentDiagnosis, pluginVersion }) {
  const pv = server?.pluginVersion || pluginVersion;
  return {
    schemaVersion: '1.2',
    runId,
    runtime,
    server: { ...server, ...(pv ? { pluginVersion: pv } : {}) },
    ...(account ? { account } : {}),
    ...(environmentDiagnosis ? { environmentDiagnosis } : {}),
    tools: tools.map(name => (verifiedTools[name] ? { name, status: 'verified', evidence: verifiedTools[name] } : { name, status: 'available_unverified' })),
    features,
    limits,
    unverified,
    checkedAt: nowIso(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'diagnose') {
    // node scripts/preflight.mjs diagnose <whoami.json> [targetPlanRef]
    // the file may hold the raw tool response or a flat {plans:[…]} (v1.8); exit 3 = format not recognised
    const result = diagnoseAccount(fs.readFileSync(a, 'utf8'), { targetPlanRef: b || null });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'ok' ? 0 : result.status === 'unrecognized_format' ? 3 : 1);
  } else if (cmd === 'connections') {
    // node scripts/preflight.mjs connections <tool-names.json | name,name,…> [accountOkPrefix]
    const names = fs.existsSync(a) ? JSON.parse(fs.readFileSync(a, 'utf8')) : String(a || '').split(',').filter(Boolean);
    console.log(JSON.stringify(figmaConnections(names, { accountOkPrefix: b || null }), null, 2));
  } else if (cmd === 'write-capabilities') {
    // node scripts/preflight.mjs write-capabilities <run-id> <facts.json>
    const facts = JSON.parse(fs.readFileSync(b, 'utf8'));
    const file = path.join(runDirFor(projectRoot(), a), 'capabilities.json');
    const diag = readJson(path.join(stateDir(projectRoot()), 'diagnostics.json'));
    const caps = buildCapabilities({ runId: a, pluginVersion: diag?.report?.pluginVersion, ...facts });
    const errors = validateSchema('capabilities', caps);
    if (errors.length) { console.error(JSON.stringify({ errors, hint: SKELETON_HINT }, null, 2)); process.exit(1); }
    atomicWriteJson(file, caps);
    console.log(JSON.stringify({ written: file, tools: caps.tools.length }, null, 2));
  } else {
    console.error('usage: preflight.mjs diagnose <whoami.json> [targetPlanRef] | connections <tool-names.json|a,b,…> [accountOkPrefix] | write-capabilities <run-id> <facts.json>');
    process.exit(2);
  }
}

