#!/usr/bin/env node
// Run bookkeeping, minimum metrics and the short handoff (spec v1.6 §14, §15; A07).
// - phase / ask / answered: tiny ledger records for phase timing and question rounds (no user forms).
// - metrics: computed from records that already exist — .figma-ui/hook-events.jsonl (tool calls,
//   durations, truncation, failures), operations.jsonl and ledger.json. Missing data is reported as
//   unknown (null), never as zero. No remote calls, no external telemetry.
// - handoff: composes design-runs/<run-id>/handoff.md from the artifacts. It refuses to run when the
//   stored evaluation is not the evaluation of the current data (evaluate-completion first).
// Usage:
//   node scripts/run-report.mjs phase <run-id> <phase>
//   node scripts/run-report.mjs ask <run-id> <questionCount> [--prefilled N] [--blank M]   (v1.7 DEC-09 rows)
//   node scripts/run-report.mjs answered <run-id>
//   node scripts/run-report.mjs metrics <run-id>
//   node scripts/run-report.mjs handoff <run-id> [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, runDirFor, atomicWriteJson, nowIso, readJson } from './state-store.mjs';
import { readJsonl, stateDir } from './hooks/lib.mjs';
import { loadRun, validateSchema, decisionStatus, decisionResolved, evidenceCoversCell, evaluationIsCurrent } from './validate-artifacts.mjs';
import { suggestFromRun } from './product-policy.mjs';

export const SPEC_VERSION = '1.8';
const PHASES = ['intake', 'preflight', 'discover', 'plan', 'build', 'validate', 'handoff', 'reconcile'];

function updateLedger(dir, fn) {
  const file = path.join(dir, 'ledger.json');
  const ledger = readJson(file);
  if (!ledger) throw new Error('ledger.json missing');
  const next = fn(structuredClone(ledger));
  next.updatedAt = nowIso();
  const errors = validateSchema('ledger', next);
  if (errors.length) throw new Error(errors.join('; '));
  atomicWriteJson(file, next);
  return next;
}

// v1.8 (§14, §20): entering the phase the run is already in (e.g. handoff again while wrapping up) is
// not a new phase; it is not recorded twice, so no duration turns negative.
export function recordPhase(dir, phase, at = nowIso()) {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase ${phase}`);
  return updateLedger(dir, l => {
    const history = l.phaseHistory || [];
    if (history.at(-1)?.phase === phase) return { ...l, phase };
    return { ...l, phase, phaseHistory: [...history, { phase, enteredAt: at }] };
  });
}

// v1.7 DEC-09: a round is one prefilled list; prefilled and blank rows are counted separately.
export function recordQuestionRound(dir, questionCount, at = nowIso(), { prefilled, blank } = {}) {
  const n = Number(questionCount);
  if (!Number.isInteger(n) || n < 1) throw new Error('questionCount must be a positive integer');
  const rows = {};
  for (const [k, v] of [['prefilledRows', prefilled], ['blankRows', blank]]) {
    if (v === undefined || v === null) continue;
    const x = Number(v);
    if (!Number.isInteger(x) || x < 0) throw new Error(`${k} must be a non-negative integer`);
    rows[k] = x;
  }
  if (rows.prefilledRows !== undefined && rows.blankRows !== undefined && rows.prefilledRows + rows.blankRows !== n) throw new Error(`prefilled (${rows.prefilledRows}) + blank (${rows.blankRows}) rows must equal questionCount (${n})`);
  return updateLedger(dir, l => {
    const rounds = l.questionRounds || [];
    if (rounds.some(r => !r.answeredAt)) throw new Error('the previous question round is still open; record "answered" first');
    return { ...l, questionRounds: [...rounds, { id: `qr-${String(rounds.length + 1).padStart(3, '0')}`, phase: l.phase, askedAt: at, answeredAt: null, questionCount: n, ...rows }] };
  });
}

export function recordAnswered(dir, at = nowIso()) {
  return updateLedger(dir, l => {
    const rounds = [...(l.questionRounds || [])];
    const open = rounds.findLastIndex(r => !r.answeredAt);
    if (open < 0) throw new Error('no open question round');
    rounds[open] = { ...rounds[open], answeredAt: at };
    return { ...l, questionRounds: rounds };
  });
}

const ms = (a, b) => (a && b ? new Date(b) - new Date(a) : null);

// Figma tool calls attributed to this run: the active run or the op header names it. Calls with no run
// attached (Preflight / Discover before the lock is taken) are attributed by the run's time window
// and reported separately, because another run could have been active in the same project.
export function runMetrics(dir, { root = projectRoot(), events: given } = {}) {
  const run = loadRun(dir);
  const runId = run.brief?.runId || run.ledger?.runId;
  const unknown = [];
  const ledger = run.ledger || {};

  // phases
  const history = ledger.phaseHistory || [];
  const end = ledger.completionEvaluatedAt || null;
  const phases = history.map((p, i) => {
    const d = ms(p.enteredAt, history[i + 1]?.enteredAt || end);
    // the evaluation can precede the last phase entry (a re-entry recorded before v1.8): unknown, not negative
    if (d !== null && d < 0) unknown.push(`duration of ${p.phase} (entered ${p.enteredAt}, after the evaluation)`);
    return { phase: p.phase, enteredAt: p.enteredAt, durationMs: d !== null && d < 0 ? null : d };
  });
  if (!history.length) unknown.push('phase timing (no ledger.phaseHistory)');

  // tool calls
  const events = given ?? readJsonl(path.join(stateDir(root), 'hook-events.jsonl')).records;
  const start = history[0]?.enteredAt || null;
  const inWindow = e => start && e.at >= start && (!end || e.at <= end);
  const post = events.filter(e => /^PostToolUse/.test(e.event || ''));
  const mine = post.filter(e => e.activeRun === runId || e.header?.runId === runId);
  const windowOnly = post.filter(e => !mine.includes(e) && !e.activeRun && !e.header && inWindow(e));
  const categorize = e => (e.category === 'screenshot' ? 'screenshot' : e.header ? (e.header.mode === 'write' ? 'write' : 'read') : /__use_figma$/.test(e.toolName || '') ? 'read' : e.category || 'read');
  let tools = null;
  if (!post.length) unknown.push('tool calls (no hook-events.jsonl entries)');
  else {
    const count = list => list.reduce((acc, e) => { const c = categorize(e); acc[c] = (acc[c] || 0) + 1; return acc; }, { read: 0, write: 0, screenshot: 0 });
    const all = [...mine, ...windowOnly];
    const durations = all.map(e => e.durationMs).filter(v => typeof v === 'number');
    tools = {
      attributedByRun: count(mine),
      attributedByTimeWindow: count(windowOnly),
      failures: all.filter(e => e.event === 'PostToolUseFailure').length,
      truncatedResponses: all.filter(e => e.truncatedResponse).length,
      toolTimeMs: durations.length ? durations.reduce((a, b) => a + b, 0) : null,
      callsWithoutDuration: all.length - durations.length,
    };
    if (tools.toolTimeMs === null) unknown.push('tool time (no duration_ms recorded)');
  }

  // journal: retries and reconciliations
  const writes = (run.operations || []).filter(o => o.mode === 'write');
  const journal = {
    writes: writes.length,
    verified: writes.filter(o => o.status === 'verified').length,
    failedKnown: writes.filter(o => o.status === 'failed_known').length,
    unknownOutcome: writes.filter(o => o.status === 'unknown_outcome').length,
    reconciled: writes.filter(o => o.reconciliation).length,
    retries: writes.filter(o => (o.retry?.attempt || 0) > 0).length,
    truncatedWriteResponses: writes.filter(o => o.effectSummary?.responseTruncated).length,
  };

  // questions and decisions
  let questions = null;
  if (!ledger.questionRounds) unknown.push('question rounds (no ledger.questionRounds)');
  else {
    const answered = ledger.questionRounds.filter(r => r.answeredAt);
    questions = {
      rounds: ledger.questionRounds.length,
      questions: ledger.questionRounds.reduce((a, r) => a + r.questionCount, 0),
      openRounds: ledger.questionRounds.length - answered.length,
      userWaitMs: answered.length ? answered.reduce((a, r) => a + ms(r.askedAt, r.answeredAt), 0) : null,
      // v1.7 DEC-09: null when no round recorded the split (not 0)
      prefilledRows: ledger.questionRounds.some(r => r.prefilledRows !== undefined) ? ledger.questionRounds.reduce((a, r) => a + (r.prefilledRows || 0), 0) : null,
      blankRows: ledger.questionRounds.some(r => r.blankRows !== undefined) ? ledger.questionRounds.reduce((a, r) => a + (r.blankRows || 0), 0) : null,
    };
  }
  const dd = run.plan?.designDecisions || [];
  // v1.8 DEC-09: scope / authorisation rows (plan.decisions) record confirmation too; both count.
  const rows = [...dd, ...(run.plan?.decisions || [])];
  const byConfirmation = list => ({
    prefilledConfirmed: list.filter(d => d.confirmation === 'prefilled_confirmed').length,
    userModified: list.filter(d => d.confirmation === 'user_modified').length,
    userFilled: list.filter(d => d.confirmation === 'user_filled').length,
    userSkipped: list.filter(d => d.confirmation === 'user_skipped').length,
  });
  const decisions = run.plan ? {
    designDecisions: dd.length,
    scopeDecisions: (run.plan.decisions || []).length,
    answeredByUser: dd.filter(d => d.source === 'user' && decisionStatus(d) === 'answered' && !d.delegation).length,
    delegated: dd.filter(d => d.delegation).length,
    fromDsPatternOrBrief: dd.filter(d => d.source !== 'user' && d.source !== 'product_policy').length,
    fromProductPolicy: dd.filter(d => d.source === 'product_policy').length,
    ...byConfirmation(rows),
    confirmationByKind: { designDecisions: byConfirmation(dd), scopeDecisions: byConfirmation(run.plan.decisions || []) },
    pending: dd.filter(d => decisionStatus(d) === 'pending').length,
    skipped: dd.filter(d => decisionStatus(d) === 'skipped').length,
    skippedByUser: dd.filter(d => decisionStatus(d) === 'skipped' && d.skippedBy === 'user').length,
    skippedByAgent: dd.filter(d => decisionStatus(d) === 'skipped' && d.skippedBy !== 'user').length,
    undefinedBehaviors: (run.plan.undefinedBehaviors || []).length,
  } : null;
  if (!decisions) unknown.push('decisions (no plan.json)');

  return { runId, phases, tools, journal, questions, decisions, unknown, note: 'executionLayer depends on where the run ran; offline fixtures prove the computation, not any speed-up.' };
}

// ---------------- handoff ----------------

const nodeUrl = (fileKey, id) => `https://www.figma.com/design/${fileKey}/?node-id=${String(id).replace(/:/g, '-')}`;
const cell = c => [c.viewport, c.state, c.mode].filter(v => v != null).join(' · ') || '—';
const fmtMs = v => (v == null ? 'unknown' : v < 60000 ? `${Math.round(v / 1000)} s` : `${Math.round(v / 60000)} min`);

// audit.metrics.tokenBinding is the quality-metrics object since v1.4, but runs written before that
// store a free-text string. Render both; never print "undefined" for a missing field (M4).
export function formatTokenBinding(tb) {
  if (tb == null) return null;
  if (typeof tb === 'string') return tb;
  if (typeof tb !== 'object') return String(tb);
  const v = x => (x == null ? 'unknown' : x);
  const ratio = tb.ratio ?? (tb.denominator != null && tb.bound != null ? `${tb.bound}/${tb.denominator}` : 'unknown');
  const styles = typeof tb.styleApplications === 'object' ? tb.styleApplications?.total : tb.styleApplications;
  return `${ratio}（variables ${v(tb.variableBindings)}、styles ${v(styles)}、raw ${v(tb.raw)}）`;
}

// v1.7 §15 item 11: applied product policies and product-policy suggestions (POL-05). Suggestions
// are only written to the policy file when the user ticks them (POL-04); run-only settings are never
// listed. When contrast was not checked because of the product policy, say so (§9.5).
export function productPolicySection(dir, { brief, audit, root = projectRoot() } = {}) {
  const L = ['## 產品政策', ''];
  const product = brief?.product;
  if (!product) L.push('- 未套用：v1.7 前建立的 run（brief 沒有 product）');
  else if (!product.productId) L.push('- 未套用：產品尚未確定（REQ-05）');
  else {
    const applied = product.appliedPolicies || [];
    L.push(`- 產品：${product.displayName || product.productId}（${product.productId}）`);
    L.push(`- 本 run 套用的政策：${applied.length ? applied.map(a => `${a.summary}（${a.policyRef}）`).join('；') : '無（政策檔沒有項目）'}`);
  }
  const g5 = (audit?.gates || []).find(g => g.id === 'G5');
  const contrastRef = g5?.contrast?.status === 'not_applicable' ? g5.contrast.policyRef : g5?.status === 'not_applicable' ? g5.policyRef : null;
  if (contrastRef) L.push(`- **依產品政策未檢查對比**（${contrastRef}）：文字與非文字對比都沒有驗證，實作端請知悉；點擊區等其他可及性項目照常檢查。`);
  let s = { suggestions: [] };
  try { s = suggestFromRun(dir, { root }); } catch { /* no plan yet */ }
  L.push('- 政策建議（勾選的才會寫入產品政策；沒勾選的只留在本 run）：');
  if (!s.suggestions.length) L.push('  - 無');
  for (const x of s.suggestions) L.push(`  - [ ] ${x.id}：${x.text}（${x.appliesTo}；來源 ${x.source}${x.conflictsWith ? `；與 ${x.conflictsWith} 衝突` : ''}${x.alsoIn ? `；也出現在 ${x.alsoIn.join('、')}` : ''}）`);
  L.push('');
  return L;
}

// v1.8 §15 item 12: dynamic behaviour that was never asked (DEC-11) and decisions the user skipped
// (DEC-08, skippedBy user). Skips the agent recorded are not here: they stay under 待決.
export function implementationDefinedSection(plan) {
  const L = ['## 未定義，交由實作決定', ''];
  const behaviors = plan?.undefinedBehaviors || [];
  L.push('- 動態行為（本 agent 只交付靜態畫面，未提問，DEC-11）：');
  if (!behaviors.length) L.push('  - 無');
  for (const b of behaviors) L.push(`  - ${b.id}${b.screenKey ? `（${b.screenKey}）` : ''}：${b.behavior}${b.kind ? `［${b.kind}］` : ''}${b.note ? `；${b.note}` : ''}`);
  const skipped = (plan?.designDecisions || []).filter(d => decisionStatus(d) === 'skipped' && d.skippedBy === 'user');
  L.push('- 使用者明確略過的決策（相關元素未建立，DEC-08）：');
  if (!skipped.length) L.push('  - 無');
  for (const d of skipped) L.push(`  - ${d.id}：${d.question}${d.context ? `（${d.context}）` : ''} → 影響：畫面上不建立這項決策的元素；需要時由實作或下一個 run 決定`);
  L.push('');
  return L;
}

export function renderHandoff(dir, { root = projectRoot(), metrics } = {}) {
  const run = loadRun(dir);
  const { brief, plan, audit, ledger } = run;
  if (!brief || !plan || !audit || !ledger) throw new Error('brief, plan, audit and ledger are required for a handoff');
  const fresh = evaluationIsCurrent(run);
  if (!fresh.current) throw new Error(`cannot write the handoff: ${fresh.reason}`);
  const ev = audit.completionEvaluation;
  const ua = ledger.userAcceptance;
  const fileKey = brief.output?.fileKey;
  const L = [];
  L.push(`# Handoff — ${brief.runId}`, '');
  L.push(`- 完成判定：**${ev.result}**（evaluate-completion，${ev.ruleVersion}，${ev.evaluatedAt}）`);
  if (ua) L.push(`- 使用者接受：${ua.kind}（${ua.decisionRef}，${ua.acceptedAt}）：${ua.note || ''}。接受為測試成功**不等於** complete。`);
  L.push(`- 任務：${brief.goal}（${brief.taskType}） · spec v${SPEC_VERSION} · schemaVersion ${brief.schemaVersion}`, '');

  L.push('## Figma', '');
  if (brief.output?.fileUrl) L.push(`- 檔案：${brief.output.fileUrl}`);
  // v1.8 (T76): every active entity is a root (one per logicalKey, written on verify); the journal
  // gives the created / modified node counts, so a run that changed nodes never reads "none".
  const roots = (ledger.entities || []).filter(e => e.active);
  for (const e of roots) L.push(`- ${e.logicalKey}（${e.type}）：${fileKey ? nodeUrl(fileKey, e.nodeId) : e.nodeId}`);
  const verifiedWrites = (run.operations || []).filter(o => o.mode === 'write' && o.status === 'verified' && !o.effectSummary?.noChange);
  const created = new Set(verifiedWrites.flatMap(o => o.createdNodeIds || []));
  const mutated = new Set(verifiedWrites.flatMap(o => o.mutatedNodeIds || []).filter(id => !created.has(id)));
  if (created.size || mutated.size) L.push(`- 本 run 建立 ${created.size} 個、修改 ${mutated.size} 個節點（已讀回驗證的 write：${verifiedWrites.map(o => o.operationId).join('、')}）`);
  if (!roots.length && !created.size && !mutated.size) L.push('- （本 run 沒有建立或修改節點）');
  L.push('');

  L.push('## 交付範圍', '');
  for (const s of plan.screens || []) L.push(`- ${s.screenKey}${s.task ? `：${s.task}` : ''}${s.primaryAction ? `（主要操作：${s.primaryAction}）` : ''}`);
  L.push('', '| requiredCell | 畫面 | viewport · state · mode | 證據 |', '|---|---|---|---|');
  const current = (audit.evidence || []).filter(e => e.validity === 'current');
  for (const c of plan.requiredCells || []) {
    const covering = c.applicable ? current.filter(e => evidenceCoversCell(e, c, plan.requiredCells)).map(e => e.id) : [];
    L.push(`| ${c.key} | ${c.screenKey} | ${cell(c)} | ${c.applicable ? covering.join(', ') || '**缺**' : `不適用：${c.reason}`} |`);
  }
  L.push('');

  L.push('## 互動與狀態', '');
  const flow = plan.flow;
  if (!flow) L.push('- flow：未記錄（v1.6 前的 run）');
  else {
    L.push(`- flow：${flow.level}（${flow.status}）— ${flow.reason}`);
    for (const st of flow.steps || []) {
      L.push(`  - ${st.id}：${st.entry ? `${st.entry} → ` : ''}${st.action} → ${st.result}（${st.screenKey}${st.state ? ` / ${st.state}` : ''}）${st.end ? `；結束：${st.end}` : ''}`);
      for (const b of st.branches || []) L.push(`    - 若 ${b.condition} → ${b.to}`);
    }
  }
  for (const s of plan.screens || []) if (s.destinations && Object.keys(s.destinations).length) L.push(`- ${s.screenKey} 目的地：${Object.entries(s.destinations).map(([k, v]) => `${k} → ${v}`).join('；')}`);
  L.push('');

  L.push('## 驗證結果', '');
  L.push(`- 覆蓋：${ev.coverage ? `${ev.coverage.verified}/${ev.coverage.applicable}` : 'unknown'}`);
  L.push(`- Gates：${(audit.gates || []).map(g => `${g.id} ${g.status}`).join('、')}`);
  const tb = formatTokenBinding(audit.metrics?.tokenBinding);
  if (tb) L.push(`- tokenBinding：${tb}`);
  const findings = audit.findings || [];
  L.push(`- Findings：${findings.length} 筆（open ${findings.filter(f => f.status === 'open').length}、resolved ${findings.filter(f => f.status === 'resolved').length}、accepted ${findings.filter(f => f.status === 'accepted').length}）；例外 ${(audit.acceptedExceptions || []).map(x => `${x.id}（${x.decisionRef}）`).join('、') || '無'}`);
  L.push('- Design QA：尚未接入（階段 B）；本 run 的適用驗證全部由 UI agent 完成。', '');

  L.push(...productPolicySection(dir, { brief, audit, root }));

  L.push(...implementationDefinedSection(plan));

  L.push('## 待決與未驗證', '');
  const open = [];
  for (const q of ledger.pendingQuestions || []) open.push(`待答問題 ${q.id}：${q.question}`);
  for (const d of plan.designDecisions || []) {
    if (decisionResolved(d)) continue;
    const st = decisionStatus(d);
    open.push(`設計決策 ${d.id}（${st === 'skipped' ? `skipped，由 ${d.skippedBy || 'agent'} 標記，使用者尚未確認略過` : st}）：${d.question}`);
  }
  for (const u of flow?.unknowns || []) if (u.status === 'open') open.push(`流程待確認 ${u.id}：${u.question}`);
  for (const f of findings.filter(f => f.status === 'open')) open.push(`finding ${f.id}（${f.severity}${f.gate ? `, ${f.gate}` : ''}）${f.observed ? `：${f.observed}` : ''}`);
  for (const g of (audit.gates || []).filter(g => ['fail', 'not_verified'].includes(g.status))) open.push(`gate ${g.id} ${g.status}${g.note ? `：${g.note}` : ''}`);
  for (const r of ev.reasons || []) open.push(`判定原因：${r}`);
  for (const x of audit.implementationVerificationRequired || []) open.push(`實作層待驗：${x}`);
  for (const s of plan.excludedSkillsLoaded || []) open.push(`排除的 skill 被載入：${s.skill}（未採用：${s.notAdopted}，§4.7）`);
  L.push(...(open.length ? open.map(o => `- ${o}`) : ['- 無']), '');

  L.push('## 下一步', '');
  if (ev.eligible) L.push('- Figma 交付完成；可交由前端工程師實作。');
  else L.push(`- 先處理：${(ev.reasons || [])[0] || '見上方待決項目'}；處理後重新執行 evaluate-completion。`);
  L.push(`- 結束或暫停：\`node scripts/state-store.mjs release ${brief.runId}\`。`, '');

  L.push('## 依據（不另抄寫，直接查 artifacts）', '');
  L.push(`- brief.json：需求、來源、輸出授權（${brief.output?.decisionRef || '無'}）`);
  L.push(`- plan.json：決策 ${(plan.decisions || []).length + (plan.designDecisions || []).length} 筆、componentMap ${(plan.componentMap || []).length}、variableMap ${(plan.variableMap || []).length}、pattern ${(plan.patternRefs || []).length}`);
  L.push(`- inventory.json：元件、variables、styles、patterns、字型盤點`);
  L.push(`- audit.json：evidence ${(audit.evidence || []).length}、findings ${findings.length}`);
  const writes = (run.operations || []).filter(o => o.mode === 'write');
  L.push(`- operations.jsonl：write ${writes.length}（verified ${writes.filter(o => o.status === 'verified').length}）`, '');

  const m = metrics || runMetrics(dir, { root });
  L.push('## 量測', '');
  L.push(`- 階段：${m.phases.length ? m.phases.map(p => `${p.phase} ${fmtMs(p.durationMs)}`).join('、') : 'unknown'}`);
  L.push(`- 工具：${m.tools ? `read ${m.tools.attributedByRun.read + m.tools.attributedByTimeWindow.read}、write ${m.tools.attributedByRun.write + m.tools.attributedByTimeWindow.write}、截圖 ${m.tools.attributedByRun.screenshot + m.tools.attributedByTimeWindow.screenshot}；工具時間 ${fmtMs(m.tools.toolTimeMs)}；截斷 ${m.tools.truncatedResponses}；失敗 ${m.tools.failures}` : 'unknown'}；重試 ${m.journal.retries}、對帳 ${m.journal.reconciled}`);
  L.push(`- 提問：${m.questions ? `${m.questions.rounds} 輪、${m.questions.questions} 題${m.questions.prefilledRows != null || m.questions.blankRows != null ? `（預填 ${m.questions.prefilledRows ?? 'unknown'}、留空 ${m.questions.blankRows ?? 'unknown'}）` : ''}；使用者等待 ${fmtMs(m.questions.userWaitMs)}` : 'unknown'}；實質設計決策（使用者回答）${m.decisions ? m.decisions.answeredByUser : 'unknown'}${m.decisions ? `；確認方式（設計決策與範圍／授權列合計）：照預填 ${m.decisions.prefilledConfirmed}、改過 ${m.decisions.userModified}、自己填 ${m.decisions.userFilled}、略過 ${m.decisions.userSkipped}` : ''}`);
  if (m.unknown.length) L.push(`- 未記錄（不是 0）：${m.unknown.join('；')}`);
  L.push('');
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, runId, ...rest] = process.argv.slice(2);
  const usage = 'usage: run-report.mjs phase <run-id> <phase> | ask <run-id> <questionCount> [--prefilled N] [--blank M] | answered <run-id> | metrics <run-id> | handoff <run-id> [--write]';
  if (!cmd || !runId) { console.error(usage); process.exit(2); }
  const dir = runDirFor(projectRoot(), runId);
  try {
    if (cmd === 'phase') console.log(JSON.stringify(recordPhase(dir, rest[0]).phaseHistory.at(-1)));
    else if (cmd === 'ask') { const opt = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; }; console.log(JSON.stringify(recordQuestionRound(dir, rest[0], undefined, { prefilled: opt('--prefilled'), blank: opt('--blank') }).questionRounds.at(-1))); }
    else if (cmd === 'answered') console.log(JSON.stringify(recordAnswered(dir).questionRounds.findLast(r => r.answeredAt)));
    else if (cmd === 'metrics') console.log(JSON.stringify(runMetrics(dir), null, 2));
    else if (cmd === 'handoff') {
      const text = renderHandoff(dir);
      if (rest.includes('--write')) { fs.writeFileSync(path.join(dir, 'handoff.md'), text); console.log(`written ${path.join(dir, 'handoff.md')}`); } else console.log(text);
    } else { console.error(usage); process.exit(2); }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
