#!/usr/bin/env node
// The single completion rule (spec §12.1) and the single final entry point at Handoff. evaluateRun()
// runs the full (final-stage) validator first, so a separate validate-artifacts run on the same data
// is not needed; a run with contract errors can never be complete. The evaluation stores a digest of
// the data it judged; after any change the run must be evaluated again (v1.6, A02).
// Usage: node scripts/evaluate-completion.mjs <runDir> [--write]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRun, validateSchema, decisionStatus, evidenceCoversCell, inputDigest, evaluationIsCurrent } from './validate-artifacts.mjs';
import { atomicWriteJson, nowIso } from './state-store.mjs';

export const RULE_VERSION = '12.1@1.7';
const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const ALWAYS_PASS = new Set(['G1', 'G2', 'G6', 'G7']);
const UNRESOLVED_OPS = new Set(['dispatched', 'unknown_outcome']);

// operations: the journal (latest state per operationId). The journal, not the ledger summary, decides
// whether every write was verified (v1.6, A02).
export function evaluateCompletion(plan, audit, ledger, now = new Date().toISOString(), operations = null) {
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
  // v1.6 (A03): evidence must name the cell (screen × viewport × state × mode); a default screenshot
  // never covers the error state or another viewport. Legacy evidence only counts when unambiguous.
  for (const c of applicable) {
    const current = (audit.evidence || []).filter(e => e.validity === 'current' && evidenceCoversCell(e, c, cells));
    const missing = (c.evidence || []).filter(kind => !current.some(e => e.kind === kind && (e.toolRef || e.artifactRef)));
    if (missing.length) {
      const sameScreen = cells.filter(x => x.applicable && x.screenKey === c.screenKey).length;
      const legacy = (audit.evidence || []).filter(e => e.validity === 'current' && !Array.isArray(e.cellKeys) && e.screenKey === c.screenKey);
      const hint = legacy.length && sameScreen > 1 ? ` (${legacy.map(e => e.id).join(', ')} has no cellKeys and screen ${c.screenKey} has ${sameScreen} cells; add evidence with cellKeys)` : '';
      flag(`cell ${c.key}: missing current evidence ${missing.join(', ')}${hint}`, 'partial');
    } else verifiedCells++;
  }

  // 2. G1–G7 exactly once each; G1/G2/G6/G7 must pass; G3–G5 pass or not_applicable with a plan basis.
  //    v1.7: G5 may also be not_applicable with a policyRef (product contrast policy, §9.5); the
  //    validator checks that the policyRef really makes contrast not applicable for this product.
  const gates = audit.gates || [];
  for (const id of GATES) {
    const found = gates.filter(g => g.id === id);
    if (found.length !== 1) { flag(`${id}: expected exactly one gate result, found ${found.length}`, 'partial'); continue; }
    const g = found[0];
    const ok = g.status === 'pass' || (!ALWAYS_PASS.has(id) && g.status === 'not_applicable' && (g.planRef || (id === 'G5' && g.policyRef)));
    if (!ok) flag(`${id} ${g.status}${g.note ? `: ${g.note}` : ''}`, id === 'G7' ? 'awaiting_user' : 'partial');
  }
  for (const g of gates) for (const ref of g.evidenceRefs || []) if (!evidence.has(ref)) flag(`${g.id}: dangling evidenceRef ${ref}`, 'partial');

  // 3. (G7) ledger: no pending questions or unresolved operations
  if ((ledger.pendingQuestions || []).length) flag(`pending questions: ${ledger.pendingQuestions.map(q => q.id || q).join(', ')}`, 'awaiting_user');
  const pendingOps = (ledger.pendingOperations || []).filter(o => UNRESOLVED_OPS.has(o.status));
  if (pendingOps.length) flag(`unresolved operations: ${pendingOps.map(o => `${o.operationId}=${o.status}`).join(', ')}`, 'blocked');
  // v1.6 (A02): read the journal directly. failed_known (reconciled, no side effect) and cancelled
  // (never sent) need no verification; an applied write must be read back and verified.
  if (operations) {
    const listed = new Set(pendingOps.map(o => o.operationId));
    const writes = operations.filter(o => o.mode === 'write');
    const unresolved = writes.filter(o => UNRESOLVED_OPS.has(o.status) && !listed.has(o.operationId));
    if (unresolved.length) flag(`unresolved writes in the journal: ${unresolved.map(o => `${o.operationId}=${o.status}`).join(', ')} (reconcile read-only first)`, 'blocked');
    const applied = writes.filter(o => o.status === 'applied');
    if (applied.length) flag(`writes applied but not verified: ${applied.map(o => o.operationId).join(', ')} (read back with a separate read operation, then verify)`, 'partial');
    const planned = writes.filter(o => o.status === 'planned');
    if (planned.length) flag(`planned writes neither sent nor cancelled: ${planned.map(o => o.operationId).join(', ')}`, 'partial');
  }
  // v1.6 (A04): an unconfirmed flow or an open flow question is an unanswered question (G7).
  const flow = plan.flow;
  if (flow && flow.status !== 'confirmed') flag('flow not confirmed', 'awaiting_user');
  const openUnknowns = (flow?.unknowns || []).filter(u => u.status === 'open');
  if (openUnknowns.length) flag(`open flow questions: ${openUnknowns.map(u => u.id).join(', ')}`, 'awaiting_user');
  // v1.4 DEC-08: pending and skipped design decisions are unanswered (G7); skipped ones are listed to
  // the user at the end of the run, never decided by the agent.
  const openDecisions = (plan.designDecisions || []).map(d => [d.id, decisionStatus(d)]).filter(([, s]) => s !== 'answered');
  if (openDecisions.length) flag(`unanswered design decisions: ${openDecisions.map(([id, s]) => `${id}=${s}`).join(', ')}`, 'awaiting_user');

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
  const hardFindings = new Set((audit.findings || []).filter(f => f.gate === 'G5').map(f => f.id));
  for (const e of exceptions) if (hardFindings.has(e.findingId)) flag(`exception ${e.id}: G5 finding ${e.findingId} is a hard gate and cannot be excepted`, 'partial');

  // ledger.userAcceptance is deliberately not read here (INVARIANT-17).
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
    return { evaluation: { ruleVersion: RULE_VERSION, eligible: false, result: 'partial', reasons: contractErrors.length ? contractErrors : ['plan/audit/ledger missing'], inputDigest: inputDigest(run), evaluatedAt: now }, run, contractErrors };
  }
  const evaluation = evaluateCompletion(run.plan, run.audit, run.ledger, now, run.operations || []);
  if (contractErrors.length) {
    evaluation.reasons = [...contractErrors, ...evaluation.reasons];
    if (evaluation.eligible) { evaluation.eligible = false; evaluation.result = 'partial'; }
  }
  evaluation.inputDigest = inputDigest(run);
  return { evaluation, run, contractErrors };
}

// Evaluate and store the result: audit.completionEvaluation (with its input digest) and ledger.status.
export function writeEvaluation(dir, now = new Date().toISOString()) {
  const { evaluation, run } = evaluateRun(dir, now);
  if (!run.audit || !run.ledger) throw new Error('audit.json and ledger.json are required to store the evaluation');
  run.audit.completionEvaluation = evaluation;
  run.ledger.status = evaluation.result;
  run.ledger.completionEvaluatedAt = evaluation.evaluatedAt;
  run.ledger.updatedAt = evaluation.evaluatedAt;
  atomicWriteJson(path.join(dir, 'audit.json'), run.audit);
  atomicWriteJson(path.join(dir, 'ledger.json'), run.ledger);
  return evaluation;
}

// §2.3: the user accepts a run that did not pass §12.1 as a test success. Only ledger.userAcceptance is
// written; ledger.status and audit.completionEvaluation stay as evaluated (INVARIANT-17).
export function recordUserAcceptance(dir, { decisionRef, note, now = nowIso() }) {
  const { run } = validateRun(dir);
  const ev = run.audit?.completionEvaluation;
  if (!run.ledger) throw new Error('ledger.json missing');
  if (!ev) throw new Error('run has no completionEvaluation; run evaluate-completion --write first');
  if (ev.eligible) throw new Error(`run already evaluates to ${ev.result}; there is nothing to accept`);
  if (run.ledger.status !== ev.result) throw new Error(`ledger.status ${run.ledger.status} differs from completionEvaluation.result ${ev.result}; re-evaluate first`);
  const fresh = evaluationIsCurrent(run);
  if (!fresh.current) throw new Error(`the stored evaluation is not current: ${fresh.reason}`);
  const known = [...(run.plan?.decisions || []), ...(run.plan?.designDecisions || [])].some(d => d.id === decisionRef);
  if (!known) throw new Error(`decisionRef ${decisionRef} not found in plan decisions; record the user's decision first`);
  const ledger = { ...run.ledger, userAcceptance: { kind: 'test_run', decisionRef, note, acceptedAt: now, evaluationResult: ev.result }, updatedAt: now };
  const errors = validateSchema('ledger', ledger);
  if (errors.length) throw new Error(errors.join('; '));
  atomicWriteJson(path.join(dir, 'ledger.json'), ledger);
  return ledger.userAcceptance;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: evaluate-completion.mjs <runDir> [--write] | <runDir> --accept-test-run <decisionRef> <note...>'); process.exit(2); }
  const acceptAt = process.argv.indexOf('--accept-test-run');
  if (acceptAt > 0) {
    const [decisionRef, ...note] = process.argv.slice(acceptAt + 1);
    try {
      console.log(JSON.stringify(recordUserAcceptance(dir, { decisionRef, note: note.join(' ') }), null, 2));
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }
  const { evaluation, run } = evaluateRun(dir);
  if (process.argv.includes('--write') && run.audit && run.ledger) writeEvaluation(dir, evaluation.evaluatedAt);
  console.log(JSON.stringify(evaluation, null, 2));
}
