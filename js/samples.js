/* Built-in sample SVGs (also used by test.html). */
(function (root) {
  'use strict';
  const S2V = (root.S2V = root.S2V || {});

  S2V.samples = [
    {
      id: 'linear-gradient',
      name: 'Gradient tuyến tính',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff5f6d"/>
      <stop offset="1" stop-color="#ffc371"/>
    </linearGradient>
    <linearGradient id="g2" href="#g1" gradientTransform="rotate(90 .5 .5)"/>
    <linearGradient id="g3" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="40" y2="0" spreadMethod="reflect">
      <stop offset="0" stop-color="#4facfe"/>
      <stop offset="1" stop-color="#00f2fe" stop-opacity=".4"/>
    </linearGradient>
    <linearGradient id="g4" x1="0%" y1="100%" x2="0%" y2="0%" spreadMethod="repeat">
      <stop offset="0" stop-color="#43e97b"/>
      <stop offset=".5" stop-color="#38f9d7"/>
      <stop offset=".5" stop-color="#fa709a"/>
      <stop offset="1" stop-color="#fee140"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="104" height="60" rx="14" fill="url(#g1)"/>
  <rect x="8" y="76" width="50" height="36" rx="8" fill="url(#g2)"/>
  <rect x="64" y="76" width="48" height="36" fill="url(#g3)" transform="translate(14 0) skewX(-10)"/>
  <circle cx="60" cy="38" r="18" fill="none" stroke="url(#g4)" stroke-width="6"/>
</svg>`,
    },
    {
      id: 'radial-gradient',
      name: 'Gradient tròn / elip',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">
  <defs>
    <radialGradient id="r1">
      <stop offset="0" stop-color="#fff"/>
      <stop offset=".5" stop-color="#7f5af0"/>
      <stop offset="1" stop-color="#2cb67d"/>
    </radialGradient>
    <radialGradient id="r2" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(120 50) rotate(30) scale(34 16)">
      <stop stop-color="#ffd803"/>
      <stop offset="1" stop-color="#e45858"/>
    </radialGradient>
    <radialGradient id="r3" cx="50%" cy="50%" r="25%" spreadMethod="repeat">
      <stop offset="0" stop-color="#094067"/>
      <stop offset="1" stop-color="#90b4ce"/>
    </radialGradient>
  </defs>
  <ellipse cx="42" cy="50" rx="36" ry="24" fill="url(#r1)"/>
  <rect x="84" y="16" width="72" height="68" rx="10" fill="url(#r2)"/>
  <circle cx="42" cy="88" r="10" fill="url(#r3)"/>
</svg>`,
    },
    {
      id: 'curves-arcs',
      name: 'Đường cong & arc',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240">
  <path d="M10 60a25 25 0 1150 0 25 25 0 11-50 0zm10 0a15 15 0 1030 0 15 15 0 10-30 0z" fill="#264653" fill-rule="evenodd"/>
  <path d="M65 40c0-15 20-15 20 0s20 15 20 0" fill="none" stroke="#2a9d8f" stroke-width="4" stroke-linecap="round"/>
  <path d="M65 70q10-20 20 0t20 0" fill="none" stroke="#e9c46a" stroke-width="4"/>
  <path d="M15 100 A40 20 -30 0 1 60 95 L55 110 Z" fill="#f4a261"/>
  <path d="M70 90h40v20H70z M80 95h20v10H80z" fill="#e76f51"/>
  <path d="M8,8L20-.5.5,20z" transform="translate(40 2) scale(.8)" fill="#8ab17d"/>
</svg>`,
    },
    {
      id: 'css-styles',
      name: 'CSS class & style',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" style="color:#6246ea">
  <style>
    .bg { fill: #d1d1e9; }
    .fg { fill: currentColor; stroke: #2b2c34; stroke-width: 2px; }
    g.accent path { fill: #e45858 }
    #dot { fill: rgba(0, 0, 0, .35) }
    .hsl { fill: hsl(160 60% 45%) }
  </style>
  <rect class="bg" width="64" height="64" rx="12"/>
  <circle class="fg" cx="24" cy="26" r="12"/>
  <g class="accent" fill="blue"><path d="M36 40h20v14H36z"/></g>
  <circle id="dot" cx="44" cy="20" r="8"/>
  <path class="hsl" d="M8 44h22l-11 14z" style="opacity:.8"/>
</svg>`,
    },
    {
      id: 'use-symbol',
      name: 'use / symbol / transform',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 120 120">
  <defs>
    <symbol id="star" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></symbol>
    <g id="petal"><ellipse cx="0" cy="-18" rx="7" ry="14"/></g>
  </defs>
  <use xlink:href="#star" x="4" y="4" width="40" height="40" fill="#f9bc60"/>
  <use href="#star" x="50" y="10" width="24" height="24" fill="#abd1c6" transform="rotate(20 62 22)"/>
  <g transform="translate(60 80)" fill="#e16162">
    <use href="#petal"/><use href="#petal" transform="rotate(60)"/><use href="#petal" transform="rotate(120)"/>
    <use href="#petal" transform="rotate(180)" fill="#004643"/><use href="#petal" transform="rotate(240)"/><use href="#petal" transform="rotate(300)"/>
    <circle r="6" fill="#f9bc60"/>
  </g>
  <g transform="matrix(1 0 -.4 1 40 0)">
    <use href="#star" x="70" y="4" width="36" height="36" fill="#001e1d"/>
    <circle cx="104" cy="104" r="12" fill="#abd1c6"/>
  </g>
</svg>`,
    },
    {
      id: 'strokes',
      name: 'Nét viền & nét đứt',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <g fill="none" stroke="#3a86ff" stroke-width="6">
    <polyline points="10,30 35,10 60,30 85,10 110,30" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="10,55 35,35 60,55 85,35 110,55" stroke-linejoin="bevel" stroke="#8338ec"/>
    <polyline points="10,80 35,60 60,80 85,60 110,80" stroke-miterlimit="10" stroke="#ff006e" stroke-linecap="square"/>
  </g>
  <circle cx="30" cy="100" r="14" fill="none" stroke="#fb5607" stroke-width="3" stroke-dasharray="6 4"/>
  <path d="M55 100c10-20 30 20 55 0" fill="none" stroke="#ffbe0b" stroke-width="4" stroke-dasharray="1 7" stroke-linecap="round" stroke-dashoffset="3"/>
  <line x1="55" y1="114" x2="112" y2="114" stroke="#222" stroke-width="2" stroke-dasharray="10,4,2,4"/>
</svg>`,
    },
    {
      id: 'clip-mask',
      name: 'Clip-path & mask',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <defs>
    <clipPath id="c1"><circle cx="40" cy="40" r="30"/></clipPath>
    <clipPath id="c2" clipPathUnits="objectBoundingBox"><path d="M.5 0L1 1H0z"/></clipPath>
    <mask id="m1" maskUnits="userSpaceOnUse" x="60" y="60" width="60" height="60">
      <rect x="64" y="64" width="52" height="52" rx="12" fill="#fff"/>
    </mask>
  </defs>
  <g clip-path="url(#c1)">
    <rect x="0" y="0" width="80" height="40" fill="#ef476f"/>
    <rect x="0" y="40" width="80" height="40" fill="#118ab2"/>
  </g>
  <rect x="70" y="8" width="44" height="44" fill="#06d6a0" clip-path="url(#c2)"/>
  <g mask="url(#m1)">
    <circle cx="90" cy="90" r="34" fill="#ffd166"/>
    <path d="M60 90h60" stroke="#073b4c" stroke-width="8"/>
  </g>
  <g clip-path="url(#c1)" transform="translate(4 64) scale(.7)">
    <circle cx="40" cy="40" r="40" fill="#073b4c"/>
    <circle cx="40" cy="40" r="20" fill="#ffd166"/>
  </g>
</svg>`,
    },
    {
      id: 'figma-export',
      name: 'Kiểu xuất từ Figma',
      svg: `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_12_7)">
<rect width="48" height="48" rx="12" fill="url(#paint0_linear_12_7)"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M24 10C16.268 10 10 16.268 10 24C10 31.732 16.268 38 24 38C31.732 38 38 31.732 38 24C38 16.268 31.732 10 24 10ZM24 16C19.5817 16 16 19.5817 16 24C16 28.4183 19.5817 32 24 32C28.4183 32 32 28.4183 32 24C32 19.5817 28.4183 16 24 16Z" fill="white" fill-opacity="0.9"/>
<circle cx="24" cy="24" r="6" fill="url(#paint1_radial_12_7)"/>
<path d="M36 6L42 12L36 18L30 12L36 6Z" fill="#FFE66D"/>
</g>
<defs>
<linearGradient id="paint0_linear_12_7" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
<stop stop-color="#6A11CB"/>
<stop offset="1" stop-color="#2575FC"/>
</linearGradient>
<radialGradient id="paint1_radial_12_7" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(22.5 22.5) rotate(45) scale(7 3.5)">
<stop stop-color="#FF6B6B"/>
<stop offset="1" stop-color="#FFE66D"/>
</radialGradient>
<clipPath id="clip0_12_7">
<rect width="48" height="48" fill="white"/>
</clipPath>
</defs>
</svg>`,
    },
    {
      id: 'nested-svg',
      name: 'SVG lồng & preserveAspectRatio',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 50 50">
  <rect width="50" height="50" fill="#fec89a"/>
  <svg x="5" y="5" width="40" height="20" viewBox="0 0 10 10" preserveAspectRatio="xMinYMid slice">
    <circle cx="5" cy="5" r="6" fill="#d8e2dc" stroke="#9d8189"/>
  </svg>
  <svg x="5" y="28" width="40" height="18" viewBox="0 0 20 10" preserveAspectRatio="none">
    <path d="M0 10L10 0l10 10z" fill="#9d8189"/>
  </svg>
</svg>`,
    },
    {
      id: 'opacity',
      name: 'Độ trong suốt & paint-order',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
  <g opacity=".6"><rect x="10" y="10" width="40" height="40" fill="#ff595e"/></g>
  <circle cx="60" cy="35" r="22" fill="#1982c4" fill-opacity=".7" stroke="#6a4c93" stroke-opacity=".5" stroke-width="8"/>
  <path d="M80 60 L110 10 L115 60Z" fill="#8ac926" stroke="#ffca3a" stroke-width="10" stroke-linejoin="round" paint-order="stroke"/>
  <rect x="10" y="58" width="60" height="14" rx="7" style="fill:#ffca3a;fill-opacity:.5;stroke:#000;stroke-width:1"/>
</svg>`,
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
