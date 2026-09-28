// figma-ui precondition guard (spec §11.2 item 3, INVARIANT-12). Paste together with
// fingerprint.js and mark-owned.js at the top of every write script that changes an existing
// agent-owned node. If anything differs from the last agent-verified state, return the conflict
// and change NOTHING. This narrows the conflict window to one script run; it is not atomic.
//
// Usage:
//   const guard = await figmaUiGuard('<node id>', { runId, expectedFingerprint, expectedChildIds });
//   if (!guard.ok) return { status: 'conflict', ...guard, createdNodeIds: [], mutatedNodeIds: [] };
async function figmaUiGuard(nodeId, { runId, expectedFingerprint, expectedChildIds = null }) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return { ok: false, kind: 'deleted', nodeId, detail: 'node no longer exists (user may have deleted it; do not recreate, ask)' };
  const owner = figmaUiReadOwner(node);
  if (owner.runId !== runId) return { ok: false, kind: 'not_owned', nodeId, owner };
  const current = await figmaUiFingerprint(node);
  const childIds = 'children' in node ? node.children.map(c => c.id) : [];
  const foreignChildren = 'children' in node
    ? node.children.filter(c => expectedChildIds && !expectedChildIds.includes(c.id)).map(c => ({ id: c.id, type: c.type, name: c.name, owner: figmaUiReadOwner(c).runId || null }))
    : [];
  const missingChildren = expectedChildIds ? expectedChildIds.filter(id => !childIds.includes(id)) : [];
  if (current !== expectedFingerprint || foreignChildren.length || missingChildren.length) {
    return {
      ok: false,
      kind: foreignChildren.length ? 'user_added_nodes' : missingChildren.length ? 'user_removed_nodes' : 'user_modified',
      nodeId,
      expectedFingerprint,
      currentFingerprint: current,
      foreignChildren,
      missingChildren,
    };
  }
  return { ok: true, nodeId, fingerprint: current };
}
