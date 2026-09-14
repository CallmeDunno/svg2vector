/*
 * Renders Android VectorDrawable XML as SVG, following Android semantics:
 * group transform = T(translate + pivot) · R(rotation) · S(scale) · T(-pivot),
 * <clip-path> clips the following siblings of its group, gradient coordinates
 * are in the path's local (group) space, fill/stroke alpha multiply colors.
 */
(function (root) {
  'use strict';
  const S2V = (root.S2V = root.S2V || {});
  const { Color, Matrix } = S2V;
  const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

  function A(el, name) {
    let v = el.getAttributeNS(ANDROID_NS, name);
    if (v == null || v === '') v = el.getAttribute('android:' + name);
    return v == null || v === '' ? null : v;
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const num = (v, def) => {
    const n = parseFloat(v);
    return isNaN(n) ? def : n;
  };

  function vectorToSvg(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML không hợp lệ');
    const v = doc.documentElement;
    if (!v || v.localName !== 'vector') throw new Error('Thiếu thẻ <vector>');
    const vw = num(A(v, 'viewportWidth'), 0);
    const vh = num(A(v, 'viewportHeight'), 0);
    if (!(vw > 0 && vh > 0)) throw new Error('viewportWidth/viewportHeight không hợp lệ');
    const w = num(A(v, 'width'), vw);
    const h = num(A(v, 'height'), vh);

    const defs = [];
    let uid = 0;

    function gradientFor(pathEl, attrName) {
      for (const child of pathEl.children) {
        if (child.localName === 'attr' && child.getAttribute('name') === attrName) {
          const g = Array.from(child.children).find((c) => c.localName === 'gradient');
          if (g) return g;
        }
      }
      return null;
    }

    function paint(pathEl, attrName, colorAttr, alpha) {
      const g = gradientFor(pathEl, 'android:' + attrName);
      if (g) {
        const type = A(g, 'type') || 'linear';
        let stops = Array.from(g.children)
          .filter((c) => c.localName === 'item')
          .map((it) => ({ offset: num(A(it, 'offset'), 0), c: Color.parseAndroid(A(it, 'color')) }));
        if (!stops.length) {
          stops = [{ offset: 0, c: Color.parseAndroid(A(g, 'startColor')) }];
          if (A(g, 'centerColor')) stops.push({ offset: 0.5, c: Color.parseAndroid(A(g, 'centerColor')) });
          stops.push({ offset: 1, c: Color.parseAndroid(A(g, 'endColor')) });
        }
        if (type === 'sweep') {
          const c = stops[0].c || { r: 0, g: 0, b: 0, a: 0 };
          return { value: `rgb(${c.r},${c.g},${c.b})`, opacity: c.a * alpha };
        }
        const id = 'vdg' + uid++;
        const tile = A(g, 'tileMode');
        const spread = tile === 'mirror' ? 'reflect' : tile === 'repeat' ? 'repeat' : 'pad';
        const stopXml = stops
          .map((s) => {
            const c = s.c || { r: 0, g: 0, b: 0, a: 0 };
            return `<stop offset="${s.offset}" stop-color="rgb(${c.r},${c.g},${c.b})" stop-opacity="${c.a}"/>`;
          })
          .join('');
        if (type === 'radial') {
          defs.push(
            `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(A(g, 'centerX'), 0)}" cy="${num(A(g, 'centerY'), 0)}" r="${num(A(g, 'gradientRadius'), 0)}" spreadMethod="${spread}">${stopXml}</radialGradient>`
          );
        } else {
          defs.push(
            `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(A(g, 'startX'), 0)}" y1="${num(A(g, 'startY'), 0)}" x2="${num(A(g, 'endX'), 0)}" y2="${num(A(g, 'endY'), 0)}" spreadMethod="${spread}">${stopXml}</linearGradient>`
          );
        }
        return { value: `url(#${id})`, opacity: alpha };
      }
      const c = Color.parseAndroid(A(pathEl, colorAttr));
      if (!c || c.a * alpha <= 0) return null;
      return { value: `rgb(${c.r},${c.g},${c.b})`, opacity: c.a * alpha };
    }

    function renderPath(p) {
      const d = A(p, 'pathData');
      if (!d) return '';
      const attrs = [`d="${esc(d)}"`];
      const fill = paint(p, 'fillColor', 'fillColor', num(A(p, 'fillAlpha'), 1));
      if (fill) {
        attrs.push(`fill="${fill.value}"`);
        if (fill.opacity < 1) attrs.push(`fill-opacity="${fill.opacity}"`);
      } else {
        attrs.push('fill="none"');
      }
      if (A(p, 'fillType') === 'evenOdd') attrs.push('fill-rule="evenodd"');
      const sw = num(A(p, 'strokeWidth'), 0);
      if (sw > 0) {
        const stroke = paint(p, 'strokeColor', 'strokeColor', num(A(p, 'strokeAlpha'), 1));
        if (stroke) {
          attrs.push(`stroke="${stroke.value}"`, `stroke-width="${sw}"`);
          if (stroke.opacity < 1) attrs.push(`stroke-opacity="${stroke.opacity}"`);
          attrs.push(`stroke-linecap="${A(p, 'strokeLineCap') || 'butt'}"`);
          attrs.push(`stroke-linejoin="${A(p, 'strokeLineJoin') || 'miter'}"`);
          attrs.push(`stroke-miterlimit="${num(A(p, 'strokeMiterLimit'), 4)}"`);
        }
      }
      return `<path ${attrs.join(' ')}/>`;
    }

    function groupMatrix(g) {
      const px = num(A(g, 'pivotX'), 0), py = num(A(g, 'pivotY'), 0);
      let m = Matrix.translate(-px, -py);
      m = Matrix.multiply(Matrix.scale(num(A(g, 'scaleX'), 1), num(A(g, 'scaleY'), 1)), m);
      m = Matrix.multiply(Matrix.rotate(num(A(g, 'rotation'), 0)), m);
      m = Matrix.multiply(Matrix.translate(num(A(g, 'translateX'), 0) + px, num(A(g, 'translateY'), 0) + py), m);
      return m;
    }

    function renderChildren(parent) {
      let out = '';
      let open = 0;
      for (const child of parent.children) {
        switch (child.localName) {
          case 'clip-path': {
            const d = A(child, 'pathData');
            if (!d) break;
            const id = 'vdc' + uid++;
            defs.push(`<clipPath id="${id}"><path d="${esc(d)}"/></clipPath>`);
            out += `<g clip-path="url(#${id})">`;
            open++;
            break;
          }
          case 'group':
            out += `<g transform="matrix(${groupMatrix(child).join(' ')})">${renderChildren(child)}</g>`;
            break;
          case 'path':
            out += renderPath(child);
            break;
        }
      }
      return out + '</g>'.repeat(open);
    }

    let body = renderChildren(v);
    const alpha = num(A(v, 'alpha'), 1);
    if (alpha < 1) body = `<g opacity="${alpha}">${body}</g>`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none">` +
      `<defs>${defs.join('')}</defs>${body}</svg>`;
    return { svg, width: w, height: h, viewportWidth: vw, viewportHeight: vh };
  }

  S2V.vectorToSvg = vectorToSvg;
})(typeof window !== 'undefined' ? window : globalThis);
