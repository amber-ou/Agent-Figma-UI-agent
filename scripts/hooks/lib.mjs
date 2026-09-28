// Shared helpers for the figma-ui PreToolUse / PostToolUse hooks (spec §4.5, §11.3).
// M1 scope: minimal enforcement. Heartbeat / PID-reuse checks are P1 (spec §11.1).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const OP_HEADER_RE = /^\s*\/\/\s*figma-ui\s+run=([A-Za-z0-9._-]+)\s+op=([A-Za-z0-9._-]+)\s+mode=(read|write)\b/;
export const UNRESOLVED = new Set(['dispatched', 'unknown_outcome']);

export async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data ? JSON.parse(data) : {};
}

export function projectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

export function stateDir(root) {
  return path.join(root, '.figma-ui');
}

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function appendJsonl(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
}

// Returns { records, truncatedTail } — a torn last line is reported, never silently dropped (spec §11.7).
export function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { records: [], truncatedTail: false }; }
  const lines = text.split('\n');
  const records = [];
  let truncatedTail = false;
  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    try { records.push(JSON.parse(line)); } catch { if (idx >= lines.length - 2) truncatedTail = true; else throw new Error(`corrupt journal line ${idx + 1}`); }
  });
  return { records, truncatedTail };
}

// Latest record per operationId wins (event-sourced journal); timestamps are merged, not replaced.
export function operationStates(records) {
  const byId = new Map();
  for (const r of records) {
    if (!r.operationId) continue;
    const prev = byId.get(r.operationId) || {};
    const merged = { ...prev, ...r };
    if (prev.timestamps || r.timestamps) merged.timestamps = { ...(prev.timestamps || {}), ...(r.timestamps || {}) };
    byId.set(r.operationId, merged);
  }
  return byId;
}

export function parseOpHeader(code) {
  const m = typeof code === 'string' ? code.match(OP_HEADER_RE) : null;
  return m ? { runId: m[1], operationId: m[2], mode: m[3] } : null;
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

// Resolve a run directory strictly inside <root>/design-runs (spec §11.7: reject traversal).
export function runDirFor(root, runId) {
  const base = path.resolve(root, 'design-runs');
  const dir = path.resolve(base, runId);
  if (!dir.startsWith(base + path.sep)) throw new Error(`runId escapes design-runs: ${runId}`);
  return dir;
}

export function nowIso() {
  return new Date().toISOString();
}

export function logEvent(root, record) {
  appendJsonl(path.join(stateDir(root), 'hook-events.jsonl'), { at: nowIso(), ...record });
}
