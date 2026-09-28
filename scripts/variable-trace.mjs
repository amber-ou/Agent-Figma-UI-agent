// Manual alias tracer (spec §6.3). Runtime resolveForConsumer() is the source of truth for
// effective values; this tracer is the tested fallback for the alias *trace* and diagnostics.
// It honours each collection's own active mode, detects cycles and limits depth.
export const MAX_DEPTH = 16;

/**
 * @param {string} variableId start variable
 * @param {(id:string)=>({id,name,variableCollectionId,valuesByMode}|null)} getVariable
 * @param {Record<string,string>} modeByCollection active mode id per collection id
 * @returns {{valueStatus, traceStatus, value, chain, error?}}
 */
export function traceAlias(variableId, getVariable, modeByCollection, { maxDepth = MAX_DEPTH } = {}) {
  const chain = [];
  const visited = new Set();
  let id = variableId;
  for (let depth = 0; depth <= maxDepth; depth++) {
    if (visited.has(id)) return { valueStatus: 'unresolved', traceStatus: 'partial', value: null, chain, error: `cycle at ${id}` };
    visited.add(id);
    const v = getVariable(id);
    if (!v) return { valueStatus: 'unavailable', traceStatus: chain.length ? 'partial' : 'unavailable', value: null, chain, error: `variable ${id} not readable (remote or missing)` };
    chain.push(v.id);
    const modeId = modeByCollection[v.variableCollectionId];
    if (!modeId) return { valueStatus: 'unresolved', traceStatus: 'partial', value: null, chain, error: `no active mode for collection ${v.variableCollectionId}` };
    if (!(modeId in (v.valuesByMode || {}))) return { valueStatus: 'unresolved', traceStatus: 'partial', value: null, chain, error: `no value for mode ${modeId} in ${v.id}` };
    const raw = v.valuesByMode[modeId];
    if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') { id = raw.id; continue; }
    return { valueStatus: 'verified', traceStatus: 'complete', value: raw, chain };
  }
  return { valueStatus: 'unresolved', traceStatus: 'partial', value: null, chain, error: `max depth ${maxDepth} exceeded` };
}

// Runtime result wins; a disagreeing manual trace is reported, never used to overwrite it (§6.3).
export function reconcileWithRuntime(runtimeValue, trace) {
  if (runtimeValue === undefined) return { value: trace.value, valueStatus: trace.valueStatus, traceStatus: trace.traceStatus, source: 'manual_trace' };
  const same = JSON.stringify(runtimeValue) === JSON.stringify(trace.value);
  return {
    value: runtimeValue,
    valueStatus: 'verified',
    traceStatus: trace.traceStatus,
    source: 'runtime',
    ...(trace.valueStatus === 'verified' && !same ? { mismatch: { manual: trace.value }, action: 'record context and check mode / data freshness; ask if unresolved' } : {}),
  };
}
