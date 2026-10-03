// figma-ui SPACE-001 value choice (spec v1.9 §9.6, references/common-rules.md section 6). A pure
// function: no Figma API calls, so it can be pasted into a use_figma script or run offline.
//
// figmaUiSpacing({ value, origin, property, tokens, patternValue, fits, scale })
//   value         the intended spacing (Figma units)
//   origin        'new'        node the agent creates in this run (the only case that is snapped)
//                 'reference'  copied from a reference screen or confirmed pattern: keep its value
//                 'existing'   existing node, reference screen or shared component: never changed
//   property      'padding' | 'gap' | 'margin' are snapped. Anything else (auto_gap, ratio, font_size,
//                 stroke, vector, image_ratio, safe_area, exception) is never rounded.
//   tokens        approved spacing tokens [{ name, value }], already filtered to the semantically
//                 suitable ones; used instead of the scale when present
//   patternValue  value of an applicable existing pattern (wins over tokens and the scale)
//   fits(v)       optional layout check (overflow, wrapping, alignment, hit areas); a candidate that
//                 fails is skipped and the next candidate is tried
//   scale         defaults to 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (a value set, not new variables)
// Returns { value, source: 'unchanged' | 'pattern' | 'token' | 'scale', token?, reason, tried }.
// When no candidate fits, the original value is kept with source 'unchanged' and revert: true so the
// caller reports it instead of forcing a value.

var FIGMA_UI_SPACING_SCALE = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64];
var FIGMA_UI_SNAPPED_PROPERTIES = ['padding', 'gap', 'margin'];
var FIGMA_UI_SPACING_TOLERANCE = 0.01;

function figmaUiSpacing(input) {
  var value = input.value;
  var origin = input.origin || 'new';
  var property = input.property || 'gap';
  var keep = function (source, reason) { return { value: value, source: source, reason: reason, tried: [] }; };

  if (origin === 'existing') return keep('unchanged', 'existing node, reference screen or shared component: SPACE-001 does not change it');
  if (origin === 'reference') return keep('pattern', 'copied from a reference screen or confirmed pattern: keep the original value, no rounding');
  if (FIGMA_UI_SNAPPED_PROPERTIES.indexOf(property) < 0) return keep('unchanged', property + ' is never rounded (auto gap, ratios, font sizes, strokes, vectors, image ratios, safe areas, exceptions)');
  if (typeof value !== 'number' || !isFinite(value)) return keep('unchanged', 'no numeric value');
  if (value < 0) return keep('unchanged', 'negative spacing is an exception, not snapped');
  if (typeof input.patternValue === 'number') return { value: input.patternValue, source: 'pattern', reason: 'an applicable existing pattern decides the value', tried: [] };

  var tokens = (input.tokens || []).filter(function (t) { return typeof t.value === 'number'; });
  var useTokens = tokens.length > 0;
  var pool = useTokens
    ? tokens.map(function (t) { return { value: t.value, token: t.name }; })
    : (input.scale || FIGMA_UI_SPACING_SCALE).map(function (v) { return { value: v }; });

  // Nearest first; on a tie the larger value wins (14 → 16 before 12).
  pool.sort(function (a, b) {
    var da = Math.abs(a.value - value);
    var db = Math.abs(b.value - value);
    if (Math.abs(da - db) > FIGMA_UI_SPACING_TOLERANCE) return da - db;
    return b.value - a.value;
  });

  var fits = typeof input.fits === 'function' ? input.fits : function () { return true; };
  var tried = [];
  for (var i = 0; i < pool.length; i++) {
    var c = pool[i];
    if (fits(c.value)) {
      var exact = Math.abs(c.value - value) <= FIGMA_UI_SPACING_TOLERANCE;
      var out = {
        value: c.value,
        source: useTokens ? 'token' : 'scale',
        reason: exact ? 'already on the ' + (useTokens ? 'approved tokens' : 'scale')
          : (tried.length ? 'nearest candidate ' + tried.join(', ') + ' broke the layout; next candidate ' + c.value : 'nearest ' + (useTokens ? 'approved token' : 'scale value') + ' to ' + value),
        tried: tried,
      };
      if (c.token) out.token = c.token;
      return out;
    }
    tried.push(c.value);
  }
  return { value: value, source: 'unchanged', reason: 'no candidate keeps the layout valid; keep the value and report it', tried: tried, revert: true };
}
