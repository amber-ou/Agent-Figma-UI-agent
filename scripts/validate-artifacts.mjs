#!/usr/bin/env node
// Artifact validator (spec §20): JSON Schema (syntax) checks and cross-file (semantic) checks are
// implemented separately. Usage: node scripts/validate-artifacts.mjs <runDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJsonl, operationStates } from './hooks/lib.mjs';

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
  const answered = id => decisions.has(id) || (designDecisions.has(id) && designDecisions.get(id).answer);

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
      else if (designDecisions.has(ref) && !designDecisions.get(ref).answer) errors.push(`operation ${op.operationId}: basisRef ${ref} is an unanswered design decision (INVARIANT-11)`);
    }
  }

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
  }

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
    for (const x of audit.acceptedExceptions || []) {
      if (!isDecision(x.decisionRef)) errors.push(`exception ${x.id}: decisionRef ${x.decisionRef} not found`);
      if (x.findingId && !(audit.findings || []).some(f => f.id === x.findingId)) errors.push(`exception ${x.id}: finding ${x.findingId} not found`);
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
