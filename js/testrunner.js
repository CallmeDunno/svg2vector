/* Batch test runner for test.html */
(function () {
  'use strict';
  const S2V = window.S2V;
  const rows = document.getElementById('rows');
  const summary = document.getElementById('summary');
  const results = [];

  function thumbImg(svg) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    return img;
  }

  function cell(tr, content, cls) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    if (content instanceof Node) td.appendChild(content);
    else if (content != null) td.textContent = content;
    tr.appendChild(td);
    return td;
  }

  function updateSummary() {
    const done = results.filter((r) => r.similarity != null);
    const errors = results.filter((r) => r.error).length;
    const avg = done.length ? done.reduce((a, r) => a + r.similarity, 0) / done.length : 0;
    const below = done.filter((r) => r.similarity < 0.99).length;
    summary.textContent =
      `${results.length} file · khớp trung bình ${(avg * 100).toFixed(2)}% · ${below} file < 99% · ${errors} lỗi`;
  }

  async function runOne(name, svgText) {
    const tr = document.createElement('tr');
    rows.appendChild(tr);
    const entry = { name, error: null, warnings: [], similarity: null, paths: 0, bytes: 0 };
    const res = S2V.convert(svgText, {});
    entry.error = res.error || null;
    entry.warnings = (res.warnings || []).map((w) => w.message);
    if (res.stats) entry.paths = res.stats.paths;
    if (res.xml) entry.bytes = res.xml.length;

    cell(tr, name);
    const tdSvg = cell(tr, null, '');
    const tdVd = cell(tr, null, '');
    const tdDiff = cell(tr, null, '');
    const tdScore = cell(tr, '…');
    const tdWarn = cell(tr, null);
    const tdOpen = cell(tr, null);
    for (const td of [tdSvg, tdVd, tdDiff]) {
      td.innerHTML = '<div class="thumb stage checker" style="height:132px;padding:6px"></div>';
    }
    if (res.previewSvg) tdSvg.firstChild.appendChild(thumbImg(res.previewSvg));

    let vd = null;
    if (!entry.error) {
      try {
        vd = S2V.vectorToSvg(res.xml);
      } catch (e) {
        entry.error = 'Render XML: ' + e.message;
      }
    }
    if (vd) {
      tdVd.firstChild.appendChild(thumbImg(vd.svg));
      try {
        const cmp = await S2V.compare.compareSvgs(res.previewSvg, vd.svg, res.svgWidth, res.svgHeight, 256);
        entry.similarity = cmp.similarity;
        entry.badPixels = cmp.badPixels;
        const c = document.createElement('canvas');
        c.width = cmp.width;
        c.height = cmp.height;
        c.getContext('2d').putImageData(cmp.diff, 0, 0);
        tdDiff.firstChild.appendChild(c);
        const pct = cmp.similarity * 100;
        tdScore.innerHTML = `<span class="badge ${pct >= 99 ? '' : pct >= 95 ? 'warn' : 'bad'}">${pct.toFixed(2)}%</span>`;
      } catch (e) {
        tdScore.textContent = 'Không so sánh được';
      }
    }
    if (entry.error) {
      tdScore.innerHTML = '';
      tdScore.appendChild(Object.assign(document.createElement('span'), { className: 'err', textContent: entry.error }));
    }
    if (entry.warnings.length) {
      const ul = document.createElement('ul');
      ul.className = 'warn-list';
      for (const w of entry.warnings) ul.appendChild(Object.assign(document.createElement('li'), { textContent: w }));
      tdWarn.appendChild(ul);
    }
    const open = document.createElement('button');
    open.className = 'btn';
    open.type = 'button';
    open.textContent = 'Mở';
    open.addEventListener('click', () => {
      try {
        localStorage.setItem('s2v:svg', svgText);
        localStorage.setItem('s2v:fileName', name);
      } catch (e) {
        /* ignore */
      }
      window.open('index.html', '_blank');
    });
    tdOpen.appendChild(open);

    results.push(entry);
    updateSummary();
    return entry;
  }

  async function runAll(list) {
    rows.innerHTML = '';
    results.length = 0;
    for (const item of list) await runOne(item.name, item.svg);
    return results;
  }

  async function runFiles(files) {
    const list = [];
    for (const f of files) {
      if (/svg/i.test(f.type) || /\.svg$/i.test(f.name)) list.push({ name: f.name, svg: await f.text() });
    }
    return runAll(list);
  }

  document.getElementById('runSamples').addEventListener('click', () => runAll(S2V.samples));
  const input = document.getElementById('files');
  input.addEventListener('change', () => {
    runFiles(Array.from(input.files));
    input.value = '';
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    runFiles(Array.from(e.dataTransfer.files));
  });

  window.S2VTest = { runAll, runOne, runFiles, results, runSamples: () => runAll(S2V.samples) };
})();
