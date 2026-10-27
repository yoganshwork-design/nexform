// Progress: weight history (server) + photos (device-local per user) + compare slider.
(function () {
  const P = {};
  const photoKey = () => `nexform_photos_${State.user?.id || 'anon'}`;

  function loadPhotos() { try { return JSON.parse(localStorage.getItem(photoKey()) || '[]'); } catch { return []; } }
  function savePhotos(list) { try { localStorage.setItem(photoKey(), JSON.stringify(list)); } catch (e) { UI.toast('Photo storage full', 'err'); } }

  async function saveWeight(entry) {
    return Api.requestJson(`${Api.API}?action=weight-save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
  }

  P.renderWeight = function () {
    const el = document.getElementById('weight-history');
    if (!el) return;
    if (!State.weightHistory.length) { el.innerHTML = `<div class="empty">No weight entries yet.</div>`; return; }
    const sorted = [...State.weightHistory].sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = sorted.slice(0, 30).map(w => `
      <div class="log-row">
        <div class="grow"><div class="nm">${new Date(w.date).toLocaleDateString()}</div>
        <div class="meta">${w.body_fat_pct ? 'BF ' + w.body_fat_pct + '%' : ''}</div></div>
        <div class="kcal">${(+w.weight_kg).toFixed(1)} kg</div>
      </div>`).join('');
  };

  P.renderPhotos = function () {
    const photos = loadPhotos();
    const gal = document.getElementById('photo-gallery');
    const selA = document.getElementById('comp-a');
    const selB = document.getElementById('comp-b');
    if (gal) {
      gal.innerHTML = photos.length
        ? photos.map((p, i) => `<div class="card" style="padding:8px;"><img src="${p.data}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;" alt="${UI.escape(p.tag)}"><div class="row between" style="margin-top:6px;"><span class="pill-badge">${UI.escape(p.tag)}</span><button class="icon-btn" data-rm="${p.id}"><i data-lucide="trash-2"></i></button></div></div>`).join('')
        : `<div class="empty" style="grid-column:1/-1;">Upload photos to compare your progress.</div>`;
      gal.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
        savePhotos(loadPhotos().filter(x => x.id !== b.dataset.rm)); P.renderPhotos();
      });
      UI.icons();
    }
    const opts = `<option value="">— none —</option>` + photos.map(p => `<option value="${p.id}">${new Date(p.date).toLocaleDateString()} · ${UI.escape(p.tag)}</option>`).join('');
    if (selA) selA.innerHTML = opts;
    if (selB) selB.innerHTML = opts;
    if (selB && photos.length > 1) { selA.value = photos[0].id; selB.value = photos[photos.length - 1].id; updateCompare(); }
  };

  function updateCompare() {
    const photos = loadPhotos();
    const a = photos.find(p => p.id === document.getElementById('comp-a')?.value);
    const b = photos.find(p => p.id === document.getElementById('comp-b')?.value);
    const imgA = document.getElementById('comp-img-a'), imgB = document.getElementById('comp-img-b');
    if (imgA) imgA.src = a?.data || '';
    if (imgB) imgB.src = b?.data || '';
  }

  function initCompare() {
    const wrap = document.getElementById('compare');
    const handle = document.getElementById('comp-handle');
    const afterWrap = document.getElementById('comp-after-wrap');
    if (!wrap) return;
    let dragging = false;
    const setPos = (clientX) => {
      const r = wrap.getBoundingClientRect();
      let pct = ((clientX - r.left) / r.width) * 100;
      pct = Math.max(0, Math.min(100, pct));
      handle.style.left = pct + '%';
      afterWrap.style.width = pct + '%';
    };
    const start = e => { dragging = true; setPos(e.touches ? e.touches[0].clientX : e.clientX); };
    const move = e => { if (dragging) setPos(e.touches ? e.touches[0].clientX : e.clientX); };
    const end = () => dragging = false;
    wrap.addEventListener('mousedown', start); wrap.addEventListener('touchstart', start, { passive: true });
    addEventListener('mousemove', move); addEventListener('touchmove', move, { passive: true });
    addEventListener('mouseup', end); addEventListener('touchend', end);
    document.getElementById('comp-a')?.addEventListener('change', updateCompare);
    document.getElementById('comp-b')?.addEventListener('change', updateCompare);
  }

  P.refresh = function () { P.renderWeight(); P.renderPhotos(); updateCompare(); };

  P.init = function () {
    initCompare();
    const dateEl = document.getElementById('w-date');
    if (dateEl) dateEl.value = State.today;
    document.getElementById('btn-save-weight')?.addEventListener('click', async () => {
      const date = document.getElementById('w-date').value || State.today;
      const weight = parseFloat(document.getElementById('w-val').value);
      const bf = parseFloat(document.getElementById('w-bf').value);
      if (!weight) { UI.toast('Enter a weight', 'err'); return; }
      try {
        await saveWeight({ date, weight_kg: weight, body_fat_pct: Number.isFinite(bf) ? bf : null });
        await window.App.reloadMeta();
        await window.App.refineTargets(true);
        UI.toast('Weight saved — targets updated', 'ok');
      } catch (e) { UI.toast(e.message, 'err'); }
    });

    const fileInput = document.getElementById('photo-file');
    document.getElementById('btn-photo')?.addEventListener('click', () => fileInput.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        // downscale to keep localStorage small
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          const scale = Math.min(1, 700 / Math.max(img.width, img.height));
          c.width = img.width * scale; c.height = img.height * scale;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const data = c.toDataURL('image/jpeg', 0.72);
          const photos = loadPhotos();
          photos.push({ id: 'p' + Date.now(), date: State.today, tag: document.getElementById('photo-tag').value, data });
          savePhotos(photos); P.renderPhotos(); updateCompare(); UI.toast('Photo added', 'ok');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    });

    P.refresh();
  };

  window.Progress = P;
})();
