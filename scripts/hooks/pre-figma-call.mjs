#!/usr/bin/env node
// PreToolUse hook for Figma MCP calls (spec §4.5).
// - No active run → allow (does not interfere with non-agent use).
// - Missing/invalid op header → deny.
// - mode=read → record and allow.
// - mode=write → require confirmed brief output, matching fileKey, lock held by this run,
//   a planned operation record, and no dispatched/unknown_outcome ops on the same file;
//   then append `dispatched` and allow.
// - Any internal error → deny writes, allow reads (never silently allow a write).
import fs from 'node:fs';
import path from 'node:path';
import {
  readStdin, projectDir, stateDir, readJson, readJsonl, appendJsonl, operationStates,
  parseOpHeader, sha256, runDirFor, nowIso, logEvent, UNRESOLVED,
} from './lib.mjs';

function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
  }));
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
    event: 'PreToolUse', toolName, toolUseId: input.tool_use_id, activeRun: active?.runId ?? null,
    header, fileKey: toolInput.fileKey ?? null, codeSha256: toolInput.code ? sha256(toolInput.code) : null,
  });

  if (!active) decide('allow', 'figma-ui: no active run');

  if (!toolName.endsWith('__use_figma')) {
    decide('deny', `figma-ui: ${toolName} is not enabled for run ${active.runId} (M1 only routes writes through use_figma with an op header)`);
  }
  if (!header) {
    decide('deny', 'figma-ui: missing op header. First line must be: // figma-ui run=<runId> op=<operationId> mode=read|write');
  }
  if (header.runId !== active.runId) {
    decide('deny', `figma-ui: op header run=${header.runId} does not match active run ${active.runId}`);
  }

  const runDir = runDirFor(root, active.runId);
  const journalFile = path.join(runDir, 'operations.jsonl');
  const { records, truncatedTail } = readJsonl(journalFile);
  const ops = operationStates(records);

  if (header.mode === 'read') {
    appendJsonl(journalFile, { operationId: header.operationId, runId: active.runId, mode: 'read', status: 'dispatched', fileKey: toolInput.fileKey, toolUseId: input.tool_use_id, codeSha256: sha256(toolInput.code), timestamps: { dispatchedAt: nowIso() } });
    decide('allow', 'figma-ui: read recorded');
  }

  // ---- write path ----
  if (truncatedTail) decide('deny', 'figma-ui: operations.jsonl has a truncated last line; reconcile before writing (spec §11.7)');

  const brief = readJson(path.join(runDir, 'brief.json'));
  const out = brief?.output;
  if (!brief || brief.stage !== 'confirmed' || !out?.writeAllowed || !out?.decisionRef) {
    decide('deny', 'figma-ui: brief.output is not confirmed with writeAllowed=true and a decisionRef');
  }
  if (toolInput.fileKey !== out.fileKey) {
    decide('deny', `figma-ui: fileKey ${toolInput.fileKey} is not the authorized output ${out.fileKey}`);
  }

  const lock = readJson(path.join(stateDir(root), 'locks', `${out.fileKey}.json`));
  if (!lock || lock.runId !== active.runId || lock.ownerToken !== active.ownerToken) {
    decide('deny', `figma-ui: local writer lock for ${out.fileKey} is not held by run ${active.runId}`);
  }

  const blocking = [...ops.values()].filter(o => o.mode === 'write' && o.fileKey === out.fileKey && UNRESOLVED.has(o.status));
  if (blocking.length) {
    decide('deny', `figma-ui: unresolved write(s) on this file: ${blocking.map(o => `${o.operationId}=${o.status}`).join(', ')}; reconcile first (spec §11.4)`);
  }

  const op = ops.get(header.operationId);
  if (!op || op.status !== 'planned') {
    decide('deny', `figma-ui: operation ${header.operationId} must exist in the journal with status=planned (found ${op ? op.status : 'none'})`);
  }
  if (!Array.isArray(op.basisRefs) || op.basisRefs.length === 0) {
    decide('deny', `figma-ui: operation ${header.operationId} has no basisRefs (spec §7.4 DEC-06)`);
  }

  appendJsonl(journalFile, { operationId: header.operationId, status: 'dispatched', toolUseId: input.tool_use_id, codeSha256: sha256(toolInput.code), timestamps: { ...(op.timestamps || {}), dispatchedAt: nowIso() } });
  decide('allow', `figma-ui: ${header.operationId} dispatched`);
} catch (err) {
  const reason = `figma-ui hook error: ${err && err.message ? err.message : String(err)}`;
  try { logEvent(projectDir(input), { event: 'PreToolUse:error', reason }); } catch { /* ignore */ }
  if (header && header.mode === 'read') decide('allow', reason + ' (read allowed)');
  decide('deny', reason + ' (write blocked)');
}
