/* UI wiring for index.html */
(function () {
  'use strict';
  const S2V = window.S2V;
  const $ = (id) => document.getElementById(id);
  const els = {
    input: $('svgInput'),
    paste: $('btnPaste'),
    file: $('fileInput'),
    clear: $('btnClear'),
    svgImg: $('svgImg'),
    svgEmpty: $('svgEmpty'),
    svgMeta: $('svgMeta'),
    svgSize: $('svgSize'),
    vdImg: $('vdImg'),
    vdEmpty: $('vdEmpty'),
    diffCanvas: $('diffCanvas'),
    diffToggle: $('diffToggle'),
    match: $('matchBadge'),
    xmlCode: $('xmlCode'),
    copy: $('btnCopy'),
    copyHeader: $('btnCopyHeader'),
    download: $('btnDownload'),
    warnings: $('warnings'),
    bgSeg: $('bgSeg'),
    drop: $('dropOverlay'),
    toast: $('toast'),
  };

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('s2v:' + k);
        return v == null ? d : v;
      } catch (e) {
        return d;
      }
    },
    remove(k) {
      try {
        localStorage.removeItem('s2v:' + k);
      } catch (e) {
        /* storage unavailable */
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('s2v:' + k, v);
      } catch (e) {
        /* storage unavailable */
      }
    },
  };

  const state = { result: null, token: 0, fileName: 'ic_vector' };

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  let toastTimer = 0;
  function toast(msg, kind) {
    els.toast.textContent = msg;
    els.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.className = 'toast'), 2600);
  }

  const debounce = (fn, ms) => {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  const fmtNum = (v) => (Math.round(v * 100) / 100).toString();

  function setImg(img, svg) {
    if (img._url) URL.revokeObjectURL(img._url);
    img._url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.src = img._url;
    img.hidden = false;
  }

  function clearImg(img) {
    if (img._url) URL.revokeObjectURL(img._url);
    img._url = null;
    img.removeAttribute('src');
    img.hidden = true;
  }

  function highlightXml(xml) {
    const esc = xml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (esc.length > 400000) return esc;
    return esc.replace(/(&lt;\/?)([\w:.-]+)|([\w:.-]+)(=)("[^"]*")|(\/?&gt;)/g, (m, lt, tag, an, eq, av, gt) => {
      if (tag) return `<span class="p">${lt}</span><span class="t">${tag}</span>`;
      if (an) return `<span class="a">${an}</span><span class="p">=</span><span class="v">${av}</span>`;
      return `<span class="p">${gt}</span>`;
    });
  }

  function resourceName(name) {
    let s = String(name || '')
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!s) s = 'ic_vector';
    if (!/^[a-z]/.test(s)) s = 'ic_' + s;
    return s;
  }

  const hasSvg = (text) => /<svg[\s>/]/i.test(text || '');

  // ---------------------------------------------------------------------------
  // conversion
  // ---------------------------------------------------------------------------
  function resetOutput() {
    state.result = null;
    clearImg(els.svgImg);
    clearImg(els.vdImg);
    els.diffCanvas.hidden = true;
    els.svgEmpty.hidden = false;
    els.svgEmpty.className = 'empty';
    els.svgEmpty.textContent = 'Dán SVG (Ctrl+V) hoặc kéo thả file .svg vào trang';
    els.vdEmpty.hidden = false;
    els.vdEmpty.className = 'empty';
    els.vdEmpty.textContent = 'Kết quả Vector Drawable sẽ hiển thị ở đây';
    els.svgMeta.textContent = '';
    els.match.hidden = true;
    els.xmlCode.textContent = '';
    els.warnings.hidden = true;
    els.copy.disabled = els.copyHeader.disabled = els.download.disabled = true;
  }

  function showError(message) {
    clearImg(els.vdImg);
    els.diffCanvas.hidden = true;
    els.vdEmpty.hidden = false;
    els.vdEmpty.className = 'empty error';
    els.vdEmpty.textContent = message;
    els.match.hidden = true;
    els.xmlCode.textContent = '';
    els.warnings.hidden = false;
    els.warnings.className = 'warnings error';
    els.warnings.textContent = message;
    els.copy.disabled = els.copyHeader.disabled = els.download.disabled = true;
  }

  function renderWarnings(list) {
    if (!list || !list.length) {
      els.warnings.hidden = true;
      return;
    }
    els.warnings.hidden = false;
    els.warnings.className = 'warnings';
    els.warnings.innerHTML = '';
    const title = document.createElement('strong');
    title.textContent = `⚠ ${list.length} lưu ý khi chuyển đổi`;
    const ul = document.createElement('ul');
    for (const w of list) {
      const li = document.createElement('li');
      li.textContent = w.message + (w.count > 1 ? ` (×${w.count})` : '');
      ul.appendChild(li);
    }
    els.warnings.append(title, ul);
  }

  function updateDiffVisibility() {
    const showDiff = els.diffToggle.checked && state.diffReady;
    els.diffCanvas.hidden = !showDiff;
    els.vdImg.hidden = showDiff || !els.vdImg._url;
  }

  function run() {
    const text = els.input.value;
    els.svgSize.textContent = text.trim() ? formatBytes(new Blob([text]).size) : '';
    const token = ++state.token;
    state.diffReady = false;
    if (!text.trim()) {
      resetOutput();
      return;
    }

    const res = S2V.convert(text);
    state.result = res;

    if (res.previewSvg) {
      setImg(els.svgImg, res.previewSvg);
      els.svgEmpty.hidden = true;
    } else {
      clearImg(els.svgImg);
      els.svgEmpty.hidden = false;
      els.svgEmpty.className = 'empty error';
      els.svgEmpty.textContent = res.error || 'Không đọc được SVG';
    }
    if (res.error) {
      els.svgMeta.textContent = '';
      showError(res.error);
      return;
    }

    els.svgMeta.textContent = `${fmtNum(res.svgWidth)} × ${fmtNum(res.svgHeight)} px`;
    els.xmlCode.innerHTML = highlightXml(res.xml);
    renderWarnings(res.warnings);
    els.copy.disabled = els.copyHeader.disabled = els.download.disabled = false;

    let vd;
    try {
      vd = S2V.vectorToSvg(res.xml);
    } catch (e) {
      showError('Không hiển thị được Vector: ' + e.message);
      return;
    }
    setImg(els.vdImg, vd.svg);
    els.vdEmpty.hidden = true;
    updateDiffVisibility();

    els.match.hidden = false;
    els.match.className = 'badge muted';
    els.match.textContent = 'Đang so sánh…';
    els.match.title = '';
    S2V.compare
      .compareSvgs(res.previewSvg, vd.svg, res.svgWidth, res.svgHeight, 360)
      .then((cmp) => {
        if (token !== state.token) return;
        const pct = cmp.similarity * 100;
        els.match.textContent = `Khớp ${pct >= 99.95 ? '100' : pct.toFixed(1)}%`;
        els.match.className = 'badge ' + (pct >= 99 ? '' : pct >= 95 ? 'warn' : 'bad');
        els.match.title = `So sánh điểm ảnh với SVG gốc ở ${cmp.width}×${cmp.height}px: ${cmp.badPixels} / ${cmp.coveredPixels} điểm ảnh khác biệt`;
        els.diffCanvas.width = cmp.width;
        els.diffCanvas.height = cmp.height;
        els.diffCanvas.getContext('2d').putImageData(cmp.diff, 0, 0);
        state.diffReady = true;
        updateDiffVisibility();
      })
      .catch(() => {
        if (token === state.token) els.match.hidden = true;
      });
  }

  const runDebounced = debounce(run, 280);

  function setInput(text, fileName) {
    els.input.value = text;
    if (fileName) {
      state.fileName = fileName;
    }
    els.input.scrollTop = 0;
    run();
  }

  // ---------------------------------------------------------------------------
  // clipboard
  // ---------------------------------------------------------------------------
  async function pasteFromClipboard() {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      /* may be blocked; try the richer API below */
    }
    if (!hasSvg(text) && navigator.clipboard && navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        outer: for (const item of items) {
          for (const type of ['image/svg+xml', 'text/plain', 'text/html']) {
            if (!item.types.includes(type)) continue;
            const t = await (await item.getType(type)).text();
            if (hasSvg(t)) {
              text = t;
              break outer;
            }
          }
        }
      } catch (e) {
        /* ignore */
      }
    }
    if (hasSvg(text)) {
      setInput(text, 'ic_vector');
      toast('Đã dán SVG từ bộ nhớ tạm');
    } else if (text) {
      toast('Bộ nhớ tạm không chứa mã SVG', 'error');
    } else {
      toast('Trình duyệt chặn đọc bộ nhớ tạm — hãy nhấn Ctrl+V trên trang', 'error');
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast('File quá lớn (> 20 MB)', 'error');
      return;
    }
    file.text().then((text) => {
      if (!hasSvg(text)) {
        toast('File không chứa SVG hợp lệ', 'error');
        return;
      }
      setInput(text, file.name);
      toast('Đã mở ' + file.name);
    });
  }

  // ---------------------------------------------------------------------------
  // events
  // ---------------------------------------------------------------------------
  els.input.addEventListener('input', runDebounced);
  els.paste.addEventListener('click', pasteFromClipboard);
  els.file.addEventListener('change', () => {
    readFile(els.file.files[0]);
    els.file.value = '';
  });
  els.clear.addEventListener('click', () => {
    els.input.value = '';
    run();
    els.input.focus();
  });

  const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>\n';
  els.copyHeader.addEventListener('click', async () => {
    if (!state.result || !state.result.xml) return;
    const ok = await copyText(XML_HEADER + state.result.xml);
    toast(ok ? 'Đã sao chép mã Vector Drawable kèm <?xml?>' : 'Không sao chép được', ok ? '' : 'error');
  });

  els.copy.addEventListener('click', async () => {
    if (!state.result || !state.result.xml) return;
    const ok = await copyText(state.result.xml);
    toast(ok ? 'Đã sao chép mã Vector Drawable' : 'Không sao chép được', ok ? '' : 'error');
  });

  els.download.addEventListener('click', () => {
    if (!state.result || !state.result.xml) return;
    const blob = new Blob([state.result.xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = resourceName(state.fileName) + '.xml';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  els.diffToggle.addEventListener('change', updateDiffVisibility);

  function setBg(bg) {
    for (const stage of document.querySelectorAll('.stage')) {
      stage.classList.remove('checker', 'light', 'dark');
      stage.classList.add(bg);
    }
    for (const b of els.bgSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.bg === bg);
    store.set('bg', bg);
  }
  els.bgSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-bg]');
    if (b) setBg(b.dataset.bg);
  });

  // Ctrl+V anywhere on the page (outside the editor) pastes SVG
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t === els.input || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const file = Array.from(dt.files || []).find((f) => /svg/i.test(f.type) || /\.svg$/i.test(f.name));
    if (file) {
      e.preventDefault();
      readFile(file);
      return;
    }
    let text = dt.getData('image/svg+xml') || dt.getData('text/plain');
    if (!hasSvg(text) && hasSvg(dt.getData('text/html'))) text = dt.getData('text/html');
    if (hasSvg(text)) {
      e.preventDefault();
      setInput(text, 'ic_vector');
      toast('Đã dán SVG từ bộ nhớ tạm');
    } else {
      toast('Bộ nhớ tạm không chứa mã SVG', 'error');
    }
  });

  // drag & drop
  let dragDepth = 0;
  const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth++;
    els.drop.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.drop.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (isFileDrag(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.drop.hidden = true;
    readFile(e.dataTransfer.files[0]);
  });

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------
  setBg(store.get('bg', 'checker'));
  store.remove('precision');
  // Every visit starts clean: never restore SVG/vector from a previous session.
  store.remove('svg');
  store.remove('fileName');
  function startFresh() {
    state.token++;
    state.fileName = 'ic_vector';
    els.input.value = '';
    els.svgSize.textContent = '';
    resetOutput();
  }
  startFresh();
  // Also clear when the page is restored from the back/forward cache
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) startFresh();
  });
})();
