// figma-ui ownership marker (spec §11.2 item 2). Write it in the SAME use_figma script that creates
// the root node. sharedPluginData (namespace figma_ui) was verified in M1 on plugin 2.2.118; note
// that the non-shared setPluginData is NOT supported by use_figma. Children are owned via their root.
// Copies of a node keep the marker, so several nodes with the same marker are ambiguous: stop and ask.
const FIGMA_UI_NS = 'figma_ui';

function figmaUiMarkOwned(node, marker) {
  for (const key of ['runId', 'operationId', 'logicalKey']) {
    if (!marker[key]) throw new Error(`ownership marker needs ${key}`);
  }
  for (const [k, v] of Object.entries(marker)) node.setSharedPluginData(FIGMA_UI_NS, k, String(v));
  return figmaUiReadOwner(node);
}

function figmaUiReadOwner(node) {
  const out = {};
  for (const k of node.getSharedPluginDataKeys(FIGMA_UI_NS)) out[k] = node.getSharedPluginData(FIGMA_UI_NS, k);
  return out;
}

// Candidates for a logicalKey inside a known parent (used by reconciliation, §11.4 step 3).
function figmaUiFindOwned(parent, { runId, logicalKey }) {
  return ('children' in parent ? parent.children : []).filter(n => {
    const o = figmaUiReadOwner(n);
    return o.runId === runId && (!logicalKey || o.logicalKey === logicalKey);
  }).map(n => ({ id: n.id, type: n.type, name: n.name, owner: figmaUiReadOwner(n) }));
}
