// Short handoff and minimum metrics (v1.6, A07); QA not ready keeps the UI agent's full validation.
// executionLayer=offline_fixture. Run: node --test "tests/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { recordPhase, recordQuestionRound, recordAnswered, runMetrics, renderHandoff } from '../../scripts/run-report.mjs';
import { writeEvaluation, recordUserAcceptance, evaluateRun } from '../../scripts/evaluate-completion.mjs';
import { validateRun } from '../../scripts/validate-artifacts.mjs';
import { copyM1, tmpRoot } from '../helpers.mjs';

const RUN = 'ui-20260928-m1';

test('A07: phase and question-round records are schema-valid ledger entries; rounds must close before a new one', () => {
  const dir = copyM1();
  recordPhase(dir, 'plan', '2026-09-28T11:00:00.000Z');
  recordQuestionRound(dir, 2, '2026-09-28T11:01:00.000Z');
  assert.throws(() => recordQuestionRound(dir, 1), /still open/);
  const l = recordAnswered(dir, '2026-09-28T11:06:00.000Z');
  assert.equal(l.questionRounds[0].answeredAt, '2026-09-28T11:06:00.000Z');
  assert.throws(() => recordAnswered(dir), /no open question round/);
  assert.throws(() => recordPhase(dir, 'shipping'), /unknown phase/);
  assert.deepEqual(validateRun(dir).schemaErrors, []);
});

test('A07: metrics come from hook events, the journal and the ledger; missing data is unknown, not zero', () => {
  const dir = copyM1();
  const bare = runMetrics(dir, { events: [] });
  assert.equal(bare.tools, null);
  assert.equal(bare.questions, null);
  assert.ok(bare.unknown.some(u => /tool calls/.test(u)) && bare.unknown.some(u => /question rounds/.test(u)) && bare.unknown.some(u => /phase timing/.test(u)));
  assert.equal(bare.journal.writes, 5);
  assert.equal(bare.journal.verified, 5);

  recordPhase(dir, 'discover', '2026-09-28T11:00:00.000Z');
  recordPhase(dir, 'build', '2026-09-28T11:10:00.000Z');
  recordQuestionRound(dir, 3, '2026-09-28T11:02:00.000Z');
  recordAnswered(dir, '2026-09-28T11:05:00.000Z');
  const events = [
    { at: '2026-09-28T11:01:00.000Z', event: 'PostToolUse', toolName: 'mcp__figma__use_figma', activeRun: null, header: null, durationMs: 800 },
    { at: '2026-09-28T11:03:00.000Z', event: 'PostToolUse', toolName: 'mcp__figma__get_screenshot', category: 'screenshot', activeRun: null, durationMs: 1200 },
    { at: '2026-09-28T11:12:00.000Z', event: 'PostToolUse', toolName: 'mcp__figma__use_figma', activeRun: RUN, header: { runId: RUN, operationId: 'op-0003', mode: 'write' }, durationMs: 2000, truncatedResponse: false },
    { at: '2026-09-28T11:13:00.000Z', event: 'PostToolUseFailure', toolName: 'mcp__figma__use_figma', activeRun: RUN, header: { runId: RUN, operationId: 'rd-0003', mode: 'read' }, durationMs: null },
    { at: '2026-09-28T11:14:00.000Z', event: 'PostToolUse', toolName: 'mcp__figma__use_figma', activeRun: 'another-run', header: { runId: 'another-run', operationId: 'op-1', mode: 'write' }, durationMs: 999 },
    { at: '2026-09-28T11:12:00.000Z', event: 'PreToolUse', toolName: 'mcp__figma__use_figma', activeRun: RUN },
  ];
  const m = runMetrics(dir, { events });
  assert.deepEqual(m.tools.attributedByRun, { read: 1, write: 1, screenshot: 0 });
  assert.deepEqual(m.tools.attributedByTimeWindow, { read: 1, write: 0, screenshot: 1 });
  assert.equal(m.tools.failures, 1);
  assert.equal(m.tools.toolTimeMs, 4000);
  assert.equal(m.tools.callsWithoutDuration, 1);
  assert.equal(m.questions.userWaitMs, 180000);
  assert.equal(m.phases[0].durationMs, 600000);
  assert.equal(m.decisions.answeredByUser > 0, true);
});

test('A07: the handoff is composed from artifacts, matches the evaluator and keeps every open item', () => {
  const dir = copyM1();
  assert.throws(() => renderHandoff(dir, { root: tmpRoot() }), /evaluated before v1\.6/, 'an evaluation without a digest must be refreshed first');
  const ev = writeEvaluation(dir);
  const text = renderHandoff(dir, { root: tmpRoot() });
  assert.match(text, new RegExp(`完成判定：\\*\\*${ev.result}\\*\\*`));
  assert.match(text, /https:\/\/www\.figma\.com\/design\/FixtureOutputFile00001\/\?node-id=34016-68/);
  assert.match(text, /\| m1\.button-row\.default \| m1\.button-row \| fixed-300 · default \| ev-005, ev-006, ev-007 \|/);
  assert.match(text, /flow：unchanged/);
  assert.match(text, /Design QA：尚未接入/);
  assert.match(text, /例外 ex-001（dec-010）/);
  assert.doesNotMatch(text, /Code Connect|Storybook/);
  // a later data change makes the stored evaluation stale: no handoff until re-evaluated
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
  plan.designDecisions.push({ id: 'dec-800', question: 'shadow?', options: ['a', 'b'], recommendation: null, answer: null, source: 'user', evidenceRefs: [], decidedAt: null, status: 'pending' });
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
  assert.throws(() => renderHandoff(dir, { root: tmpRoot() }), /changed after the last evaluation/);
  writeEvaluation(dir);
  const again = renderHandoff(dir, { root: tmpRoot() });
  assert.match(again, /完成判定：\*\*awaiting_user\*\*/);
  assert.match(again, /設計決策 dec-800（pending）：shadow\?/);
});

test('A07: with a user acceptance the handoff lists both results and still passes the validator check', () => {
  const dir = copyM1({ audit: a => { a.gates.find(g => g.id === 'G4').status = 'not_verified'; } });
  writeEvaluation(dir);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
  plan.decisions.push({ id: 'dec-900', decision: 'accept as a test run', scope: 'run', decidedAt: '2026-09-28T12:00:00.000Z', source: 'user' });
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
  writeEvaluation(dir);
  recordUserAcceptance(dir, { decisionRef: 'dec-900', note: 'flow test' });
  const text = renderHandoff(dir, { root: tmpRoot() });
  fs.writeFileSync(path.join(dir, 'handoff.md'), text);
  assert.match(text, /完成判定：\*\*partial\*\*/);
  assert.match(text, /使用者接受：test_run（dec-900/);
  assert.match(text, /gate G4 not_verified/);
  assert.deepEqual(validateRun(dir).semanticErrors, []);
});

test('Stage B not ready: the UI agent keeps its full validation (no ready_for_qa shortcut)', () => {
  const dir = copyM1({ audit: a => { a.gates.find(g => g.id === 'G4').status = 'not_verified'; } });
  const { evaluation } = evaluateRun(dir);
  assert.equal(evaluation.eligible, false);
  assert.notEqual(evaluation.result, 'ready_for_qa');
  assert.ok(evaluation.reasons.some(r => /G4 not_verified/.test(r)));
});
