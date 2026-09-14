/* Color parsing and Android color formatting. */
(function (root) {
  'use strict';
  const S2V = (root.S2V = root.S2V || {});

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  let ctx2d = null;

  // Fallback for exotic CSS colors (hsl, lab, oklch, color(), named colors...)
  function viaCanvas(str) {
    if (typeof document === 'undefined') return null;
    if (!ctx2d) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      ctx2d = c.getContext('2d', { willReadFrequently: true });
    }
    ctx2d.fillStyle = '#010203';
    ctx2d.fillStyle = str;
    const a = ctx2d.fillStyle;
    ctx2d.fillStyle = '#030201';
    ctx2d.fillStyle = str;
    if (ctx2d.fillStyle !== a) return null; // invalid color
    ctx2d.clearRect(0, 0, 1, 1);
    ctx2d.fillRect(0, 0, 1, 1);
    const d = ctx2d.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }

  function parseHex(h) {
    let r, g, b, a = 255;
    if (h.length === 3 || h.length === 4) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
      if (h.length === 4) a = parseInt(h[3] + h[3], 16);
    } else if (h.length === 6 || h.length === 8) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
      if (h.length === 8) a = parseInt(h.slice(6, 8), 16);
    } else {
      return null;
    }
    return { r, g, b, a: a / 255 };
  }

  const Color = {
    /** Parse a CSS color into {r,g,b (0-255), a (0-1)}; null for none/invalid. */
    parse(str) {
      if (str == null) return null;
      const s = String(str).trim().toLowerCase();
      if (!s || s === 'none') return null;
      if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      let m = s.match(
        /^rgba?\(\s*([-\d.e]+%?)\s*[,\s]\s*([-\d.e]+%?)\s*[,\s]\s*([-\d.e]+%?)\s*(?:[,/]\s*([-\d.e]+%?)\s*)?\)$/
      );
      if (m) {
        const ch = (v) => clamp(v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v), 0, 255);
        const al = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        return { r: ch(m[1]), g: ch(m[2]), b: ch(m[3]), a: clamp(isNaN(al) ? 1 : al, 0, 1) };
      }
      m = s.match(/^#([0-9a-f]+)$/);
      if (m) return parseHex(m[1]);
      return viaCanvas(s);
    },

    /** Android color literal: #RRGGBB or #AARRGGBB. */
    toAndroid(c, forceAlpha) {
      const hex = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0').toUpperCase();
      const A = Math.round(clamp(c.a, 0, 1) * 255);
      return '#' + (A < 255 || forceAlpha ? hex(A) : '') + hex(c.r) + hex(c.g) + hex(c.b);
    },

    /** Parse Android color literal (#RGB, #ARGB, #RRGGBB, #AARRGGBB). */
    parseAndroid(str) {
      if (!str) return null;
      const m = String(str).trim().match(/^#([0-9a-fA-F]+)$/);
      if (!m) return null;
      const h = m[1];
      const d = (x) => parseInt(x + x, 16);
      switch (h.length) {
        case 3: return { r: d(h[0]), g: d(h[1]), b: d(h[2]), a: 1 };
        case 4: return { a: d(h[0]) / 255, r: d(h[1]), g: d(h[2]), b: d(h[3]) };
        case 6: return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
        case 8: return { a: parseInt(h.slice(0, 2), 16) / 255, r: parseInt(h.slice(2, 4), 16), g: parseInt(h.slice(4, 6), 16), b: parseInt(h.slice(6, 8), 16) };
        default: return null;
      }
    },
  };

  S2V.Color = Color;
})(typeof window !== 'undefined' ? window : globalThis);
