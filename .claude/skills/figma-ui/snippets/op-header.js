// figma-ui op header (spec §4.5, §11.3). The FIRST line of every use_figma `code` must be:
//
//   // figma-ui run=<runId> op=<operationId> mode=read|write
//
// Rules enforced by scripts/hooks/pre-figma-call.mjs while a run is active:
// - mode=write: <operationId> must already be `planned` in design-runs/<runId>/operations.jsonl
//   (scripts/operation-journal.mjs plan ...), with mode=write, the authorized output fileKey and
//   non-empty basisRefs. The hook records `dispatched`; PostToolUse records `applied`.
// - mode=read: use a separate id (rd-0001, rd-0002, ...). Reusing a write operationId is denied,
//   because it would overwrite that operation's status (INVARIANT-15).
// - Header and runId must match .figma-ui/active-run.json, or the call is denied.
//
// Example (read):
//   // figma-ui run=ui-20260929-001 op=rd-0003 mode=read
//   const page = await figma.getNodeByIdAsync('<page id from a previous read>');
//
// Local helper used by the skill to build the line (not pasted into Figma):
function figmaUiOpHeader(runId, operationId, mode) {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || !/^[A-Za-z0-9._-]+$/.test(operationId)) throw new Error('invalid runId/operationId');
  if (mode !== 'read' && mode !== 'write') throw new Error('mode must be read or write');
  return `// figma-ui run=${runId} op=${operationId} mode=${mode}`;
}
