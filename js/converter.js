/*
 * SVG -> Android VectorDrawable converter.
 *
 * The SVG is mounted (sanitized) inside a hidden Shadow DOM so the browser's
 * own CSS engine resolves <style> rules, inheritance, currentColor, etc.
 * All transforms are flattened into path coordinates, so the output does not
 * depend on Android's group-transform quirks. Groups are only emitted for
 * clip-paths and for elliptical radial gradients.
 */
(function (root) {
  'use strict';
  const S2V = (root.S2V = root.S2V || {});
  const { Matrix, PathData, Color } = S2V;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const EMPTY = { empty: true };

  const CONTAINERS = new Set(['g', 'a', 'svg', 'switch']);
  const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
  const USE_STYLE_PROPS = [
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'color', 'visibility',
    'opacity', 'paint-order', 'clip-rule', 'clip-path',
  ];
  const UNSUPPORTED = {
    text: 'Phần tử <text> không được hỗ trợ (VectorDrawable không có chữ). Hãy chuyển chữ thành path (Outline/Convert to path) trước khi xuất SVG.',
    image: 'Phần tử <image> (ảnh bitmap) không được hỗ trợ và đã bị bỏ qua.',
    foreignObject: 'Phần tử <foreignObject> không được hỗ trợ và đã bị bỏ qua.',
  };

  const clamp01 = (v) => (isNaN(v) ? 1 : v < 0 ? 0 : v > 1 ? 1 : v);
  const fmt = PathData.formatNum;

  // ---------------------------------------------------------------------------
  // Parsing & sanitizing
  // ---------------------------------------------------------------------------
  function parseSvgText(text) {
    if (!text || !String(text).trim()) return { error: 'Chưa có dữ liệu SVG.' };
    const src = String(text).replace(/^﻿/, '').trim();
    if (!/<svg[\s>/]/i.test(src)) return { error: 'Không tìm thấy thẻ <svg> trong dữ liệu.' };

    let rootEl = null;
    const tryXml = (s) => {
      try {
        const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
        const r = doc.documentElement;
        if (!doc.getElementsByTagName('parsererror').length && r && r.localName === 'svg' && r.namespaceURI === SVG_NS) {
          return r;
        }
      } catch (e) {
        /* ignore */
      }
      return null;
    };
    rootEl = tryXml(src);
    if (!rootEl) {
      const start = src.search(/<svg[\s>/]/i);
      const end = src.toLowerCase().lastIndexOf('</svg>');
      if (start > 0 && end > start) rootEl = tryXml(src.slice(start, end + 6));
    }
    if (!rootEl) {
      // Lenient HTML parser: handles missing xmlns, undeclared prefixes, &nbsp; ...
      const hdoc = new DOMParser().parseFromString(src, 'text/html');
      rootEl = hdoc.querySelector('svg');
    }
    if (!rootEl) return { error: 'Không đọc được SVG (cú pháp không hợp lệ).' };
    return { root: rootEl };
  }

  function sanitize(svg) {
    svg.querySelectorAll('script, iframe, object, embed, audio, video, canvas, foreignObject').forEach((n) => n.remove());
    const all = [svg, ...svg.querySelectorAll('*')];
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttributeNode(attr);
        } else if ((name === 'href' || name === 'xlink:href') && !attr.value.trim().startsWith('#')) {
          el.removeAttributeNode(attr);
        }
      }
      if (el.localName === 'style') {
        el.textContent = el.textContent.replace(/@import[^;]*;?/gi, '');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Small parsers
  // ---------------------------------------------------------------------------
  const UNIT = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8, rem: 16 };

  /** Parse a length. ref: reference length for percentages (null => percentages invalid). */
  function parseLength(str, ref) {
    if (str == null) return null;
    const m = String(str).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)$/i);
    if (!m) return null;
    const v = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    if (!u) return v;
    if (u === '%') return ref == null ? null : (v / 100) * ref;
    return UNIT[u] ? v * UNIT[u] : v;
  }

  function parseViewBox(str) {
    if (!str) return null;
    const n = (str.match(PathData.NUM_RE) || []).map(Number);
    if (n.length < 4 || !(n[2] > 0) || !(n[3] > 0)) return null;
    return { x: n[0], y: n[1], w: n[2], h: n[3] };
  }

  function viewBoxTransform(vb, W, H, par) {
    const parts = String(par || 'xMidYMid meet').trim().split(/\s+/);
    if (parts[0] === 'defer') parts.shift();
    const align = parts[0] || 'xMidYMid';
    const slice = parts[1] === 'slice';
    let sx = W / vb.w, sy = H / vb.h;
    if (align !== 'none') {
      const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
      sx = sy = s;
    }
    let tx = -vb.x * sx, ty = -vb.y * sy;
    if (align !== 'none') {
      const ax = align.slice(1, 4), ay = align.slice(5, 8);
      if (ax === 'Mid') tx += (W - vb.w * sx) / 2;
      else if (ax === 'Max') tx += W - vb.w * sx;
      if (ay === 'Mid') ty += (H - vb.h * sy) / 2;
      else if (ay === 'Max') ty += H - vb.h * sy;
    }
    return [sx, 0, 0, sy, tx, ty];
  }

  function urlId(value) {
    if (!value || value === 'none') return null;
    const m = String(value).match(/url\(\s*(['"]?)(.*?)\1\s*\)/);
    if (!m) return null;
    const hash = m[2].lastIndexOf('#');
    if (hash < 0) return null;
    try {
      return decodeURIComponent(m[2].slice(hash + 1));
    } catch (e) {
      return m[2].slice(hash + 1);
    }
  }

  function getHref(el) {
    return el.getAttribute('href') || el.getAttributeNS(XLINK_NS, 'href') || el.getAttribute('xlink:href');
  }

  function rectSegs(x, y, w, h, rx, ry) {
    if (!(w > 0) || !(h > 0)) return null;
    if (rx > 0 && ry > 0) {
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      const s = [['M', x + rx, y]];
      if (w > 2 * rx) s.push(['L', x + w - rx, y]);
      s.push(['A', rx, ry, 0, 0, 1, x + w, y + ry]);
      if (h > 2 * ry) s.push(['L', x + w, y + h - ry]);
      s.push(['A', rx, ry, 0, 0, 1, x + w - rx, y + h]);
      if (w > 2 * rx) s.push(['L', x + rx, y + h]);
      s.push(['A', rx, ry, 0, 0, 1, x, y + h - ry]);
      if (h > 2 * ry) s.push(['L', x, y + ry]);
      s.push(['A', rx, ry, 0, 0, 1, x + rx, y]);
      s.push(['Z']);
      return s;
    }
    return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  }

  function ellipseSegs(cx, cy, rx, ry) {
    if (!(rx > 0) || !(ry > 0)) return null;
    return [
      ['M', cx + rx, cy],
      ['A', rx, ry, 0, 0, 1, cx, cy + ry],
      ['A', rx, ry, 0, 0, 1, cx - rx, cy],
      ['A', rx, ry, 0, 0, 1, cx, cy - ry],
      ['A', rx, ry, 0, 0, 1, cx + rx, cy],
      ['Z'],
    ];
  }

  // ---------------------------------------------------------------------------
  // Converter
  // ---------------------------------------------------------------------------
  class Converter {
    constructor(svg, scope, options) {
      this.svg = svg;
      this.scope = scope;
      this.options = options || {};
      this.warnings = new Map();
      this.rootVp = { w: 100, h: 100 };
    }

    warn(msg) {
      this.warnings.set(msg, (this.warnings.get(msg) || 0) + 1);
    }

    byId(id) {
      if (!id) return null;
      return this.scope.getElementById(id);
    }

    // --- <use> expansion ------------------------------------------------------
    expandUses() {
      let guard = 0;
      for (;;) {
        const uses = Array.from(this.svg.querySelectorAll('use'));
        if (!uses.length) break;
        for (const use of uses) {
          if (!use.isConnected) continue;
          if (++guard > 20000) {
            this.warn('Quá nhiều hoặc có vòng lặp tham chiếu <use>; một phần đã bị bỏ qua.');
            this.svg.querySelectorAll('use').forEach((u) => u.remove());
            return;
          }
          const href = getHref(use);
          const ref = href && href.trim().startsWith('#') ? this.byId(href.trim().slice(1)) : null;
          if (!ref || ref === use || ref.contains(use)) {
            use.remove();
            continue;
          }
          const doc = use.ownerDocument;
          const g = doc.createElementNS(SVG_NS, 'g');
          const skip = new Set(['x', 'y', 'width', 'height', 'href', 'xlink:href', 'transform', 'id']);
          for (const attr of Array.from(use.attributes)) {
            if (skip.has(attr.name)) continue;
            try {
              if (attr.namespaceURI) g.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
              else g.setAttribute(attr.name, attr.value);
            } catch (e) {
              /* ignore invalid attribute names */
            }
          }
          // CSS rules may target the <use> itself (e.g. "use.icon { fill: red }"); they would
          // stop matching on the replacement <g>, so pin the use's computed values inline.
          const ucs = getComputedStyle(use);
          if (ucs.display === 'none') {
            use.remove();
            continue;
          }
          // Only pin values set on the <use> itself: pinning inherited values would block
          // inheritance when this expansion is later cloned somewhere else (e.g. <use> in <defs>).
          const pcs = use.parentElement ? getComputedStyle(use.parentElement) : null;
          const decl = [];
          for (const prop of USE_STYLE_PROPS) {
            const val = ucs.getPropertyValue(prop);
            if (!val) continue;
            if (prop === 'opacity' ? val === '1' : prop === 'clip-path' ? val === 'none' : pcs && pcs.getPropertyValue(prop) === val) {
              continue;
            }
            decl.push(`${prop}:${val}`);
          }
          if (decl.length) g.setAttribute('style', decl.join(';'));
          else g.removeAttribute('style');

          const vp = this.rootVp;
          const x = parseLength(use.getAttribute('x'), vp.w) || 0;
          const y = parseLength(use.getAttribute('y'), vp.h) || 0;
          let tf = use.getAttribute('transform') || '';
          if (x || y) tf += ` translate(${x},${y})`;
          if (tf.trim()) g.setAttribute('transform', tf);
          g.setAttribute('data-s2v-use', '1');

          let clone;
          if (ref.localName === 'symbol') {
            clone = doc.createElementNS(SVG_NS, 'svg');
            for (const attr of Array.from(ref.attributes)) {
              if (attr.name === 'id') continue;
              try {
                clone.setAttribute(attr.name, attr.value);
              } catch (e) {
                /* ignore */
              }
            }
            for (const child of Array.from(ref.childNodes)) clone.appendChild(child.cloneNode(true));
            clone.setAttribute('width', use.getAttribute('width') || ref.getAttribute('width') || '100%');
            clone.setAttribute('height', use.getAttribute('height') || ref.getAttribute('height') || '100%');
            clone.removeAttribute('x');
            clone.removeAttribute('y');
          } else {
            clone = ref.cloneNode(true);
            if (ref.localName === 'svg') {
              if (use.hasAttribute('width')) clone.setAttribute('width', use.getAttribute('width'));
              if (use.hasAttribute('height')) clone.setAttribute('height', use.getAttribute('height'));
            }
          }
          // Avoid duplicate ids inside the clone (lookups must hit the original definitions)
          clone.removeAttribute('id');
          g.appendChild(clone);
          use.replaceWith(g);
        }
      }
    }

    // --- viewport ---------------------------------------------------------------
    rootViewport() {
      const svg = this.svg;
      const vb = parseViewBox(svg.getAttribute('viewBox'));
      let W = parseLength(svg.getAttribute('width'), null);
      let H = parseLength(svg.getAttribute('height'), null);
      if (!(W > 0)) W = null;
      if (!(H > 0)) H = null;
      if (vb) {
        if (W == null && H == null) { W = vb.w; H = vb.h; }
        else if (W == null) W = (H * vb.w) / vb.h;
        else if (H == null) H = (W * vb.h) / vb.w;
      } else {
        if (W == null || H == null) {
          this.rootVp = { w: W || 300, h: H || 150 };
          const bb = this.elementBBox(svg);
          if (W == null) W = bb && bb.x + bb.w > 0 ? bb.x + bb.w : 300;
          if (H == null) H = bb && bb.y + bb.h > 0 ? bb.y + bb.h : 150;
        }
      }
      const box = vb || { x: 0, y: 0, w: W, h: H };
      const par = svg.getAttribute('preserveAspectRatio') || '';
      const sameAspect = Math.abs(box.w / box.h - W / H) < 1e-6 * (W / H);
      let ctm, vpW, vpH;
      if (sameAspect || /^\s*none/.test(par)) {
        vpW = box.w;
        vpH = box.h;
        ctm = Matrix.translate(-box.x, -box.y);
      } else {
        const k = box.w / W;
        vpW = W * k;
        vpH = H * k;
        ctm = Matrix.multiply(Matrix.scale(k), viewBoxTransform(box, W, H, par));
      }
      this.rootVp = { w: box.w, h: box.h };
      return { W, H, vpW, vpH, ctm, userVp: { w: box.w, h: box.h } };
    }

    // --- lengths & transforms -----------------------------------------------------
    len(value, axis, vp) {
      const ref = axis === 'x' ? vp.w : axis === 'y' ? vp.h : Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2);
      const v = parseLength(value, ref);
      return v == null || isNaN(v) ? null : v;
    }

    localTransform(el, cs) {
      const attr = el.getAttribute('transform');
      if (attr && attr.trim()) return Matrix.parse(attr);
      if (!cs || !cs.transform || cs.transform === 'none') return Matrix.identity();
      const m = Matrix.parseCss(cs.transform);
      if (!m) return Matrix.identity();
      const o = String(cs.transformOrigin || '0 0').split(/\s+/).map(parseFloat);
      let ox = o[0] || 0, oy = o[1] || 0;
      if (cs.transformBox === 'fill-box') {
        const bb = this.elementBBox(el);
        if (bb) { ox += bb.x; oy += bb.y; }
      }
      if (!ox && !oy) return m;
      return Matrix.multiply(Matrix.multiply(Matrix.translate(ox, oy), m), Matrix.translate(-ox, -oy));
    }

    // --- geometry -----------------------------------------------------------------
    shapeSegments(el, cs, vp) {
      const get = (name, axis, def = 0) => {
        let v = el.getAttribute(name);
        if (v == null && cs) {
          const c = cs.getPropertyValue(name);
          if (c && c !== 'auto' && c !== 'none') v = c;
        }
        if (v == null) return def;
        const n = this.len(v, axis, vp);
        return n == null ? def : n;
      };
      switch (el.localName) {
        case 'path': {
          let d = el.getAttribute('d');
          if (d == null && cs) {
            const m = (cs.getPropertyValue('d') || '').match(/path\(\s*(["'])([\s\S]*)\1\s*\)/);
            if (m) d = m[2];
          }
          return PathData.parse(d);
        }
        case 'rect': {
          const w = get('width', 'x'), h = get('height', 'y');
          let rx = get('rx', 'x', null), ry = get('ry', 'y', null);
          if (rx == null && ry == null) rx = ry = 0;
          else if (rx == null) rx = ry;
          else if (ry == null) ry = rx;
          return rectSegs(get('x', 'x'), get('y', 'y'), w, h, Math.max(0, rx), Math.max(0, ry));
        }
        case 'circle': {
          const r = get('r', 'd');
          return ellipseSegs(get('cx', 'x'), get('cy', 'y'), r, r);
        }
        case 'ellipse': {
          let rx = get('rx', 'x', null), ry = get('ry', 'y', null);
          if (rx == null) rx = ry;
          if (ry == null) ry = rx;
          return ellipseSegs(get('cx', 'x'), get('cy', 'y'), rx, ry);
        }
        case 'line':
          return [['M', get('x1', 'x'), get('y1', 'y')], ['L', get('x2', 'x'), get('y2', 'y')]];
        case 'polyline':
        case 'polygon': {
          const nums = (el.getAttribute('points') || '').match(PathData.NUM_RE) || [];
          if (nums.length < 4) return null;
          const segs = [];
          for (let k = 0; k + 1 < nums.length; k += 2) segs.push([k ? 'L' : 'M', +nums[k], +nums[k + 1]]);
          if (el.localName === 'polygon') segs.push(['Z']);
          return segs;
        }
      }
      return null;
    }

    /** Bounding box of an element in its own user space (own transform excluded). */
    elementBBox(el) {
      let box = null;
      const add = (b) => {
        if (!b) return;
        if (!box) { box = { ...b }; return; }
        const x2 = Math.max(box.x + box.w, b.x + b.w), y2 = Math.max(box.y + box.h, b.y + b.h);
        box.x = Math.min(box.x, b.x);
        box.y = Math.min(box.y, b.y);
        box.w = x2 - box.x;
        box.h = y2 - box.y;
      };
      const visit = (node, m, cs, depth) => {
        if (depth > 64 || node.namespaceURI !== SVG_NS) return;
        const tag = node.localName;
        if (SHAPES.has(tag)) {
          const segs = this.shapeSegments(node, cs, this.rootVp);
          if (segs && PathData.hasDrawing(segs)) add(PathData.bbox(PathData.transform(segs, m)));
        } else if (CONTAINERS.has(tag)) {
          for (const child of node.children) {
            if (child.namespaceURI !== SVG_NS) continue;
            const ccs = getComputedStyle(child);
            if (ccs.display === 'none') continue;
            visit(child, Matrix.multiply(m, this.localTransform(child, ccs)), ccs, depth + 1);
          }
        }
      };
      visit(el, Matrix.identity(), getComputedStyle(el), 0);
      return box;
    }

    // --- traversal ------------------------------------------------------------------
    walk(el, ctx) {
      if (el.namespaceURI !== SVG_NS) return;
      const tag = el.localName;
      if (!CONTAINERS.has(tag) && !SHAPES.has(tag)) {
        if (UNSUPPORTED[tag]) this.warn(UNSUPPORTED[tag]);
        return;
      }
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const isRoot = el === this.svg;

      let ctm = ctx.ctm;
      let vp = ctx.vp;
      if (!isRoot) ctm = Matrix.multiply(ctm, this.localTransform(el, cs));
      const opacity = ctx.opacity * clamp01(parseFloat(cs.opacity));
      if (!(opacity > 0)) return;

      const clips = [];
      const clipId = urlId(el.getAttribute('clip-path')) || urlId(cs.clipPath);
      if (clipId) {
        const r = this.clipGeometry(clipId, el, ctm, vp);
        if (r === EMPTY) return;
        if (r) clips.push(r);
      }
      const maskId =
        urlId(el.getAttribute('mask')) || urlId(cs.getPropertyValue('mask-image')) || urlId(cs.getPropertyValue('mask'));
      if (maskId) {
        const r = this.maskGeometry(maskId, el, ctm, vp);
        if (r === EMPTY) return;
        if (r) clips.push(r);
      }
      if (cs.filter && cs.filter !== 'none') {
        this.warn('Filter (đổ bóng, làm mờ...) không được VectorDrawable hỗ trợ; nội dung được giữ nguyên nhưng hiệu ứng bị bỏ qua.');
      }

      if (tag === 'svg' && !isRoot) {
        const x = this.len(el.getAttribute('x'), 'x', vp) || 0;
        const y = this.len(el.getAttribute('y'), 'y', vp) || 0;
        const w = this.len(el.getAttribute('width') || '100%', 'x', vp);
        const h = this.len(el.getAttribute('height') || '100%', 'y', vp);
        if (!(w > 0) || !(h > 0)) return;
        if (cs.overflow !== 'visible' && cs.overflow !== 'auto') {
          clips.push(PathData.transform(rectSegs(x, y, w, h, 0, 0), ctm));
        }
        const vb = parseViewBox(el.getAttribute('viewBox'));
        ctm = Matrix.multiply(ctm, Matrix.translate(x, y));
        if (vb) ctm = Matrix.multiply(ctm, viewBoxTransform(vb, w, h, el.getAttribute('preserveAspectRatio')));
        vp = vb ? { w: vb.w, h: vb.h } : { w, h };
      }

      let out = ctx.out;
      let group = null;
      if (clips.length) {
        group = { type: 'group', clips, children: [] };
        out.push(group);
        out = group.children;
      }
      const nctx = { ctm, opacity, out, vp };
      if (SHAPES.has(tag)) {
        this.emitShape(el, cs, nctx);
      } else if (tag === 'switch') {
        const child = this.pickSwitchChild(el);
        if (child) this.walk(child, nctx);
      } else {
        for (const child of el.children) this.walk(child, nctx);
      }
      if (group && !group.children.length) ctx.out.pop();
    }

    pickSwitchChild(el) {
      const langs = (typeof navigator !== 'undefined' && navigator.languages) || ['en'];
      for (const child of el.children) {
        if (child.namespaceURI !== SVG_NS) continue;
        if (child.hasAttribute('requiredExtensions') && child.getAttribute('requiredExtensions').trim()) continue;
        const sl = child.getAttribute('systemLanguage');
        if (sl && !sl.split(',').some((l) => langs.some((n) => n.toLowerCase().startsWith(l.trim().toLowerCase().split('-')[0])))) continue;
        return child;
      }
      return null;
    }

    // --- clip-path & mask -----------------------------------------------------------
    collectClipShapes(container, m, vp, accept, depth = 0) {
      const all = [];
      for (const child of container.children) {
        if (child.namespaceURI !== SVG_NS || depth > 32) continue;
        const tag = child.localName;
        const ccs = getComputedStyle(child);
        if (ccs.display === 'none') continue;
        if (!(parseFloat(ccs.opacity) > 0) && ccs.opacity !== '') continue;
        const cm = Matrix.multiply(m, this.localTransform(child, ccs));
        if (SHAPES.has(tag)) {
          if (ccs.visibility !== 'visible') continue;
          if (accept && !accept(child, ccs)) continue;
          const segs = this.shapeSegments(child, ccs, vp);
          if (segs && PathData.hasDrawing(segs)) {
            all.push(...PathData.transform(segs, cm));
            if (child.hasAttribute('clip-path')) this.warn('clip-path lồng bên trong clipPath/mask được bỏ qua.');
          }
        } else if (tag === 'g' || tag === 'svg' || tag === 'a') {
          let inner = cm;
          if (tag === 'svg') {
            const vb = parseViewBox(child.getAttribute('viewBox'));
            const x = this.len(child.getAttribute('x'), 'x', vp) || 0;
            const y = this.len(child.getAttribute('y'), 'y', vp) || 0;
            const w = this.len(child.getAttribute('width') || '100%', 'x', vp);
            const h = this.len(child.getAttribute('height') || '100%', 'y', vp);
            inner = Matrix.multiply(cm, Matrix.translate(x, y));
            if (vb && w > 0 && h > 0) inner = Matrix.multiply(inner, viewBoxTransform(vb, w, h, child.getAttribute('preserveAspectRatio')));
          }
          all.push(...this.collectClipShapes(child, inner, vp, accept, depth + 1));
        } else if (UNSUPPORTED[tag]) {
          this.warn(UNSUPPORTED[tag]);
        }
      }
      return all;
    }

    clipGeometry(id, refEl, ctm, vp) {
      const cp = this.byId(id);
      if (!cp || cp.localName !== 'clipPath') return null;
      let m = Matrix.multiply(ctm, this.localTransform(cp, null));
      if (cp.getAttribute('clipPathUnits') === 'objectBoundingBox') {
        const bb = this.elementBBox(refEl);
        if (!bb || !(bb.w > 0) || !(bb.h > 0)) return EMPTY;
        m = Matrix.multiply(m, [bb.w, 0, 0, bb.h, bb.x, bb.y]);
      }
      let evenOdd = false;
      const segs = this.collectClipShapes(cp, m, vp, (child, ccs) => {
        if (ccs.clipRule === 'evenodd') evenOdd = true;
        return true;
      });
      if (!segs.length) return EMPTY;
      if (evenOdd && segs.filter((s) => s[0] === 'M').length > 1) {
        this.warn('clip-rule="evenodd" không được hỗ trợ trong <clip-path> của Android; dùng nonzero thay thế.');
      }
      if (cp.hasAttribute('clip-path')) this.warn('clip-path đặt trên chính phần tử <clipPath> được bỏ qua.');
      return segs;
    }

    maskGeometry(id, refEl, ctm, vp) {
      const mk = this.byId(id);
      if (!mk || mk.localName !== 'mask') return null;
      const mcs = getComputedStyle(mk);
      const alphaMode = mcs.maskType === 'alpha' || (mk.getAttribute('style') || '').includes('mask-type:alpha');
      let m = ctm;
      if (mk.getAttribute('maskContentUnits') === 'objectBoundingBox') {
        const bb = this.elementBBox(refEl);
        if (!bb || !(bb.w > 0) || !(bb.h > 0)) return EMPTY;
        m = Matrix.multiply(m, [bb.w, 0, 0, bb.h, bb.x, bb.y]);
      }
      let complex = false;
      const segs = this.collectClipShapes(mk, m, vp, (child, ccs) => {
        const fill = ccs.fill;
        if (!fill || fill === 'none') {
          if (ccs.stroke && ccs.stroke !== 'none') complex = true;
          return false;
        }
        if (fill.startsWith('url(')) {
          complex = true;
          return true;
        }
        const c = Color.parse(fill);
        if (!c) return false;
        const a = c.a * clamp01(parseFloat(ccs.fillOpacity));
        const lum = (0.2125 * c.r + 0.7154 * c.g + 0.0721 * c.b) / 255;
        const visible = alphaMode ? a > 0.02 : a * lum > 0.02;
        if (!visible) complex = true;
        else if (a < 0.98 || (!alphaMode && lum < 0.98)) complex = true;
        return visible;
      });
      if (complex) {
        this.warn('Mask có độ trong suốt/gradient/vùng khoét được xấp xỉ bằng clip-path (VectorDrawable không hỗ trợ mask).');
      }
      if (!segs.length) return EMPTY;
      return segs;
    }

    // --- paints ----------------------------------------------------------------------
    parsePaint(value) {
      if (!value || value === 'none') return null;
      const v = String(value).trim();
      if (v.startsWith('url(')) {
        const id = urlId(v);
        const close = v.indexOf(')');
        const fallback = v.slice(close + 1).trim();
        return { url: id, fallback: fallback && fallback !== 'none' ? fallback : null };
      }
      if (v === 'context-fill' || v === 'context-stroke') return null;
      return { color: v };
    }

    paintSpec(value, alpha, bboxFn, ctx, kind) {
      const p = this.parsePaint(value);
      if (!p) return null;
      if (p.url) {
        const ref = this.byId(p.url);
        if (ref && (ref.localName === 'linearGradient' || ref.localName === 'radialGradient')) {
          return this.gradientSpec(ref, alpha, bboxFn, ctx, kind);
        }
        if (ref && ref.localName === 'pattern') {
          this.warn('Pattern không được hỗ trợ; dùng màu dự phòng (nếu có) hoặc bỏ qua.');
        }
        if (!p.fallback) return null;
        p.color = p.fallback;
      }
      const c = Color.parse(p.color);
      if (!c) return null;
      c.a *= alpha;
      if (Math.round(c.a * 255) <= 0) return null;
      return { color: c };
    }

    gradientChain(el) {
      const chain = [el];
      const seen = new Set(chain);
      let cur = el;
      for (;;) {
        const h = getHref(cur);
        const next = h && h.trim().startsWith('#') ? this.byId(h.trim().slice(1)) : null;
        if (!next || seen.has(next) || !/Gradient$/.test(next.localName)) break;
        chain.push(next);
        seen.add(next);
        cur = next;
      }
      return chain;
    }

    gradientSpec(gEl, alpha, bboxFn, ctx, kind) {
      const chain = this.gradientChain(gEl);
      const type = gEl.localName === 'radialGradient' ? 'radial' : 'linear';
      const attr = (name, sameType) => {
        for (const g of chain) {
          if (sameType && g.localName !== gEl.localName) continue;
          if (g.hasAttribute(name)) return g.getAttribute(name);
        }
        return null;
      };

      // stops
      let stopEls = [];
      for (const g of chain) {
        stopEls = Array.from(g.children).filter((c) => c.localName === 'stop');
        if (stopEls.length) break;
      }
      const stops = [];
      let last = 0;
      for (const s of stopEls) {
        const scs = getComputedStyle(s);
        let off = s.getAttribute('offset');
        off = off == null ? 0 : String(off).trim().endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
        if (isNaN(off)) off = 0;
        off = Math.max(last, Math.min(1, Math.max(0, off)));
        last = off;
        const c = Color.parse(scs.stopColor) || { r: 0, g: 0, b: 0, a: 1 };
        c.a *= clamp01(parseFloat(scs.stopOpacity)) * alpha;
        stops.push({ offset: off, color: c });
      }
      if (!stops.length) return null;
      if (stops.every((s) => Math.round(s.color.a * 255) <= 0)) return null;
      const solid = (c) => (Math.round(c.a * 255) > 0 ? { color: { ...c } } : null);
      if (stops.length === 1) return solid(stops[0].color);

      const obb = attr('gradientUnits') !== 'userSpaceOnUse';
      const vp = ctx.vp;
      const coord = (name, def, axis) => {
        let v = attr(name, true);
        if (v == null) v = def;
        v = String(v).trim();
        if (v.endsWith('%')) {
          const pct = parseFloat(v) / 100;
          if (obb) return pct;
          const ref = axis === 'x' ? vp.w : axis === 'y' ? vp.h : Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2);
          return pct * ref;
        }
        const n = parseLength(v, null);
        return n == null || isNaN(n) ? parseFloat(def) / (String(def).endsWith('%') ? 100 : 1) : n;
      };

      let m = ctx.ctm;
      if (obb) {
        const bb = bboxFn();
        if (!bb || !(bb.w > 0) || !(bb.h > 0)) return null;
        m = Matrix.multiply(m, [bb.w, 0, 0, bb.h, bb.x, bb.y]);
      }
      m = Matrix.multiply(m, Matrix.parse(attr('gradientTransform')));

      const spread = attr('spreadMethod');
      const tileMode = spread === 'reflect' ? 'mirror' : spread === 'repeat' ? 'repeat' : 'clamp';
      const lastColor = stops[stops.length - 1].color;
      const det = Matrix.det(m);
      if (!det || !isFinite(det)) return solid(lastColor);

      if (type === 'linear') {
        const x1 = coord('x1', '0%', 'x'), y1 = coord('y1', '0%', 'y');
        const x2 = coord('x2', '100%', 'x'), y2 = coord('y2', '0%', 'y');
        const dx = x2 - x1, dy = y2 - y1;
        const dd = dx * dx + dy * dy;
        if (dd === 0) return solid(lastColor);
        // Exact mapping of a linear gradient through an arbitrary affine transform.
        const inv = Matrix.inverse(m);
        const gx = (inv[0] * dx + inv[1] * dy) / dd;
        const gy = (inv[2] * dx + inv[3] * dy) / dd;
        const gg = gx * gx + gy * gy;
        const [sx, sy] = Matrix.apply(m, x1, y1);
        return {
          gradient: { type: 'linear', startX: sx, startY: sy, endX: sx + gx / gg, endY: sy + gy / gg, stops, tileMode },
        };
      }

      // radial
      const cx = coord('cx', '50%', 'x'), cy = coord('cy', '50%', 'y');
      const r = coord('r', '50%', 'd');
      if (!(r > 0)) return solid(lastColor);
      const fxA = attr('fx', true), fyA = attr('fy', true);
      const fx = fxA == null ? cx : coord('fx', '50%', 'x');
      const fy = fyA == null ? cy : coord('fy', '50%', 'y');
      if (Math.hypot(fx - cx, fy - cy) > r * 0.02) {
        this.warn('Radial gradient có tiêu điểm (fx/fy) lệch tâm không được Android hỗ trợ; tiêu điểm được đặt về tâm.');
      }
      const dec = Matrix.decompose(m);
      const ratio = Math.abs(dec.sy) / dec.sx;
      if (Math.abs(ratio - 1) < 1e-3 || kind === 'stroke' || this.options.ellipticalGradients === false) {
        if (Math.abs(ratio - 1) >= 1e-3) {
          this.warn('Radial gradient dạng elip trên nét viền (stroke) được xấp xỉ thành hình tròn.');
        }
        const [ccx, ccy] = Matrix.apply(m, cx, cy);
        return { gradient: { type: 'radial', centerX: ccx, centerY: ccy, radius: r * Math.sqrt(Math.abs(det)), stops, tileMode } };
      }
      // Elliptical gradient: wrap the path in a group whose scale/rotation turns
      // the circle into the right ellipse; the path is inverse-transformed.
      const k = Math.sqrt(Math.abs(dec.sx * dec.sy));
      const a = dec.sx / k, b = dec.sy / k;
      const cphi = Math.cos(dec.phi), sphi = Math.sin(dec.phi);
      const G = [a * cphi, a * sphi, -b * sphi, b * cphi, m[4], m[5]];
      const cth = Math.cos(dec.theta), sth = Math.sin(dec.theta);
      return {
        gradient: {
          type: 'radial',
          centerX: k * (cth * cx - sth * cy),
          centerY: k * (sth * cx + cth * cy),
          radius: k * r,
          stops,
          tileMode,
        },
        group: {
          matrix: G,
          rotation: (dec.phi * 180) / Math.PI,
          scaleX: a,
          scaleY: b,
          translateX: m[4],
          translateY: m[5],
        },
      };
    }

    // --- shapes ----------------------------------------------------------------------
    emitShape(el, cs, ctx) {
      if (cs.visibility !== 'visible') return;
      const segs = this.shapeSegments(el, cs, ctx.vp);
      if (!segs || !PathData.hasDrawing(segs)) return;
      const tag = el.localName;
      for (const mk of ['marker-start', 'marker-mid', 'marker-end']) {
        const v = cs.getPropertyValue(mk);
        if (v && v !== 'none') {
          this.warn('Marker (đầu mũi tên...) không được hỗ trợ và đã bị bỏ qua.');
          break;
        }
      }
      let bboxCache;
      const bboxFn = () => (bboxCache !== undefined ? bboxCache : (bboxCache = PathData.bbox(segs)));
      const vsegs = PathData.transform(segs, ctx.ctm);

      const fillAlpha = clamp01(parseFloat(cs.fillOpacity)) * ctx.opacity;
      const strokeAlpha = clamp01(parseFloat(cs.strokeOpacity)) * ctx.opacity;
      const fill = tag === 'line' ? null : this.paintSpec(cs.fill, fillAlpha, bboxFn, ctx, 'fill');

      const vp = ctx.vp;
      const diag = Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2);
      let stroke = null;
      let strokeWidth = 0;
      const swRaw = String(cs.strokeWidth || '1');
      const sw = swRaw.trim().endsWith('%') ? (parseFloat(swRaw) / 100) * diag : parseFloat(swRaw);
      if (sw > 0) stroke = this.paintSpec(cs.stroke, strokeAlpha, bboxFn, ctx, 'stroke');
      if (!fill && !stroke) return;

      let strokeSegs = vsegs;
      if (stroke) {
        const det = Math.abs(Matrix.det(ctx.ctm));
        if (cs.vectorEffect === 'non-scaling-stroke') {
          strokeWidth = sw * (this.meta.vpW / this.meta.W);
        } else {
          strokeWidth = sw * Math.sqrt(det);
          const dec = Matrix.decompose(ctx.ctm);
          if (dec.sx > 0 && Math.abs(Math.abs(dec.sy) / dec.sx - 1) > 0.01) {
            this.warn('Nét viền bị co giãn không đều (scale X ≠ Y) được xấp xỉ bằng độ dày đồng nhất.');
          }
        }
        const dashes = this.parseDash(cs.strokeDasharray, diag);
        if (dashes) {
          const offRaw = String(cs.strokeDashoffset || '0');
          const off = offRaw.trim().endsWith('%') ? (parseFloat(offRaw) / 100) * diag : parseFloat(offRaw) || 0;
          const dashed = PathData.dash(segs, dashes, off, cs.strokeLinecap !== 'butt');
          strokeSegs = PathData.transform(dashed, ctx.ctm);
          if (!strokeSegs.length) stroke = null;
        }
      }
      if (!fill && !stroke) return;

      const fillType = cs.fillRule === 'evenodd' ? 'evenOdd' : null;
      const join = cs.strokeLinejoin === 'round' ? 'round' : cs.strokeLinejoin === 'bevel' ? 'bevel' : 'miter';
      const strokeProps = stroke && {
        stroke,
        strokeWidth,
        cap: cs.strokeLinecap === 'round' ? 'round' : cs.strokeLinecap === 'square' ? 'square' : 'butt',
        join,
        miter: parseFloat(cs.strokeMiterlimit) || 4,
      };

      const order = this.paintOrder(cs.paintOrder);
      const strokeFirst = order.indexOf('stroke') < order.indexOf('fill');
      const nodes = [];
      const fillNode = fill && this.fillNode(vsegs, fill, fillType);
      if (fill && stroke && !fill.group && strokeSegs === vsegs && !strokeFirst) {
        nodes.push({ type: 'path', segs: vsegs, fill, fillType, ...strokeProps });
      } else {
        const strokeNode = stroke && { type: 'path', segs: strokeSegs, ...strokeProps };
        if (strokeFirst) {
          if (strokeNode) nodes.push(strokeNode);
          if (fillNode) nodes.push(fillNode);
        } else {
          if (fillNode) nodes.push(fillNode);
          if (strokeNode) nodes.push(strokeNode);
        }
      }
      ctx.out.push(...nodes);
    }

    fillNode(vsegs, fill, fillType) {
      if (!fill.group) return { type: 'path', segs: vsegs, fill, fillType };
      const inv = Matrix.inverse(fill.group.matrix);
      return {
        type: 'group',
        transform: fill.group,
        clips: [],
        children: [{ type: 'path', segs: PathData.transform(vsegs, inv), fill, fillType }],
      };
    }

    parseDash(value, diag) {
      if (!value || value === 'none') return null;
      const parts = String(value).split(/[\s,]+/).filter(Boolean);
      const nums = parts.map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * diag : parseFloat(p)));
      if (!nums.length || nums.some((n) => isNaN(n) || n < 0)) return null;
      const sum = nums.reduce((a, b) => a + b, 0);
      if (!(sum > 0)) return null;
      return nums.length % 2 ? nums.concat(nums) : nums;
    }

    paintOrder(value) {
      const def = ['fill', 'stroke', 'markers'];
      if (!value || value === 'normal') return def;
      const given = String(value).split(/\s+/).filter((t) => def.includes(t));
      return given.concat(def.filter((t) => !given.includes(t)));
    }

    // --- run -------------------------------------------------------------------------
    run() {
      this.rootVp = (() => {
        const vb = parseViewBox(this.svg.getAttribute('viewBox'));
        return vb ? { w: vb.w, h: vb.h } : { w: 300, h: 150 };
      })();
      this.expandUses();
      const meta = this.rootViewport();
      this.meta = meta;
      const model = [];
      this.walk(this.svg, { ctm: meta.ctm, opacity: 1, out: model, vp: meta.userVp });

      const opts = this.options;
      let widthDp = meta.W, heightDp = meta.H;
      const ow = parseFloat(opts.width), oh = parseFloat(opts.height);
      if (ow > 0 && oh > 0) { widthDp = ow; heightDp = oh; }
      else if (ow > 0) { widthDp = ow; heightDp = (ow * meta.H) / meta.W; }
      else if (oh > 0) { heightDp = oh; widthDp = (oh * meta.W) / meta.H; }

      const autoDec = Math.min(6, Math.max(1, Math.ceil(4 - Math.log10(Math.max(meta.vpW, meta.vpH)))));
      const decimals = opts.precision === undefined || opts.precision === 'auto' ? autoDec : Math.max(0, Math.min(8, +opts.precision));

      const stats = { paths: 0, groups: 0, gradients: 0, clipPaths: 0 };
      const xml = serializeVector(model, { widthDp, heightDp, vpW: meta.vpW, vpH: meta.vpH, decimals }, stats);
      if (!stats.paths) this.warn('Không có hình nào được chuyển đổi (SVG trống hoặc chỉ chứa phần tử không hỗ trợ).');
      return {
        xml,
        svgWidth: meta.W,
        svgHeight: meta.H,
        width: widthDp,
        height: heightDp,
        viewportWidth: meta.vpW,
        viewportHeight: meta.vpH,
        decimals,
        stats,
        warnings: Array.from(this.warnings.entries()).map(([message, count]) => ({ message, count })),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // XML serialization
  // ---------------------------------------------------------------------------
  function serializeVector(model, meta, stats) {
    const dec = meta.decimals;
    const lines = [];
    const hasGradient = (nodes) =>
      nodes.some((n) => (n.type === 'group' ? hasGradient(n.children) : (n.fill && n.fill.gradient) || (n.stroke && n.stroke.gradient)));
    lines.push('<vector xmlns:android="http://schemas.android.com/apk/res/android"');
    if (hasGradient(model)) lines.push('    xmlns:aapt="http://schemas.android.com/aapt"');
    lines.push(`    android:width="${fmt(meta.widthDp, 2)}dp"`);
    lines.push(`    android:height="${fmt(meta.heightDp, 2)}dp"`);
    lines.push(`    android:viewportWidth="${fmt(meta.vpW, 4)}"`);
    lines.push(`    android:viewportHeight="${fmt(meta.vpH, 4)}">`);

    const emitTag = (pad, name, attrs, close) => {
      if (!attrs.length) {
        lines.push(`${pad}<${name}${close}`);
        return;
      }
      if (attrs.length === 1 && name !== 'path' && name !== 'gradient') {
        lines.push(`${pad}<${name} ${attrs[0]}${close}`);
        return;
      }
      lines.push(`${pad}<${name}`);
      attrs.forEach((a, i) => lines.push(`${pad}    ${a}${i === attrs.length - 1 ? close : ''}`));
    };

    const emitGradient = (pad, attrName, g) => {
      stats.gradients++;
      lines.push(`${pad}<aapt:attr name="${attrName}">`);
      const gp = pad + '  ';
      const attrs = [`android:type="${g.type}"`];
      const cd = dec + 1;
      if (g.type === 'linear') {
        attrs.push(
          `android:startX="${fmt(g.startX, cd)}"`,
          `android:startY="${fmt(g.startY, cd)}"`,
          `android:endX="${fmt(g.endX, cd)}"`,
          `android:endY="${fmt(g.endY, cd)}"`
        );
      } else {
        attrs.push(
          `android:centerX="${fmt(g.centerX, cd)}"`,
          `android:centerY="${fmt(g.centerY, cd)}"`,
          `android:gradientRadius="${fmt(Math.max(g.radius, Math.pow(10, -cd)), cd)}"`
        );
      }
      if (g.tileMode !== 'clamp') attrs.push(`android:tileMode="${g.tileMode}"`);
      emitTag(gp, 'gradient', attrs, '>');
      for (const s of g.stops) {
        lines.push(`${gp}  <item android:offset="${fmt(s.offset, 4)}" android:color="${Color.toAndroid(s.color, true)}"/>`);
      }
      lines.push(`${gp}</gradient>`);
      lines.push(`${pad}</aapt:attr>`);
    };

    const emitNodes = (nodes, depth) => {
      const pad = '  '.repeat(depth);
      for (const n of nodes) {
        if (n.type === 'group') {
          const attrs = [];
          if (n.transform) {
            const t = n.transform;
            if (Math.abs(t.rotation) > 1e-9) attrs.push(`android:rotation="${fmt(t.rotation, 4)}"`);
            if (Math.abs(t.scaleX - 1) > 1e-9) attrs.push(`android:scaleX="${fmt(t.scaleX, 6)}"`);
            if (Math.abs(t.scaleY - 1) > 1e-9) attrs.push(`android:scaleY="${fmt(t.scaleY, 6)}"`);
            if (Math.abs(t.translateX) > 1e-9) attrs.push(`android:translateX="${fmt(t.translateX, dec + 2)}"`);
            if (Math.abs(t.translateY) > 1e-9) attrs.push(`android:translateY="${fmt(t.translateY, dec + 2)}"`);
          }
          const clipStrs = (n.clips || []).map((c) => PathData.serialize(c, dec)).filter(Boolean);
          const startLen = lines.length;
          emitTag(pad, 'group', attrs, '>');
          for (const d of clipStrs) {
            stats.clipPaths++;
            lines.push(`${pad}  <clip-path`);
            lines.push(`${pad}      android:pathData="${d}"/>`);
          }
          const before = lines.length;
          emitNodes(n.children, depth + 1);
          if (lines.length === before) {
            lines.length = startLen; // drop empty group
            continue;
          }
          lines.push(`${pad}</group>`);
          stats.groups++;
          continue;
        }
        const d = PathData.serialize(n.segs, dec);
        if (!d || !/[^Mm\d.,\s-]/.test(d.replace(/^[Mm]/, ''))) continue;
        stats.paths++;
        const attrs = [`android:pathData="${d}"`];
        const gradients = [];
        if (n.fill) {
          if (n.fill.gradient) gradients.push(['android:fillColor', n.fill.gradient]);
          else attrs.push(`android:fillColor="${Color.toAndroid(n.fill.color)}"`);
        }
        if (n.stroke) {
          if (n.stroke.gradient) gradients.push(['android:strokeColor', n.stroke.gradient]);
          else attrs.push(`android:strokeColor="${Color.toAndroid(n.stroke.color)}"`);
          attrs.push(`android:strokeWidth="${fmt(n.strokeWidth, dec + 1)}"`);
          if (n.cap !== 'butt') attrs.push(`android:strokeLineCap="${n.cap}"`);
          if (n.join !== 'miter') attrs.push(`android:strokeLineJoin="${n.join}"`);
          if (n.join === 'miter' && Math.abs(n.miter - 4) > 1e-6) attrs.push(`android:strokeMiterLimit="${fmt(n.miter, 3)}"`);
        }
        if (n.fillType && n.fill) attrs.push(`android:fillType="${n.fillType}"`);
        if (!gradients.length) {
          emitTag(pad, 'path', attrs, '/>');
        } else {
          emitTag(pad, 'path', attrs, '>');
          for (const [name, g] of gradients) emitGradient(pad + '  ', name, g);
          lines.push(`${pad}</path>`);
        }
      }
    };
    emitNodes(model, 1);
    lines.push('</vector>');
    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function convert(svgText, options) {
    const parsed = parseSvgText(svgText);
    if (parsed.error) return { error: parsed.error };

    const svg = document.importNode(parsed.root, true);
    sanitize(svg);
    const previewEl = svg.cloneNode(true);
    const serializePreview = (w, h) => {
      if (w > 0 && h > 0) {
        previewEl.setAttribute('width', w);
        previewEl.setAttribute('height', h);
      }
      return new XMLSerializer().serializeToString(previewEl);
    };

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'all:initial;position:fixed;left:-100000px;top:0;width:1024px;height:1024px;overflow:hidden;pointer-events:none;opacity:0;contain:strict;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(svg);
    document.body.appendChild(host);
    try {
      const result = new Converter(svg, shadow, options).run();
      result.previewSvg = serializePreview(result.svgWidth, result.svgHeight);
      return result;
    } catch (e) {
      console.error(e);
      return { error: 'Lỗi khi chuyển đổi: ' + (e && e.message ? e.message : e), previewSvg: serializePreview() };
    } finally {
      host.remove();
    }
  }

  S2V.convert = convert;
  S2V.parseSvgText = parseSvgText;
})(typeof window !== 'undefined' ? window : globalThis);
