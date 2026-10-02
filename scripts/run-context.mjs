#!/usr/bin/env node
// What a /figma-ui invocation still has to ask or do (v1.6, A04). The skill calls this instead of
// re-running the whole intake: new → only the gaps of a fresh brief; continue → the confirmed scope
// is reused and only open items are asked; resume → reconcile first, then only stale or conflicting
// items. It never carries a previous run's platform, brand, DS or delegation into a new run.
// Usage: node scripts/run-context.mjs <run-id> [new|continue|resume]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, decisionStatus } from './validate-artifacts.mjs';
import { journalSummary } from './operation-journal.mjs';
import { projectRoot, runDirFor } from './state-store.mjs';
import { loadPolicy, loadLocal, appliedPolicies, contrastPolicy } from './product-policy.mjs';

export function runContext(dir, mode = 'continue', { root } = {}) {
  if (!['new', 'continue', 'resume'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  const run = loadRun(dir, { root });
  const { brief, plan, ledger } = run;
  const confirmed = [];
  const ask = [];

  if (!brief) ask.push({ kind: 'intake', item: 'brief.json missing; start a new run' });
  else if (brief.stage !== 'confirmed') for (const q of brief.openQuestions || []) ask.push({ kind: 'intake', item: q });
  else {
    confirmed.push('brief (goal, sources, output, write authorisation)');
    if (brief.openQuestions?.length) for (const q of brief.openQuestions) ask.push({ kind: 'intake', item: q });
  }

  if (plan) {
    if (plan.status === 'confirmed') confirmed.push('plan');
    for (const d of plan.designDecisions || []) {
      const st = decisionStatus(d);
      if (d.source === 'product_policy') continue; // listed under applied, never asked (POL-03)
      if (st === 'answered') confirmed.push(`${d.id} (${d.source})`);
      else ask.push({ kind: 'design_decision', item: d.id, status: st, question: d.question });
    }
    const flow = plan.flow;
    if (flow?.status === 'confirmed') confirmed.push(`flow (${flow.level})`);
    else if (flow) ask.push({ kind: 'flow', item: 'confirm the flow judgement', level: flow.level });
    for (const u of flow?.unknowns || []) if (u.status === 'open') ask.push({ kind: 'flow_unknown', item: u.id, question: u.question });
    for (const s of plan.screens || []) for (const c of s.copy || []) if (c.status !== 'confirmed') ask.push({ kind: 'copy', item: `${s.screenKey}/${c.id}` });
  }
  for (const q of ledger?.pendingQuestions || []) ask.push({ kind: 'pending_question', item: q.id, question: q.question });

  // v1.7 product and policies (REQ-05/06, DEC-10, POL-03): the product question comes first, then a
  // missing policy question, then everything else. Items a policy already decides are "applied".
  const applied = [];
  const notices = [];
  const first = [];
  const candidates = {};
  const policyRoot = run.root;
  if (brief && !brief.product) notices.push('run created before v1.7: no brief.product; product policies not applied');
  else if (brief) {
    const productId = brief.product.productId;
    if (!productId) {
      // the intake list already carries this question for a new run: move it to the front, never ask twice
      const i = ask.findIndex(a => a.item === 'product (REQ-05)');
      if (i >= 0) first.push(...ask.splice(i, 1));
      else first.push({ kind: 'product', item: 'product (REQ-05)', question: '這次是哪個產品？需求沒寫產品時必須先問，不從上次 run、目標檔案或參考畫面推定' });
    }
    else {
      const loaded = loadPolicy(productId, { root: policyRoot });
      if (!loaded.exists && !brief.product.newProduct) first.push({ kind: 'product', item: `new product ${productId}`, question: `${productId} 還沒有產品政策檔：要建立嗎？（POL-02）` });
      for (const a of appliedPolicies(loaded)) applied.push(`${a.policyRef}：${a.summary}`);
      const contrast = contrastPolicy(productId, { root: policyRoot });
      if (loaded.exists && !contrast.decided) first.push({ kind: 'product_policy', item: 'accessibility.contrast', label: '產品政策', question: `${loaded.policy.displayName} 的 design system 要遵守對比（WCAG）規則嗎？回答會寫入產品政策，之後不再問（DEC-10）` });
      if (loaded.exists && brief.product.policyDigest && loaded.digest !== brief.product.policyDigest) notices.push(`product policy ${productId} changed after it was applied; re-confirm the applied policies`);
      const local = loadLocal(productId, { root: policyRoot });
      if (local.exists && !local.errors.length) candidates.libraries = (local.local.libraries || []).map(l => l.name);
    }
    if (brief.stage === 'confirmed' && brief.taskType !== 'audit' && !(brief.sources?.componentLibraryKeys || []).length) {
      first.push({ kind: 'library', item: 'component library (REQ-06)', question: '這次用哪個元件 library？沒提供或找不到時要問，不自行改用其他 library', ...(candidates.libraries?.length ? { prefillCandidates: candidates.libraries } : {}) });
    }
  }
  for (const d of plan?.designDecisions || []) if (d.source === 'product_policy') applied.push(`${d.id} ← ${d.policyRef}`);
  ask.unshift(...first);

  const journal = journalSummary(dir);
  const next = [];
  if (mode === 'resume' || journal.nextStep === 'reconcile') {
    if (journal.nextStep === 'reconcile') next.push('reconcile unresolved writes read-only before anything else (references/recovery.md)');
    if (journal.nextStep === 'verify') next.push(`read back and verify: ${journal.awaitingVerification.join(', ')}`);
    next.push('read back ledger entities (existence, ownership marker, fingerprint); ask only about what changed');
  } else if (journal.nextStep === 'verify') next.push(`read back and verify: ${journal.awaitingVerification.join(', ')}`);

  const guidance = {
    new: 'Prefill what the request already states; ask the product first if it is not stated, apply its product policy and say so in one line, then ask only the missing items as one prefilled list (DEC-09). Nothing from earlier runs is reused without the user saying so.',
    continue: 'Reuse the confirmed scope. Ask only the open items below and what the requested change adds (new file, platform or area needs a new decision).',
    resume: 'Reconcile first. Re-ask only items that are open, stale or in conflict after reconciliation.',
  }[mode];
  return { runId: brief?.runId ?? ledger?.runId ?? null, mode, confirmed, applied, ask, notices, journal: { nextStep: journal.nextStep, unresolved: journal.unresolved, awaitingVerification: journal.awaitingVerification }, next, guidance };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runId, mode = 'continue'] = process.argv.slice(2);
  if (!runId) { console.error('usage: run-context.mjs <run-id> [new|continue|resume]'); process.exit(2); }
  try {
    console.log(JSON.stringify(runContext(runDirFor(projectRoot(), runId), mode), null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
