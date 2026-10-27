// UI layer: magnetic cursor, scroll reveal, toasts, modals, navigation, icon refresh, sound.
(function () {
  const UI = {};

  UI.icons = function () { if (window.lucide) window.lucide.createIcons(); };

  UI.escape = function (str) {
    return String(str ?? '').replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t]));
  };

  /* ---- Magnetic cursor ---- */
  function initCursor() {
    const ring = document.getElementById('magnet-cursor');
    const dot = document.getElementById('cursor-dot');
    if (!ring || window.matchMedia('(pointer: coarse)').matches) return;
    let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
    addEventListener('mousemove', e => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
      const hot = e.target.closest('a, button, .food-card, .card, .ex-row, input, select, textarea, .log-row, .nav-pill, .cat-chip');
      ring.classList.toggle('is-hot', !!hot);
    });
    addEventListener('mousedown', () => ring.classList.add('is-down'));
    addEventListener('mouseup', () => ring.classList.remove('is-down'));
    (function loop() {
      rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
      requestAnimationFrame(loop);
    })();
  }

  /* ---- Scroll reveal ---- */
  function initReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    UI.observeReveals = function (root = document) {
      root.querySelectorAll('.reveal:not(.in)').forEach(el => io.observe(el));
    };
    UI.observeReveals();
  }

  /* ---- Toasts ---- */
  UI.toast = function (msg, kind = '') {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = (kind === 'ok' ? '<span>✓</span> ' : kind === 'err' ? '<span>!</span> ' : '') + UI.escape(msg);
    stack.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s, transform .4s'; el.style.opacity = '0'; el.style.transform = 'translateY(16px)'; }, 2600);
    setTimeout(() => el.remove(), 3100);
  };

  /* ---- Modals ---- */
  UI.openModal = function (id) { const m = document.getElementById(id); if (m) { m.classList.add('open'); UI.icons(); } };
  UI.closeModal = function (id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); };
  function initModals() {
    document.addEventListener('click', e => {
      const closer = e.target.closest('[data-close]');
      if (closer) UI.closeModal(closer.dataset.close);
      if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
    });
    addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    });
  }

  /* ---- Sound synth (subtle) ---- */
  let audioCtx = null, soundOn = false;
  UI.setSound = function (on) { soundOn = on; };
  UI.beep = function (freq = 660, dur = 0.12) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  };

  /* ---- Navigation between tabs ---- */
  UI.goto = function (tabId, scrollTarget) {
    document.querySelectorAll('.nav-pill').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
    if (tabId === 'analytics-tab' && window.Analytics) window.Analytics.render();
    if (tabId === 'progress-tab' && window.Progress) window.Progress.refresh();
    UI.observeReveals();
    if (scrollTarget) {
      const el = document.getElementById(scrollTarget);
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    UI.beep(520, 0.06);
  };

  function initNav() {
    document.querySelectorAll('.nav-pill').forEach(b => b.addEventListener('click', () => UI.goto(b.dataset.tab)));
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-goto]');
      if (g) UI.goto(g.dataset.goto, g.dataset.scroll);
    });
  }

  /* ---- Magnetic buttons ---- */
  function initMagnetic() {
    document.addEventListener('mousemove', e => {
      const btn = e.target.closest('.btn-volt, .btn-aqua, .brand-mark');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      btn.style.transform = `translate(${x * 0.16}px, ${y * 0.22 - 3}px)`;
    });
    document.addEventListener('mouseout', e => {
      const btn = e.target.closest('.btn-volt, .btn-aqua, .brand-mark');
      if (btn) btn.style.transform = '';
    });
  }

  UI.init = function () {
    initCursor(); initReveal(); initModals(); initNav(); initMagnetic();
  };

  window.UI = UI;
})();
