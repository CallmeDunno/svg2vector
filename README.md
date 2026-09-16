# SVG → Android Vector Drawable

A website that converts SVG into Android VectorDrawable XML (`res/drawable/*.xml`). It runs entirely in the browser; no data is uploaded anywhere.

## Features

- **Paste SVG from the clipboard**: the "Dán SVG" button, or press `Ctrl+V` anywhere on the page. You can also open a file or drag and drop a `.svg`.
- **SVG preview** and **Vector preview**. The Vector preview is rendered back from the generated XML using Android semantics.
- **Automatic pixel comparison** between the original SVG and the Vector ("Khớp xx%" badge). Tick "So sánh khác biệt" to highlight mismatched pixels in red.
- **Vector code display** with syntax highlighting, **copy to clipboard** and **download as `.xml`**.
- Options: coordinate precision (number of decimals) and output size in dp.

## Running it

It is a static site with no build step:

- Open `index.html` directly in a browser, **or**
- Run a local server (recommended, so the clipboard read permission works):

  ```bash
  node serve.js
  ```

  and then open http://localhost:5173

To deploy, just upload the whole folder to any static host (GitHub Pages, Netlify, Nginx...). The "Dán SVG" button needs HTTPS (or localhost) to read the clipboard; `Ctrl+V` works everywhere.

## How it works

1. The SVG is parsed (with a fallback to a lenient parser when `xmlns` is missing or the XML is broken), stripped of scripts, and mounted into a hidden Shadow DOM. The browser's own CSS engine resolves `<style>`, classes, inheritance, `currentColor`, `!important`...
2. `<use>`/`<symbol>` are expanded; nested `<svg>`, `viewBox` and `preserveAspectRatio` are handled.
3. Every transform (including skew) is **flattened into the coordinates**: arcs are transformed exactly (SVD), so no curves are lost. The output has no fragile `<group>` transforms.
4. Paint:
   - Solid colors with opacity (`opacity`, `fill-opacity`, `stroke-opacity`, group opacity) → `#AARRGGBB`.
   - `linearGradient`: mapped exactly through any affine transform (`gradientTransform`, `objectBoundingBox`, skew...).
   - `radialGradient`: circles map directly; **elliptical** gradients (non-uniform scale/rotation) are rendered exactly with a `<group>` scale/rotation and the inverse-transformed path.
   - `spreadMethod` pad/reflect/repeat → `tileMode` clamp/mirror/repeat.
5. `clip-path` → `<group><clip-path/>…</group>` (supports userSpaceOnUse/objectBoundingBox, nested clips).
6. `stroke-dasharray` is split into dash segments (VectorDrawable has no native dash support).
7. `fill-rule="evenodd"` → `android:fillType="evenOdd"`, `paint-order`, `stroke-linecap/linejoin/miterlimit`.

## Limitations (VectorDrawable itself does not support these)

| SVG | Handling |
| --- | --- |
| `<text>` | Skipped (with a warning). Convert text to outlines before exporting the SVG. |
| `<image>`, `<pattern>` | Skipped / fallback color used. |
| `filter` (shadow, blur) | The content is kept, the effect is dropped. |
| `mask` | Approximated as a clip-path using the shape of the mask. |
| `fx/fy` of a radial gradient | Focal point moved back to the center. |
| Elliptical radial gradient on a **stroke** | Approximated as a circle. |
| `clip-rule="evenodd"` with multiple subpaths | Uses nonzero. |

Every approximation is listed in the "lưu ý" (notes) section above the output code.

## Structure

```
index.html          Conversion page
css/style.css
js/geometry.js      Affine matrices, path parsing/transforming/serializing, arcs, bbox, dashing
js/color.js         Color parsing
js/converter.js     SVG → VectorDrawable
js/vdrender.js      VectorDrawable → SVG (preview, following Android semantics)
js/compare.js       Pixel comparison
js/app.js           UI
serve.js            Minimal static server (node)
```

The generated XML uses `aapt:attr` for gradients (API 24+ or AndroidX VectorDrawableCompat, AGP ≥ 3.0) and `android:fillType` (API 24+).
