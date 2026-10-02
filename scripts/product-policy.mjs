#!/usr/bin/env node
// Product policies (spec v1.7 §4.6 layer 2, §7.5 POL-01–06, INVARIANT-24–26).
// - load / validate product-policies/<productId>.json (in git) and the optional machine-local
//   .figma-ui/products/<productId>.local.json (never in git; only intake prefill candidates, REQ-06).
// - apply: record the product and its applied policies in brief.product (POL-03).
// - suggest: list product-policy suggestions from a run for the handoff (POL-05). Settings valid for
//   this run only (runOnly decisions, DEC-07 delegations, test-round rules) are never suggested.
// - write: change a policy only with a decisionRef the user answered or confirmed in this run (POL-04);
//   history is append-only and the run records a decision pointing at the changed item.
// The agent never edits policies on its own and never copies them into Claude Code memory or CLAUDE.md.
// Usage:
//   node scripts/product-policy.mjs show <productId>
//   node scripts/product-policy.mjs validate [productId ...] [--against-git]
//   node scripts/product-policy.mjs local <productId>
//   node scripts/product-policy.mjs apply <run-id> <productId> [--source request|user_answer]
//   node scripts/product-policy.mjs suggest <run-id>
//   node scripts/product-policy.mjs write <run-id> <productId> '<change json>'
//   node scripts/product-policy.mjs init <run-id> <productId> <displayName...> --decision <decisionRef>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectRoot, runDirFor, atomicWriteJson, nowIso, readJson } from './state-store.mjs';
import { validateSchema } from './validate-artifacts.mjs';
import { stateDir } from './hooks/lib.mjs';

export const POLICY_ITEMS = ['accessibility.contrast'];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const REF_RE = /^([a-z0-9][a-z0-9-]*)#(policies\/accessibility\.contrast|rules\/([a-z0-9][a-z0-9-]*))$/;

export const policyDir = (root = projectRoot()) => path.join(root, 'product-policies');
export const policyFile = (productId, root = projectRoot()) => {
  if (!ID_RE.test(productId || '')) throw new Error(`invalid productId: ${productId}`);
  return path.join(policyDir(root), `${productId}.json`);
};
export const localFile = (productId, root = projectRoot()) => {
  if (!ID_RE.test(productId || '')) throw new Error(`invalid productId: ${productId}`);
  return path.join(stateDir(root), 'products', `${productId}.local.json`);
};

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
  return v;
}
export const policyDigest = policy => 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(stable(policy))).digest('hex');

// ---- validation (§20 product-policy contract) ----

// Walk every key and string value: no figma.com URL, no fileKey / fileUrl field anywhere (POL-01).
function forbiddenContent(node, at = '') {
  const out = [];
  if (Array.isArray(node)) node.forEach((v, i) => out.push(...forbiddenContent(v, `${at}/${i}`)));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/^file(Key|Url)$/i.test(k)) out.push(`${at}/${k}: fileKey / fileUrl fields are not allowed in a product policy (keep them in .figma-ui/products/<productId>.local.json)`);
      out.push(...forbiddenContent(v, `${at}/${k}`));
    }
  } else if (typeof node === 'string' && /figma\.com/i.test(node)) out.push(`${at}: Figma URLs are not allowed in a product policy (the repo is public)`);
  return out;
}

// history must be append-only: the previous history is an unchanged prefix of the new one.
export function historyAppendOnlyErrors(prev, next) {
  const a = prev?.history || [];
  const b = next?.history || [];
  if (b.length < a.length) return [`history shrank from ${a.length} to ${b.length} entries (append-only)`];
  for (let i = 0; i < a.length; i++) if (JSON.stringify(stable(a[i])) !== JSON.stringify(stable(b[i]))) return [`history entry ${i} was changed (append-only)`];
  return [];
}

export function validatePolicy(policy, { fileName = null, previous = null } = {}) {
  const errors = validateSchema('product-policy', policy);
  if (fileName && policy?.productId && path.basename(fileName, '.json') !== policy.productId) errors.push(`productId ${policy.productId} does not match file name ${path.basename(fileName)}`);
  errors.push(...forbiddenContent(policy));
  const ids = (policy?.rules || []).map(r => r.id);
  for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) errors.push(`duplicate rule id ${id}`);
  // every current item must be explained by the history
  const targets = new Set((policy?.history || []).map(h => h.target));
  for (const k of Object.keys(policy?.policies || {})) if (!targets.has(`policies/${k}`)) errors.push(`policies/${k} has no history entry`);
  for (const id of ids) if (!targets.has(`rules/${id}`)) errors.push(`rules/${id} has no history entry`);
  if (previous) errors.push(...historyAppendOnlyErrors(previous, policy));
  return errors;
}

export function validateLocal(local, { fileName = null } = {}) {
  const errors = validateSchema('product-local', local);
  if (fileName && local?.productId && path.basename(fileName, '.local.json') !== local.productId) errors.push(`productId ${local.productId} does not match file name ${path.basename(fileName)}`);
  return errors;
}

// ---- reading ----

export function loadPolicy(productId, { root = projectRoot() } = {}) {
  const file = policyFile(productId, root);
  if (!fs.existsSync(file)) return { productId, exists: false, file, policy: null, digest: null };
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { productId, exists: true, file, policy, digest: policyDigest(policy) };
}

export function loadLocal(productId, { root = projectRoot() } = {}) {
  const file = localFile(productId, root);
  if (!fs.existsSync(file)) return { productId, exists: false, file, local: null, errors: [] };
  const local = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { productId, exists: true, file, local, errors: validateLocal(local, { fileName: file }) };
}

export function resolvePolicyRef(ref, { root = projectRoot(), cache = new Map() } = {}) {
  const m = REF_RE.exec(ref || '');
  if (!m) return { ok: false, reason: `malformed policyRef ${ref}` };
  const [, productId, item, ruleId] = m;
  if (!cache.has(productId)) cache.set(productId, loadPolicy(productId, { root }));
  const loaded = cache.get(productId);
  if (!loaded.exists) return { ok: false, reason: `policyRef ${ref}: product-policies/${productId}.json not found` };
  if (ruleId) {
    const rule = (loaded.policy.rules || []).find(r => r.id === ruleId);
    return rule ? { ok: true, productId, kind: 'rule', item: rule } : { ok: false, reason: `policyRef ${ref}: rule ${ruleId} not found` };
  }
  const key = item.replace(/^policies\//, '');
  const value = loaded.policy.policies?.[key];
  return value ? { ok: true, productId, kind: 'policy', key, item: value } : { ok: false, reason: `policyRef ${ref}: policy ${key} not set` };
}

// Contrast policy for a product: { decided: false } when the policy has no such item (DEC-10 question).
export function contrastPolicy(productId, { root = projectRoot() } = {}) {
  const loaded = loadPolicy(productId, { root });
  const item = loaded.policy?.policies?.['accessibility.contrast'];
  if (!loaded.exists || !item) return { productId, exists: loaded.exists, decided: false };
  return { productId, exists: true, decided: true, required: item.value.required, policyRef: `${productId}#policies/accessibility.contrast` };
}

const summaryOf = (key, value) => key === 'accessibility.contrast'
  ? `對比：${value.required ? '依 WCAG 門檻檢查' : '不適用（不檢查、不詢問對比；其他可及性項照常）'}`
  : `${key}: ${JSON.stringify(value)}`;

export function appliedPolicies(loaded) {
  if (!loaded.exists) return [];
  const out = [];
  for (const [key, item] of Object.entries(loaded.policy.policies || {})) out.push({ policyRef: `${loaded.productId}#policies/${key}`, summary: summaryOf(key, item.value), value: item.value });
  for (const r of loaded.policy.rules || []) out.push({ policyRef: `${loaded.productId}#rules/${r.id}`, summary: r.text });
  return out;
}

// One line for the intake summary (POL-03).
export function intakeLine(loaded) {
  if (!loaded.exists) return `產品 ${loaded.productId} 沒有政策檔：視為新產品，詢問是否建立（POL-02）`;
  const applied = appliedPolicies(loaded);
  const missing = POLICY_ITEMS.filter(k => !loaded.policy.policies?.[k]);
  const head = `已套用產品政策：${loaded.policy.displayName}${applied.length ? ' — ' + applied.map(a => a.summary).join('；') : '（尚無政策項目）'}`;
  return missing.length ? `${head}。待問政策題：${missing.join('、')}（DEC-10，列在預填清單最前面）` : head;
}

// ---- apply to a run (POL-03) ----

export function applyToRun(dir, productId, { root = projectRoot(), source = 'request', at = nowIso() } = {}) {
  const file = path.join(dir, 'brief.json');
  const brief = readJson(file);
  if (!brief) throw new Error('brief.json missing');
  const loaded = loadPolicy(productId, { root });
  if (loaded.exists) {
    const errors = validatePolicy(loaded.policy, { fileName: loaded.file });
    if (errors.length) throw new Error(`product policy ${productId} is invalid: ${errors.join('; ')}`);
  }
  const product = {
    productId,
    ...(loaded.exists ? { displayName: loaded.policy.displayName } : {}),
    source,
    policyDigest: loaded.digest,
    appliedPolicies: appliedPolicies(loaded),
    appliedAt: at,
    ...(loaded.exists ? {} : { newProduct: true }),
  };
  const next = { ...brief, product };
  next.openQuestions = (brief.openQuestions || []).filter(q => q !== 'product (REQ-05)');
  const errors = validateSchema('brief', next);
  if (errors.length) throw new Error(errors.join('; '));
  atomicWriteJson(file, next);
  return { product, intakeLine: intakeLine(loaded), contrast: contrastPolicy(productId, { root }) };
}

// ---- suggestions for the handoff (POL-05) ----

const isRunOnly = d => d.runOnly === true || !!d.delegation;

export function suggestFromRun(dir, { root = projectRoot(), runsRoot = path.join(root, 'design-runs') } = {}) {
  const read = f => readJson(path.join(dir, f));
  const brief = read('brief.json');
  const plan = read('plan.json') || {};
  const productId = brief?.product?.productId || null;
  const suggestions = [];
  const excluded = [];
  // 1. preferences the user stated during the run, recorded as plan.decisions[].policySuggestion
  for (const d of plan.decisions || []) {
    if (!d.policySuggestion) continue;
    if (isRunOnly(d)) { excluded.push({ ref: d.id, reason: 'run-only setting (test-round rule or delegation)' }); continue; }
    suggestions.push({ id: `ps-${suggestions.length + 1}`, source: d.id, kind: d.policySuggestion.conflictsWith ? 'conflict_with_policy' : 'stated_preference', text: d.policySuggestion.text, appliesTo: d.policySuggestion.appliesTo, ...(d.policySuggestion.value !== undefined ? { value: d.policySuggestion.value } : {}), ...(d.policySuggestion.conflictsWith ? { conflictsWith: d.policySuggestion.conflictsWith } : {}) });
  }
  // 2. the same user answer to the same question in several runs of this product
  if (productId && fs.existsSync(runsRoot)) {
    const mine = (plan.designDecisions || []).filter(d => d.source === 'user' && !d.delegation && typeof d.answer === 'string');
    for (const d of mine) {
      const runs = [];
      for (const other of fs.readdirSync(runsRoot)) {
        if (other === brief?.runId) continue;
        const ob = readJson(path.join(runsRoot, other, 'brief.json'));
        if (ob?.product?.productId !== productId) continue;
        const op = readJson(path.join(runsRoot, other, 'plan.json'));
        if ((op?.designDecisions || []).some(x => x.source === 'user' && !x.delegation && x.question === d.question && x.answer === d.answer)) runs.push(other);
      }
      if (runs.length) suggestions.push({ id: `ps-${suggestions.length + 1}`, source: d.id, kind: 'repeated_answer', text: `${d.question} → ${d.answer}`, appliesTo: 'design_decision', alsoIn: runs });
    }
  }
  for (const d of plan.designDecisions || []) if (d.delegation) excluded.push({ ref: d.id, reason: 'answered by DEC-07 delegation (run only)' });
  return { runId: brief?.runId ?? null, productId, suggestions, excluded };
}

// ---- writing (POL-04) ----

// change: { action: add|modify|remove, target: "policies/accessibility.contrast" | "rules/<id>",
//           value?: {...} (policy), rule?: { text, appliesTo } (rule), origin: policy_question |
//           handoff_suggestion | user_instruction, decisionRef: "<id in this run's plan.decisions>" }
export function writePolicy(dir, productId, change, { root = projectRoot(), at = nowIso() } = {}) {
  const planFile = path.join(dir, 'plan.json');
  const plan = readJson(planFile);
  const brief = readJson(path.join(dir, 'brief.json'));
  if (!plan) throw new Error('plan.json missing: a policy change needs a user decision recorded in this run');
  const { action, target, origin, decisionRef } = change || {};
  if (!['add', 'modify', 'remove'].includes(action)) throw new Error('change.action must be add, modify or remove');
  if (!['policy_question', 'handoff_suggestion', 'user_instruction'].includes(origin)) throw new Error('change.origin must be policy_question, handoff_suggestion or user_instruction');
  const decision = (plan.decisions || []).find(d => d.id === decisionRef);
  if (!decision) throw new Error(`decisionRef ${decisionRef} not found in this run's plan.decisions: write the user's answer or confirmation first (POL-04)`);
  if (decision.source !== 'user') throw new Error(`decisionRef ${decisionRef} is not a user decision`);
  if (isRunOnly(decision)) throw new Error(`decisionRef ${decisionRef} is a run-only setting; it cannot become a product policy (§4.6, INVARIANT-24)`);
  const loaded = loadPolicy(productId, { root });
  if (!loaded.exists) throw new Error(`product-policies/${productId}.json not found; create it with init after the user confirms (POL-02)`);
  const prev = loaded.policy;
  const next = structuredClone(prev);
  const stamp = { decidedBy: 'user', decidedAt: at, origin, runId: brief?.runId ?? null, decisionRef };
  let from = null; let to = null;
  const m = /^policies\/(.+)$/.exec(target || '') || null;
  const r = /^rules\/([a-z0-9][a-z0-9-]*)$/.exec(target || '') || null;
  if (m) {
    const key = m[1];
    if (!POLICY_ITEMS.includes(key)) throw new Error(`unknown policy item ${key}; new policy questions need a spec revision (DEC-10)`);
    const cur = next.policies[key];
    if (action === 'add' && cur) throw new Error(`policies/${key} already exists; use modify`);
    if (action !== 'add' && !cur) throw new Error(`policies/${key} does not exist`);
    from = cur ? cur.value : null;
    if (action === 'remove') { delete next.policies[key]; to = null; }
    else { to = change.value; next.policies[key] = { value: change.value, ...stamp, ...(change.note ? { note: change.note } : {}) }; }
  } else if (r) {
    const id = r[1];
    const idx = next.rules.findIndex(x => x.id === id);
    if (action === 'add' && idx >= 0) throw new Error(`rules/${id} already exists; use modify`);
    if (action !== 'add' && idx < 0) throw new Error(`rules/${id} does not exist`);
    from = idx >= 0 ? { text: next.rules[idx].text, appliesTo: next.rules[idx].appliesTo } : null;
    if (action === 'remove') { next.rules.splice(idx, 1); to = null; }
    else {
      const rule = { id, text: change.rule?.text, appliesTo: change.rule?.appliesTo, ...stamp, ...(change.note ? { note: change.note } : {}) };
      to = { text: rule.text, appliesTo: rule.appliesTo };
      if (idx >= 0) next.rules[idx] = rule; else next.rules.push(rule);
    }
  } else throw new Error(`unknown target ${target}`);
  next.history = [...prev.history, { at, action, target, from, to, origin, runId: stamp.runId, decisionRef }];
  const errors = validatePolicy(next, { fileName: loaded.file, previous: prev });
  if (errors.length) throw new Error(`refused: ${errors.join('; ')}`);
  // record in this run (POL-04): a decision pointing at the changed item. Everything is checked before
  // anything is written. Only plan.decisions is checked: at intake the rest of the plan is still partial.
  const policyRef = `${productId}#${target}`;
  const ids = new Set([...(plan.decisions || []), ...(plan.designDecisions || [])].map(d => d.id));
  let n = 1; while (ids.has(`dec-pol-${n}`)) n++;
  plan.decisions = [...(plan.decisions || []), { id: `dec-pol-${n}`, decision: `Product policy ${action} ${policyRef} (from ${JSON.stringify(from)} to ${JSON.stringify(to)}) on the user's ${origin.replace('_', ' ')}`, scope: `product policy ${productId}`, decidedAt: at, source: 'user', evidenceRefs: [decisionRef], ...(action === 'remove' ? {} : { policyRef }) }];
  const planErrors = validateSchema('plan', plan).filter(e => /^plan\/decisions\//.test(e));
  if (planErrors.length) throw new Error(`refused: the run decision would be invalid: ${planErrors.join('; ')}`);
  atomicWriteJson(loaded.file, next);
  atomicWriteJson(planFile, plan);
  return { productId, policyRef, action, from, to, digest: policyDigest(next), recordedAs: `dec-pol-${n}` };
}

// New product (POL-02): only productId and displayName, no policies; only after the user confirms.
export function initProduct(dir, productId, displayName, { decisionRef, root = projectRoot(), at = nowIso() } = {}) {
  const plan = readJson(path.join(dir, 'plan.json')) || { decisions: [] };
  const brief = readJson(path.join(dir, 'brief.json'));
  const decision = (plan.decisions || []).find(d => d.id === decisionRef);
  if (!decision || decision.source !== 'user') throw new Error(`creating a product policy needs the user's confirmation recorded as a decision (decisionRef ${decisionRef} not found)`);
  const file = policyFile(productId, root);
  if (fs.existsSync(file)) throw new Error(`product-policies/${productId}.json already exists`);
  const policy = { schemaVersion: '1.0', productId, displayName, policies: {}, rules: [], history: [{ at, action: 'add', target: 'product', from: null, to: { productId, displayName }, origin: 'user_instruction', runId: brief?.runId ?? null, decisionRef }] };
  const errors = validatePolicy(policy, { fileName: file });
  if (errors.length) throw new Error(errors.join('; '));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteJson(file, policy);
  return { productId, file, digest: policyDigest(policy) };
}

function gitPrevious(file, root) {
  try {
    const rel = path.relative(root, file).split(path.sep).join('/');
    return JSON.parse(execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return null; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const root = projectRoot();
  const out = v => console.log(JSON.stringify(v, null, 2));
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const usage = 'usage: product-policy.mjs show <productId> | validate [productId...] [--against-git] | local <productId> | apply <run-id> <productId> [--source request|user_answer] | suggest <run-id> | write <run-id> <productId> \'<change json>\' | init <run-id> <productId> <displayName...> --decision <decisionRef>';
  try {
    if (cmd === 'show') { const l = loadPolicy(args[0], { root }); out({ ...l, intakeLine: intakeLine(l), applied: appliedPolicies(l) }); }
    else if (cmd === 'validate') {
      const ids = args.filter(a => !a.startsWith('--'));
      const list = ids.length ? ids : (fs.existsSync(policyDir(root)) ? fs.readdirSync(policyDir(root)).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')) : []);
      const results = list.map(id => { const l = loadPolicy(id, { root }); const errors = l.exists ? validatePolicy(l.policy, { fileName: l.file, previous: args.includes('--against-git') ? gitPrevious(l.file, root) : null }) : ['file not found']; return { productId: id, ok: !errors.length, errors }; });
      out(results); if (results.some(r => !r.ok)) process.exit(1);
    } else if (cmd === 'local') { const l = loadLocal(args[0], { root }); out({ ...l, note: 'prefill candidates only; this run must still confirm and authorise (REQ-06)' }); if (l.errors.length) process.exit(1); }
    else if (cmd === 'apply') out(applyToRun(runDirFor(root, args[0]), args[1], { root, source: flag('--source') || 'request' }));
    else if (cmd === 'suggest') out(suggestFromRun(runDirFor(root, args[0]), { root }));
    else if (cmd === 'write') out(writePolicy(runDirFor(root, args[0]), args[1], JSON.parse(args.slice(2).join(' ')), { root }));
    else if (cmd === 'init') { const name = args.slice(2).filter((a, i, all) => a !== '--decision' && all[i - 1] !== '--decision').join(' '); out(initProduct(runDirFor(root, args[0]), args[1], name, { decisionRef: flag('--decision'), root })); }
    else { console.error(usage); process.exit(2); }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
