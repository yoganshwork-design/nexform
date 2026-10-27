// App orchestrator: auth, onboarding, bootstrap, water, profile, coach chat.
(function () {
  const App = {};
  let obStep = 0;

  function showGate(which) {
    document.getElementById('gate').classList.add('open');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('site-header').classList.add('hidden');
    ['gate-signin', 'gate-onboard', 'gate-loading'].forEach(id => document.getElementById(id).classList.add('hidden'));
    if (which) document.getElementById(which).classList.remove('hidden');
  }
  function showApp() {
    document.getElementById('gate').classList.remove('open');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('site-header').classList.remove('hidden');
  }

  /* ---------- Boot ---------- */
  async function boot() {
    showGate('gate-loading');
    let data;
    try {
      data = await Api.requestJson(`${Api.API}?action=boot`);
    } catch (e) {
      if (e.code === 'login_required' || e.status === 401) return showGate('gate-signin');
      if (e.code === 'access_denied' || e.status === 403) return showGate('gate-signin');
      UI.toast(e.message, 'err');
      return showGate('gate-signin');
    }
    State.user = data.user;
    if (!data.profile) return startOnboarding(data.user);
    applyProfile(data.profile);
    State.foods = data.foods || [];
    State.workouts = data.workouts || [];
    State.water = data.water || 0;
    State.weightHistory = data.weightHistory || [];
    State.split = data.split || JSON.parse(JSON.stringify(Data.DEFAULT_SPLIT));
    State.setQuota(data.aiQuota);
    enterApp();
    if (!data.profile.targets || !data.profile.targets.calories) refineTargets(true);
  }

  function applyProfile(profile) {
    State.profile = profile;
    State.profile.targets = (profile.targets && profile.targets.calories)
      ? profile.targets
      : State.computeTargets(profile);
  }

  // Ask the AI engine to plan calorie + macro targets from the full profile & lifestyle
  // meta, then persist + apply. Falls back silently to the formula targets on failure.
  async function refineTargets(quiet) {
    try {
      const t = await AI.estimateTargets();
      if (t && t.calories) {
        State.profile.targets = t;
        State.renderHUD();
        if (!quiet) UI.toast('Nex planned your targets', 'ok');
      }
    } catch (e) {
      if (!quiet) UI.toast('Using estimated targets (AI unavailable)', 'err');
    }
  }
  App.refineTargets = refineTargets;

  function enterApp() {
    showApp();
    const u = State.user || {};
    document.getElementById('hud-username').textContent = State.profile.display_name || u.name || 'You';
    const av = document.getElementById('hud-avatar');
    if (u.picture && u.picture.startsWith('http')) { av.outerHTML = `<img id="hud-avatar" src="${u.picture}" alt="" referrerpolicy="no-referrer">`; }
    else { av.textContent = (State.profile.display_name || u.name || 'Y').charAt(0).toUpperCase(); }
    const greet = document.getElementById('hero-greeting');
    if (greet) {
      const h = new Date().getHours();
      greet.textContent = `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${State.profile.display_name || 'there'}`;
    }
    State.renderHUD();
    State.renderQuota();
    Nutrition.init(); Exercise.init(); Progress.init(); Analytics.init(); Coach.init();
    UI.observeReveals();
    UI.icons();
    wireWater(); wireProfileModal();
  }

  /* ---------- Reloaders ---------- */
  App.reloadToday = async function () {
    const d = await Api.requestJson(`${Api.API}?action=today`);
    State.foods = d.foods || []; State.workouts = d.workouts || []; State.water = d.water || 0;
    Nutrition.renderLogged(); Exercise.renderLogged(); State.renderHUD();
  };
  App.reloadMeta = async function () {
    const d = await Api.requestJson(`${Api.API}?action=boot`);
    applyProfile(d.profile); State.weightHistory = d.weightHistory || [];
    if (d.split) State.split = d.split;
    State.foods = d.foods || []; State.workouts = d.workouts || []; State.water = d.water || 0;
    State.setQuota(d.aiQuota);
    State.renderHUD(); Progress.refresh(); Nutrition.renderLogged(); Exercise.renderLogged(); Exercise.rerender();
  };

  /* ---------- Onboarding ---------- */
  function startOnboarding(user) {
    showGate('gate-onboard');
    obStep = 0;
    if (user?.name) document.getElementById('ob-name').value = user.name;
    renderObStep();
  }
  const OB_STEPS = [
    ['Let\'s build your profile', 'The basics — these are required.'],
    ['Your body & goal', 'Weight, target and what you\'re aiming for.'],
    ['Training & activity', 'Optional — add as much detail as you like, or skip.'],
    ['Recovery & habits', 'Optional — sleep, stress and habits that affect your metabolism.'],
    ['Diet & health', 'Optional — preferences, allergies and anything that shapes your plan.'],
    ['Your plan', 'A starting estimate. NexForm refines calories and macros with AI when you finish.'],
  ];
  const OB_LAST = 5;
  function renderObStep() {
    document.querySelectorAll('.ob-step').forEach(s => s.classList.toggle('hidden', +s.dataset.step !== obStep));
    document.querySelectorAll('#ob-dots i').forEach((d, i) => d.classList.toggle('on', i === obStep));
    document.getElementById('ob-back').classList.toggle('hidden', obStep === 0);
    document.getElementById('ob-next').classList.toggle('hidden', obStep === OB_LAST);
    document.getElementById('ob-submit').classList.toggle('hidden', obStep !== OB_LAST);
    const [title, sub] = OB_STEPS[obStep] || OB_STEPS[0];
    document.getElementById('ob-title').textContent = title;
    document.getElementById('ob-sub').textContent = sub;
    if (obStep === OB_LAST) updateObPreview();
    UI.icons();
  }
  const obVal = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  const obNum = (id) => { const v = obVal(id); return v === '' ? null : Number(v); };
  function readOb() {
    return {
      display_name: obVal('ob-name'),
      age: obNum('ob-age'),
      gender: obVal('ob-gender') || 'Male',
      height_cm: obNum('ob-height'),
      weight_kg: obNum('ob-weight'),
      target_weight_kg: obNum('ob-target'),
      body_fat_pct: obNum('ob-bodyfat'),
      activity: Number(obVal('ob-activity') || 1.55),
      goal: obVal('ob-goal') || 'recomp',
      diet_pref: obVal('ob-diet'),
      meta: {
        training_days: obNum('ob-traindays'),
        training_type: obVal('ob-traintype'),
        occupation: obVal('ob-occupation'),
        steps_day: obNum('ob-steps'),
        sleep_hours: obNum('ob-sleep'),
        stress: obVal('ob-stress'),
        alcohol: obVal('ob-alcohol'),
        caffeine: obVal('ob-caffeine'),
        smoking: obVal('ob-smoking'),
        meals_per_day: obNum('ob-meals'),
        allergies: obVal('ob-allergies'),
        intolerances: obVal('ob-intolerances'),
        avoid_foods: obVal('ob-avoid'),
        conditions: obVal('ob-conditions'),
        medications: obVal('ob-medications'),
        injuries: obVal('ob-injuries'),
        supplements: obVal('ob-supplements'),
        cycle: obVal('ob-cycle'),
        timeline_weeks: obNum('ob-timeline'),
      },
    };
  }
  function validateOb(step) {
    const v = readOb();
    if (step === 0 && (!v.display_name || !v.age || !v.height_cm)) { UI.toast('Fill in name, age and height', 'err'); return false; }
    if (step === 1 && (!v.weight_kg || !v.target_weight_kg)) { UI.toast('Enter current and target weight', 'err'); return false; }
    return true;
  }
  function updateObPreview() {
    const v = readOb();
    const t = State.computeTargets(v);
    document.getElementById('ob-preview').innerHTML = `
      <div class="kbd" style="font-size:.95rem;margin-bottom:8px;">Starting estimate</div>
      <div class="macro-line">
        <div>${t.calories}<span>kcal</span></div><div>${t.protein}g<span>protein</span></div>
        <div>${t.carbs}g<span>carbs</span></div><div>${t.fat}g<span>fat</span></div>
        <div>${t.tdee}<span>TDEE</span></div>
      </div>
      <p class="small muted" style="margin:10px 0 0;">These are formula-based numbers. When you tap <b>Start tracking</b>, NexForm's AI re-plans your calories and macros from every detail above — including your goal, body composition, training and health — and tunes them to you.</p>`;
  }
  async function submitOnboard(e) {
    e.preventDefault();
    const v = readOb();
    const btn = document.getElementById('ob-submit'); btn.disabled = true;
    try {
      const d = await Api.requestJson(`${Api.API}?action=profile`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v),
      });
      applyProfile(d.profile);
      State.foods = []; State.workouts = []; State.water = 0; State.weightHistory = [];
      State.split = JSON.parse(JSON.stringify(Data.DEFAULT_SPLIT));
      if (d.split) State.split = d.split;
      enterApp();
      UI.toast('Welcome to NexForm! Planning your targets…', 'ok');
      refineTargets(false);
    } catch (err) { UI.toast(err.message, 'err'); }
    finally { btn.disabled = false; }
  }

  /* ---------- Water ---------- */
  function wireWater() {
    const set = async (delta) => {
      try {
        const d = await Api.requestJson(`${Api.API}?action=water`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delta }) });
        State.water = d.water; State.renderHUD(); UI.beep(delta > 0 ? 700 : 400, 0.06);
      } catch (e) { UI.toast(e.message, 'err'); }
    };
    document.getElementById('btn-water-add').onclick = () => set(250);
    document.getElementById('btn-water-sub').onclick = () => set(-250);
  }

  /* ---------- Profile modal ---------- */
  function wireProfileModal() {
    document.getElementById('hud-user').onclick = () => {
      const p = State.profile;
      document.getElementById('pf-name').value = p.display_name || '';
      document.getElementById('pf-age').value = p.age || '';
      document.getElementById('pf-gender').value = p.gender || 'Male';
      document.getElementById('pf-height').value = p.height_cm || '';
      document.getElementById('pf-weight').value = p.weight_kg || '';
      document.getElementById('pf-target').value = p.target_weight_kg || '';
      document.getElementById('pf-bodyfat').value = p.body_fat_pct || '';
      document.getElementById('pf-activity').value = String(p.activity || 1.55);
      document.getElementById('pf-goal').value = p.goal || 'recomp';
      document.getElementById('pf-diet').value = p.diet_pref || '';
      const acct = document.getElementById('pf-acctid');
      if (acct) acct.textContent = State.user?.id || '—';
      UI.openModal('modal-profile');
    };
    const copyBtn = document.getElementById('pf-copyid');
    if (copyBtn) copyBtn.onclick = async () => {
      const id = State.user?.id || '';
      try { await navigator.clipboard.writeText(id); UI.toast('Account ID copied', 'ok'); }
      catch { UI.toast(id, 'ok'); }
    };
    document.getElementById('pf-save').onclick = async () => {
      const v = {
        display_name: document.getElementById('pf-name').value.trim(),
        age: +document.getElementById('pf-age').value,
        gender: document.getElementById('pf-gender').value,
        height_cm: +document.getElementById('pf-height').value,
        weight_kg: +document.getElementById('pf-weight').value,
        target_weight_kg: +document.getElementById('pf-target').value,
        body_fat_pct: document.getElementById('pf-bodyfat').value ? +document.getElementById('pf-bodyfat').value : null,
        activity: +document.getElementById('pf-activity').value,
        goal: document.getElementById('pf-goal').value,
        diet_pref: document.getElementById('pf-diet').value.trim(),
        meta: State.profile?.meta || {},
      };
      if (!v.display_name || !v.weight_kg) { UI.toast('Name and weight are required', 'err'); return; }
      const btn = document.getElementById('pf-save'); btn.disabled = true;
      try {
        const d = await Api.requestJson(`${Api.API}?action=profile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) });
        applyProfile(d.profile);
        document.getElementById('hud-username').textContent = d.profile.display_name;
        State.renderHUD(); UI.closeModal('modal-profile'); UI.toast('Profile updated', 'ok');
        refineTargets(true);
      } catch (e) { UI.toast(e.message, 'err'); }
      finally { btn.disabled = false; }
    };
    document.getElementById('pf-signout').onclick = () => { location.href = '/__qoder_auth/logout?return_path=%2F'; };
  }

  /* ---------- Coach chat ---------- */
  const Coach = {};
  let chatHistory = [];
  function pushMsg(role, text) {
    const scroll = document.getElementById('chat-scroll');
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'me' : 'ai');
    div.innerHTML = `<div class="av">${role === 'user' ? 'ME' : '⚡'}</div><div class="bubble">${UI.escape(text)}</div>`;
    scroll.appendChild(div); scroll.scrollTop = scroll.scrollHeight;
    return div;
  }
  async function sendChat(text) {
    if (!text.trim()) return;
    pushMsg('user', text); chatHistory.push({ role: 'user', content: text });
    const typing = document.createElement('div');
    typing.className = 'msg ai'; typing.innerHTML = `<div class="av">⚡</div><div class="bubble typing"><span></span><span></span><span></span></div>`;
    const scroll = document.getElementById('chat-scroll'); scroll.appendChild(typing); scroll.scrollTop = scroll.scrollHeight;
    try {
      const reply = await AI.chat(text, chatHistory.slice(-8));
      typing.remove(); pushMsg('ai', reply); chatHistory.push({ role: 'assistant', content: reply });
    } catch (e) { typing.remove(); pushMsg('ai', '⚠️ ' + e.message); }
  }
  Coach.init = function () {
    const scroll = document.getElementById('chat-scroll');
    if (scroll) scroll.innerHTML = '';
    chatHistory = [];
    pushMsg('ai', `Hi ${State.profile.display_name || 'there'}! I'm Nex, your AI coach. I can see your targets and today's log — ask me anything about food, training or progress.`);
    document.getElementById('btn-chat-send').onclick = () => { const i = document.getElementById('chat-input'); sendChat(i.value); i.value = ''; };
    document.getElementById('chat-input').addEventListener('keypress', e => { if (e.key === 'Enter') { sendChat(e.target.value); e.target.value = ''; } });
    document.querySelectorAll('#coach-prompts [data-p]').forEach(b => b.onclick = () => sendChat(b.dataset.p));
  };

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    UI.init(); UI.icons();
    document.getElementById('ob-next').onclick = () => { if (validateOb(obStep)) { obStep = Math.min(OB_LAST, obStep + 1); renderObStep(); } };
    document.getElementById('ob-back').onclick = () => { obStep = Math.max(0, obStep - 1); renderObStep(); };
    document.getElementById('onboard-form').addEventListener('submit', submitOnboard);
    ['ob-weight', 'ob-height', 'ob-age', 'ob-target', 'ob-goal', 'ob-activity', 'ob-gender'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => { if (obStep === OB_LAST) updateObPreview(); });
    });
    boot();
  });

  window.App = App;
})();
