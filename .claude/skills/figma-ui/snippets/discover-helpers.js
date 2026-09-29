// figma-ui Discover helpers (spec v1.6 §8.1, A05). Paste the functions a read-only use_figma script
// needs. They keep responses small: filter on the Figma side and page by UTF-8 bytes, because
// use_figma silently truncates responses above 20,480 UTF-8 bytes (M3).
// INVARIANT-19: only properties of the node type returned by findAllWithCriteria are read.

// UTF-8 byte length without TextEncoder (not guaranteed in the plugin runtime).
function figmaUiUtf8Bytes(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

// Return one page of `items` whose JSON stays under maxBytes (default 15,000 B, leaving room for the
// envelope). `complete` is true only when this page reaches the end; read the next page with
// `nextCursor`. An item that alone exceeds maxBytes is not cut: it is reported so the caller can
// narrow the read instead of trusting a partial value.
function figmaUiPage(items, { cursor = 0, maxBytes = 15000 } = {}) {
  const out = [];
  let bytes = 2;
  let i = cursor;
  for (; i < items.length; i++) {
    const size = figmaUiUtf8Bytes(JSON.stringify(items[i])) + 1;
    if (size > maxBytes) {
      if (!out.length) return { items: [], cursor, nextCursor: i + 1, complete: false, total: items.length, bytes, oversizedItem: i };
      break;
    }
    if (bytes + size > maxBytes) break;
    out.push(items[i]);
    bytes += size;
  }
  return { items: out, cursor, nextCursor: i < items.length ? i : null, complete: i >= items.length, total: items.length, bytes };
}

// Compare only the fonts this run needs with the installed list; never return the whole list
// (M0: 8,927 fonts). required: [{ family, style, usedBy? }].
async function figmaUiFontCheck(required) {
  const available = await figma.listAvailableFontsAsync();
  const have = new Set(available.map(f => `${f.fontName.family}\u0000${f.fontName.style}`));
  const seen = new Map();
  for (const f of required) {
    const k = `${f.family}\u0000${f.style}`;
    const prev = seen.get(k);
    const usedBy = [...new Set([...(prev ? prev.usedBy : []), ...(f.usedBy || [])])];
    seen.set(k, { family: f.family, style: f.style, installed: have.has(k), usedBy });
  }
  const fonts = [...seen.values()];
  return { checked: fonts.length, missing: fonts.filter(f => !f.installed), fonts };
}

// Instances under `root`, grouped so that the same component, version, variant, overrides and
// explicit modes collapse into one entry, while a different override, mode or imported version stays
// separate (never mixed). The main component node id separates versions: a library update imported
// into the file is a different node with the same key. Scans at most `limit` instances and says so.
async function figmaUiInstanceGroups(root, { limit = 1500, samples = 3 } = {}) {
  const all = root.findAllWithCriteria({ types: ['INSTANCE'] });
  const list = all.slice(0, limit);
  const groups = new Map();
  for (const inst of list) {
    const main = await inst.getMainComponentAsync();
    const set = main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : null;
    const overrideFields = [...new Set((inst.overrides || []).flatMap(o => o.overriddenFields || []))].sort();
    const modes = inst.explicitVariableModes || {};
    const props = inst.componentProperties || {};
    const propSig = Object.keys(props).sort().map(k => `${k}=${props[k] && props[k].value}`);
    const modeSig = Object.keys(modes).sort().map(k => `${k}=${modes[k]}`);
    const key = [set ? set.key : '', main ? main.key : '', main ? main.id : 'missing', main ? main.name : '', propSig.join('&'), overrideFields.join(','), modeSig.join('&')].join('|');
    let g = groups.get(key);
    if (!g) {
      g = {
        componentSetKey: set ? set.key : null, componentSetName: set ? set.name : null,
        componentKey: main ? main.key : null, mainComponentId: main ? main.id : null, variant: main ? main.name : null,
        remote: main ? main.remote : null, properties: propSig, overrideFields, explicitModes: modeSig, count: 0, sampleIds: [],
      };
      groups.set(key, g);
    }
    g.count++;
    if (g.sampleIds.length < samples) g.sampleIds.push(inst.id);
  }
  return { scanned: list.length, totalInstances: all.length, limited: all.length > limit, groups: [...groups.values()] };
}
