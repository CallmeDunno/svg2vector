# SVG → Android Vector Drawable

A website that converts SVG into Android VectorDrawable XML (`res/drawable/*.xml`). It runs entirely in the browser; no data is uploaded anywhere.

## Features

- **Paste SVG from the clipboard**: the "Dán SVG" button, or press `Ctrl+V` anywhere on the page. You can also open a file or drag and drop a `.svg`.
- **SVG preview** and **Vector preview**. The Vector preview is rendered back from the generated XML using Android semantics.
- **Automatic pixel comparison** between the original SVG and the Vector ("Khớp xx%" badge). Tick "So sánh khác biệt" to highlight mismatched pixels in red.
- **Vector code display** with syntax highlighting, **copy to clipboard** and **download as `.xml`**.

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

The generated XML uses `aapt:attr` for gradients (API 24+ or AndroidX VectorDrawableCompat, AGP ≥ 3.0) and `android:fillType` (API 24+).
