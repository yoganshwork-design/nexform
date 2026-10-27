// Nutrition: catalog, AI meal description, food-link analysis, logging.
(function () {
  const N = {};
  let activeCat = 'All', searchTerm = '', portionFood = null;

  function saveMeal(meal) {
    return Api.requestJson(`${Api.API}?action=food-log`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(meal),
    });
  }
  function deleteMeal(id) {
    return Api.requestJson(`${Api.API}?action=food-delete`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  }

  /* ---------- Catalog ---------- */
  function renderCats() {
    const cats = ['All', 'Breakfast', 'Lunch', 'Office', 'Snack', 'Dinner'];
    const el = document.getElementById('food-cats');
    if (!el) return;
    el.innerHTML = cats.map(c => `<button class="cat-chip ${c === activeCat ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('');
    el.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { activeCat = b.dataset.cat; renderCats(); renderGrid(); });
  }

  function renderGrid() {
    const grid = document.getElementById('food-grid');
    if (!grid) return;
    const list = Data.FOODS.filter(f =>
      (activeCat === 'All' || f.cat === activeCat) &&
      f.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (!list.length) { grid.innerHTML = `<div class="empty">No dishes match. Try the AI meal describer above.</div>`; return; }
    grid.innerHTML = list.map((f, i) => `
      <div class="card food-card" data-food="${UI.escape(f.name)}">
        <div class="food-emoji">${f.emoji}</div>
        <div class="food-name">${UI.escape(f.name)}</div>
        <div class="food-macros"><span><b>${f.cal}</b> kcal</span><span><b>${f.p}g</b> P</span><span><b>${f.c}g</b> C</span><span><b>${f.f}g</b> F</span></div>
        <div class="row" style="margin-top:auto;justify-content:space-between;">
          <span class="pill-badge">${f.cat}</span>
          <button class="btn btn-aqua btn-sm">Add</button>
        </div>
      </div>`).join('');
    grid.querySelectorAll('.food-card').forEach(card => {
      card.onclick = () => {
        const food = Data.FOODS.find(x => x.name === card.dataset.food);
        openPortion(food);
      };
    });
    UI.icons();
  }

  /* ---------- Portion modal ---------- */
  function openPortion(food) {
    if (!food) return;
    portionFood = food;
    document.getElementById('mp-title').textContent = food.name;
    document.getElementById('mp-desc').textContent = `${food.cat} · per regular serving`;
    document.getElementById('mp-portion').value = '1';
    updatePortionPreview();
    UI.openModal('modal-portion');
  }
  function updatePortionPreview() {
    const m = parseFloat(document.getElementById('mp-portion').value);
    const box = document.getElementById('mp-preview');
    if (!portionFood || !box) return;
    box.innerHTML = `
      <div class="macro-line">
        <div>${Math.round(portionFood.cal * m)}<span>kcal</span></div>
        <div>${Math.round(portionFood.p * m)}g<span>protein</span></div>
        <div>${Math.round(portionFood.c * m)}g<span>carbs</span></div>
        <div>${Math.round(portionFood.f * m)}g<span>fat</span></div>
      </div>`;
  }

  /* ---------- Logged meals ---------- */
  N.renderLogged = function () {
    const el = document.getElementById('logged-meals');
    if (!el) return;
    const tag = document.getElementById('meal-count-tag');
    if (tag) tag.textContent = State.foods.length;
    if (!State.foods.length) { el.innerHTML = `<div class="empty">Nothing logged yet today. Add a meal above.</div>`; return; }
    el.innerHTML = State.foods.map(f => `
      <div class="log-row">
        <div class="grow">
          <div class="nm">${UI.escape(f.name)}</div>
          <div class="meta">${UI.escape(f.category || '')} · P ${Math.round(f.protein || 0)}g · C ${Math.round(f.carbs || 0)}g · F ${Math.round(f.fat || 0)}g ${f.source ? '· ' + UI.escape(f.source) : ''}</div>
        </div>
        <div class="kcal">${Math.round(f.calories || 0)} kcal</div>
        <button class="icon-btn" data-del="${f.id}" title="Remove"><i data-lucide="trash-2"></i></button>
      </div>`).join('');
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      try { await deleteMeal(b.dataset.del); State.foods = State.foods.filter(x => x.id !== b.dataset.del); N.renderLogged(); State.renderHUD(); UI.toast('Removed', 'ok'); }
      catch (e) { UI.toast(e.message, 'err'); }
    });
    UI.icons();
  };

  /* ---------- AI meal description ---------- */
  function renderAIResult(boxId, r, onLog) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.innerHTML = `
      <div class="ai-result">
        <div class="kbd" style="font-size:1.05rem;">${UI.escape(r.name)}</div>
        <div class="macro-line">
          <div>${Math.round(r.calories)}<span>kcal</span></div>
          <div>${Math.round(r.protein)}g<span>protein</span></div>
          <div>${Math.round(r.carbs)}g<span>carbs</span></div>
          <div>${Math.round(r.fat)}g<span>fat</span></div>
        </div>
        ${r.note ? `<p class="small muted" style="margin:0 0 12px;">${UI.escape(r.note)}</p>` : ''}
        <button class="btn btn-volt btn-sm ai-log-btn"><i data-lucide="plus"></i> Log this</button>
      </div>`;
    box.querySelector('.ai-log-btn').onclick = async (e) => {
      e.target.disabled = true;
      await onLog(r);
    };
    UI.icons();
  }

  function bindAI() {
    const foodBtn = document.getElementById('btn-ai-food');
    const foodStatus = document.getElementById('ai-food-status');
    foodBtn?.addEventListener('click', async () => {
      const text = document.getElementById('ai-food-text').value.trim();
      if (!text) { UI.toast('Describe what you ate first', 'err'); return; }
      const cat = document.getElementById('ai-food-cat').value;
      foodBtn.disabled = true;
      foodStatus.innerHTML = `<span class="spinner" style="display:inline-block;vertical-align:-3px;"></span> Nex is analyzing your meal…`;
      try {
        const r = await AI.analyzeFood(text, cat);
        foodStatus.textContent = '';
        renderAIResult('ai-food-result', r, async (res) => {
          await saveMeal({ name: res.name, category: cat, calories: res.calories, protein: res.protein, carbs: res.carbs, fat: res.fat, portion: 1, source: 'AI described' });
          await window.App.reloadToday();
          UI.toast('Logged ' + res.name, 'ok');
          document.getElementById('ai-food-text').value = '';
        });
      } catch (e) {
        foodStatus.textContent = '';
        UI.toast(e.message, 'err');
      } finally { foodBtn.disabled = false; }
    });

    const urlBtn = document.getElementById('btn-ai-url');
    const urlStatus = document.getElementById('ai-url-status');
    urlBtn?.addEventListener('click', async () => {
      const val = document.getElementById('ai-url-text').value.trim();
      if (!val) { UI.toast('Paste a link or dish name', 'err'); return; }
      urlBtn.disabled = true;
      urlStatus.innerHTML = `<span class="spinner" style="display:inline-block;vertical-align:-3px;"></span> Reading the link…`;
      try {
        const r = await AI.analyzeUrl(val);
        urlStatus.textContent = '';
        renderAIResult('ai-url-result', r, async (res) => {
          await saveMeal({ name: res.name, category: 'Snack', calories: res.calories, protein: res.protein, carbs: res.carbs, fat: res.fat, portion: 1, source: 'AI link' });
          await window.App.reloadToday();
          UI.toast('Logged ' + res.name, 'ok');
          document.getElementById('ai-url-text').value = '';
        });
      } catch (e) {
        urlStatus.textContent = '';
        UI.toast(e.message, 'err');
      } finally { urlBtn.disabled = false; }
    });
  }

  N.init = function () {
    renderCats(); renderGrid(); bindAI();
    const search = document.getElementById('food-search');
    if (search) search.oninput = () => { searchTerm = search.value; renderGrid(); };
    document.getElementById('mp-portion')?.addEventListener('change', updatePortionPreview);
    document.getElementById('mp-confirm')?.addEventListener('click', async () => {
      if (!portionFood) return;
      const m = parseFloat(document.getElementById('mp-portion').value);
      const btn = document.getElementById('mp-confirm'); btn.disabled = true;
      try {
        await saveMeal({ name: portionFood.name, category: portionFood.cat, calories: Math.round(portionFood.cal * m), protein: Math.round(portionFood.p * m), carbs: Math.round(portionFood.c * m), fat: Math.round(portionFood.f * m), portion: m, source: 'Catalog' });
        await window.App.reloadToday();
        UI.closeModal('modal-portion');
        UI.toast('Added to today', 'ok');
      } catch (e) { UI.toast(e.message, 'err'); }
      finally { btn.disabled = false; }
    });
    N.renderLogged();
  };

  window.Nutrition = N;
})();
