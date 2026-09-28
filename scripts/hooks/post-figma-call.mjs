#!/usr/bin/env node
// PostToolUse / PostToolUseFailure hook for Figma MCP calls (spec §4.5, §11.3, §11.5).
// Success → `applied` (never `verified`; verification is a separate step).
// Failure → `failed_known` only when the response states safeToRetryWithoutCanvasRead=true
//           (figma-use skill Rule 14); otherwise `unknown_outcome`.
import path from 'node:path';
import {
  readStdin, projectDir, stateDir, readJson, appendJsonl, parseOpHeader, runDirFor, nowIso, logEvent,
} from './lib.mjs';

const MAX_SUMMARY = 4000;

function summarize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > MAX_SUMMARY ? text.slice(0, MAX_SUMMARY) + `…[truncated ${text.length - MAX_SUMMARY} chars]` : text;
}

function safeToRetryFlag(text) {
  const m = /"?safeToRetryWithoutCanvasRead"?\s*[:=]\s*(true|false)/.exec(text);
  return m ? m[1] === 'true' : null;
}

try {
  const input = await readStdin();
  const root = projectDir(input);
  const event = input.hook_event_name || 'PostToolUse';
  const toolInput = input.tool_input || {};
  const header = parseOpHeader(toolInput.code);
  const active = readJson(path.join(stateDir(root), 'active-run.json'));
  const rawResult = event === 'PostToolUseFailure' ? (input.error ?? input.tool_response) : input.tool_response;
  const resultText = summarize(rawResult);

  logEvent(root, { event, toolName: input.tool_name, toolUseId: input.tool_use_id, activeRun: active?.runId ?? null, header, inputKeys: Object.keys(input) });

  if (!active || !header || header.runId !== active.runId) process.exit(0);

  const journalFile = path.join(runDirFor(root, active.runId), 'operations.jsonl');
  if (event === 'PostToolUseFailure') {
    const flag = safeToRetryFlag(resultText);
    const status = header.mode === 'write' && flag !== true ? 'unknown_outcome' : 'failed_known';
    appendJsonl(journalFile, { operationId: header.operationId, status, toolUseId: input.tool_use_id, safeToRetryWithoutCanvasRead: flag, errorSummary: resultText, timestamps: { failedAt: nowIso() } });
  } else {
    appendJsonl(journalFile, { operationId: header.operationId, status: 'applied', toolUseId: input.tool_use_id, resultSummary: resultText, timestamps: { appliedAt: nowIso() } });
  }
} catch (err) {
  // Post hooks cannot undo a call; surface the problem without blocking.
  process.stderr.write(`figma-ui post hook error: ${err && err.message ? err.message : String(err)}\n`);
}
process.exit(0);
