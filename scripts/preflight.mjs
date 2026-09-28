#!/usr/bin/env node
// Preflight (spec §4.2.1, §5.1): account / seat diagnosis and the capabilities snapshot.
// Input is the JSON returned by the Figma `whoami` tool; email and handle are never stored (CAP-03).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDirFor } from './hooks/lib.mjs';
import { atomicWriteJson, projectRoot, nowIso } from './state-store.mjs';

export const RECOVERY_STEPS = [
  'In Claude Code run /mcp, choose figma, then Clear authentication.',
  'In your default browser (or a private window) confirm figma.com is signed in as the account that owns the target files.',
  'Run /mcp, choose figma, Authenticate, and check the account on the consent page before allowing.',
  'If the old account comes back, restart Claude Code (claude --continue); if needed run claude mcp remove figma and add it again.',
  'Optional: copy the authorization URL from the terminal into a private window that is signed in only as the right account (the callback is localhost).',
  'After authorizing, run whoami again; the account is not considered switched until whoami shows it.',
];

// requireWrite: extend/modify tasks need a Full seat on the plan that owns the target file.
export function diagnoseAccount(whoami, { requireWrite = true, targetPlanRef = null, accessDenied = false } = {}) {
  const plans = (whoami?.plans || []).map(p => ({ planRef: p.key, tier: p.tier, seat: p.seat, role: p.role }));
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

// Build capabilities.json from facts gathered in the session. Tool statuses start as
// available_unverified; only calls that actually succeeded become verified (CAP-02).
export function buildCapabilities({ runId, runtime, server, account, tools = [], verifiedTools = {}, features = {}, limits = {}, unverified = [] }) {
  return {
    schemaVersion: '1.2',
    runId,
    runtime,
    server,
    ...(account ? { account } : {}),
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
    const result = diagnoseAccount(JSON.parse(fs.readFileSync(a, 'utf8')), { targetPlanRef: b || null });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'ok' ? 0 : 1);
  } else if (cmd === 'write-capabilities') {
    // node scripts/preflight.mjs write-capabilities <run-id> <facts.json>
    const facts = JSON.parse(fs.readFileSync(b, 'utf8'));
    const file = path.join(runDirFor(projectRoot(), a), 'capabilities.json');
    const caps = buildCapabilities({ runId: a, ...facts });
    atomicWriteJson(file, caps);
    console.log(JSON.stringify({ written: file, tools: caps.tools.length }, null, 2));
  } else {
    console.error('usage: preflight.mjs diagnose <whoami.json> [targetPlanRef] | write-capabilities <run-id> <facts.json>');
    process.exit(2);
  }
}

