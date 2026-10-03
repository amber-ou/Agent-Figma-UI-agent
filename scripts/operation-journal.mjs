#!/usr/bin/env node
// Operation journal (spec §11.3–§11.5). The skill writes `planned` and `verified` here;
// hooks write `dispatched`, `applied`, `failed_known` and `unknown_outcome` automatically.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendJsonl, readJsonl, operationStates, runDirFor } from './hooks/lib.mjs';
import { projectRoot, nowIso, readJson, atomicWriteJson } from './state-store.mjs';
import { validateSchema, loadRun, decisionStatus, validateRun } from './validate-artifacts.mjs';

const journalOf = dir => path.join(dir, 'operations.jsonl');

export function readOperations(dir) {
  const { records, truncatedTail } = readJsonl(journalOf(dir));
  return { ops: operationStates(records), truncatedTail };
}

// Resolve basisRefs against plan/inventory the same way the validator does (DEC-06, INVARIANT-11).
function basisProblems(dir, basisRefs) {
  const run = loadRun(dir);
  const dd = new Map((run.plan?.designDecisions || []).map(d => [d.id, d]));
  const known = new Set([
    ...(run.plan?.decisions || []).map(d => d.id), ...dd.keys(),
    ...(run.plan?.componentMap || []).map(c => c.id), ...(run.plan?.variableMap || []).map(v => v.id),
    ...(run.inventory?.patterns || []).map(p => p.id),
  ]);
  const problems = [];
  for (const ref of basisRefs || []) {
    if (!known.has(ref)) problems.push(`basisRef ${ref} does not resolve`);
    else if (dd.has(ref) && decisionStatus(dd.get(ref)) === 'skipped') problems.push(`basisRef ${ref} is a skipped design decision; its elements are not built (DEC-08)`);
    else if (dd.has(ref) && decisionStatus(dd.get(ref)) !== 'answered') problems.push(`basisRef ${ref} is an unanswered design decision`);
  }
  return problems;
}

export function planOperation(dir, op) {
  const { ops, truncatedTail } = readOperations(dir);
  if (truncatedTail) throw new Error('operations.jsonl has a truncated last line; reconcile first');
  if (ops.has(op.operationId)) throw new Error(`operationId ${op.operationId} already exists (status ${ops.get(op.operationId).status})`);
  const record = { schemaVersion: '1.2', status: 'planned', createdNodeIds: [], mutatedNodeIds: [], evidenceRefs: [], retry: { attempt: 0, outcomeKnown: false }, ...op, timestamps: { plannedAt: nowIso(), ...(op.timestamps || {}) } };
  const errors = validateSchema('operation', record);
  if (record.mode === 'write') {
    errors.push(...basisProblems(dir, record.basisRefs));
    // v1.6 (A02): a write is only planned when the Plan/Build boundary holds (authorisation, confirmed
    // plan and flow, answered decisions, this run's capabilities, no unresolved writes).
    const gate = validateRun(dir, { stage: 'build' });
    errors.push(...gate.schemaErrors.map(e => `build gate: ${e}`), ...gate.semanticErrors.map(e => (e.startsWith('build:') ? e : `build gate: ${e}`)));
  }
  if (errors.length) throw new Error(`invalid operation ${op.operationId}: ${errors.join('; ')}`);
  appendJsonl(journalOf(dir), record);
  return record;
}

// Mark an applied write as verified after a read-back (never from the write's own response alone).
// noChange: the read-back confirmed the write changed no node (e.g. a precondition guard returned a
// conflict). Only allowed when created and mutated IDs are both empty; later evidence checks then treat
// the write as having no effect instead of an unknown one (M4).
export function verifyOperation(dir, operationId, { evidenceRefs = [], fingerprint, createdNodeIds, mutatedNodeIds, note, noChange = false, entity } = {}) {
  const { ops } = readOperations(dir);
  const op = ops.get(operationId);
  if (!op) throw new Error(`unknown operation ${operationId}`);
  if (op.status !== 'applied') throw new Error(`operation ${operationId} is ${op.status}; only applied operations can be verified`);
  if (!evidenceRefs.length) throw new Error('verification needs at least one evidenceRef (a read-back operation id or evidence id)');
  if (noChange) assertNoTouchedIds(operationId, [...(createdNodeIds ?? op.createdNodeIds ?? []), ...(mutatedNodeIds ?? op.mutatedNodeIds ?? [])]);
  const patch = { operationId, status: 'verified', evidenceRefs, timestamps: { verifiedAt: nowIso() } };
  if (fingerprint) patch.fingerprint = fingerprint;
  if (createdNodeIds) patch.createdNodeIds = createdNodeIds;
  if (mutatedNodeIds) patch.mutatedNodeIds = mutatedNodeIds;
  if (note || noChange) patch.effectSummary = { partial: false, ...(noChange ? { noChange: true } : {}), ...(note ? { note } : {}) };
  appendJsonl(journalOf(dir), patch);
  if (op.mode === 'write' && !noChange) {
    const verified = { ...op, ...patch };
    recordLedgerEntity(dir, verified, { entity });
    upgradeNativeWrite(dir, verified);
  }
  return patch;
}

// v1.8 (§20): ledger.entities is written on verify, so the handoff lists the created / modified nodes
// without a manual edit. One entity per logicalKey: its root is the given entity.nodeId, else the first
// created node, else the first mutated node; the other IDs become childNodeIds. The node type is only
// what the caller read back (entity.type); without it the entity keeps type "UNKNOWN" (never guessed).
const FINGERPRINT = /^fp[0-9]+:[0-9a-f]{8}$/;
export function recordLedgerEntity(dir, op, { entity = {} } = {}) {
  const file = path.join(dir, 'ledger.json');
  const ledger = readJson(file);
  if (!ledger) return null;
  const ids = [...(op.createdNodeIds || []), ...(op.mutatedNodeIds || [])];
  const nodeId = entity.nodeId || ids[0];
  if (!nodeId) return null;
  const entities = [...(ledger.entities || [])];
  const at = entities.findIndex(e => e.logicalKey === op.logicalKey && e.active);
  const prev = at >= 0 ? entities[at] : {};
  const children = [...new Set([...(prev.childNodeIds || []), ...(entity.childNodeIds || []), ...ids])].filter(id => id !== nodeId);
  const next = {
    logicalKey: op.logicalKey,
    nodeId,
    type: entity.type || (prev.nodeId === nodeId && prev.type) || 'UNKNOWN',
    fileKey: op.fileKey,
    active: true,
    ...(children.length ? { childNodeIds: children } : {}),
    ...(FINGERPRINT.test(op.fingerprint || '') ? { agentFingerprint: op.fingerprint } : prev.agentFingerprint && prev.nodeId === nodeId ? { agentFingerprint: prev.agentFingerprint } : {}),
    lastOperationId: op.operationId,
  };
  if (at >= 0) entities[at] = next; else entities.push(next);
  const updated = { ...ledger, entities, lastVerifiedOperationId: op.operationId, updatedAt: nowIso() };
  const errors = validateSchema('ledger', updated);
  if (errors.length) throw new Error(`${op.operationId} verified, but ledger.entities could not be updated: ${errors.join('; ')}`);
  atomicWriteJson(file, updated);
  return next;
}

// v1.8 (§20): the first write of a run may probe nativeWrite (basis history, nativeWriteReady). Once
// that write is read back and verified, nativeWrite becomes verified for this run automatically.
export function upgradeNativeWrite(dir, op) {
  const file = path.join(dir, 'capabilities.json');
  const caps = readJson(file);
  const w = caps?.features?.nativeWrite;
  if (!w || w.status === 'verified') return null;
  const nativeWrite = { status: 'verified', basis: 'this_run', evidence: [op.operationId, ...(op.evidenceRefs || [])], checkedAt: nowIso(), notes: `verified by ${op.operationId} (read back${op.evidenceRefs?.length ? ` in ${op.evidenceRefs.join(', ')}` : ''})${w.notes ? `; before: ${w.notes}` : ''}` };
  const updated = { ...caps, features: { ...caps.features, nativeWrite } };
  const errors = validateSchema('capabilities', updated);
  if (errors.length) throw new Error(`${op.operationId} verified, but nativeWrite could not be upgraded: ${errors.join('; ')}`);
  atomicWriteJson(file, updated);
  return nativeWrite;
}

function assertNoTouchedIds(operationId, ids) {
  if (ids.length) throw new Error(`${operationId}: noChange requires empty createdNodeIds and mutatedNodeIds (found ${ids.join(', ')})`);
}

// Record, for an already verified write, that a read-back confirmed it changed nothing (written before
// verify supported noChange). Needs its own read-back evidence; never changes the status.
export function confirmNoChange(dir, operationId, { evidenceRefs = [], note } = {}) {
  const op = readOperations(dir).ops.get(operationId);
  if (!op) throw new Error(`unknown operation ${operationId}`);
  if (op.mode !== 'write' || op.status !== 'verified') throw new Error(`${operationId} is ${op.mode} ${op.status}; only verified writes can be confirmed as no-change`);
  if (!evidenceRefs.length) throw new Error('confirming no change needs a read-back evidenceRef');
  assertNoTouchedIds(operationId, [...(op.createdNodeIds || []), ...(op.mutatedNodeIds || [])]);
  const patch = { operationId, effectSummary: { ...(op.effectSummary || {}), partial: false, noChange: true, noChangeConfirmedAt: nowIso(), ...(note ? { note } : {}) }, evidenceRefs: [...new Set([...(op.evidenceRefs || []), ...evidenceRefs])] };
  appendJsonl(journalOf(dir), patch);
  return patch;
}

export function cancelOperation(dir, operationId) {
  const op = readOperations(dir).ops.get(operationId);
  if (!op) throw new Error(`unknown operation ${operationId}`);
  if (op.status !== 'planned') throw new Error(`only planned operations can be cancelled; ${operationId} is ${op.status} (a dispatched call may still have run remotely)`);
  const patch = { operationId, status: 'cancelled', timestamps: { cancelledAt: nowIso() } };
  appendJsonl(journalOf(dir), patch);
  return patch;
}

// Record the outcome of a read-only reconciliation of an unknown_outcome / dispatched write (§11.4).
export function reconcileOperation(dir, operationId, { outcome, evidenceRefs = [], createdNodeIds, note }) {
  const op = readOperations(dir).ops.get(operationId);
  if (!op) throw new Error(`unknown operation ${operationId}`);
  if (!['dispatched', 'unknown_outcome'].includes(op.status)) throw new Error(`${operationId} is ${op.status}; nothing to reconcile`);
  if (!['applied', 'failed_known'].includes(outcome)) throw new Error('outcome must be applied or failed_known');
  if (!evidenceRefs.length) throw new Error('reconciliation needs a read-back evidenceRef');
  const patch = { operationId, status: outcome, evidenceRefs, reconciliation: { from: op.status, note: note || '' }, timestamps: { reconciledAt: nowIso() } };
  if (createdNodeIds) patch.createdNodeIds = createdNodeIds;
  appendJsonl(journalOf(dir), patch);
  return patch;
}

// What must happen before the next write (used by resume and by the skill).
export function journalSummary(dir) {
  const { ops, truncatedTail } = readOperations(dir);
  const list = [...ops.values()];
  const writes = list.filter(o => o.mode === 'write');
  const unresolved = writes.filter(o => ['dispatched', 'unknown_outcome'].includes(o.status)).map(o => ({ operationId: o.operationId, status: o.status, logicalKey: o.logicalKey }));
  const awaitingVerification = writes.filter(o => o.status === 'applied').map(o => o.operationId);
  const planned = writes.filter(o => o.status === 'planned').map(o => o.operationId);
  const lastVerified = writes.filter(o => o.status === 'verified').sort((a, b) => (a.timestamps?.verifiedAt || '').localeCompare(b.timestamps?.verifiedAt || '')).pop();
  return {
    truncatedTail,
    unresolved,
    awaitingVerification,
    planned,
    lastVerifiedOperationId: lastVerified ? lastVerified.operationId : null,
    nextStep: truncatedTail || unresolved.length ? 'reconcile' : awaitingVerification.length ? 'verify' : planned.length ? 'dispatch_planned' : 'none',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, runId, ...rest] = process.argv.slice(2);
  const usage = 'usage: operation-journal.mjs <plan|verify|cancel|reconcile|confirm-no-change|summary> <run-id> [json]';
  if (!cmd || !runId) { console.error(usage); process.exit(2); }
  const dir = runDirFor(projectRoot(), runId);
  const arg = rest.length ? JSON.parse(rest.join(' ')) : {};
  try {
    let out;
    if (cmd === 'plan') out = planOperation(dir, { runId, ...arg });
    // One independent read-back may confirm several writes of the same composition (v1.6, A05):
    // {"operationIds":["op-0003","op-0004"],"evidenceRefs":["rd-0005"]}
    else if (cmd === 'verify' && Array.isArray(arg.operationIds)) out = arg.operationIds.map(id => verifyOperation(dir, id, { ...arg, operationIds: undefined }));
    else if (cmd === 'verify') out = verifyOperation(dir, arg.operationId, arg);
    else if (cmd === 'cancel') out = cancelOperation(dir, arg.operationId);
    else if (cmd === 'reconcile') out = reconcileOperation(dir, arg.operationId, arg);
    else if (cmd === 'confirm-no-change') out = confirmNoChange(dir, arg.operationId, arg);
    else if (cmd === 'summary') out = journalSummary(dir);
    else { console.error(usage); process.exit(2); }
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

