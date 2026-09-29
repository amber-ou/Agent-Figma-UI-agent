#!/usr/bin/env node
// Logging-only PostToolUse / PostToolUseFailure hook for every Figma MCP tool (spec v1.6 §14, A06/A07).
// It never blocks and never changes the journal. It records:
// - .figma-ui/session.json: the Claude Code session id of the latest Figma call (lets
//   verify-installation.mjs reuse a diagnosis within the same session);
// - hook-events.jsonl: tool name, duration and session for Figma tools that the write-path hooks do
//   not already log (use_figma / create_new_file / upload_assets are logged by post-figma-call.mjs).
// No tool input or response content is stored.
import path from 'node:path';
import { readStdin, projectDir, stateDir, readJson, logEvent, nowIso } from './lib.mjs';
import { atomicWriteJson } from '../state-store.mjs';

export const WRITE_PATH_TOOL = /__(use_figma|create_new_file|upload_assets)$/;

export function toolCategory(toolName = '') {
  if (/__get_screenshot$/.test(toolName)) return 'screenshot';
  if (WRITE_PATH_TOOL.test(toolName)) return 'use_figma_or_write';
  return 'read';
}

try {
  const input = await readStdin();
  const root = projectDir(input);
  const toolName = input.tool_name || '';
  if (input.session_id) atomicWriteJson(path.join(stateDir(root), 'session.json'), { sessionId: input.session_id, seenAt: nowIso(), toolName });
  if (!WRITE_PATH_TOOL.test(toolName)) {
    const active = readJson(path.join(stateDir(root), 'active-run.json'));
    logEvent(root, {
      event: input.hook_event_name || 'PostToolUse', toolName, category: toolCategory(toolName), toolUseId: input.tool_use_id,
      activeRun: active?.runId ?? null, sessionId: input.session_id ?? null, durationMs: input.duration_ms ?? null,
    });
  }
} catch (err) {
  process.stderr.write(`figma-ui log hook error: ${err && err.message ? err.message : String(err)}\n`);
}
process.exit(0);
