#!/usr/bin/env node
// Artifact validator (spec §20): JSON Schema (syntax) checks and cross-file (semantic) checks are
// implemented separately. Usage: node scripts/validate-artifacts.mjs <runDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJsonl, operationStates } from './hooks/lib.mjs';
import { precheckContrast } from './quality-metrics.mjs';

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
export const CONTRACTS = ['brief', 'plan', 'inventory', 'capabilities', 'ledger', 'audit'];

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

// ---- syntax: one document against one schema ----
export function validateSchema(name, doc) {
  const validate = getAjv().getSchema(schemaId(name));
  if (!validate) throw new Error(`unknown schema ${name}`);
  const ok = validate(doc);
  return ok ? [] : validate.errors.map(e => `${name}${e.instancePath || ''} ${e.message}${e.params && e.params.allowedValues ? ` (${e.params.allowedValues.join('|')})` : ''}${e.params && e.params.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
}

export function loadRun(dir) {
  const read = f => {
    const file = path.join(dir, f);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
  };
  const run = { dir };
  for (const c of CONTRACTS) run[c] = read(`${c}.json`);
  const journal = readJsonl(path.join(dir, 'operations.jsonl'));
  run.journalRecords = journal.records;
  run.journalTruncated = journal.truncatedTail;
  run.operations = [...operationStates(journal.records).values()];
  return run;
}

export function validateRunSchemas(run, { required = CONTRACTS } = {}) {
  const errors = [];
  for (const c of CONTRACTS) {
    if (run[c] === undefined) { if (required.includes(c)) errors.push(`${c}.json missing`); continue; }
    errors.push(...validateSchema(c, run[c]));
  }
  for (const op of run.operations || []) {
    errors.push(...validateSchema('operation', op).map(e => e.replace(/^operation/, `operation ${op.operationId}`)));
  }
  if (run.journalTruncated) errors.push('operations.jsonl has a truncated last line (reconcile before continuing)');
  return errors;
}

// ---- semantics: references across files ----
export function validateRunSemantics(run) {
  const errors = [];
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
    for (const ref of brief.decisionRefs || []) if (plan && !isDecision(ref)) errors.push(`brief.decisionRefs: ${ref} not found in plan decisions`);
    const out = brief.output;
    if (out && out.writeAllowed && plan && out.decisionRef && !isDecision(out.decisionRef)) errors.push(`brief.output.decisionRef ${out.decisionRef} not found in plan decisions`);
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
    const unresolved = ops.filter(o => ['dispatched', 'unknown_outcome'].includes(o.status)).map(o => o.operationId);
    const listed = new Set((ledger.pendingOperations || []).map(o => o.operationId));
    for (const id of unresolved) if (!listed.has(id)) errors.push(`ledger.pendingOperations is missing unresolved operation ${id}`);

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

  // audit
  if (audit) {
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
      // stale screenshot/structure: a later mutation touched this node
      if (e.validity === 'current' && e.nodeId && e.toolRef?.capturedAt) {
        for (const op of ops) {
          const touched = [...(op.createdNodeIds || []), ...(op.mutatedNodeIds || [])];
          const at = op.timestamps?.appliedAt || op.timestamps?.verifiedAt;
          if (op.mode === 'write' && touched.includes(e.nodeId) && at && at > e.toolRef.capturedAt) errors.push(`evidence ${e.id}: stale, ${op.operationId} changed ${e.nodeId} after capture`);
        }
      }
    }
    if (audit.taskType !== brief?.taskType && brief) errors.push(`audit.taskType ${audit.taskType} differs from brief.taskType ${brief.taskType}`);
  }

  // capabilities: unknown cannot be a write precondition
  if (capabilities && brief?.output?.writeAllowed) {
    const write = capabilities.features?.nativeWrite;
    if (!write || write.status !== 'verified') errors.push('capabilities.features.nativeWrite must be verified before writes are allowed');
    if (capabilities.account && capabilities.account.status !== 'ok') errors.push('capabilities.account is blocked; writes are not allowed (§4.2.1)');
  }

  return errors;
}

export function validateRun(dir, opts = {}) {
  const run = loadRun(dir);
  const schemaErrors = validateRunSchemas(run, opts);
  const semanticErrors = validateRunSemantics(run);
  return { ok: schemaErrors.length === 0 && semanticErrors.length === 0, schemaErrors, semanticErrors, run };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: validate-artifacts.mjs <runDir>'); process.exit(2); }
  const { ok, schemaErrors, semanticErrors } = validateRun(dir);
  console.log(JSON.stringify({ ok, schemaErrors, semanticErrors }, null, 2));
  process.exit(ok ? 0 : 1);
}
