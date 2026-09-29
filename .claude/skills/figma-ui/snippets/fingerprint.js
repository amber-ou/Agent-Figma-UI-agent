// figma-ui fingerprint v1 (spec §11.2 item 3, §11.4). Paste into a use_figma script and call on the
// agent-owned root node. Computed on the Figma side only; local scripts cannot read the canvas.
// Covers stable properties that agent operations depend on: type, name, rounded size, auto-layout
// settings, fill count, and per child: id, type, main component key and text contents.
// This is exactly the algorithm used in M1 (fp1:3b000d57 / fp1:38e19867 / fp1:d9899c64).
// Changing it requires a new prefix (fp2:) — values from different versions are not comparable.
// M3 fix (still fp1): reading findAllWithCriteria on a TEXT or other leaf node THROWS in use_figma
// ("no such property") instead of returning undefined, so the old `c.findAllWithCriteria ? … : []`
// guard aborted any script with a direct TEXT child (ui-20260929-001 op-0001). Children are now
// narrowed by type; containers and instances hash exactly as before, so M1 values are unchanged.
const FIGMA_UI_TEXT_CONTAINERS = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
async function figmaUiFingerprint(node) {
  const norm = {
    v: 1,
    type: node.type,
    name: node.name,
    w: Math.round(node.width),
    h: Math.round(node.height),
    layout: [node.layoutMode, node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft, node.itemSpacing, node.primaryAxisAlignItems, node.counterAxisAlignItems],
    fills: Array.isArray(node.fills) ? node.fills.length : 0,
    children: [],
  };
  for (const c of ('children' in node ? node.children : [])) {
    const m = c.type === 'INSTANCE' ? await c.getMainComponentAsync() : null;
    const txt = c.type === 'TEXT' ? [c.characters]
      : FIGMA_UI_TEXT_CONTAINERS.has(c.type) ? c.findAllWithCriteria({ types: ['TEXT'] }).map(t => t.characters) : [];
    norm.children.push({ id: c.id, type: c.type, mainKey: m ? m.key : null, text: txt });
  }
  const str = JSON.stringify(norm);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fp1:' + h.toString(16).padStart(8, '0');
}
