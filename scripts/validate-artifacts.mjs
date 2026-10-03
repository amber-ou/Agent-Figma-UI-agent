#!/usr/bin/env node
// Artifact validator (spec §20): JSON Schema (syntax) checks and cross-file (semantic) checks are
// implemented separately.
// Usage: node scripts/validate-artifacts.mjs <runDir> [--stage intake|plan|build|final]
// Stages (v1.6, A02): intake / plan / build check what must exist at that point and report references
// to artifacts that do not exist yet as "deferred" (never as resolved). build is the Plan/Build
// boundary: it requires every authorisation, basis, decision and capability a write needs. final (the
// default, unchanged behaviour) runs every schema and cross-file check.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJsonl, operationStates } from './hooks/lib.mjs';
import { precheckContrast } from './quality-metrics.mjs';
import { loadPolicy, resolvePolicyRef, contrastPolicy } from './product-policy.mjs';

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
export const CONTRACTS = ['brief', 'plan', 'inventory', 'capabilities', 'ledger', 'audit'];
export const STAGES = ['intake', 'plan', 'build', 'final'];
// Artifacts that must exist at each stage. Later artifacts are validated when present.
export const STAGE_REQUIRED = {
  intake: ['brief', 'ledger'],
  plan: ['brief', 'ledger', 'capabilities', 'inventory', 'plan'],
  build: ['brief', 'ledger', 'capabilities', 'inventory', 'plan'],
  final: CONTRACTS,
};
const UNRESOLVED_WRITE = new Set(['dispatched', 'unknown_outcome']);

function checkStage(stage) {
  if (!STAGES.includes(stage)) throw new Error(`unknown stage ${stage} (expected ${STAGES.join('|')})`);
  return stage;
}

let ajv;
function getAjv() {
  if (ajv) return ajv;
  // strictSchema stays on (unknown keywords are errors). strictRequired/strictTypes are off because
  // if/then branches constrain properties declared on the parent schema, which is intended here.
  ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const f of fs.readdirSync(schemaDir).filter(f => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(fs.readFileSync(path.join(schemaDir, f), 'utf8')));
  }
  return ajv;
}

const schemaId = name => `https://figma-ui.local/schemas/${name}.schema.json`;

// DEC-08: status is optional for plans written before v1.4; derive it from the answer.
export function decisionStatus(d) {
  return d.status || (typeof d.answer === 'string' && d.answer ? 'answered' : 'pending');
}

// v1.8 INVARIANT-28: a decision is resolved when answered, or skipped by the user who saw the row.
// A skip the agent recorded (or a skip without skippedBy, written before v1.8) is still open.
export function decisionResolved(d) {
  const st = decisionStatus(d);
  return st === 'answered' || (st === 'skipped' && d.skippedBy === 'user');
}

// v1.8 (§20): the shapes real runs got wrong, with the correct format in the message, so a run does
// not have to guess field by field. Matched on contract + instance path + keyword.
const SHAPE_HINTS = [
  { name: 'brief', path: /^\/viewports\/\d+$/, hint: 'each viewport is an object, e.g. {"name":"mobile","width":390,"height":844}' },
  { name: 'capabilities', path: /^\/limits\/[A-Za-z]+$/, keyword: 'type', hint: 'limits.useFigmaReturnBytes / useFigmaReturnChars / getMetadataWholePage are objects, e.g. {"status":"verified","maxObservedOk":20480,"firstFailure":null,"evidence":["rd-0001"]}; searchDesignSystemQueriesPerCall is an integer or null' },
  { name: 'capabilities', path: /^\/environmentDiagnosis$/, keyword: 'additionalProperties', hint: 'environmentDiagnosis takes mode, reason, checkedAt, cachedAt, fingerprintDigest, problems, note (copy the "diagnosis" block of verify-installation.mjs)' },
  { name: 'audit', path: /^\/evidence\/\d+\/toolRef$/, keyword: 'additionalProperties', hint: 'toolRef is {"tool":"mcp__figma__use_figma","operation":"rd-0006","capturedAt":"<ISO time>"}; put the read operationId in "operation" (there is no readOperationId)' },
];

function shapeHint(name, e) {
  const h = SHAPE_HINTS.find(x => x.name === name && x.path.test(e.instancePath || '') && (!x.keyword || x.keyword === e.keyword));
  return h ? ` — hint: ${h.hint}` : '';
}

export const SKELETON_HINT = 'for a schema-valid starting point run: node scripts/artifact-skeleton.mjs <contract> <run-id>';

// ---- syntax: one document against one schema ----
export function validateSchema(name, doc) {
  const validate = getAjv().getSchema(schemaId(name));
  if (!validate) throw new Error(`unknown schema ${name}`);
  const ok = validate(doc);
  return ok ? [] : validate.errors.map(e => `${name}${e.instancePath || ''} ${e.message}${e.params && e.params.allowedValues ? ` (${e.params.allowedValues.join('|')})` : ''}${e.params && e.params.additionalProperty ? ` (${e.params.additionalProperty})` : ''}${shapeHint(name, e)}`);
}

export function loadRun(dir, { root } = {}) {
  const read = f => {
    const file = path.join(dir, f);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
  };
  // project root for product-policies/ (§7.5): design-runs/<run-id> lives two levels below it
  const run = { dir, root: root || path.resolve(dir, '..', '..') };
  for (const c of CONTRACTS) run[c] = read(`${c}.json`);
  const journal = readJsonl(path.join(dir, 'operations.jsonl'));
  run.journalRecords = journal.records;
  run.journalTruncated = journal.truncatedTail;
  run.operations = [...operationStates(journal.records).values()];
  return run;
}

export function validateRunSchemas(run, { stage = 'final', required = STAGE_REQUIRED[checkStage(stage)] } = {}) {
  const errors = [];
  for (const c of CONTRACTS) {
    if (run[c] === undefined) { if (required.includes(c)) errors.push(`${c}.json missing`); continue; }
    errors.push(...validateSchema(c, run[c]));
  }
  for (const op of run.operations || []) {
    errors.push(...validateSchema('operation', op).map(e => e.replace(/^operation/, `operation ${op.operationId}`)));
    if (op.effectSummary?.noChange === true && [...(op.createdNodeIds || []), ...(op.mutatedNodeIds || [])].length) {
      errors.push(`operation ${op.operationId}: effectSummary.noChange contradicts its created/mutated node IDs`);
    }
  }
  if (run.journalTruncated) errors.push('operations.jsonl has a truncated last line (reconcile before continuing)');
  return errors;
}

// ---- evidence ↔ requiredCell and evidence validity (v1.6, A03) ----

// When an operation took effect (or may have): applied/verified use their applied time; an
// unresolved write may have run at dispatch time.
function effectTime(op) {
  const t = op.timestamps || {};
  if (['applied', 'verified'].includes(op.status)) return t.appliedAt || t.reconciledAt || t.verifiedAt || t.dispatchedAt || null;
  if (UNRESOLVED_WRITE.has(op.status)) return t.dispatchedAt || t.failedAt || null;
  return null;
}

// Does this evidence cover the cell? Matching is by cell, never by screenKey alone. Legacy evidence
// (no cellKeys) counts only when the screen has exactly one applicable cell and nothing contradicts it.
export function evidenceCoversCell(e, cell, cells) {
  if (Array.isArray(e.cellKeys)) return e.cellKeys.includes(cell.key);
  if (e.screenKey !== cell.screenKey) return false;
  const same = (cells || []).filter(c => c.applicable && c.screenKey === cell.screenKey);
  if (same.length !== 1) return false;
  for (const f of ['viewport', 'state', 'mode']) if (e[f] != null && cell[f] != null && e[f] !== cell[f]) return false;
  return true;
}

// Is current evidence still valid? Returns { status: 'valid' | 'stale' | 'undeterminable', reason }.
// A later write that touched the evidence scope, its ancestors (parent layout, explicit modes) or any
// child the ledger knows about makes it stale; a later write whose effect or target is unknown makes
// it undeterminable (never guessed valid). A user change recorded on a ledger entity in scope after
// capture also makes it stale.
export function isConfirmedNoChange(op) {
  return op.status === 'verified' && op.effectSummary?.noChange === true && (op.evidenceRefs || []).length > 0
    && !(op.createdNodeIds || []).length && !(op.mutatedNodeIds || []).length;
}

export function evidenceValidity(e, ops = [], ledger) {
  const capturedAt = e.toolRef?.capturedAt || null;
  const sub = e.subject || {};
  const scope = new Set([e.nodeId, sub.rootNodeId, ...(sub.scopeNodeIds || [])].filter(Boolean));
  for (const ent of ledger?.entities || []) if (scope.has(ent.nodeId)) for (const c of ent.childNodeIds || []) scope.add(c);
  const ancestors = new Set(sub.ancestorNodeIds || []);
  const writes = ops.filter(o => o.mode === 'write' && effectTime(o));
  for (const op of writes) {
    const at = effectTime(op);
    if (capturedAt && at <= capturedAt) continue;
    const label = capturedAt ? `after capture (${capturedAt})` : '(capture time unknown)';
    if (UNRESOLVED_WRITE.has(op.status)) return { status: 'undeterminable', reason: `${op.operationId} is ${op.status}; its effect ${label} is unknown` };
    // M4: a verified write whose read-back confirmed it changed nothing (e.g. a guard conflict) has no
    // effect on earlier evidence. Without that confirmation, an empty ID list still means "unknown".
    if (isConfirmedNoChange(op)) continue;
    const touched = [...(op.createdNodeIds || []), ...(op.mutatedNodeIds || []), ...(op.scopeRootIds || [])];
    if (!touched.length) return { status: 'undeterminable', reason: `${op.operationId} changed unknown nodes ${label}` };
    const hit = touched.find(id => scope.has(id) || ancestors.has(id));
    if (hit) return { status: 'stale', reason: `${op.operationId} changed ${hit} ${label}` };
    if (!scope.size) return { status: 'undeterminable', reason: `evidence has no node scope and ${op.operationId} wrote ${label}` };
  }
  for (const ent of ledger?.entities || []) {
    if (!ent.userChangeDetectedAt || !(scope.has(ent.nodeId) || ancestors.has(ent.nodeId))) continue;
    if (!capturedAt || ent.userChangeDetectedAt > capturedAt) return { status: 'stale', reason: `user change detected on ${ent.nodeId} at ${ent.userChangeDetectedAt}` };
  }
  return { status: 'valid' };
}

// ---- digest of the evaluated data (v1.6, A02): a stored evaluation is only current for this data ----

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// Fields the evaluator itself writes (and user acceptance / lock bookkeeping) are excluded, so writing
// the evaluation back does not change the digest.
export function inputDigest(run) {
  const omit = (doc, keys) => (doc ? Object.fromEntries(Object.entries(doc).filter(([k]) => !keys.includes(k))) : null);
  const payload = {
    brief: run.brief ?? null, plan: run.plan ?? null, inventory: run.inventory ?? null, capabilities: run.capabilities ?? null,
    audit: omit(run.audit, ['completionEvaluation']),
    ledger: omit(run.ledger, ['status', 'completionEvaluatedAt', 'updatedAt', 'userAcceptance', 'lock', 'phase', 'phaseHistory', 'questionRounds']),
    journal: run.journalRecords || [],
  };
  return `sha256:${crypto.createHash('sha256').update(stable(payload)).digest('hex')}`;
}

// Is audit.completionEvaluation the evaluation of the data as it is now?
export function evaluationIsCurrent(run) {
  const ev = run.audit?.completionEvaluation;
  if (!ev) return { current: false, reason: 'no completionEvaluation; run evaluate-completion --write' };
  if (!ev.inputDigest) return { current: false, reason: 'completionEvaluation has no inputDigest (evaluated before v1.6); evaluate again' };
  const now = inputDigest(run);
  return now === ev.inputDigest ? { current: true } : { current: false, reason: 'artifacts or journal changed after the last evaluation; evaluate again' };
}

// ---- semantics: references across files ----
export function validateRunSemantics(run, { stage = 'final' } = {}) {
  checkStage(stage);
  const errors = [];
  const deferred = [];
  const { brief, plan, inventory, ledger, audit, capabilities } = run;
  const ops = run.operations || [];
  const opsById = new Map(ops.map(o => [o.operationId, o]));

  const runIds = new Set(CONTRACTS.filter(c => run[c]).map(c => run[c].runId).concat(ops.map(o => o.runId)).filter(Boolean));
  if (runIds.size > 1) errors.push(`runId differs across artifacts: ${[...runIds].join(', ')}`);

  const dup = (list, label) => {
    const seen = new Set();
    for (const id of list) { if (seen.has(id)) errors.push(`duplicate ${label} id ${id}`); seen.add(id); }
  };

  const designDecisions = new Map((plan?.designDecisions || []).map(d => [d.id, d]));
  const decisions = new Map((plan?.decisions || []).map(d => [d.id, d]));
  const patterns = new Map((inventory?.patterns || []).map(p => [p.id, p]));
  const componentMap = new Map((plan?.componentMap || []).map(c => [c.id, c]));
  const variableMap = new Map((plan?.variableMap || []).map(v => [v.id, v]));
  const observations = new Map((plan?.baseline?.observations || []).map(o => [o.id, o]));
  const gaps = new Map((brief?.gaps || []).map(g => [g.id, g]));

  if (plan) {
    dup([...(plan.designDecisions || []), ...(plan.decisions || [])].map(d => d.id), 'decision (shared namespace)');
    dup((plan.requiredCells || []).map(c => c.key), 'requiredCell');
    dup((plan.componentMap || []).map(c => c.id), 'componentMap');
    dup((plan.variableMap || []).map(c => c.id), 'variableMap');
    dup((plan.undefinedBehaviors || []).map(u => u.id), 'undefinedBehavior');
  }
  if (inventory) dup((inventory.patterns || []).map(p => p.id), 'pattern');
  if (audit) {
    dup((audit.evidence || []).map(e => e.id), 'evidence');
    dup((audit.findings || []).map(f => f.id), 'finding');
  }

  const isDecision = id => designDecisions.has(id) || decisions.has(id);
  const answered = id => decisions.has(id) || (designDecisions.has(id) && decisionStatus(designDecisions.get(id)) === 'answered');

  // brief
  if (brief) {
    for (const ref of brief.decisionRefs || []) {
      if (!plan) deferred.push(`brief.decisionRefs: ${ref} resolves against plan decisions (plan.json not written yet)`);
      else if (!isDecision(ref)) errors.push(`brief.decisionRefs: ${ref} not found in plan decisions`);
    }
    const out = brief.output;
    if (out && out.writeAllowed && out.decisionRef) {
      if (!plan) deferred.push(`brief.output.decisionRef ${out.decisionRef} resolves against plan decisions (plan.json not written yet); writes stay blocked until it does`);
      else if (!isDecision(out.decisionRef)) errors.push(`brief.output.decisionRef ${out.decisionRef} not found in plan decisions`);
    }
    const approved = new Set(brief.sources.approvedLibraryKeys);
    for (const k of [...(brief.sources.componentLibraryKeys || []), ...(brief.sources.variableLibraryKeys || [])]) {
      if (!approved.has(k)) errors.push(`brief.sources: ${k} is listed as component/variable library but not in approvedLibraryKeys`);
    }
    const ds = brief.designSystem;
    for (const [flag, label] of [['allowNewTokens', 'new tokens'], ['allowNewComponents', 'new components'], ['allowWrap', 'wrap'], ['allowMainComponentEdits', 'main component edits']]) {
      if (ds[flag] && !(ds.decisionRefs || []).some(r => !plan || isDecision(r))) errors.push(`brief.designSystem.${flag}=true requires a decisionRef (INVARIANT-04, ${label})`);
    }
  }

  // plan
  if (plan) {
    if (plan.status === 'confirmed' && !(plan.decisions || []).length) errors.push('plan confirmed without a scope decision');
    for (const ref of plan.patternRefs || []) if (!patterns.has(ref)) errors.push(`plan.patternRefs: ${ref} not found in inventory.patterns`);
    for (const s of plan.screens || []) {
      for (const ref of s.patternRefs || []) if (!patterns.has(ref)) errors.push(`screen ${s.screenKey}: pattern ${ref} not found in inventory`);
      for (const ref of s.decisionRefs || []) if (!answered(ref)) errors.push(`screen ${s.screenKey}: decision ${ref} missing or unanswered`);
    }
    const screenKeys = new Set((plan.screens || []).map(s => s.screenKey));
    for (const c of plan.requiredCells || []) {
      if (plan.taskType !== 'audit' && !screenKeys.has(c.screenKey)) errors.push(`requiredCell ${c.key}: screenKey ${c.screenKey} not in plan.screens`);
      if (c.decisionRef && !isDecision(c.decisionRef)) errors.push(`requiredCell ${c.key}: decisionRef ${c.decisionRef} not found`);
    }
    // §6.2 version drift (T46)
    for (const c of plan.componentMap || []) {
      const vc = c.versionCheck;
      if (vc && vc.status === 'differs') {
        const obs = observations.get(vc.baselineRef);
        if (!obs) errors.push(`componentMap ${c.id}: versionCheck.baselineRef ${vc.baselineRef} not found in plan.baseline.observations`);
        else if (obs.kind !== 'inherited_baseline') errors.push(`componentMap ${c.id}: version difference must be recorded as inherited_baseline`);
        if (plan.status === 'confirmed' && !vc.listedToUserRef) errors.push(`componentMap ${c.id}: version difference not listed to the user before confirming the plan (§6.2)`);
        else if (vc.listedToUserRef && !isDecision(vc.listedToUserRef)) errors.push(`componentMap ${c.id}: listedToUserRef ${vc.listedToUserRef} not found`);
      }
    }
    // §6.1 variables library approval (T45)
    const variableLibs = new Set(brief?.sources?.variableLibraryKeys || []);
    for (const v of plan.variableMap || []) {
      if (v.bindingStatus === 'gap' && !gaps.has(v.gapRef)) errors.push(`variableMap ${v.id}: gapRef ${v.gapRef} not found in brief.gaps`);
      if (['verified', 'planned'].includes(v.bindingStatus) && v.sourceKind === 'remote') {
        if (!v.libraryKey) errors.push(`variableMap ${v.id}: remote variable without an identified source library; record a gap instead of binding (§6.1)`);
        else if (!variableLibs.has(v.libraryKey)) errors.push(`variableMap ${v.id}: library ${v.libraryKey} is not an approved variables library (§6.1)`);
      }
    }
    // DEC-07 / INVARIANT-18: a delegation is valid only for this run and must point at the user's
    // authorisation in this plan's decisions.
    for (const d of plan.designDecisions || []) {
      const dg = d.delegation;
      if (!dg) continue;
      if (dg.runId !== plan.runId) errors.push(`designDecision ${d.id}: delegation belongs to run ${dg.runId}, not ${plan.runId}; authorisation does not carry over to another run (INVARIANT-18)`);
      if (!decisions.has(dg.decisionRef)) errors.push(`designDecision ${d.id}: delegation.decisionRef ${dg.decisionRef} is not a user decision in plan.decisions (DEC-07)`);
    }
    // §9.5 accessibility pre-check: recompute contrast; a failing style needs a design decision
    // (alternatives) before the plan is confirmed.
    const a11y = plan.accessibilityPrecheck || [];
    dup(a11y.map(c => c.id), 'accessibilityPrecheck');
    for (const c of a11y) {
      if (c.foreground && c.background && c.kind !== 'target_size') {
        const expected = precheckContrast(c);
        if (c.status !== expected.status) errors.push(`accessibilityPrecheck ${c.id}: status ${c.status} but ${c.foreground} on ${c.background} is ${expected.ratio}:1 (needs ${expected.required}:1) → ${expected.status}`);
      }
      if (c.status === 'fail' && !designDecisions.has(c.decisionRef)) errors.push(`accessibilityPrecheck ${c.id}: failing item needs decisionRef to a designDecision listing alternatives (§9.5)`);
      if (c.baselineRef) {
        const obs = observations.get(c.baselineRef);
        if (!obs) errors.push(`accessibilityPrecheck ${c.id}: baselineRef ${c.baselineRef} not found in plan.baseline.observations`);
        else if (obs.kind !== 'inherited_baseline') errors.push(`accessibilityPrecheck ${c.id}: reference-screen failure must be recorded as inherited_baseline`);
      }
    }
  }

  // v1.6 (A04) flow: steps map to planned screens and states; branches point at steps; decisions resolve.
  const flow = plan?.flow;
  if (flow) {
    const screenKeys = new Set((plan.screens || []).map(s => s.screenKey));
    const stepIds = new Set((flow.steps || []).map(st => st.id));
    dup((flow.steps || []).map(st => st.id), 'flow step');
    dup((flow.unknowns || []).map(u => u.id), 'flow unknown');
    for (const st of flow.steps || []) {
      if (!screenKeys.has(st.screenKey)) errors.push(`flow step ${st.id}: screenKey ${st.screenKey} not in plan.screens`);
      if (st.state != null && !(plan.requiredCells || []).some(c => c.screenKey === st.screenKey && c.state === st.state)) errors.push(`flow step ${st.id}: ${st.screenKey} / ${st.state} has no requiredCell (every flow state must map to a planned screen state)`);
      for (const b of st.branches || []) if (!stepIds.has(b.to)) errors.push(`flow step ${st.id}: branch "${b.condition}" goes to unknown step ${b.to}`);
    }
    if (flow.decisionRef && !isDecision(flow.decisionRef)) errors.push(`flow.decisionRef ${flow.decisionRef} not found in plan decisions`);
    for (const u of flow.unknowns || []) if (u.decisionRef && !answered(u.decisionRef)) errors.push(`flow unknown ${u.id}: decisionRef ${u.decisionRef} missing or unanswered`);
  }

  // §10.3 fonts: a font that is not installed is an inherited_baseline listed to the user, never
  // silently substituted.
  for (const f of inventory?.fonts || []) {
    if (f.installed) continue;
    const label = `font ${f.family} ${f.style}`;
    if (plan) {
      const obs = observations.get(f.baselineRef);
      if (!obs) errors.push(`${label}: not installed; baselineRef ${f.baselineRef} not found in plan.baseline.observations`);
      else if (obs.kind !== 'inherited_baseline') errors.push(`${label}: missing font must be recorded as inherited_baseline`);
      if (plan.status === 'confirmed' && !f.listedToUserRef) errors.push(`${label}: not installed and not listed to the user before confirming the plan (§10.3)`);
    }
    if (f.listedToUserRef && plan && !isDecision(f.listedToUserRef)) errors.push(`${label}: listedToUserRef ${f.listedToUserRef} not found`);
  }

  // inventory (INVARIANT-16)
  for (const p of inventory?.patterns || []) {
    for (const c of p.constraints || []) {
      if (c.status === 'confirmed' && c.hypothesis) errors.push(`pattern ${p.id} constraint ${c.id}: confirmed constraint still carries a hypothesis`);
    }
  }

  // operations
  const basisOk = ref => patterns.has(ref) || componentMap.has(ref) || variableMap.has(ref) || isDecision(ref);
  const outKey = brief?.output?.fileKey;
  for (const op of ops) {
    if (op.mode !== 'write') continue;
    if (brief?.taskType === 'audit') errors.push(`operation ${op.operationId}: audit runs must not write to the canvas (INVARIANT-08)`);
    if (outKey && op.fileKey !== outKey) errors.push(`operation ${op.operationId}: fileKey ${op.fileKey} is not the authorized output (INVARIANT-09)`);
    for (const ref of op.basisRefs || []) {
      if (!basisOk(ref)) errors.push(`operation ${op.operationId}: basisRef ${ref} does not resolve (DEC-06)`);
      else if (designDecisions.has(ref)) {
        const st = decisionStatus(designDecisions.get(ref));
        if (st === 'skipped') errors.push(`operation ${op.operationId}: basisRef ${ref} is a skipped design decision; its elements must not be built (DEC-08)`);
        else if (st !== 'answered') errors.push(`operation ${op.operationId}: basisRef ${ref} is an unanswered design decision (INVARIANT-11)`);
      }
    }
  }
  const createdByRun = new Set(ops.filter(o => o.mode === 'write').flatMap(o => o.createdNodeIds || []));
  for (const e of ledger?.entities || []) { createdByRun.add(e.nodeId); for (const c of e.childNodeIds || []) createdByRun.add(c); }

  // ledger
  if (ledger) {
    const active = (ledger.entities || []).filter(e => e.active);
    dup(active.map(e => e.logicalKey), 'active ledger logicalKey');
    for (const e of ledger.entities || []) {
      if (outKey && e.fileKey !== outKey) errors.push(`ledger entity ${e.logicalKey}: fileKey outside the authorized output`);
      if (!opsById.has(e.lastOperationId)) errors.push(`ledger entity ${e.logicalKey}: lastOperationId ${e.lastOperationId} not in journal`);
    }
    if (ledger.lastVerifiedOperationId && opsById.get(ledger.lastVerifiedOperationId)?.status !== 'verified') errors.push(`ledger.lastVerifiedOperationId ${ledger.lastVerifiedOperationId} is not verified in the journal`);
    if (stage === 'final') {
      const unresolved = ops.filter(o => UNRESOLVED_WRITE.has(o.status)).map(o => o.operationId);
      const listed = new Set((ledger.pendingOperations || []).map(o => o.operationId));
      for (const id of unresolved) if (!listed.has(id)) errors.push(`ledger.pendingOperations is missing unresolved operation ${id}`);
    }

    // §2.3 / INVARIANT-17: userAcceptance records the user's view; it never changes status or the evaluation.
    const ua = ledger.userAcceptance;
    const ev = audit?.completionEvaluation;
    if (ua) {
      if (plan && !isDecision(ua.decisionRef)) errors.push(`ledger.userAcceptance.decisionRef ${ua.decisionRef} not found in plan decisions`);
      if (!ev) errors.push('ledger.userAcceptance without audit.completionEvaluation: evaluate the run before recording acceptance');
      else {
        if (ledger.status !== ev.result) errors.push(`ledger.status ${ledger.status} differs from completionEvaluation.result ${ev.result}; userAcceptance must not change the run status (INVARIANT-17)`);
        if (ua.evaluationResult && ua.evaluationResult !== ev.result) errors.push(`ledger.userAcceptance.evaluationResult ${ua.evaluationResult} differs from completionEvaluation.result ${ev.result} (INVARIANT-17)`);
      }
      const handoffFile = path.join(run.dir || '.', 'handoff.md');
      if (ev && fs.existsSync(handoffFile)) {
        const text = fs.readFileSync(handoffFile, 'utf8');
        if (!text.includes(ev.result) || !text.includes(ua.decisionRef)) errors.push(`handoff.md must list both the completion result (${ev.result}) and the user acceptance (${ua.decisionRef}) (§2.3)`);
      }
    }
  }
  // A stored evaluation can never claim completion it did not earn (INVARIANT-05, INVARIANT-17).
  const ev = audit?.completionEvaluation;
  if (ev && ['complete', 'complete_with_exceptions'].includes(ev.result) && !ev.eligible) errors.push(`completionEvaluation.result ${ev.result} with eligible=false`);
  if (ledger && audit && ['complete', 'complete_with_exceptions'].includes(ledger.status) && ev?.result !== ledger.status) errors.push(`ledger.status ${ledger.status} is not the result of completionEvaluation (${ev ? ev.result : 'none'})`);

  // audit (final stage; an audit written before a later Build round is re-checked at Handoff)
  if (audit && stage === 'final') {
    const evidence = new Map((audit.evidence || []).map(e => [e.id, e]));
    for (const g of audit.gates || []) {
      for (const ref of g.evidenceRefs || []) if (!evidence.has(ref)) errors.push(`gate ${g.id}: evidenceRef ${ref} not found`);
      if (g.status === 'not_applicable' && !(g.planRef && isDecision(g.planRef))) errors.push(`gate ${g.id}: not_applicable needs a planRef to a plan decision`);
    }
    for (const f of audit.findings || []) {
      for (const ref of f.evidenceRefs || []) if (!evidence.has(ref)) errors.push(`finding ${f.id}: evidenceRef ${ref} not found`);
      if (f.decisionRef && !isDecision(f.decisionRef)) errors.push(`finding ${f.id}: decisionRef ${f.decisionRef} not found`);
    }
    const findingsById = new Map((audit.findings || []).map(f => [f.id, f]));
    for (const x of audit.acceptedExceptions || []) {
      if (!isDecision(x.decisionRef)) errors.push(`exception ${x.id}: decisionRef ${x.decisionRef} not found`);
      if (x.findingId && !findingsById.has(x.findingId)) errors.push(`exception ${x.id}: finding ${x.findingId} not found`);
      if (findingsById.get(x.findingId)?.gate === 'G5') errors.push(`exception ${x.id}: G5 accessibility finding ${x.findingId} is a hard gate and cannot be accepted as an exception (§9.5)`);
    }
    for (const f of audit.findings || []) {
      if (f.gate === 'G5' && f.status === 'accepted') errors.push(`finding ${f.id}: G5 accessibility finding cannot be accepted (§9.5); resolve it or keep it open`);
      // §9.5: a new screen that reuses a failing style introduces the defect; it is not baseline.
      // (Other gates keep inherited_baseline for untouched properties inside library instances, §10.1.)
      if (f.gate === 'G5' && f.origin === 'inherited_baseline' && f.nodeId && createdByRun.has(f.nodeId)) errors.push(`finding ${f.id}: node ${f.nodeId} was created by this run, so its accessibility failure is introduced, not inherited_baseline (§9.5)`);
    }
    const g5 = (audit.gates || []).find(g => g.id === 'G5');
    const openG5 = (audit.findings || []).filter(f => f.gate === 'G5' && f.status === 'open' && f.origin !== 'inherited_baseline');
    if (g5?.status === 'pass' && openG5.length) errors.push(`gate G5 pass while G5 finding(s) ${openG5.map(f => f.id).join(', ')} are open`);
    const exceptionIds = new Set((audit.acceptedExceptions || []).map(x => x.id));
    for (const b of audit.metrics?.propertyBindings || []) {
      if (b.exceptionRef && !exceptionIds.has(b.exceptionRef) && !isDecision(b.exceptionRef)) errors.push(`metrics.propertyBindings ${b.nodeId} ${b.property}: exceptionRef ${b.exceptionRef} not found`);
      if (b.exceptionRef && b.binding !== 'raw') errors.push(`metrics.propertyBindings ${b.nodeId} ${b.property}: only raw values take an exceptionRef`);
    }
    for (const e of audit.evidence || []) {
      if (e.artifactRef && !fs.existsSync(path.join(run.dir || '.', e.artifactRef))) errors.push(`evidence ${e.id}: artifactRef ${e.artifactRef} does not exist`);
      for (const id of e.operationIds || []) if (!opsById.has(id) && !/^(rd|probe)-/.test(id)) errors.push(`evidence ${e.id}: operation ${id} not in journal`);
      // v1.6 (A03): evidence names the cells it covers; a cell key must exist and agree on screen,
      // viewport, state and mode.
      const cellsByKey = new Map((plan?.requiredCells || []).map(c => [c.key, c]));
      for (const key of e.cellKeys || []) {
        const cell = cellsByKey.get(key);
        if (!cell) { errors.push(`evidence ${e.id}: cellKey ${key} not found in plan.requiredCells`); continue; }
        if (cell.screenKey !== e.screenKey) errors.push(`evidence ${e.id}: cell ${key} belongs to screen ${cell.screenKey}, not ${e.screenKey}`);
        for (const f of ['viewport', 'state', 'mode']) {
          if (e[f] != null && cell[f] != null && e[f] !== cell[f]) errors.push(`evidence ${e.id}: ${f} ${e[f]} does not match cell ${key} (${cell[f]})`);
        }
      }
      // version: the write the evidence claims to show must exist and precede the capture
      if (e.subject && e.subject.afterOperationId) {
        const after = opsById.get(e.subject.afterOperationId);
        if (!after || after.mode !== 'write') errors.push(`evidence ${e.id}: subject.afterOperationId ${e.subject.afterOperationId} is not a write in the journal`);
        else if (e.toolRef?.capturedAt && effectTime(after) && effectTime(after) > e.toolRef.capturedAt) errors.push(`evidence ${e.id}: captured before ${after.operationId} took effect, so it cannot show that version`);
      }
      // stale or undeterminable evidence cannot stay current (A03: never guess valid)
      if (e.validity === 'current') {
        const v = evidenceValidity(e, ops, ledger);
        if (v.status === 'stale') errors.push(`evidence ${e.id}: stale, ${v.reason}; mark it superseded and re-read the composition`);
        else if (v.status === 'undeterminable') errors.push(`evidence ${e.id}: validity cannot be determined (${v.reason}); re-read the affected composition`);
      }
    }
    if (audit.taskType !== brief?.taskType && brief) errors.push(`audit.taskType ${audit.taskType} differs from brief.taskType ${brief.taskType}`);
  }

  // capabilities: unknown cannot be a write precondition
  if (capabilities && brief?.output?.writeAllowed) {
    if (!nativeWriteReady(run)) errors.push('capabilities.features.nativeWrite must be verified before writes are allowed (only the first write of a run may probe it, with basis "history")');
    if (capabilities.account && capabilities.account.status !== 'ok') errors.push('capabilities.account is blocked; writes are not allowed (§4.2.1)');
  }

  // v1.6 (A02) Plan/Build boundary: every authorisation, basis and capability a write needs.
  if (stage === 'build') errors.push(...buildReadiness(run, { isDecision }));

  return { errors, deferred };
}

// M4: a new run cannot verify nativeWrite before its first write, yet the Build boundary blocked that
// first write. The first write of a run may therefore act as the probe, but only when nativeWrite is
// available_unverified with basis "history" (verified in an earlier run) and this run has not dispatched
// any write yet. Once a write exists, nativeWrite must be verified in this run.
export function nativeWriteReady(run) {
  const w = run?.capabilities?.features?.nativeWrite;
  if (w?.status === 'verified') return true;
  const anyWrite = (run?.operations || []).some(o => o.mode === 'write' && !['planned', 'cancelled'].includes(o.status));
  return !anyWrite && w?.status === 'available_unverified' && w?.basis === 'history';
}

export function buildReadiness(run, { isDecision } = {}) {
  const errors = [];
  const { brief, plan, capabilities } = run;
  const known = isDecision || (id => [...(plan?.decisions || []), ...(plan?.designDecisions || [])].some(d => d.id === id));
  if (!brief || !plan) return ['build: brief.json and plan.json are required'];
  if (brief.taskType === 'audit' || plan.taskType === 'audit') errors.push('build: audit runs have no Build and must not write (INVARIANT-08)');
  const out = brief.output;
  if (brief.stage !== 'confirmed') errors.push('build: brief is not confirmed');
  if (!out?.writeAllowed || !out?.fileKey) errors.push('build: brief.output has no confirmed write authorisation (writeAllowed and fileKey)');
  if (!out?.decisionRef) errors.push('build: brief.output.decisionRef is missing');
  else if (!(plan.decisions || []).some(d => d.id === out.decisionRef) && !known(out.decisionRef)) errors.push(`build: brief.output.decisionRef ${out.decisionRef} does not resolve to a user decision`);
  if (plan.status !== 'confirmed') errors.push('build: plan is not confirmed');
  if (brief.taskType !== 'audit') {
    const flow = plan.flow;
    if (!flow) errors.push('build: plan.flow is missing; record the flow judgement (unchanged / partial / task_flow) before Build (A04)');
    else {
      if (flow.status !== 'confirmed') errors.push('build: plan.flow is not confirmed');
      const open = (flow.unknowns || []).filter(u => u.status === 'open').map(u => u.id);
      if (open.length) errors.push(`build: flow unknowns still open: ${open.join(', ')}; ask before building the affected screens`);
    }
    for (const s of plan.screens || []) {
      const unconfirmed = (s.copy || []).filter(c => c.status !== 'confirmed');
      const drafts = unconfirmed.filter(c => c.origin === 'draft').map(c => c.id);
      const pending = unconfirmed.filter(c => c.origin !== 'draft').map(c => c.id);
      if (drafts.length) errors.push(`build: screen ${s.screenKey} has draft copy (擬稿) ${drafts.join(', ')} the user has not confirmed (INVARIANT-30, DEC-14)`);
      if (pending.length) errors.push(`build: screen ${s.screenKey} has unconfirmed copy ${pending.join(', ')}; build with confirmed text, not placeholders`);
    }
    // v1.9 EXT-01: a delivery that depends on an unverified requirement needs the user's decision first
    for (const r of run.inventory?.externalRequirements || []) {
      if (r.status === 'unverified' && r.affectsDelivery && !r.decisionRef) errors.push(`build: external requirement ${r.id} (${r.subject}) is unverified and this delivery depends on it; ask the user how to proceed (EXT-01)`);
    }
    // v1.9 §8.1 6b: keys not checked for import fail in the middle of Build
    const unchecked = (plan.importChecks || []).filter(ic => ic.status === 'not_checked').map(ic => ic.id);
    if (unchecked.length) errors.push(`build: import not checked for ${unchecked.join(', ')}; check it before Build (§8.1 6b)`);
  }
  if (!capabilities) errors.push('build: capabilities.json is required');
  else {
    if (!nativeWriteReady(run)) errors.push('build: capabilities.features.nativeWrite must be verified in this run (only the first write may probe it, with basis "history")');
    if (!capabilities.account || capabilities.account.status !== 'ok') errors.push('build: capabilities.account must be ok for this run (§4.2.1)');
  }
  if (run.journalTruncated) errors.push('build: operations.jsonl has a truncated last line; reconcile first');
  const unresolved = (run.operations || []).filter(o => o.mode === 'write' && UNRESOLVED_WRITE.has(o.status)).map(o => `${o.operationId}=${o.status}`);
  if (unresolved.length) errors.push(`build: unresolved writes ${unresolved.join(', ')}; reconcile before planning more writes`);
  return errors;
}

// ---- v1.9 question flow phase 1 and common rules (§7.4 DEC-12–15, §8.1 EXT-01 / 6b, §9.6, §10.3, §20) ----
// Errors block; notices are hints for runs written before v1.9 (the fields are optional, schemaVersion
// stays 1.2).
export const DELEGABLE_KINDS = ['size', 'spacing', 'alignment', 'component_width', 'placeholder_size'];
export const EXCLUDED_TOPICS = ['copy', 'brand_asset', 'external_requirement', 'new_token', 'new_component', 'raw_value_exception', 'platform', 'write_scope'];

// DEC-12: the run's scoped delegation (a plan.decisions entry with delegation.allowedKinds), if any.
export function scopedDelegation(plan, ref) {
  const auth = (plan?.decisions || []).find(d => d.id === ref);
  return auth?.delegation ? auth : null;
}

// DEC-13: a sub-choice accepted together with its direction is not a separate substantive decision.
export function bundledWithDirection(d) {
  return Boolean(d.dependsOn) && d.confirmedWith === 'direction';
}

const textIn = (needle, ...hay) => hay.some(h => typeof h === 'string' && needle && h.includes(needle));

export function validateV19(run, { stage = 'final' } = {}) {
  const errors = [];
  const notices = [];
  const { plan, inventory, audit } = run;
  const dds = new Map((plan?.designDecisions || []).map(d => [d.id, d]));
  const decisions = new Map((plan?.decisions || []).map(d => [d.id, d]));
  const isDecision = id => dds.has(id) || decisions.has(id);
  const requirements = new Map((inventory?.externalRequirements || []).map(r => [r.id, r]));

  if (plan) {
    for (const d of plan.designDecisions || []) {
      // DEC-12 / INVARIANT-29: a delegated detail stays inside the run's authorised kinds, never touches
      // an excluded topic and belongs to a confirmed direction. Checking that the IDs exist is not enough.
      const auth = d.delegation ? scopedDelegation(plan, d.delegation.decisionRef) : null;
      if (auth) {
        const allowed = auth.delegation.allowedKinds || [];
        const excluded = new Set([...EXCLUDED_TOPICS, ...(auth.delegation.excludedKinds || [])]);
        if (!d.kind) errors.push(`designDecision ${d.id}: delegated under ${auth.id} without kind; a scoped delegation covers only ${allowed.join(', ')} (DEC-12)`);
        else if (!DELEGABLE_KINDS.includes(d.kind) || !allowed.includes(d.kind)) errors.push(`designDecision ${d.id}: kind ${d.kind} is not delegated by ${auth.id} (allowed: ${allowed.join(', ')}); ask it in the prefilled list (DEC-12, INVARIANT-29)`);
        if (d.topic && excluded.has(d.topic)) errors.push(`designDecision ${d.id}: topic ${d.topic} can never be delegated (copy, brand assets, external requirements, new tokens or components, raw-value exceptions, platform and write scope stay with the user, DEC-12)`);
        if (!d.directionRef) errors.push(`designDecision ${d.id}: delegated detail without directionRef; it must belong to a confirmed direction (INVARIANT-29)`);
      }
      if (d.directionRef) {
        const dir = dds.get(d.directionRef);
        if (!dir || dir.kind !== 'direction') errors.push(`designDecision ${d.id}: directionRef ${d.directionRef} is not a kind:direction design decision (INVARIANT-29)`);
        else if (decisionStatus(dir) !== 'answered') errors.push(`designDecision ${d.id}: direction ${dir.id} is not confirmed; details cannot be decided inside an unconfirmed direction (INVARIANT-29)`);
      }
      // DEC-13: sub-choices bundle only design choices of the same direction.
      if (d.dependsOn) {
        const dir = dds.get(d.dependsOn);
        if (!dir || dir.kind !== 'direction') errors.push(`designDecision ${d.id}: dependsOn ${d.dependsOn} is not a kind:direction design decision (DEC-13)`);
        if (d.kind === 'direction') errors.push(`designDecision ${d.id}: a direction cannot be a sub-choice of another direction (DEC-13)`);
        if (d.topic && EXCLUDED_TOPICS.includes(d.topic)) errors.push(`designDecision ${d.id}: ${d.topic} cannot be bundled into direction ${d.dependsOn}; platform, write scope, brand assets, copy and external requirements are separate rows (DEC-13)`);
        if (dir && decisionStatus(d) === 'answered') {
          if (decisionStatus(dir) !== 'answered') errors.push(`designDecision ${d.id}: answered while its direction ${dir.id} is not confirmed (DEC-13)`);
          else if (d.confirmedWith === 'direction' && dir.confirmation === 'user_modified') errors.push(`designDecision ${d.id}: the user changed direction ${dir.id}; ask its sub-choices as single rows (confirmedWith: row), do not confirm them with the bundle (DEC-13)`);
        }
      }
      for (const ref of d.requirementRefs || []) {
        if (!inventory) notices.push(`designDecision ${d.id}: requirementRef ${ref} resolves against inventory.json (not written yet)`);
        else if (!requirements.has(ref)) errors.push(`designDecision ${d.id}: requirementRef ${ref} not found in inventory.externalRequirements`);
      }
    }
    for (const a of (plan.decisions || []).filter(x => x.delegation)) {
      const missing = EXCLUDED_TOPICS.filter(t => !(a.delegation.excludedKinds || []).includes(t));
      if (missing.length) notices.push(`decision ${a.id}: delegation does not list ${missing.join(', ')} as excluded; they are excluded anyway (DEC-12), list them so the user sees the boundary`);
    }

    // DEC-14 / INVARIANT-30: user copy is the user's own words, never the example inside a question.
    let legacyCopy = 0;
    for (const s of plan.screens || []) for (const c of s.copy || []) {
      const label = `screen ${s.screenKey} copy ${c.id}`;
      if (!c.origin) { legacyCopy++; continue; }
      if (c.origin === 'user' && c.sourceRef && isDecision(c.sourceRef)) {
        const dd = dds.get(c.sourceRef);
        const own = dd ? dd.answer : decisions.get(c.sourceRef).decision;
        if (!textIn(c.text, own)) {
          const fromQuestion = dd && textIn(c.text, dd.question, dd.context, dd.recommendation, ...(dd.options || []));
          errors.push(`${label}: origin user but "${c.text}" is not in the answer of ${c.sourceRef}${fromQuestion ? '; it only appears in the question or its options — an example in the question is not the user\'s text (mark it draft and confirm it, INVARIANT-30)' : ''}`);
        }
      }
      if (c.decisionRef && !isDecision(c.decisionRef)) errors.push(`${label}: decisionRef ${c.decisionRef} not found in plan decisions`);
      else if (c.origin === 'draft' && c.status === 'confirmed' && dds.has(c.decisionRef) && decisionStatus(dds.get(c.decisionRef)) !== 'answered') errors.push(`${label}: draft confirmed through ${c.decisionRef}, which is not answered (INVARIANT-30)`);
    }
    if (legacyCopy) notices.push(`${legacyCopy} copy item(s) without origin (written before v1.9, DEC-14): handoff cannot tell drafts from the user's text`);

    // §8.1 step 6b: component and style keys are checked for import before Plan, not during Build.
    const reuse = (plan.componentMap || []).filter(c => c.decision === 'reuse');
    const componentMap = new Map((plan.componentMap || []).map(c => [c.id, c]));
    if (plan.importChecks) {
      for (const ic of plan.importChecks) {
        if (ic.componentMapRef && !componentMap.has(ic.componentMapRef)) errors.push(`importCheck ${ic.id}: componentMapRef ${ic.componentMapRef} not found`);
        if (ic.listedToUserRef && !isDecision(ic.listedToUserRef)) errors.push(`importCheck ${ic.id}: listedToUserRef ${ic.listedToUserRef} not found`);
        if (ic.status === 'not_importable' && plan.status === 'confirmed' && !ic.listedToUserRef) errors.push(`importCheck ${ic.id}: not importable and the fallback was not listed to the user before confirming the plan (§8.1 6b)`);
      }
      for (const c of reuse.filter(c => c.source?.kind === 'published_library')) {
        if (!plan.importChecks.some(ic => ic.componentMapRef === c.id)) errors.push(`componentMap ${c.id}: no importCheck; confirm the key imports into the output file before Plan (§8.1 6b)`);
      }
    } else if (reuse.length) notices.push('plan.importChecks missing (before v1.9): import of component and style keys was not checked before Plan (§8.1 6b)');

    // §10.3: fonts of every instance the plan creates come from its main component.
    if (inventory) {
      const checks = inventory.componentFontChecks;
      if (checks) {
        const installed = new Set((inventory.fonts || []).map(f => `${f.family}/${f.style}`));
        for (const ch of checks) {
          if (!componentMap.has(ch.componentMapRef)) errors.push(`componentFontCheck ${ch.componentMapRef}: not found in plan.componentMap`);
          for (const f of ch.fonts) if (!installed.has(`${f.family}/${f.style}`)) errors.push(`componentFontCheck ${ch.componentMapRef}: font ${f.family} ${f.style} is not in inventory.fonts (record whether it is installed, §10.3)`);
        }
        for (const c of reuse) {
          const mine = checks.filter(ch => ch.componentMapRef === c.id);
          if (!mine.some(ch => ch.source === 'main_component')) errors.push(`componentMap ${c.id}: fonts not read from the main component${mine.length ? ' (a reference instance may carry font overrides a new instance does not get)' : ''} (§10.3)`);
        }
      } else if (reuse.length) notices.push('inventory.componentFontChecks missing (before v1.9): fonts of new instances were not read from their main components (§10.3)');
    }
  }

  // EXT-01: verified requirements carry their source; unverified ones are never facts.
  const seen = new Set();
  for (const r of inventory?.externalRequirements || []) {
    if (seen.has(r.id)) errors.push(`duplicate externalRequirement id ${r.id}`);
    seen.add(r.id);
    if (r.decisionRef && plan && !isDecision(r.decisionRef)) errors.push(`externalRequirement ${r.id}: decisionRef ${r.decisionRef} not found in plan decisions`);
  }

  // §9.6 ruleChecks: never a replacement for gates or the completion rule.
  if (audit?.ruleChecks && stage === 'final') {
    const findings = new Set((audit.findings || []).map(f => f.id));
    const exceptions = new Set((audit.acceptedExceptions || []).map(x => x.id));
    const ivr = audit.implementationVerificationRequired || [];
    for (const rc of audit.ruleChecks) {
      const label = `ruleCheck ${rc.ruleId}${rc.nodeIds?.length ? ` (${rc.nodeIds.join(', ')})` : ''}`;
      if (rc.status === 'fail' && rc.affectsDelivery === undefined) errors.push(`${label}: fail must say whether it affects delivery (a fail that does becomes a finding, §9.6)`);
      if (rc.findingRef && !findings.has(rc.findingRef)) errors.push(`${label}: findingRef ${rc.findingRef} not found in audit.findings`);
      if (rc.exceptionRef && !exceptions.has(rc.exceptionRef) && !isDecision(rc.exceptionRef)) errors.push(`${label}: exceptionRef ${rc.exceptionRef} not found`);
      if (rc.status === 'not_tested' && !ivr.some(x => x.includes(rc.ruleId))) errors.push(`${label}: not_tested must be listed in implementationVerificationRequired (it is not a pass, §9.6)`);
    }
  }
  return { errors, notices };
}

// ---- v1.7 product policies (§4.6, §7.5, §9.5, §12.1, §20) ----
// Errors block; notices are hints (runs created before v1.7, policy changed during the run).
const CONTRAST_PRECHECK = new Set(['text_contrast', 'non_text_contrast']);
const isContrastFinding = f => /contrast/i.test(f.category || '');
const isContrastRuleCheck = rc => [rc.reason, rc.verification, rc.before, rc.after].some(v => v != null && /contrast|對比|\b\d+(\.\d+)?:1\b/i.test(typeof v === 'string' ? v : JSON.stringify(v)));

export function validateProductPolicy(run, { stage = 'final', root } = {}) {
  const errors = [];
  const notices = [];
  const { brief, plan, audit } = run;
  if (!brief) return { errors, notices };
  const policyRoot = root || run.root;
  const cache = new Map();
  const resolve = ref => resolvePolicyRef(ref, { root: policyRoot, cache });
  const product = brief.product;
  if (!product) notices.push('brief.product missing: run created before v1.7; product policies were not applied (REQ-05 hint only)');
  else if (product.productId === null) {
    if (brief.stage === 'confirmed') errors.push('brief.product.productId is not determined: ask the user which product this is before confirming intake (REQ-05, INVARIANT-25)');
  } else {
    const loaded = loadPolicy(product.productId, { root: policyRoot });
    if (!loaded.exists && !product.newProduct) notices.push(`product-policies/${product.productId}.json not found: new product? ask the user whether to create it (POL-02)`);
    if (loaded.exists && product.policyDigest && loaded.digest !== product.policyDigest) notices.push(`product policy ${product.productId} changed after it was applied to this run (digest differs): re-confirm the applied policies`);
    for (const a of product.appliedPolicies || []) { const r = resolve(a.policyRef); if (!r.ok) notices.push(`brief.product.appliedPolicies: ${r.reason}`); }
  }
  const productId = product?.productId || null;
  for (const d of plan?.designDecisions || []) {
    if (!d.policyRef) continue;
    const r = resolve(d.policyRef);
    if (!r.ok) errors.push(`designDecision ${d.id}: ${r.reason}`);
    else if (productId && r.productId !== productId) errors.push(`designDecision ${d.id}: policyRef ${d.policyRef} belongs to ${r.productId}, not to this run's product ${productId}`);
  }
  for (const d of plan?.decisions || []) {
    if (d.policyRef) { const r = resolve(d.policyRef); if (!r.ok) notices.push(`decision ${d.id}: ${r.reason}`); }
    if (d.policySuggestion?.conflictsWith) { const r = resolve(d.policySuggestion.conflictsWith); if (!r.ok) errors.push(`decision ${d.id}: policySuggestion.conflictsWith ${r.reason}`); }
  }
  // contrast policy (§9.5): required=false → no contrast checks, findings or questions; G5 records it
  const contrast = productId ? contrastPolicy(productId, { root: policyRoot }) : { decided: false };
  const g5 = (audit?.gates || []).find(g => g.id === 'G5');
  const g5Refs = [g5?.contrast?.status === 'not_applicable' ? g5.contrast.policyRef : null, g5?.status === 'not_applicable' ? g5.policyRef : null].filter(Boolean);
  if (g5?.contrast?.status === 'not_applicable' && !g5.contrast.policyRef) errors.push('gate G5: contrast not_applicable needs a policyRef to the product contrast policy (§12.1)');
  for (const ref of g5Refs) {
    const r = resolve(ref);
    if (!r.ok) errors.push(`gate G5: ${r.reason}`);
    else if (r.key !== 'accessibility.contrast' || r.item.value.required !== false) errors.push(`gate G5: ${ref} does not make contrast not applicable (needs accessibility.contrast.required = false)`);
    else if (productId && r.productId !== productId) errors.push(`gate G5: ${ref} belongs to ${r.productId}, not to this run's product ${productId}`);
  }
  if (contrast.decided && contrast.required === false) {
    for (const c of plan?.accessibilityPrecheck || []) if (CONTRAST_PRECHECK.has(c.kind)) errors.push(`accessibilityPrecheck ${c.id}: product policy ${contrast.policyRef} says contrast is not checked; remove contrast items (other accessibility items stay)`);
    for (const f of audit?.findings || []) if (isContrastFinding(f)) errors.push(`finding ${f.id}: product policy ${contrast.policyRef} says contrast is not checked; no contrast findings (§9.5)`);
    // v1.9 §9.6 (T94): common rules never bring contrast back (SYS-08 checks modes without contrast)
    for (const rc of audit?.ruleChecks || []) if (isContrastRuleCheck(rc)) errors.push(`ruleCheck ${rc.ruleId}: product policy ${contrast.policyRef} says contrast is not checked; common rules do not add contrast items (§9.6)`);
    if (audit && stage === 'final' && g5 && !g5Refs.includes(contrast.policyRef)) errors.push(`gate G5: record contrast as not_applicable with policyRef ${contrast.policyRef} (other accessibility items still decide G5)`);
  }
  if (g5Refs.length && (!contrast.decided || contrast.required !== false)) errors.push('gate G5: contrast is not_applicable by policy, but this run\'s product has no policy accessibility.contrast.required = false');
  return { errors, notices };
}

export function validateRun(dir, opts = {}) {
  const stage = checkStage(opts.stage || 'final');
  const run = loadRun(dir, opts);
  const schemaErrors = validateRunSchemas(run, { ...opts, stage });
  const { errors: semanticErrors, deferred } = validateRunSemantics(run, { stage });
  const policy = validateProductPolicy(run, { stage, root: opts.root });
  const v19 = validateV19(run, { stage });
  semanticErrors.push(...policy.errors, ...v19.errors);
  return { ok: schemaErrors.length === 0 && semanticErrors.length === 0, stage, schemaErrors, semanticErrors, deferred, notices: [...policy.notices, ...v19.notices], run };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--stage');
  const stage = at >= 0 ? args[at + 1] : 'final';
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--stage');
  if (!dir || !STAGES.includes(stage)) { console.error(`usage: validate-artifacts.mjs <runDir> [--stage ${STAGES.join('|')}]  (default final = every check)`); process.exit(2); }
  const { ok, schemaErrors, semanticErrors, deferred, notices } = validateRun(dir, { stage });
  console.log(JSON.stringify({ ok, stage, schemaErrors, semanticErrors, deferred, notices, ...(schemaErrors.length ? { hint: SKELETON_HINT } : {}) }, null, 2));
  process.exit(ok ? 0 : 1);
}
