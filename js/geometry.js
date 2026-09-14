/*
 * Geometry helpers: affine matrices and SVG path data.
 * Path segments are normalized to absolute commands:
 *   ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Q',x1,y1,x,y]
 *   ['A',rx,ry,rotation,largeArc,sweep,x,y] ['Z']
 */
(function (root) {
  'use strict';
  const S2V = (root.S2V = root.S2V || {});

  const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------------------
  // Affine matrix [a, b, c, d, e, f]:  x' = a*x + c*y + e,  y' = b*x + d*y + f
  // ---------------------------------------------------------------------------
  const Matrix = {
    identity: () => [1, 0, 0, 1, 0, 0],

    // m · n  (n is applied first)
    multiply(m, n) {
      return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
      ];
    },

    apply(m, x, y) {
      return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    },

    det(m) {
      return m[0] * m[3] - m[1] * m[2];
    },

    inverse(m) {
      const det = m[0] * m[3] - m[1] * m[2];
      if (!det || !isFinite(det)) return null;
      return [
        m[3] / det,
        -m[1] / det,
        -m[2] / det,
        m[0] / det,
        (m[2] * m[5] - m[3] * m[4]) / det,
        (m[1] * m[4] - m[0] * m[5]) / det,
      ];
    },

    translate: (tx, ty) => [1, 0, 0, 1, tx, ty],
    scale: (sx, sy) => [sx, 0, 0, sy === undefined ? sx : sy, 0, 0],
    rotate(deg) {
      const c = Math.cos(deg * DEG);
      const s = Math.sin(deg * DEG);
      return [c, s, -s, c, 0, 0];
    },

    isIdentity(m, eps = 1e-12) {
      return (
        Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps &&
        Math.abs(m[3] - 1) < eps && Math.abs(m[4]) < eps && Math.abs(m[5]) < eps
      );
    },

    /**
     * SVD of the linear part: L = R(phi) · diag(sx, sy) · R(theta).
     * sx >= 0; sy is negative when the matrix contains a reflection.
     */
    decompose(m) {
      const E = (m[0] + m[3]) / 2;
      const F = (m[0] - m[3]) / 2;
      const G = (m[1] + m[2]) / 2;
      const H = (m[1] - m[2]) / 2;
      const Q = Math.hypot(E, H);
      const R = Math.hypot(F, G);
      const a1 = Math.atan2(G, F);
      const a2 = Math.atan2(H, E);
      return { sx: Q + R, sy: Q - R, phi: (a2 + a1) / 2, theta: (a2 - a1) / 2 };
    },

    /** Parse an SVG transform attribute. */
    parse(str) {
      let m = Matrix.identity();
      if (!str) return m;
      const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
      let match;
      while ((match = re.exec(str))) {
        const args = (match[2].match(NUM_RE) || []).map(Number);
        let t = null;
        switch (match[1]) {
          case 'matrix':
            if (args.length >= 6) t = args.slice(0, 6);
            break;
          case 'translate':
            t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
            break;
          case 'scale': {
            const sx = args.length ? args[0] : 1;
            const sy = args.length > 1 ? args[1] : sx;
            t = [sx, 0, 0, sy, 0, 0];
            break;
          }
          case 'rotate': {
            t = Matrix.rotate(args[0] || 0);
            if (args.length >= 3) {
              t = Matrix.multiply(
                Matrix.multiply(Matrix.translate(args[1], args[2]), t),
                Matrix.translate(-args[1], -args[2])
              );
            }
            break;
          }
          case 'skewX':
            t = [1, 0, Math.tan((args[0] || 0) * DEG), 1, 0, 0];
            break;
          case 'skewY':
            t = [1, Math.tan((args[0] || 0) * DEG), 0, 1, 0, 0];
            break;
        }
        if (t && t.every(isFinite)) m = Matrix.multiply(m, t);
      }
      return m;
    },

    /** Parse a CSS computed transform: matrix(...) or matrix3d(...). */
    parseCss(str) {
      if (!str || str === 'none') return null;
      const nums = (str.match(NUM_RE) || []).map(Number);
      if (/^matrix3d/.test(str) && nums.length >= 16) {
        return [nums[0], nums[1], nums[4], nums[5], nums[12], nums[13]];
      }
      if (/^matrix/.test(str) && nums.length >= 6) return nums.slice(0, 6);
      return Matrix.parse(str);
    },
  };

  // ---------------------------------------------------------------------------
  // Path data
  // ---------------------------------------------------------------------------
  const CMD_CHARS = 'MmZzLlHhVvCcSsQqTtAa';

  function parse(d) {
    const out = [];
    if (d == null) return out;
    const s = String(d);
    const n = s.length;
    let i = 0;
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let lcx = null, lcy = null; // last cubic control point 2
    let lqx = null, lqy = null; // last quadratic control point
    let cmd = null;

    function skip() {
      while (i < n) {
        const c = s.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 44) i++;
        else break;
      }
    }
    function num() {
      skip();
      const start = i;
      let c = s.charCodeAt(i);
      if (c === 43 || c === 45) c = s.charCodeAt(++i);
      let digits = false;
      while (c >= 48 && c <= 57) { digits = true; c = s.charCodeAt(++i); }
      if (c === 46) {
        c = s.charCodeAt(++i);
        while (c >= 48 && c <= 57) { digits = true; c = s.charCodeAt(++i); }
      }
      if (!digits) { i = start; return NaN; }
      if (c === 101 || c === 69) {
        const save = i;
        c = s.charCodeAt(++i);
        if (c === 43 || c === 45) c = s.charCodeAt(++i);
        let ed = false;
        while (c >= 48 && c <= 57) { ed = true; c = s.charCodeAt(++i); }
        if (!ed) i = save;
      }
      return parseFloat(s.slice(start, i));
    }
    function flag() {
      skip();
      const c = s.charCodeAt(i);
      if (c === 48 || c === 49) { i++; return c - 48; }
      return NaN;
    }
    function nextIsNumber() {
      skip();
      if (i >= n) return false;
      const c = s.charCodeAt(i);
      return (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46;
    }

    for (;;) {
      skip();
      if (i >= n) break;
      const ch = s[i];
      let explicit = false;
      if (CMD_CHARS.indexOf(ch) >= 0) {
        cmd = ch;
        i++;
        explicit = true;
      } else if (cmd === null || !nextIsNumber()) {
        break; // garbage: stop, keep what was parsed (SVG error handling)
      }
      if (!out.length && cmd !== 'M' && cmd !== 'm') break;
      const rel = cmd >= 'a';
      const up = cmd.toUpperCase();
      if (up === 'Z') {
        if (!explicit) break;
        out.push(['Z']);
        cx = sx; cy = sy;
        lcx = lqx = null;
        cmd = null;
        continue;
      }
      let ok = true;
      let isCubic = false, isQuad = false;
      switch (up) {
        case 'M': {
          let x = num(), y = num();
          if (isNaN(y)) { ok = false; break; }
          if (rel) { x += cx; y += cy; }
          cx = sx = x; cy = sy = y;
          out.push(['M', x, y]);
          cmd = rel ? 'l' : 'L';
          break;
        }
        case 'L': {
          let x = num(), y = num();
          if (isNaN(y)) { ok = false; break; }
          if (rel) { x += cx; y += cy; }
          cx = x; cy = y;
          out.push(['L', x, y]);
          break;
        }
        case 'H': {
          let x = num();
          if (isNaN(x)) { ok = false; break; }
          if (rel) x += cx;
          cx = x;
          out.push(['L', cx, cy]);
          break;
        }
        case 'V': {
          let y = num();
          if (isNaN(y)) { ok = false; break; }
          if (rel) y += cy;
          cy = y;
          out.push(['L', cx, cy]);
          break;
        }
        case 'C': {
          let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
          if (isNaN(y)) { ok = false; break; }
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
          out.push(['C', x1, y1, x2, y2, x, y]);
          lcx = x2; lcy = y2; cx = x; cy = y; isCubic = true;
          break;
        }
        case 'S': {
          let x2 = num(), y2 = num(), x = num(), y = num();
          if (isNaN(y)) { ok = false; break; }
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
          const x1 = lcx === null ? cx : 2 * cx - lcx;
          const y1 = lcx === null ? cy : 2 * cy - lcy;
          out.push(['C', x1, y1, x2, y2, x, y]);
          lcx = x2; lcy = y2; cx = x; cy = y; isCubic = true;
          break;
        }
        case 'Q': {
          let x1 = num(), y1 = num(), x = num(), y = num();
          if (isNaN(y)) { ok = false; break; }
          if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
          out.push(['Q', x1, y1, x, y]);
          lqx = x1; lqy = y1; cx = x; cy = y; isQuad = true;
          break;
        }
        case 'T': {
          let x = num(), y = num();
          if (isNaN(y)) { ok = false; break; }
          if (rel) { x += cx; y += cy; }
          const x1 = lqx === null ? cx : 2 * cx - lqx;
          const y1 = lqx === null ? cy : 2 * cy - lqy;
          out.push(['Q', x1, y1, x, y]);
          lqx = x1; lqy = y1; cx = x; cy = y; isQuad = true;
          break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), fa = flag(), fs = flag();
          let x = num(), y = num();
          if (isNaN(y) || isNaN(fa) || isNaN(fs) || isNaN(rot)) { ok = false; break; }
          if (rel) { x += cx; y += cy; }
          if (x === cx && y === cy) {
            // zero-length arc is omitted
          } else if (rx === 0 || ry === 0) {
            out.push(['L', x, y]);
          } else {
            out.push(['A', Math.abs(rx), Math.abs(ry), rot, fa, fs, x, y]);
          }
          cx = x; cy = y;
          break;
        }
      }
      if (!ok) break;
      if (!isCubic) lcx = lcy = null;
      if (!isQuad) lqx = lqy = null;
    }
    return out;
  }

  function transform(segs, m) {
    if (Matrix.isIdentity(m)) return segs.map((s) => s.slice());
    const det = Matrix.det(m);
    const out = [];
    const ap = (x, y) => Matrix.apply(m, x, y);
    for (const s of segs) {
      switch (s[0]) {
        case 'M':
        case 'L':
          out.push([s[0], ...ap(s[1], s[2])]);
          break;
        case 'C':
          out.push(['C', ...ap(s[1], s[2]), ...ap(s[3], s[4]), ...ap(s[5], s[6])]);
          break;
        case 'Q':
          out.push(['Q', ...ap(s[1], s[2]), ...ap(s[3], s[4])]);
          break;
        case 'A': {
          const [, rx, ry, rot, fa, fs, x, y] = s;
          const c = Math.cos(rot * DEG), sn = Math.sin(rot * DEG);
          const e = Matrix.multiply([m[0], m[1], m[2], m[3], 0, 0], [c * rx, sn * rx, -sn * ry, c * ry, 0, 0]);
          const dec = Matrix.decompose(e);
          const nrx = Math.abs(dec.sx), nry = Math.abs(dec.sy);
          const p = ap(x, y);
          if (nrx < 1e-12 || nry < 1e-12) out.push(['L', ...p]);
          else out.push(['A', nrx, nry, dec.phi / DEG, fa, det < 0 ? 1 - fs : fs, ...p]);
          break;
        }
        case 'Z':
          out.push(['Z']);
          break;
      }
    }
    return out;
  }

  /** Convert an elliptical arc to cubic bezier segments (SVG spec F.6.5). */
  function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx === 0 || ry === 0) {
      return [[x1 + (x2 - x1) / 3, y1 + (y2 - y1) / 3, x1 + (2 * (x2 - x1)) / 3, y1 + (2 * (y2 - y1)) / 3, x2, y2]];
    }
    const phi = phiDeg * DEG;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      const sl = Math.sqrt(lambda);
      rx *= sl;
      ry *= sl;
    }
    const rx2 = rx * rx, ry2 = ry * ry;
    const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
    const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
    let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
    if (fa === fs) coef = -coef;
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const theta1 = ang(1, 0, ux, uy);
    let dtheta = ang(ux, uy, vx, vy);
    if (!fs && dtheta > 0) dtheta -= 2 * Math.PI;
    else if (fs && dtheta < 0) dtheta += 2 * Math.PI;
    const nseg = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-7));
    const delta = dtheta / nseg;
    const t = (4 / 3) * Math.tan(delta / 4);
    const map = (u, v) => [cx + cos * rx * u - sin * ry * v, cy + sin * rx * u + cos * ry * v];
    const out = [];
    let th = theta1;
    for (let k = 0; k < nseg; k++) {
      const c1 = Math.cos(th), s1 = Math.sin(th);
      const c2 = Math.cos(th + delta), s2 = Math.sin(th + delta);
      const p1 = map(c1 - t * s1, s1 + t * c1);
      const p2 = map(c2 + t * s2, s2 - t * c2);
      const p3 = k === nseg - 1 ? [x2, y2] : map(c2, s2);
      out.push([...p1, ...p2, ...p3]);
      th += delta;
    }
    return out;
  }

  /** Normalize to M, L, C, Z only. */
  function toCubics(segs) {
    const out = [];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    for (const s of segs) {
      switch (s[0]) {
        case 'M':
          out.push(s.slice());
          cx = sx = s[1]; cy = sy = s[2];
          break;
        case 'L':
          out.push(s.slice());
          cx = s[1]; cy = s[2];
          break;
        case 'C':
          out.push(s.slice());
          cx = s[5]; cy = s[6];
          break;
        case 'Q': {
          const [, qx, qy, x, y] = s;
          out.push(['C', cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y]);
          cx = x; cy = y;
          break;
        }
        case 'A': {
          for (const c of arcToCubics(cx, cy, s[1], s[2], s[3], s[4], s[5], s[6], s[7])) out.push(['C', ...c]);
          cx = s[6]; cy = s[7];
          break;
        }
        case 'Z':
          out.push(['Z']);
          cx = sx; cy = sy;
          break;
      }
    }
    return out;
  }

  function bbox(segs) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const inc = (x, y) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    const cubicExtrema = (p0, p1, p2, p3) => {
      const a = -p0 + 3 * p1 - 3 * p2 + p3;
      const b = 2 * (p0 - 2 * p1 + p2);
      const c = p1 - p0;
      const ts = [];
      if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) ts.push(-c / b);
      } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          ts.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
        }
      }
      return ts.filter((t) => t > 0 && t < 1);
    };
    const cub = (p0, p1, p2, p3, t) => {
      const mt = 1 - t;
      return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
    };
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let any = false;
    for (const s of toCubics(segs)) {
      switch (s[0]) {
        case 'M':
          cx = sx = s[1]; cy = sy = s[2];
          break;
        case 'L':
          if (!any) { inc(cx, cy); any = true; }
          inc(cx, cy);
          inc(s[1], s[2]);
          cx = s[1]; cy = s[2];
          break;
        case 'C': {
          any = true;
          inc(cx, cy);
          inc(s[5], s[6]);
          for (const t of cubicExtrema(cx, s[1], s[3], s[5])) {
            inc(cub(cx, s[1], s[3], s[5], t), cub(cy, s[2], s[4], s[6], t));
          }
          for (const t of cubicExtrema(cy, s[2], s[4], s[6])) {
            inc(cub(cx, s[1], s[3], s[5], t), cub(cy, s[2], s[4], s[6], t));
          }
          cx = s[5]; cy = s[6];
          break;
        }
        case 'Z':
          cx = sx; cy = sy;
          break;
      }
    }
    if (!any) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // --- dashing -----------------------------------------------------------------
  function splitCubic(p, t) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
    const lerp = (a, b) => a + (b - a) * t;
    const ax = lerp(x0, x1), ay = lerp(y0, y1);
    const bx = lerp(x1, x2), by = lerp(y1, y2);
    const cx = lerp(x2, x3), cy = lerp(y2, y3);
    const dx = lerp(ax, bx), dy = lerp(ay, by);
    const ex = lerp(bx, cx), ey = lerp(by, cy);
    const fx = lerp(dx, ex), fy = lerp(dy, ey);
    return [[x0, y0, ax, ay, dx, dy, fx, fy], [fx, fy, ex, ey, cx, cy, x3, y3]];
  }

  function subCubic(p, t0, t1) {
    if (t0 <= 0 && t1 >= 1) return p;
    let right = p;
    if (t0 > 0) {
      if (t0 >= 1) return [p[6], p[7], p[6], p[7], p[6], p[7], p[6], p[7]];
      right = splitCubic(p, t0)[1];
    }
    if (t1 >= 1) return right;
    const t = (t1 - t0) / (1 - t0);
    return splitCubic(right, t)[0];
  }

  function cubicPoint(p, t) {
    const mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
  }

  function makePiece(type, p) {
    if (type === 'L') {
      return { type, p, len: Math.hypot(p[2] - p[0], p[3] - p[1]) };
    }
    const N = 48;
    const table = [0];
    let prev = [p[0], p[1]];
    let acc = 0;
    for (let k = 1; k <= N; k++) {
      const pt = cubicPoint(p, k / N);
      acc += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
      table.push(acc);
      prev = pt;
    }
    return { type, p, len: acc, table };
  }

  function pieceT(piece, l) {
    const tb = piece.table;
    const N = tb.length - 1;
    if (l <= 0) return 0;
    if (l >= piece.len) return 1;
    let lo = 0, hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tb[mid] < l) lo = mid;
      else hi = mid;
    }
    const seg = tb[hi] - tb[lo];
    const f = seg > 0 ? (l - tb[lo]) / seg : 0;
    return (lo + f) / N;
  }

  function pieceSlice(piece, a, b) {
    const p = piece.p;
    if (piece.type === 'L') {
      const L = piece.len || 1;
      const ta = a / L, tb = b / L;
      return ['L', p[0] + (p[2] - p[0]) * ta, p[1] + (p[3] - p[1]) * ta, p[0] + (p[2] - p[0]) * tb, p[1] + (p[3] - p[1]) * tb];
    }
    const c = subCubic(p, pieceT(piece, a), pieceT(piece, b));
    return ['C', ...c];
  }

  /** Split path into dashes. dashes: even-length array of non-negative numbers. */
  function dash(segs, dashes, offset, keepZeroLength) {
    const subs = [];
    let cur = null;
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const ensure = () => {
      if (!cur) {
        cur = { pieces: [] };
        subs.push(cur);
      }
    };
    for (const s of toCubics(segs)) {
      switch (s[0]) {
        case 'M':
          cur = null;
          cx = sx = s[1]; cy = sy = s[2];
          break;
        case 'L':
          ensure();
          cur.pieces.push(makePiece('L', [cx, cy, s[1], s[2]]));
          cx = s[1]; cy = s[2];
          break;
        case 'C':
          ensure();
          cur.pieces.push(makePiece('C', [cx, cy, s[1], s[2], s[3], s[4], s[5], s[6]]));
          cx = s[5]; cy = s[6];
          break;
        case 'Z':
          if (cur && (cx !== sx || cy !== sy)) cur.pieces.push(makePiece('L', [cx, cy, sx, sy]));
          cur = null;
          cx = sx; cy = sy;
          break;
      }
    }

    const total = dashes.reduce((a, b) => a + b, 0);
    const out = [];
    for (const sub of subs) {
      if (!sub.pieces.length) continue;
      let off = ((offset % total) + total) % total;
      let idx = 0;
      let guard = 0;
      while (off >= dashes[idx] && guard++ < 10000) {
        off -= dashes[idx];
        idx = (idx + 1) % dashes.length;
      }
      let remain = dashes[idx] - off;
      let on = idx % 2 === 0;
      let current = null;
      const startDash = (x, y) => {
        current = [['M', x, y]];
      };
      const endDash = () => {
        if (current) {
          if (current.length > 1) out.push(...current);
          else if (keepZeroLength) out.push(current[0], ['L', current[0][1], current[0][2]]);
        }
        current = null;
      };
      const first = sub.pieces[0].p;
      if (on) startDash(first[0], first[1]);
      for (const piece of sub.pieces) {
        let pos = 0;
        guard = 0;
        while (piece.len - pos > remain && guard++ < 100000) {
          const end = pos + remain;
          if (on) {
            const sl = pieceSlice(piece, pos, end);
            if (end > pos) current.push(sl[0] === 'L' ? ['L', sl[3], sl[4]] : ['C', ...sl.slice(3)]);
            endDash();
          }
          pos = end;
          idx = (idx + 1) % dashes.length;
          remain = dashes[idx];
          on = !on;
          if (on) {
            const sl = pieceSlice(piece, pos, pos);
            startDash(sl[1], sl[2]);
          }
        }
        if (on && piece.len > pos) {
          const sl = pieceSlice(piece, pos, piece.len);
          current.push(sl[0] === 'L' ? ['L', sl[3], sl[4]] : ['C', ...sl.slice(3)]);
        }
        remain -= piece.len - pos;
      }
      endDash();
    }
    return out;
  }

  // --- serialization -------------------------------------------------------------
  function fmtInt(iv, dec) {
    if (iv === 0) return '0';
    const neg = iv < 0;
    let s = String(Math.abs(iv));
    if (dec > 0) {
      if (s.length <= dec) s = '0'.repeat(dec - s.length + 1) + s;
      const ip = s.slice(0, s.length - dec);
      const fp = s.slice(s.length - dec).replace(/0+$/, '');
      s = fp ? ip + '.' + fp : ip;
    }
    return (neg ? '-' : '') + s;
  }

  function formatNum(v, dec) {
    return fmtInt(Math.round(v * Math.pow(10, dec)), dec);
  }

  function hasDrawing(segs) {
    return !!segs && segs.some((s) => s[0] !== 'M' && s[0] !== 'Z');
  }

  /** Serialize to compact path data, choosing absolute/relative per segment. */
  function serialize(segs, dec) {
    const k = Math.pow(10, dec);
    const R = (v) => Math.round(v * k);
    const F = (iv) => fmtInt(iv, dec);
    const pick = (a, b) => (b.length < a.length ? b : a);
    const parts = [];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let lc = null; // last cubic ctrl2 [x,y] (ints)
    let lq = null; // last quad ctrl
    for (let idx = 0; idx < segs.length; idx++) {
      const s = segs[idx];
      let nlc = null, nlq = null;
      switch (s[0]) {
        case 'M': {
          const next = segs[idx + 1];
          if (!next || next[0] === 'M') break;
          const x = R(s[1]), y = R(s[2]);
          parts.push(pick('M' + F(x) + ',' + F(y), 'm' + F(x - cx) + ',' + F(y - cy)));
          cx = sx = x; cy = sy = y;
          break;
        }
        case 'L': {
          const x = R(s[1]), y = R(s[2]);
          const dx = x - cx, dy = y - cy;
          if (dy === 0 && dx !== 0) parts.push(pick('H' + F(x), 'h' + F(dx)));
          else if (dx === 0 && dy !== 0) parts.push(pick('V' + F(y), 'v' + F(dy)));
          else parts.push(pick('L' + F(x) + ',' + F(y), 'l' + F(dx) + ',' + F(dy)));
          cx = x; cy = y;
          break;
        }
        case 'C': {
          const x1 = R(s[1]), y1 = R(s[2]), x2 = R(s[3]), y2 = R(s[4]), x = R(s[5]), y = R(s[6]);
          if (lc && x1 === 2 * cx - lc[0] && y1 === 2 * cy - lc[1]) {
            parts.push(pick(
              'S' + F(x2) + ',' + F(y2) + ' ' + F(x) + ',' + F(y),
              's' + F(x2 - cx) + ',' + F(y2 - cy) + ' ' + F(x - cx) + ',' + F(y - cy)
            ));
          } else {
            parts.push(pick(
              'C' + F(x1) + ',' + F(y1) + ' ' + F(x2) + ',' + F(y2) + ' ' + F(x) + ',' + F(y),
              'c' + F(x1 - cx) + ',' + F(y1 - cy) + ' ' + F(x2 - cx) + ',' + F(y2 - cy) + ' ' + F(x - cx) + ',' + F(y - cy)
            ));
          }
          nlc = [x2, y2];
          cx = x; cy = y;
          break;
        }
        case 'Q': {
          const x1 = R(s[1]), y1 = R(s[2]), x = R(s[3]), y = R(s[4]);
          if (lq && x1 === 2 * cx - lq[0] && y1 === 2 * cy - lq[1]) {
            parts.push(pick('T' + F(x) + ',' + F(y), 't' + F(x - cx) + ',' + F(y - cy)));
          } else {
            parts.push(pick(
              'Q' + F(x1) + ',' + F(y1) + ' ' + F(x) + ',' + F(y),
              'q' + F(x1 - cx) + ',' + F(y1 - cy) + ' ' + F(x - cx) + ',' + F(y - cy)
            ));
          }
          nlq = [x1, y1];
          cx = x; cy = y;
          break;
        }
        case 'A': {
          const x = R(s[6]), y = R(s[7]);
          const rx = R(s[1]), ry = R(s[2]);
          if (x === cx && y === cy) break;
          if (rx === 0 || ry === 0) {
            parts.push(pick('L' + F(x) + ',' + F(y), 'l' + F(x - cx) + ',' + F(y - cy)));
          } else {
            let rot = s[3] % 180;
            if (rot < 0) rot += 180;
            if (Math.abs(rx - ry) === 0) rot = 0;
            const head = F(rx) + ',' + F(ry) + ',' + formatNum(rot, 2) + ',' + s[4] + ',' + s[5] + ',';
            parts.push(pick('A' + head + F(x) + ',' + F(y), 'a' + head + F(x - cx) + ',' + F(y - cy)));
          }
          cx = x; cy = y;
          break;
        }
        case 'Z':
          if (parts.length && !/[Zz]$/.test(parts[parts.length - 1])) parts.push('Z');
          cx = sx; cy = sy;
          break;
      }
      lc = nlc;
      lq = nlq;
    }
    return parts.join('');
  }

  S2V.Matrix = Matrix;
  S2V.PathData = {
    parse,
    transform,
    toCubics,
    arcToCubics,
    bbox,
    dash,
    serialize,
    hasDrawing,
    formatNum,
    NUM_RE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
