#!/usr/bin/env node
// Computable quality metrics (spec §12.2) and the Plan-stage checks added in v1.4:
// - tokenBinding: variable bindings and style applications counted separately; raw values stay in
//   the denominator (§10.1, §12.2). Accepted raw exceptions are listed, the unhidden ratio is kept.
// - contrast pre-check (§9.5) and installed-font comparison (§10.3).
// Usage:
//   node scripts/quality-metrics.mjs token-binding <runDir> [--write]   (reads audit.metrics.propertyBindings)
//   node scripts/quality-metrics.mjs contrast <#fg> <#bg> [fontSizePx] [bold]
//   node scripts/quality-metrics.mjs fonts <required.json> <available.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson } from './state-store.mjs';

// ---- tokenBinding (§12.2) ----

// Denominator: eligible properties this run created or changed (origin introduced | regression).
// Numerator: variable bindings and style applications confirmed by a read-back (verified=true).
// inherited_baseline properties are counted apart and never lower the ratio.
export function tokenBinding(records = []) {
  const eligible = records.filter(r => r.eligible !== false);
  const own = eligible.filter(r => r.origin !== 'inherited_baseline');
  const baseline = eligible.filter(r => r.origin === 'inherited_baseline');
  const bound = r => (r.binding === 'variable' || r.binding === 'style') && r.verified === true;

  const variables = own.filter(r => r.binding === 'variable' && bound(r));
  const styles = own.filter(r => r.binding === 'style' && bound(r));
  const styleByKind = {};
  for (const r of styles) styleByKind[r.styleKind] = (styleByKind[r.styleKind] || 0) + 1;
  const raw = own.filter(r => r.binding === 'raw');
  const rawAccepted = raw.filter(r => r.exceptionRef);
  const unverified = own.filter(r => r.binding !== 'raw' && r.verified !== true);
  const regressions = own.filter(r => r.origin === 'regression');

  const denominator = own.length;
  const numerator = variables.length + styles.length;
  const ratio = (n, d) => (d === 0 ? 'N/A' : `${n}/${d}`);
  const exDenominator = denominator - rawAccepted.length;
  return {
    denominator,
    bound: numerator,
    variableBindings: variables.length,
    styleApplications: { total: styles.length, byKind: styleByKind },
    raw: raw.length,
    rawAcceptedAsException: rawAccepted.map(r => ({ nodeId: r.nodeId, property: r.property, exceptionRef: r.exceptionRef })),
    rawUnaccepted: raw.filter(r => !r.exceptionRef).map(r => ({ nodeId: r.nodeId, property: r.property })),
    unverified: unverified.map(r => ({ nodeId: r.nodeId, property: r.property, binding: r.binding })),
    regressions: regressions.map(r => ({ nodeId: r.nodeId, property: r.property })),
    inheritedBaseline: { total: baseline.length, bound: baseline.filter(bound).length },
    notEligible: records.length - eligible.length,
    // The unhidden ratio (§12.2) and, next to it, the ratio with accepted raw exceptions set aside.
    ratio: ratio(numerator, denominator),
    ratioExcludingAcceptedExceptions: ratio(numerator, exDenominator),
    status: denominator === 0 ? 'not_applicable' : numerator === denominator ? 'complete' : 'incomplete',
  };
}

// ---- contrast (§9.5, WCAG 2.2 AA) ----

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) throw new Error(`expected #RRGGBB, got ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}

// Large text: ≥ 24px, or ≥ 18.66px bold (18pt / 14pt bold). 14px bold is NOT large.
export function requiredContrast({ kind = 'text_contrast', fontSize, bold = false } = {}) {
  if (kind === 'non_text_contrast') return 3;
  if (kind !== 'text_contrast') throw new Error(`no contrast requirement for ${kind}`);
  const large = fontSize >= 24 || (bold && fontSize >= 18.66);
  return large ? 3 : 4.5;
}

// Fill ratio / required / status of one plan.accessibilityPrecheck item. Items without both colours
// stay not_verified (e.g. text on a gradient or image needs a manual check).
export function precheckContrast(item) {
  if (!item.foreground || !item.background) return { ...item, status: 'not_verified' };
  const ratio = contrastRatio(item.foreground, item.background);
  const required = requiredContrast(item);
  return { ...item, ratio, required, status: ratio >= required ? 'pass' : 'fail' };
}

// ---- fonts (§10.3) ----

const fontKey = f => `${f.family}\u0000${f.style}`;

// required: [{family, style, usedBy?}]; available: listAvailableFontsAsync() result
// ([{fontName:{family,style}}] or [{family,style}]). Missing fonts are reported, never substituted.
export function fontCheck(required = [], available = []) {
  const have = new Set(available.map(a => fontKey(a.fontName || a)));
  const seen = new Map();
  for (const f of required) {
    const k = fontKey(f);
    const prev = seen.get(k);
    const usedBy = [...new Set([...(prev?.usedBy || []), ...(f.usedBy || [])])];
    seen.set(k, { family: f.family, style: f.style, installed: have.has(k), ...(usedBy.length ? { usedBy } : {}) });
  }
  const fonts = [...seen.values()];
  return { fonts, missing: fonts.filter(f => !f.installed) };
}

// ---- CLI ----

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  const usage = 'usage: quality-metrics.mjs token-binding <runDir> [--write] | contrast <#fg> <#bg> [fontSizePx] [bold] | fonts <required.json> <available.json>';
  try {
    if (cmd === 'token-binding' && rest[0]) {
      const file = path.join(rest[0], 'audit.json');
      const audit = readJson(file);
      const result = tokenBinding(audit.metrics?.propertyBindings || []);
      if (rest.includes('--write')) {
        audit.metrics = { ...(audit.metrics || {}), tokenBinding: result };
        atomicWriteJson(file, audit);
      }
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'contrast' && rest[1]) {
      const fontSize = rest[2] ? Number(rest[2]) : 16;
      console.log(JSON.stringify(precheckContrast({ kind: 'text_contrast', foreground: rest[0], background: rest[1], fontSize, bold: rest[3] === 'bold' }), null, 2));
    } else if (cmd === 'fonts' && rest[1]) {
      console.log(JSON.stringify(fontCheck(readJson(rest[0]), readJson(rest[1])), null, 2));
    } else {
      console.error(usage);
      process.exit(2);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
