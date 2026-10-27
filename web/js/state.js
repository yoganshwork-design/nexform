// Client-side state, target math, and HUD rendering.
(function () {
  const State = {
    user: null,          // Qoder identity {id, name, picture}
    profile: null,       // persisted profile row (+ computed targets)
    foods: [],           // today's food logs
    workouts: [],        // today's exercise logs
    water: 0,            // today's water ml
    weightHistory: [],   // [{date, weight, bodyFat}]
    split: null,         // user's training split
    aiQuota: null,       // {cap, used, remaining} daily AI credits for this user
    today: new Date().toISOString().split('T')[0],
  };

  function num(v, d = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }

  // Mifflin-St Jeor BMR/TDEE + goal-based macro targets (instant fallback / preview).
  // The AI planner (server) is authoritative; this only fills the gap before it responds.
  State.computeTargets = function (p) {
    const weight = num(p.weight_kg, 80), height = num(p.height_cm, 175);
    const target = num(p.target_weight_kg, weight);
    const age = num(p.age, 25);
    const sex = String(p.gender || 'Male').toLowerCase();
    const act = num(p.activity, 1.55);
    const bmi = height > 0 ? weight / Math.pow(height / 100, 2) : 25;
    // For an overweight person, size intake to an adjusted weight so we don't over-feed them.
    const abw = bmi >= 25 && target < weight ? target + 0.4 * (weight - target) : weight;
    let bmr = 10 * abw + 6.25 * height - 5 * age + (sex === 'male' ? 5 : sex === 'female' ? -161 : -78);
    bmr = Math.round(bmr);
    const tdee = Math.round(bmr * act);

    const goal = p.goal || 'recomp';
    let cal = tdee;
    if (goal === 'cut') cal = Math.round(tdee * 0.78);       // ~22% deficit
    else if (goal === 'recomp') cal = Math.round(tdee * 0.88); // ~12% deficit
    else if (goal === 'bulk') cal = tdee + 280;                // modest surplus

    const floor = sex === 'female' ? 1200 : 1400;
    cal = Math.max(floor, Math.round(cal));

    // Protein on target/adjusted mass in a deficit (protects muscle without over-feeding).
    const proteinBase = goal === 'bulk' ? weight : Math.min(weight, abw);
    const protein = Math.round(proteinBase * (goal === 'cut' ? 2.0 : goal === 'bulk' ? 1.8 : 1.9));
    const fat = Math.round(abw * (goal === 'cut' ? 0.7 : 0.8));
    const carbs = Math.max(40, Math.round((cal - protein * 4 - fat * 9) / 4));

    return { bmr, tdee, calories: cal, protein, carbs, fat, waterMl: Math.round(weight * 33) };
  };

  State.targets = function () {
    return State.profile?.targets || { calories: 2200, protein: 170, carbs: 220, fat: 65, waterMl: 3000, tdee: 2600, bmr: 1700 };
  };

  State.totals = function () {
    let calories = 0, protein = 0, carbs = 0, fat = 0;
    State.foods.forEach(f => { calories += num(f.calories); protein += num(f.protein); carbs += num(f.carbs); fat += num(f.fat); });
    let burned = 0;
    State.workouts.forEach(w => { burned += num(w.calories_burned); });
    return { calories: Math.round(calories), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat), burned: Math.round(burned), water: State.water };
  };

  function setRing(id, cur, target, color) {
    const ring = document.getElementById(id);
    if (!ring) return;
    const r = 52, C = 2 * Math.PI * r;
    const pct = Math.min(1, Math.max(0, target ? cur / target : 0));
    ring.style.strokeDasharray = `${C} ${C}`;
    ring.style.strokeDashoffset = C - pct * C;
    ring.style.stroke = color;
  }

  State.renderHUD = function () {
    const t = State.targets(), tot = State.totals();
    const left = Math.max(0, t.calories - tot.calories);
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

    el('hud-cal', `${left} kcal`);
    el('hud-prot', `${tot.protein}/${t.protein}g`);
    el('hud-burn', `${tot.burned} kcal`);

    // rings
    setRing('ring-cal', tot.calories, t.calories, '#ef4444');
    setRing('ring-prot', tot.protein, t.protein, '#2563eb');
    setRing('ring-carbs', tot.carbs, t.carbs, '#10b981');
    setRing('ring-fat', tot.fat, t.fat, '#f59e0b');
    el('val-cal', tot.calories); el('sub-cal', `/ ${t.calories} kcal`);
    el('val-prot', tot.protein + 'g'); el('sub-prot', `goal ${t.protein}g`);
    el('val-carbs', tot.carbs + 'g'); el('sub-carbs', `goal ${t.carbs}g`);
    el('val-fat', tot.fat + 'g'); el('sub-fat', `goal ${t.fat}g`);

    // Energy balance. TDEE already includes daily activity, steps and training, so logged
    // exercise burn is shown as advisory only — subtracting it again would double-count and
    // push the user to under-eat.
    const balance = t.tdee - tot.calories; // >0 = eating below maintenance
    el('net-cal', `${tot.calories} kcal`);
    const dEl = document.getElementById('net-deficit');
    if (dEl) {
      dEl.textContent = `${balance >= 0 ? '−' : '+'}${Math.abs(Math.round(balance))} kcal`;
      dEl.style.color = balance >= 0 ? 'var(--pos)' : 'var(--danger)';
    }
    const note = document.getElementById('balance-note');
    if (note) note.textContent = `Maintenance (TDEE) ≈ ${t.tdee} kcal · BMR ≈ ${t.bmr} kcal · goal: ${State.profile?.goal || 'recomp'}${tot.burned ? ` · ${tot.burned} kcal exercise logged (already reflected in TDEE)` : ''}`;

    // water
    const wGoal = t.waterMl || 3000;
    el('water-val', `${State.water} / ${wGoal} ml`);
    const fill = document.getElementById('water-fill');
    if (fill) fill.style.height = Math.min(100, Math.round(State.water / wGoal * 100)) + '%';

    const dateTag = document.getElementById('dash-date');
    if (dateTag) dateTag.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  State.aiContext = function () {
    const t = State.targets(), tot = State.totals(), p = State.profile || {};
    return {
      name: p.display_name || State.user?.name || 'there',
      age: num(p.age), gender: p.gender, heightCm: num(p.height_cm), weightKg: num(p.weight_kg),
      targetWeightKg: num(p.target_weight_kg), bodyFatPct: num(p.body_fat_pct),
      activity: num(p.activity), goal: p.goal, diet: p.diet_pref || '',
      bmr: t.bmr, tdee: t.tdee, calorieTarget: t.calories, proteinTarget: t.protein,
      todayCalories: tot.calories, todayProtein: tot.protein, todayCarbs: tot.carbs, todayFat: tot.fat,
      todayBurned: tot.burned, waterMl: tot.water,
    };
  };

  State.setQuota = function (q) {
    if (!q) return;
    State.aiQuota = q;
    State.renderQuota();
  };

  State.renderQuota = function () {
    const badge = document.getElementById('ai-credit');
    if (!badge) return;
    const q = State.aiQuota;
    if (!q) { badge.textContent = ''; return; }
    badge.classList.remove('low', 'empty', 'admin');
    if (q.unlimited) { badge.textContent = 'Unlimited AI · admin'; badge.classList.add('admin'); return; }
    badge.textContent = `${q.remaining}/${q.cap} AI credits today`;
    badge.classList.toggle('low', q.remaining <= Math.max(3, Math.round(q.cap * 0.1)));
    badge.classList.toggle('empty', q.remaining <= 0);
  };

  window.State = State;
})();
