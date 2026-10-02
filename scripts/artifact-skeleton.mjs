#!/usr/bin/env node
// Schema-valid starting points for run artifacts (spec v1.8 §20): a run fills in a skeleton instead of
// guessing the format field by field (v1.7 run ui-20261002-001 needed several rounds of schema fixes).
// Every skeleton passes its JSON Schema as is; the values are neutral (empty lists, null, draft,
// not_verified) and never claim anything was checked. Example entries for the shapes that real runs
// got wrong are returned under `examples`, not inside the artifact.
// Usage: node scripts/artifact-skeleton.mjs <brief|plan|inventory|capabilities|ledger|audit> <run-id> [--write]
//   --write writes design-runs/<run-id>/<contract>.json, only when that file does not exist yet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intakeBrief, projectRoot, runDirFor, atomicWriteJson, nowIso } from './state-store.mjs';
import { validateSchema, CONTRACTS } from './validate-artifacts.mjs';

const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];

export const EXAMPLES = {
  brief: { viewports: [{ name: 'mobile', width: 390, height: 844 }] },
  capabilities: {
    environmentDiagnosis: { mode: 'reused', reason: 'same session and unchanged environment', checkedAt: '2026-10-03T00:00:00.000Z', note: 'free text' },
    limits: { useFigmaReturnBytes: { status: 'verified', maxObservedOk: 20480, firstFailure: null, evidence: ['rd-0001'] }, searchDesignSystemQueriesPerCall: null },
    features: { nativeWrite: { status: 'available_unverified', basis: 'history', notes: 'verified in an earlier run; the first write of this run probes it' } },
  },
  audit: { evidenceToolRef: { tool: 'mcp__figma__use_figma', operation: 'rd-0006', capturedAt: '2026-10-03T00:00:00.000Z' } },
  plan: {
    designDecisionSkippedByUser: { id: 'dd-01', question: '…', options: ['A', 'B'], recommendation: null, answer: null, source: 'user', evidenceRefs: [], decidedAt: null, status: 'skipped', skippedBy: 'user', confirmation: 'user_skipped' },
    scopeDecision: { id: 'dec-001', decision: 'variables library: none for this run', scope: 'sources', decidedAt: '2026-10-03T00:00:00.000Z', source: 'user', confirmation: 'user_modified' },
    undefinedBehavior: { id: 'ub-01', behavior: 'how long the error toast stays and whether it can be dismissed', kind: 'timing', screenKey: 'share-failed' },
  },
};

export function skeleton(contract, runId, { now = nowIso(), toolPrefix = 'mcp__figma__' } = {}) {
  const base = { schemaVersion: '1.2', runId };
  switch (contract) {
    case 'brief': return intakeBrief(runId);
    case 'ledger': return { ...base, phase: 'intake', status: 'in_progress', entities: [], lastVerifiedOperationId: null, pendingOperations: [], pendingQuestions: [], gaps: [], updatedAt: now };
    case 'capabilities': return {
      ...base,
      runtime: { claudeCodeVersion: 'unknown' },
      server: { name: 'figma', url: 'https://mcp.figma.com/mcp', toolPrefix },
      tools: [{ name: `${toolPrefix}use_figma`, status: 'available_unverified' }],
      features: { nativeWrite: { status: 'unknown' } },
      limits: {},
      unverified: [],
      checkedAt: now,
    };
    case 'inventory': return {
      ...base, sources: [],
      discoveryCoverage: { components: 'unavailable', variables: 'unavailable', styles: 'unavailable' },
      components: [], variables: [], styles: [], patterns: [], baseline: [], evidenceRefs: [],
    };
    case 'plan': return {
      ...base, taskType: 'extend', status: 'draft', screens: [], requiredCells: [], componentMap: [], variableMap: [],
      patternRefs: [], designDecisions: [], undefinedBehaviors: [], scope: {}, baseline: { observations: [] }, decisions: [],
    };
    case 'audit': return {
      ...base, taskType: 'extend', gates: GATES.map(id => ({ id, status: 'not_verified' })), coverage: { applicable: 0, verified: 0 },
      findings: [], evidence: [], acceptedExceptions: [], completionEvaluation: null,
    };
    default: throw new Error(`unknown contract ${contract} (expected ${CONTRACTS.join('|')})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [contract, runId] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!contract || !runId) { console.error(`usage: artifact-skeleton.mjs <${CONTRACTS.join('|')}> <run-id> [--write]`); process.exit(2); }
  try {
    const doc = skeleton(contract, runId);
    const errors = validateSchema(contract, doc);
    if (errors.length) throw new Error(`skeleton does not validate (bug): ${errors.join('; ')}`);
    if (process.argv.includes('--write')) {
      const file = path.join(runDirFor(projectRoot(), runId), `${contract}.json`);
      if (fs.existsSync(file)) throw new Error(`${file} exists; the skeleton never overwrites an artifact`);
      atomicWriteJson(file, doc);
      console.log(JSON.stringify({ written: file, examples: EXAMPLES[contract] || null }, null, 2));
    } else console.log(JSON.stringify({ skeleton: doc, examples: EXAMPLES[contract] || null }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
