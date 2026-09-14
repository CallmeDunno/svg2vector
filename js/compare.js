/* Pixel comparison between the original SVG and the rendered VectorDrawable. */
(function (root) {
  'use strict';
  const S2V = (root.S2V = root.S2V || {});

  function loadImage(svgText) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không render được SVG'));
      };
      img.src = url;
    });
  }

  async function rasterize(svgText, W, H) {
    const img = await loadImage(svgText);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H);
  }

  function fitSize(w, h, max) {
    if (!(w > 0) || !(h > 0)) return [max, max];
    const s = max / Math.max(w, h);
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  }

  /**
   * Returns { similarity, mismatch, width, height, diff: ImageData }.
   * A pixel mismatches when its premultiplied RGBA differs by more than `threshold` (0-255).
   */
  async function compareSvgs(svgA, svgB, width, height, max = 256, threshold = 40) {
    const [W, H] = fitSize(width, height, max);
    const [a, b] = await Promise.all([rasterize(svgA, W, H), rasterize(svgB, W, H)]);
    const da = a.data, db = b.data;
    const diff = new ImageData(W, H);
    const dd = diff.data;
    let covered = 0, bad = 0;
    for (let i = 0; i < da.length; i += 4) {
      const aa = da[i + 3], ab = db[i + 3];
      if (aa === 0 && ab === 0) continue;
      covered++;
      let m = Math.abs(aa - ab);
      for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(da[i + k] * aa - db[i + k] * ab) / 255);
      if (m > threshold) {
        bad++;
        dd[i] = 235; dd[i + 1] = 30; dd[i + 2] = 70; dd[i + 3] = 255;
      } else {
        const g = Math.round((da[i] + da[i + 1] + da[i + 2]) / 3);
        dd[i] = dd[i + 1] = dd[i + 2] = g;
        dd[i + 3] = Math.round(aa * 0.3);
      }
    }
    const mismatch = covered ? bad / covered : 0;
    return { similarity: 1 - mismatch, mismatch, width: W, height: H, diff, badPixels: bad, coveredPixels: covered };
  }

  S2V.compare = { rasterize, compareSvgs, fitSize };
})(typeof window !== 'undefined' ? window : globalThis);
