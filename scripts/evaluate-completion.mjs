#!/usr/bin/env node
// The single completion rule (spec §12.1). evaluateRun() first runs the §20 validator
// (JSON Schema + cross-file checks); a run with contract errors can never be complete.
// Usage: node scripts/evaluate-completion.mjs <runDir> [--write]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRun } from './validate-artifacts.mjs';
import { atomicWriteJson } from './state-store.mjs';

export const RULE_VERSION = '12.1@1.2';
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

// Validate the run, then evaluate. Contract errors make the run partial (never complete).
export function evaluateRun(dir, now = new Date().toISOString()) {
  const { schemaErrors, semanticErrors, run } = validateRun(dir);
  const contractErrors = [...schemaErrors.map(e => `schema: ${e}`), ...semanticErrors.map(e => `contract: ${e}`)];
  if (!run.plan || !run.audit || !run.ledger) {
    return { evaluation: { ruleVersion: RULE_VERSION, eligible: false, result: 'partial', reasons: contractErrors.length ? contractErrors : ['plan/audit/ledger missing'], evaluatedAt: now }, run, contractErrors };
  }
  const evaluation = evaluateCompletion(run.plan, run.audit, run.ledger, now);
  if (contractErrors.length) {
    evaluation.reasons = [...contractErrors, ...evaluation.reasons];
    if (evaluation.eligible) { evaluation.eligible = false; evaluation.result = 'partial'; }
  }
  return { evaluation, run, contractErrors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: evaluate-completion.mjs <runDir> [--write]'); process.exit(2); }
  const { evaluation, run } = evaluateRun(dir);
  if (process.argv.includes('--write') && run.audit && run.ledger) {
    run.audit.completionEvaluation = evaluation;
    run.ledger.status = evaluation.result;
    run.ledger.completionEvaluatedAt = evaluation.evaluatedAt;
    run.ledger.updatedAt = evaluation.evaluatedAt;
    atomicWriteJson(path.join(dir, 'audit.json'), run.audit);
    atomicWriteJson(path.join(dir, 'ledger.json'), run.ledger);
  }
  console.log(JSON.stringify(evaluation, null, 2));
}
