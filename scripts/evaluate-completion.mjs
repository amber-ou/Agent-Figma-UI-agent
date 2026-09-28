#!/usr/bin/env node
// Minimal implementation of the single completion rule (spec §12.1), used for M1.
// M2 will add JSON Schema validation and the full cross-file checks of spec §20.
// Usage: node scripts/evaluate-completion.mjs <runDir> [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULE_VERSION = '12.1@1.2-m1min';
const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const ALWAYS_PASS = new Set(['G1', 'G2', 'G6', 'G7']);
const UNRESOLVED_OPS = new Set(['dispatched', 'unknown_outcome']);

export function evaluateCompletion(plan, audit, ledger, now = new Date().toISOString()) {
  const reasons = [];
  let blockedBy = null; // 'awaiting_user' | 'blocked' | 'partial'
  const flag = (reason, kind) => {
    reasons.push(reason);
    const rank = { partial: 1, awaiting_user: 2, blocked: 3 };
    if (!blockedBy || rank[kind] > rank[blockedBy]) blockedBy = kind;
  };

  // 1. confirmed plan, applicable cells, current evidence of the required kinds
  if (plan.status !== 'confirmed') flag('plan not confirmed', 'awaiting_user');
  const cells = plan.requiredCells || [];
  const applicable = cells.filter(c => c.applicable);
  if (applicable.length === 0) flag('no applicable requiredCells: scope invalid', 'awaiting_user');
  for (const c of cells) if (!c.applicable && !c.reason) flag(`cell ${c.key}: not applicable without reason`, 'partial');
  const evidence = new Map((audit.evidence || []).map(e => [e.id, e]));
  let verifiedCells = 0;
  for (const c of applicable) {
    const current = (audit.evidence || []).filter(e => e.screenKey === c.screenKey && e.validity === 'current');
    const missing = (c.evidence || []).filter(kind => !current.some(e => e.kind === kind && (e.toolRef || e.artifactRef)));
    if (missing.length) flag(`cell ${c.key}: missing current evidence ${missing.join(', ')}`, 'partial');
    else verifiedCells++;
  }

  // 2. G1–G7 exactly once each; G1/G2/G6/G7 must pass; G3–G5 pass or not_applicable
  const gates = audit.gates || [];
  for (const id of GATES) {
    const found = gates.filter(g => g.id === id);
    if (found.length !== 1) { flag(`${id}: expected exactly one gate result, found ${found.length}`, 'partial'); continue; }
    const g = found[0];
    const ok = g.status === 'pass' || (!ALWAYS_PASS.has(id) && g.status === 'not_applicable' && g.planRef);
    if (!ok) flag(`${id} ${g.status}${g.note ? `: ${g.note}` : ''}`, id === 'G7' ? 'awaiting_user' : 'partial');
  }
  for (const g of gates) for (const ref of g.evidenceRefs || []) if (!evidence.has(ref)) flag(`${g.id}: dangling evidenceRef ${ref}`, 'partial');

  // 3. (G7) ledger: no pending questions or unresolved operations
  if ((ledger.pendingQuestions || []).length) flag(`pending questions: ${ledger.pendingQuestions.map(q => q.id || q).join(', ')}`, 'awaiting_user');
  const pendingOps = (ledger.pendingOperations || []).filter(o => UNRESOLVED_OPS.has(o.status));
  if (pendingOps.length) flag(`unresolved operations: ${pendingOps.map(o => `${o.operationId}=${o.status}`).join(', ')}`, 'blocked');

  // 4. design tasks: no open critical/major finding affecting delivery
  if (plan.taskType !== 'audit') {
    for (const f of audit.findings || []) {
      if (f.status === 'open' && ['critical', 'major'].includes(f.severity) && f.affectsDelivery !== false) flag(`finding ${f.id} (${f.severity}) open`, 'partial');
      if (f.status === 'accepted' && !f.decisionRef) flag(`finding ${f.id} accepted without decisionRef`, 'partial');
    }
  }

  // 5. exceptions need decisionRef
  const exceptions = audit.acceptedExceptions || [];
  for (const e of exceptions) if (!e.decisionRef) flag(`exception ${e.id || '?'} without decisionRef`, 'partial');

  const eligible = reasons.length === 0;
  return {
    ruleVersion: RULE_VERSION,
    eligible,
    result: eligible ? (exceptions.length ? 'complete_with_exceptions' : 'complete') : blockedBy,
    coverage: { applicable: applicable.length, verified: verifiedCells },
    reasons,
    evaluatedAt: now,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: evaluate-completion.mjs <runDir> [--write]'); process.exit(2); }
  const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const plan = read('plan.json'), audit = read('audit.json'), ledger = read('ledger.json');
  const result = evaluateCompletion(plan, audit, ledger);
  if (process.argv.includes('--write')) {
    audit.completionEvaluation = result;
    ledger.status = result.result;
    ledger.completionEvaluatedAt = result.evaluatedAt;
    for (const [file, obj] of [['audit.json', audit], ['ledger.json', ledger]]) {
      const tmp = path.join(dir, file + '.tmp');
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, path.join(dir, file));
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
