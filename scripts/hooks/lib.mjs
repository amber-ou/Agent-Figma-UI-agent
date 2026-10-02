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

// M4: heuristic static check for scripts declared mode=read. Found after ui-20260929-002 rd-0009, a
// "read" that created and removed temporary instances on a page outside the output scope.
// LIMITS (heuristic, not a guarantee): it only sees the literal source text. It misses mutations
// reached indirectly (computed property names such as node['fi' + 'lls'], aliases like
// const f = figma; f['create' + 'Frame'](), eval / new Function, helper objects defined elsewhere) and
// it can flag harmless code (a local object whose property is named `name` or `x`). Comments and
// string literals are stripped first, so text that merely mentions an API is not flagged. A pass
// therefore does not prove a script is read-only; the read-back discipline and ownership markers
// stay the real protection.
const READ_MUTATION_PATTERNS = [
  [/\bfigma\s*\.\s*create[A-Za-z]*\s*\(/, 'figma.create*()'],
  [/\.\s*createInstance\s*\(/, 'createInstance()'],
  [/\.\s*clone\s*\(/, 'clone()'],
  [/\.\s*remove\s*\(\s*\)/, '.remove()'],
  [/\.\s*(appendChild|insertChild)\s*\(/, 'appendChild/insertChild()'],
  [/\.\s*(importComponentByKeyAsync|importComponentSetByKeyAsync|importStyleByKeyAsync|importVariableByKeyAsync)\s*\(/, 'import*ByKeyAsync()'],
  [/\.\s*(setSharedPluginData|setPluginData|setRelaunchData)\s*\(/, 'set*PluginData()'],
  [/\.\s*(setProperties|swapComponent|detachInstance|resetOverrides|resize|resizeWithoutConstraints|rescale|setBoundVariable|setExplicitVariableModeForCollection|setRangeFills|setRangeTextStyleIdAsync|insertCharacters|deleteCharacters)\s*\(/, 'node mutation method'],
  [/\.\s*set(Fill|Stroke|Text|Effect|Grid)StyleIdAsync\s*\(/, 'set*StyleIdAsync()'],
  [/\bfigma\s*\.\s*(group|ungroup|flatten|union|subtract|intersect|exclude|combineAsVariants)\s*\(/, 'figma.<structure op>()'],
  [/\.\s*(characters|fills|strokes|effects|name|visible|opacity|x|y|rotation|cornerRadius|layoutMode|itemSpacing|padding(Top|Right|Bottom|Left)|layoutSizing(Horizontal|Vertical)|layoutPositioning|textStyleId|fillStyleId|strokeStyleId|placeholder|locked|clipsContent|fontName|fontSize|textTruncation|maxLines)\s*(=(?![=>])|\+=|-=)/, 'property assignment'],
];

function stripCommentsAndStrings(code) {
  // strings first, so a "//" inside a URL string does not hide the rest of the line
  return code
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

export function readScriptMutations(code) {
  if (typeof code !== 'string') return [];
  const src = stripCommentsAndStrings(code);
  return READ_MUTATION_PATTERNS.filter(([re]) => re.test(src)).map(([, label]) => label);
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
