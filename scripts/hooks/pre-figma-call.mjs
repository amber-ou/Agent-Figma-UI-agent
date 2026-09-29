#!/usr/bin/env node
// PreToolUse hook for Figma MCP calls (spec §4.5).
// "Pass" means exit 0 with no decision output, so Claude Code's normal permission flow still
// applies. Only a deny emits a permissionDecision (an explicit "allow" would skip the prompt).
// - No active run → pass (does not interfere with non-agent use).
// - Missing/invalid op header → deny.
// - mode=read → deny if the operationId belongs to an existing write op (it would overwrite
//   that op's status, e.g. clear unknown_outcome); otherwise record and pass.
// - mode=write → require confirmed brief output, matching fileKey, lock held by this run,
//   a planned write operation for the same fileKey with basisRefs, and no
//   dispatched/unknown_outcome writes on the same file; then append `dispatched` and pass.
// - Any internal error → deny writes, pass reads (never silently pass a write).
import fs from 'node:fs';
import path from 'node:path';
import {
  readStdin, projectDir, stateDir, readJson, readJsonl, appendJsonl, operationStates,
  parseOpHeader, sha256, runDirFor, nowIso, logEvent, UNRESOLVED,
} from './lib.mjs';

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

function pass() {
  process.exit(0);
}

let input = {};
let header = null;
try {
  input = await readStdin();
  const root = projectDir(input);
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const active = readJson(path.join(stateDir(root), 'active-run.json'));

  header = parseOpHeader(toolInput.code);
  logEvent(root, {
    event: 'PreToolUse', toolName, toolUseId: input.tool_use_id, activeRun: active?.runId ?? null, sessionId: input.session_id ?? null,
    header, fileKey: toolInput.fileKey ?? null, codeSha256: toolInput.code ? sha256(toolInput.code) : null,
  });

  if (!active) pass();

  if (!toolName.endsWith('__use_figma')) {
    deny(`figma-ui: ${toolName} is not enabled for run ${active.runId} (M1 only routes writes through use_figma with an op header)`);
  }
  if (!header) {
    deny('figma-ui: missing op header. First line must be: // figma-ui run=<runId> op=<operationId> mode=read|write');
  }
  if (header.runId !== active.runId) {
    deny(`figma-ui: op header run=${header.runId} does not match active run ${active.runId}`);
  }

  const runDir = runDirFor(root, active.runId);
  const journalFile = path.join(runDir, 'operations.jsonl');
  const { records, truncatedTail } = readJsonl(journalFile);
  const ops = operationStates(records);
  const op = ops.get(header.operationId);

  if (header.mode === 'read') {
    if (op && op.mode === 'write') {
      deny(`figma-ui: read uses operationId ${header.operationId}, which belongs to a write operation (status=${op.status}); use a separate read operationId`);
    }
    appendJsonl(journalFile, { operationId: header.operationId, runId: active.runId, mode: 'read', status: 'dispatched', fileKey: toolInput.fileKey, toolUseId: input.tool_use_id, codeSha256: sha256(toolInput.code), timestamps: { dispatchedAt: nowIso() } });
    pass();
  }

  // ---- write path ----
  if (truncatedTail) deny('figma-ui: operations.jsonl has a truncated last line; reconcile before writing (spec §11.7)');

  const brief = readJson(path.join(runDir, 'brief.json'));
  const out = brief?.output;
  if (!brief || brief.stage !== 'confirmed' || !out?.writeAllowed || !out?.decisionRef) {
    deny('figma-ui: brief.output is not confirmed with writeAllowed=true and a decisionRef');
  }
  if (toolInput.fileKey !== out.fileKey) {
    deny(`figma-ui: fileKey ${toolInput.fileKey} is not the authorized output ${out.fileKey}`);
  }

  const lock = readJson(path.join(stateDir(root), 'locks', `${out.fileKey}.json`));
  if (!lock || lock.runId !== active.runId || lock.ownerToken !== active.ownerToken) {
    deny(`figma-ui: local writer lock for ${out.fileKey} is not held by run ${active.runId}`);
  }

  const blocking = [...ops.values()].filter(o => o.mode === 'write' && o.fileKey === out.fileKey && UNRESOLVED.has(o.status));
  if (blocking.length) {
    deny(`figma-ui: unresolved write(s) on this file: ${blocking.map(o => `${o.operationId}=${o.status}`).join(', ')}; reconcile first (spec §11.4)`);
  }

  if (!op || op.status !== 'planned') {
    deny(`figma-ui: operation ${header.operationId} must exist in the journal with status=planned (found ${op ? op.status : 'none'})`);
  }
  if (op.mode !== 'write' || op.fileKey !== out.fileKey) {
    deny(`figma-ui: planned operation ${header.operationId} must have mode=write and fileKey=${out.fileKey} (found mode=${op.mode}, fileKey=${op.fileKey})`);
  }
  if (!Array.isArray(op.basisRefs) || op.basisRefs.length === 0) {
    deny(`figma-ui: operation ${header.operationId} has no basisRefs (spec §7.4 DEC-06)`);
  }

  appendJsonl(journalFile, { operationId: header.operationId, runId: active.runId, mode: 'write', fileKey: out.fileKey, status: 'dispatched', toolUseId: input.tool_use_id, codeSha256: sha256(toolInput.code), timestamps: { ...(op.timestamps || {}), dispatchedAt: nowIso() } });
  pass();
} catch (err) {
  const reason = `figma-ui hook error: ${err && err.message ? err.message : String(err)}`;
  try { logEvent(projectDir(input), { event: 'PreToolUse:error', reason }); } catch { /* ignore */ }
  if (header && header.mode === 'read') pass();
  deny(reason + ' (write blocked)');
}
