// Shared helpers for fixture tests. executionLayer=offline_fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const M1_FIXTURE = path.join(repo, 'tests', 'fixtures', 'm1-run');

// Copy the de-identified M1 run into a temp dir so a test can mutate it.
export function copyM1(mutate = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-ui-run-'));
  for (const f of fs.readdirSync(M1_FIXTURE)) fs.copyFileSync(path.join(M1_FIXTURE, f), path.join(dir, f));
  for (const [file, fn] of Object.entries(mutate)) {
    const p = path.join(dir, `${file}.json`);
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    const out = fn(doc) ?? doc;
    fs.writeFileSync(p, JSON.stringify(out, null, 2));
  }
  return dir;
}

export function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(M1_FIXTURE, `${name}.json`), 'utf8'));
}

export function appendOp(dir, record) {
  fs.appendFileSync(path.join(dir, 'operations.jsonl'), JSON.stringify(record) + '\n');
}

export function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'figma-ui-root-'));
}
