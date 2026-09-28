// Local run state: atomic JSON writes, run directories, active run and the local writer lock
// (spec §4.1, §4.5, §11.1, §11.7). Heartbeat / PID-reuse checks are P1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runDirFor, stateDir, readJson } from './hooks/lib.mjs';

export { runDirFor, readJson };

export function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function nowIso() {
  return new Date().toISOString();
}

// Write to a temp file in the same directory, then rename over the target (spec §11.7).
export function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function listRuns(root = projectRoot()) {
  const base = path.join(root, 'design-runs');
  try {
    return fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  } catch {
    return [];
  }
}

// Resolve a user-supplied run id: exact match, else unique prefix. Ambiguous or missing -> ask (spec §7.1).
export function resolveRunId(query, root = projectRoot()) {
  const runs = listRuns(root);
  if (!query) return { status: 'missing', candidates: runs };
  if (runs.includes(query)) return { status: 'found', runId: query };
  const matches = runs.filter(r => r.startsWith(query));
  if (matches.length === 1) return { status: 'found', runId: matches[0] };
  return { status: matches.length ? 'ambiguous' : 'not_found', candidates: matches };
}

// Parse `/figma-ui` arguments: new (default) | continue <run-id> <adjustment> | resume <run-id>.
export function parseInvocation(args) {
  const text = (Array.isArray(args) ? args.join(' ') : String(args ?? '')).trim();
  const m = text.match(/^(continue|resume)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/i);
  if (!m) return { mode: 'new', runId: null, request: text };
  return { mode: m[1].toLowerCase(), runId: m[2] ?? null, request: (m[3] ?? '').trim() };
}

export function newRunId(date = new Date(), root = projectRoot()) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  const taken = new Set(listRuns(root));
  for (let n = 1; n < 1000; n++) {
    const id = `ui-${day}-${String(n).padStart(3, '0')}`;
    if (!taken.has(id)) return id;
  }
  throw new Error('no free run id for today');
}

// A fresh intake brief. Nothing is copied from earlier runs (INVARIANT-01, T21).
export function intakeBrief(runId, goal) {
  return {
    schemaVersion: '1.2',
    runId,
    workflow: 'native_design',
    taskType: 'extend',
    stage: 'intake',
    goal: goal || '(to be confirmed at intake)',
    platform: null,
    sources: { referenceFiles: [], designSystemFiles: [], approvedLibraryKeys: [], componentLibraryKeys: [], variableLibraryKeys: [] },
    output: { fileUrl: null, fileKey: null, pageId: null, scopeRootIds: [], createNewFile: false, placement: 'new_draft', writeAllowed: false, decisionRef: null },
    designSystem: { discoverySource: 'ask_user', reusePolicy: 'strict', allowNewTokens: false, allowNewComponents: false, allowWrap: false, allowMainComponentEdits: false },
    requiredModes: [],
    reviewScope: [],
    decisionRefs: [],
    openQuestions: ['product / platform', 'reference files', 'component library', 'variables library', 'output file / page', 'new draft or edit existing', 'what to extend'],
    approvalPolicy: 'ask_on_problem',
    delivery: ['figma', 'audit', 'handoff'],
  };
}

export function createRun({ runId, goal, root = projectRoot() } = {}) {
  const id = runId || newRunId(new Date(), root);
  const dir = runDirFor(root, id);
  if (fs.existsSync(dir)) throw new Error(`run ${id} already exists`);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteJson(path.join(dir, 'brief.json'), intakeBrief(id, goal));
  atomicWriteJson(path.join(dir, 'ledger.json'), {
    schemaVersion: '1.2', runId: id, phase: 'intake', status: 'in_progress', entities: [],
    lastVerifiedOperationId: null, pendingOperations: [], pendingQuestions: [], gaps: [], updatedAt: nowIso(),
  });
  fs.writeFileSync(path.join(dir, 'operations.jsonl'), '');
  return { runId: id, dir };
}

// ---- active run + lock ----

const activeFile = root => path.join(stateDir(root), 'active-run.json');
const lockFile = (root, fileKey) => {
  if (!/^[0-9A-Za-z]{22,128}$/.test(fileKey || '')) throw new Error(`invalid fileKey: ${fileKey}`);
  return path.join(stateDir(root), 'locks', `${fileKey}.json`);
};

export function readActiveRun(root = projectRoot()) {
  return readJson(activeFile(root));
}

// Acquire the per-file lock with O_EXCL and mark the run active. Never steals an existing lock.
export function activateRun({ runId, fileKey, root = projectRoot() }) {
  const active = readActiveRun(root);
  if (active && active.runId !== runId) {
    return { ok: false, reason: `another run is active: ${active.runId}` };
  }
  const file = lockFile(root, fileKey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = readJson(file);
  if (existing) {
    if (active && existing.runId === runId && existing.ownerToken === active.ownerToken) return { ok: true, reused: true, ownerToken: existing.ownerToken };
    return { ok: false, reason: `lock for ${fileKey} is held by run ${existing.runId} (pid ${existing.pid}); reconcile its journal and ask the user before taking over (spec §11.1)`, holder: existing };
  }
  const ownerToken = crypto.randomUUID();
  const acquiredAt = nowIso();
  let fd;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') return { ok: false, reason: `lock for ${fileKey} was taken concurrently` };
    throw err;
  }
  fs.writeSync(fd, JSON.stringify({ ownerToken, runId, pid: process.ppid || process.pid, hostname: os.hostname(), acquiredAt }));
  fs.closeSync(fd);
  atomicWriteJson(activeFile(root), { runId, ownerToken, fileKey, activatedAt: acquiredAt });
  return { ok: true, ownerToken, acquiredAt };
}

// Release the lock and remove active-run.json, only when the owner token matches (spec §4.5).
export function releaseRun({ runId, root = projectRoot() }) {
  const active = readActiveRun(root);
  if (!active) return { ok: true, released: false, reason: 'no active run' };
  if (active.runId !== runId) return { ok: false, reason: `active run is ${active.runId}, not ${runId}` };
  const released = [];
  const locksDir = path.join(stateDir(root), 'locks');
  for (const name of fs.existsSync(locksDir) ? fs.readdirSync(locksDir) : []) {
    const file = path.join(locksDir, name);
    const lock = readJson(file);
    if (lock && lock.runId === runId && lock.ownerToken === active.ownerToken) {
      fs.unlinkSync(file);
      released.push(name.replace(/\.json$/, ''));
    }
  }
  fs.unlinkSync(activeFile(root));
  const ledgerFile = path.join(runDirFor(root, runId), 'ledger.json');
  const ledger = readJson(ledgerFile);
  if (ledger) {
    ledger.lock = { released: true, releasedAt: nowIso(), by: runId };
    ledger.updatedAt = ledger.lock.releasedAt;
    atomicWriteJson(ledgerFile, ledger);
  }
  return { ok: true, released: true, fileKeys: released };
}

// CLI: node scripts/state-store.mjs <new|resolve|parse|activate|release|active> [...]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const out = v => { console.log(JSON.stringify(v, null, 2)); process.exit(v && v.ok === false ? 1 : 0); };
  if (cmd === 'new') out(createRun({ goal: rest.join(' ') }));
  else if (cmd === 'resolve') out(resolveRunId(rest[0]));
  else if (cmd === 'parse') out(parseInvocation(rest));
  else if (cmd === 'activate') out(activateRun({ runId: rest[0], fileKey: rest[1] }));
  else if (cmd === 'release') out(releaseRun({ runId: rest[0] }));
  else if (cmd === 'active') out(readActiveRun() ?? { active: null });
  else { console.error('usage: state-store.mjs new <goal> | resolve <run-id> | parse <args...> | activate <run-id> <fileKey> | release <run-id> | active'); process.exit(2); }
}
