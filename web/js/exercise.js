// Training: editable split, AI burn estimates, set logging, rest timer, cardio.
(function () {
  const E = {};
  let currentDay = 'd1';
  let timerId = null, timerLeft = 0, timerTotal = 90;
  let activeEx = null;

  function split() { return State.split || Data.DEFAULT_SPLIT; }

  function saveSplit() {
    return Api.requestJson(`${Api.API}?action=split-save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ split: State.split }),
    });
  }
  function logWorkout(w) {
    return Api.requestJson(`${Api.API}?action=exercise-log`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(w),
    });
  }
  function deleteWorkout(id) {
    return Api.requestJson(`${Api.API}?action=exercise-delete`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  }

  /* ---------- Split rendering ---------- */
  function renderDayTabs() {
    const el = document.getElementById('day-tabs');
    if (!el) return;
    el.innerHTML = Data.DAY_ORDER.map(d => {
      const day = split()[d]; if (!day) return '';
      const label = day.title.replace(/^Day \d+\s*[—-]\s*/, '');
      return `<button class="cat-chip ${d === currentDay ? 'active' : ''}" data-day="${d}">${UI.escape(label)}</button>`;
    }).join('');
    el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { currentDay = b.dataset.day; renderDayTabs(); renderExercises(); });
  }

  function renderExercises() {
    const day = split()[currentDay]; if (!day) return;
    document.getElementById('split-title').textContent = day.title;
    document.getElementById('split-note').textContent = day.note || '';
    const list = document.getElementById('split-list');
    list.innerHTML = day.exercises.map((ex, i) => `
      <div class="ex-row">
        <div class="ex-index">${i + 1}</div>
        <div class="ex-body">
          <div class="ex-name">${UI.escape(ex.name)}
            <a class="yt-link" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(ex.yt || ex.name)}"><i data-lucide="play"></i> Video</a>
          </div>
          <div class="ex-meta">Target: ${UI.escape(ex.target || '—')} · Rest: ${UI.escape(ex.rest || '90s')}</div>
        </div>
        <div class="ex-actions">
          <button class="btn btn-aqua btn-sm" data-log="${i}"><i data-lucide="plus-circle"></i> Log set</button>
          <button class="icon-btn" data-edit="${i}" title="Replace"><i data-lucide="pencil"></i></button>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-log]').forEach(b => b.onclick = () => openSetModal(day.exercises[+b.dataset.log]));
    list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openExerciseModal(+b.dataset.edit));
    UI.icons();
    UI.observeReveals();
  }

  /* ---------- Add / replace exercise ---------- */
  function openExerciseModal(index) {
    activeEx = index;
    const day = split()[currentDay];
    const sel = document.getElementById('me-replace');
    sel.innerHTML = `<option value="-1">— Add as new —</option>` +
      day.exercises.map((ex, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${UI.escape(ex.name)}</option>`).join('');
    if (index != null && day.exercises[index]) {
      const ex = day.exercises[index];
      document.getElementById('me-name').value = ex.name;
      document.getElementById('me-target').value = ex.target || '';
      document.getElementById('me-rest').value = ex.rest || '';
      document.getElementById('me-title').textContent = 'Replace exercise';
    } else {
      document.getElementById('me-name').value = '';
      document.getElementById('me-target').value = '3 × 10 reps';
      document.getElementById('me-rest').value = '90s';
      document.getElementById('me-title').textContent = 'Add exercise';
    }
    UI.openModal('modal-exercise');
  }

  async function confirmExercise() {
    const name = document.getElementById('me-name').value.trim();
    if (!name) { UI.toast('Enter an exercise name', 'err'); return; }
    const target = document.getElementById('me-target').value.trim() || '3 × 10';
    const rest = document.getElementById('me-rest').value.trim() || '90s';
    const replaceIdx = parseInt(document.getElementById('me-replace').value);
    const ex = { name, target, rest, yt: name.toLowerCase().replace(/[^a-z0-9]+/g, '+') };
    const day = split()[currentDay];
    if (replaceIdx >= 0) day.exercises[replaceIdx] = ex; else day.exercises.push(ex);
    State.split = split();
    try { await saveSplit(); renderExercises(); UI.closeModal('modal-exercise'); UI.toast('Split updated', 'ok'); }
    catch (e) { UI.toast(e.message, 'err'); }
  }

  /* ---------- Set logging with AI burn ---------- */
  function openSetModal(ex) {
    activeEx = ex;
    document.getElementById('ms-title').textContent = ex.name;
    document.getElementById('ms-status').textContent = '';
    UI.openModal('modal-set');
  }

  async function confirmSet() {
    if (!activeEx) return;
    const sets = +document.getElementById('ms-sets').value || 3;
    const reps = +document.getElementById('ms-reps').value || 8;
    const weight = +document.getElementById('ms-weight').value || 0;
    const rest = +document.getElementById('ms-rest').value || 90;
    const btn = document.getElementById('ms-confirm');
    const status = document.getElementById('ms-status');
    btn.disabled = true;
    status.innerHTML = `<span class="spinner" style="display:inline-block;vertical-align:-3px;"></span> Estimating burn from your body data…`;
    try {
      const r = await AI.estimateLiftBurn({ exercise: activeEx.name, sets, reps, weightKg: weight, restSec: rest });
      await logWorkout({ name: activeEx.name, kind: 'lift', sets, reps, weight_kg: weight, calories_burned: Math.round(r.caloriesBurned), detail: { met: r.met, note: r.note } });
      await window.App.reloadToday();
      UI.closeModal('modal-set');
      startRestTimer(rest);
      UI.toast(`${activeEx.name} · ${Math.round(r.caloriesBurned)} kcal`, 'ok');
    } catch (e) { status.textContent = ''; UI.toast(e.message, 'err'); }
    finally { btn.disabled = false; }
  }

  /* ---------- Rest timer ---------- */
  function startRestTimer(sec) {
    clearInterval(timerId);
    timerLeft = timerTotal = sec;
    const slot = document.getElementById('rest-timer-slot');
    slot.classList.remove('hidden');
    updateTimerUI();
    timerId = setInterval(() => {
      timerLeft--;
      updateTimerUI();
      if (timerLeft <= 0) { clearInterval(timerId); UI.beep(880, 0.4); document.getElementById('rest-num').textContent = 'Go!'; }
    }, 1000);
  }
  function updateTimerUI() {
    const num = document.getElementById('rest-num');
    const ring = document.getElementById('rest-ring-val');
    if (num) num.textContent = timerLeft;
    if (ring) {
      const r = 34, C = 2 * Math.PI * r;
      ring.style.strokeDasharray = `${C} ${C}`;
      ring.style.strokeDashoffset = C - (timerLeft / timerTotal) * C;
    }
  }
  function stopRestTimer() { clearInterval(timerId); document.getElementById('rest-timer-slot').classList.add('hidden'); }

  /* ---------- Logged workouts ---------- */
  E.renderLogged = function () {
    const el = document.getElementById('logged-workouts');
    if (!el) return;
    const tot = State.workouts.reduce((s, w) => s + (+w.calories_burned || 0), 0);
    const tag = document.getElementById('burn-total-tag');
    if (tag) tag.textContent = `${Math.round(tot)} kcal`;
    if (!State.workouts.length) { el.innerHTML = `<div class="empty">No sessions logged yet today.</div>`; return; }
    el.innerHTML = State.workouts.map(w => `
      <div class="log-row">
        <div class="grow">
          <div class="nm">${UI.escape(w.name)}</div>
          <div class="meta">${w.kind === 'lift' ? `${w.sets} × ${w.reps} @ ${w.weight_kg}kg` : `${w.duration_mins} min`} ${w.detail?.note ? '· ' + UI.escape(w.detail.note) : ''}</div>
        </div>
        <div class="kcal burn">−${Math.round(w.calories_burned)} kcal</div>
        <button class="icon-btn" data-del="${w.id}"><i data-lucide="trash-2"></i></button>
      </div>`).join('');
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      try { await deleteWorkout(b.dataset.del); State.workouts = State.workouts.filter(x => x.id !== b.dataset.del); E.renderLogged(); State.renderHUD(); }
      catch (e) { UI.toast(e.message, 'err'); }
    });
    UI.icons();
  };

  E.init = function () {
    renderDayTabs(); renderExercises();
    document.getElementById('btn-add-exercise')?.addEventListener('click', () => openExerciseModal(null));
    document.getElementById('me-confirm')?.addEventListener('click', confirmExercise);
    document.getElementById('ms-confirm')?.addEventListener('click', confirmSet);
    document.getElementById('btn-rest-stop')?.addEventListener('click', stopRestTimer);

    const cardioBtn = document.getElementById('btn-log-cardio');
    cardioBtn?.addEventListener('click', async () => {
      const name = document.getElementById('cardio-name').value.trim();
      const mins = +document.getElementById('cardio-mins').value || 0;
      const intensity = document.getElementById('cardio-intensity').value;
      const status = document.getElementById('cardio-status');
      if (!name || !mins) { UI.toast('Enter an activity and duration', 'err'); return; }
      cardioBtn.disabled = true;
      status.innerHTML = `<span class="spinner" style="display:inline-block;vertical-align:-3px;"></span> Estimating burn…`;
      try {
        const r = await AI.estimateCardioBurn({ activity: name, minutes: mins, intensity });
        await logWorkout({ name, kind: 'cardio', duration_mins: mins, calories_burned: Math.round(r.caloriesBurned), detail: { met: r.met, intensity, note: r.note } });
        await window.App.reloadToday();
        status.textContent = '';
        document.getElementById('cardio-name').value = '';
        UI.toast(`${name} · ${Math.round(r.caloriesBurned)} kcal`, 'ok');
      } catch (e) { status.textContent = ''; UI.toast(e.message, 'err'); }
      finally { cardioBtn.disabled = false; }
    });

    E.renderLogged();
  };

  E.rerender = function () { renderDayTabs(); renderExercises(); };
  window.Exercise = E;
})();
