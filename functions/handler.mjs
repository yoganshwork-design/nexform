// Application Function handler: auth, per-user data, and AI actions.
import { requireUser, getUser, UserContextError } from './auth.mjs';
import { runOnce, parseJsonReply, normalizeFood, normalizeBurn, normalizeTargets, CloudAgentsError } from './ai.mjs';

const MAX_BODY = 256 * 1024;
const today = () => new Date().toISOString().split('T')[0];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const err = (code, status = 400) => json({ error: code }, status);

async function readJson(request) {
  if (request.method === 'GET') return {};
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Bad('invalid_input');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BODY) throw new Bad('invalid_input');
  try { return JSON.parse(new TextDecoder().decode(buf) || '{}'); } catch { throw new Bad('invalid_input'); }
}
class Bad extends Error { constructor(code) { super(code); this.code = code; } }

const str = (v, max = 200, d = '') => typeof v === 'string' ? v.slice(0, max) : d;
const num = (v, d = null) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const intg = (v, d = 0) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? x : d; };
// Restricted DDL has no decimal type: fractional measurements are stored as text and coerced on read.
const dec = (v, d = null) => { const x = Number(v); return Number.isFinite(x) ? String(x) : d; };
const PROFILE_NUM_FIELDS = ['height_cm', 'weight_kg', 'target_weight_kg', 'body_fat_pct', 'activity'];
function numifyProfile(p) {
  if (!p) return p;
  for (const k of PROFILE_NUM_FIELDS) if (p[k] != null && p[k] !== '') p[k] = Number(p[k]);
  if (p.age != null && p.age !== '') p.age = Number(p.age);
  return p;
}

/* ---------- Per-user AI usage caps ---------- */
// Each signed-in user is minted their own quota token (ai_usage row) the first time
// they load the app. Every AI action consumes one credit against a daily allowance.
// NOTE: the upstream Qoder Cloud Agents call still uses the site's single QODER_PAT;
// this caps how many AI calls any one user can burn per day so nobody drains it.
const AI_DAILY_CAP = 60;
const AI_ACTIONS = new Set(['ai-food', 'ai-url', 'ai-burn', 'ai-chat', 'ai-targets']);

// Admin accounts bypass the daily cap entirely. The Gateway does NOT expose email to
// the Function, so admins are matched by their stable user_id. The admin signs in once,
// reads their Account ID from the Profile panel, and that id is added here.
const ADMIN_USER_IDS = new Set([
  // 'paste-admin-user_id-here',
]);
const isAdmin = (user) => ADMIN_USER_IDS.has(user.user_id);

function quotaShape(row, admin = false) {
  const cap = row?.cap ?? AI_DAILY_CAP;
  const used = row?.calls ?? 0;
  const base = { used, period: row?.period ?? today(), tokenId: row?.token_id || null };
  return admin
    ? { ...base, unlimited: true, cap: null, remaining: null }
    : { ...base, unlimited: false, cap, remaining: Math.max(0, cap - used) };
}

// Mint the user's quota token on first sign-in and reset the counter each new day.
async function ensureQuota(supabase, user) {
  const userId = user.user_id;
  const admin = isAdmin(user);
  const d = today();
  const { data: row, error } = await supabase.from('ai_usage').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Bad('database_error');
  if (!row) {
    const { data, error: ierr } = await supabase.from('ai_usage')
      .insert({ user_id: userId, token_id: crypto.randomUUID(), period: d, calls: 0, cap: AI_DAILY_CAP, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .select('*').single();
    if (ierr) throw new Bad('write_rejected');
    return quotaShape(data, admin);
  }
  if (row.period !== d) {
    const { data, error: uerr } = await supabase.from('ai_usage')
      .update({ period: d, calls: 0, updated_at: new Date().toISOString() }).eq('user_id', userId).select('*').single();
    if (uerr) throw new Bad('write_rejected');
    return quotaShape(data, admin);
  }
  return quotaShape(row, admin);
}

// Reserve one credit before an AI call; rejects with quota_exceeded (429) at the cap.
// Admins are counted for stats but never blocked.
async function consumeQuota(supabase, user) {
  const admin = isAdmin(user);
  const q = await ensureQuota(supabase, user);
  if (!admin && q.used >= q.cap) throw new Bad('quota_exceeded');
  const { data, error } = await supabase.from('ai_usage')
    .update({ calls: (q.used ?? 0) + 1, updated_at: new Date().toISOString() }).eq('user_id', user.user_id).select('*').single();
  if (error) throw new Bad('write_rejected');
  return quotaShape(data, admin);
}

function sanitizeMeta(body) {
  const m = body && typeof body.meta === 'object' && body.meta ? body.meta : {};
  const opt = (v, max = 120) => { const s = str(v, max).trim(); return s || null; };
  const optNum = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  const out = {
    training_days: optNum(m.training_days),
    training_type: opt(m.training_type, 40),
    occupation: opt(m.occupation, 40),
    steps_day: optNum(m.steps_day),
    sleep_hours: optNum(m.sleep_hours),
    stress: opt(m.stress, 30),
    alcohol: opt(m.alcohol, 30),
    caffeine: opt(m.caffeine, 30),
    smoking: opt(m.smoking, 20),
    meals_per_day: optNum(m.meals_per_day),
    allergies: opt(m.allergies, 200),
    intolerances: opt(m.intolerances, 200),
    avoid_foods: opt(m.avoid_foods, 200),
    conditions: opt(m.conditions, 240),
    medications: opt(m.medications, 240),
    injuries: opt(m.injuries, 200),
    supplements: opt(m.supplements, 200),
    cycle: opt(m.cycle, 30),
    timeline_weeks: optNum(m.timeline_weeks),
  };
  // Drop empty keys to keep the jsonb small.
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
}

function sanitizeProfile(body, userId) {
  const name = str(body.display_name, 60).trim();
  if (!name) throw new Bad('invalid_input');
  const height = num(body.height_cm); const weight = num(body.weight_kg); const target = num(body.target_weight_kg);
  if (!height || !weight || !target) throw new Bad('invalid_input');
  return {
    user_id: userId, display_name: name,
    age: intg(body.age, 25), gender: ['Male', 'Female', 'Other'].includes(body.gender) ? body.gender : 'Male',
    height_cm: dec(height), weight_kg: dec(weight), target_weight_kg: dec(target),
    body_fat_pct: dec(body.body_fat_pct), activity: dec(num(body.activity, 1.55), '1.55'),
    goal: ['cut', 'recomp', 'bulk', 'maintain'].includes(body.goal) ? body.goal : 'recomp',
    diet_pref: str(body.diet_pref, 120), meta: sanitizeMeta(body), updated_at: new Date().toISOString(),
  };
}

// Fetch today's logs for a user.
async function loadToday(supabase, userId, date) {
  const [foods, workouts, daily] = await Promise.all([
    supabase.from('food_logs').select('id,name,category,calories,protein,carbs,fat,portion,source').eq('user_id', userId).eq('log_date', date).order('created_at', { ascending: true }),
    supabase.from('exercise_logs').select('id,name,kind,sets,reps,weight_kg,duration_mins,calories_burned,detail').eq('user_id', userId).eq('log_date', date).order('created_at', { ascending: true }),
    supabase.from('daily_logs').select('water_ml').eq('user_id', userId).eq('log_date', date).maybeSingle(),
  ]);
  if (foods.error) throw new Bad('database_error');
  if (workouts.error) throw new Bad('database_error');
  const frows = (foods.data || []).map(f => ({ ...f, portion: f.portion != null && f.portion !== '' ? Number(f.portion) : 1 }));
  const wrows = (workouts.data || []).map(w => ({ ...w, weight_kg: w.weight_kg != null && w.weight_kg !== '' ? Number(w.weight_kg) : 0 }));
  return { foods: frows, workouts: wrows, water: daily.data?.water_ml || 0 };
}

async function actionBoot(supabase, user) {
  const date = today();
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('user_id', user.user_id).maybeSingle();
  if (error) throw new Bad('database_error');
  if (!profile) return { user: { id: user.user_id, name: user.name, picture: user.picture }, profile: null };
  const t = await loadToday(supabase, user.user_id, date);
  const { data: wh } = await supabase.from('weight_history').select('date:log_date,weight_kg,body_fat_pct').eq('user_id', user.user_id).order('log_date', { ascending: true }).limit(200);
  const whRows = (wh || []).map(w => ({ ...w, weight_kg: w.weight_kg != null && w.weight_kg !== '' ? Number(w.weight_kg) : null, body_fat_pct: w.body_fat_pct != null && w.body_fat_pct !== '' ? Number(w.body_fat_pct) : null }));
  const aiQuota = await ensureQuota(supabase, user);
  return {
    user: { id: user.user_id, name: user.name, picture: user.picture },
    profile: numifyProfile(profile), foods: t.foods, workouts: t.workouts, water: t.water,
    weightHistory: whRows, split: profile.split || null, aiQuota,
  };
}

async function actionToday(supabase, user) {
  return await loadToday(supabase, user.user_id, today());
}

async function actionQuota(supabase, user) {
  return { ok: true, quota: await ensureQuota(supabase, user) };
}

async function actionProfile(supabase, user, body) {
  const row = sanitizeProfile(body, user.user_id);
  const { data, error } = await supabase.from('profiles').upsert(row, { onConflict: 'user_id' }).select('*').single();
  if (error) throw new Bad('write_rejected');
  return { profile: numifyProfile(data), split: data.split || null };
}

async function actionSplitSave(supabase, user, body) {
  const split = body.split;
  if (!split || typeof split !== 'object') throw new Bad('invalid_input');
  const { error } = await supabase.from('profiles').update({ split, updated_at: new Date().toISOString() }).eq('user_id', user.user_id);
  if (error) throw new Bad('write_rejected');
  return { ok: true };
}

async function actionFoodLog(supabase, user, body) {
  const name = str(body.name, 120).trim();
  if (!name) throw new Bad('invalid_input');
  const row = {
    id: crypto.randomUUID(), user_id: user.user_id, log_date: today(), name,
    category: str(body.category, 30, 'Snack'), calories: intg(body.calories), protein: intg(body.protein),
    carbs: intg(body.carbs), fat: intg(body.fat), portion: dec(num(body.portion, 1), '1'), source: str(body.source, 30),
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('food_logs').insert(row);
  if (error) throw new Bad('write_rejected');
  return { ok: true, id: row.id };
}

async function actionFoodDelete(supabase, user, body) {
  const id = str(body.id, 64); if (!id) throw new Bad('invalid_input');
  const { data, error } = await supabase.from('food_logs').delete().eq('id', id).eq('user_id', user.user_id).select('id');
  if (error || !data || !data.length) throw new Bad('write_rejected');
  return { ok: true };
}

async function actionExerciseLog(supabase, user, body) {
  const name = str(body.name, 120).trim();
  if (!name) throw new Bad('invalid_input');
  const row = {
    id: crypto.randomUUID(), user_id: user.user_id, log_date: today(), name,
    kind: body.kind === 'cardio' ? 'cardio' : 'lift',
    sets: intg(body.sets, 0), reps: intg(body.reps, 0), weight_kg: dec(num(body.weight_kg, 0), '0'),
    duration_mins: intg(body.duration_mins, 0), calories_burned: intg(body.calories_burned),
    detail: body.detail && typeof body.detail === 'object' ? body.detail : {},
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('exercise_logs').insert(row);
  if (error) throw new Bad('write_rejected');
  return { ok: true, id: row.id };
}

async function actionExerciseDelete(supabase, user, body) {
  const id = str(body.id, 64); if (!id) throw new Bad('invalid_input');
  const { data, error } = await supabase.from('exercise_logs').delete().eq('id', id).eq('user_id', user.user_id).select('id');
  if (error || !data || !data.length) throw new Bad('write_rejected');
  return { ok: true };
}

async function actionWater(supabase, user, body) {
  const delta = intg(body.delta, 0);
  const date = today();
  const { data: cur } = await supabase.from('daily_logs').select('water_ml').eq('user_id', user.user_id).eq('log_date', date).maybeSingle();
  const next = Math.max(0, (cur?.water_ml || 0) + delta);
  const { error } = await supabase.from('daily_logs').upsert({ user_id: user.user_id, log_date: date, water_ml: next }, { onConflict: 'user_id,log_date' });
  if (error) throw new Bad('write_rejected');
  return { ok: true, water: next };
}

async function actionWeightSave(supabase, user, body) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(body.date, 10)) ? body.date : today();
  const weight = num(body.weight_kg); if (!weight) throw new Bad('invalid_input');
  const row = { user_id: user.user_id, log_date: date, weight_kg: dec(weight), body_fat_pct: dec(body.body_fat_pct) };
  const { error } = await supabase.from('weight_history').upsert(row, { onConflict: 'user_id,log_date' });
  if (error) throw new Bad('write_rejected');
  // Keep the profile's current weight in sync so targets re-plan against the latest weigh-in.
  if (date === today()) {
    const patch = { weight_kg: dec(weight), updated_at: new Date().toISOString() };
    const bf = num(body.body_fat_pct); if (bf) patch.body_fat_pct = dec(bf);
    const { error: perr } = await supabase.from('profiles').update(patch).eq('user_id', user.user_id);
    if (perr) throw new Bad('write_rejected');
  }
  return { ok: true };
}

async function actionHistory(supabase, user, url) {
  const days = Math.min(90, Math.max(1, intg(url.searchParams.get('days'), 7)));
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];
  const uid = user.user_id;
  const [foods, workouts, weights] = await Promise.all([
    supabase.from('food_logs').select('log_date,calories,protein').eq('user_id', uid).gte('log_date', since),
    supabase.from('exercise_logs').select('log_date,calories_burned').eq('user_id', uid).gte('log_date', since),
    supabase.from('weight_history').select('log_date,weight_kg').eq('user_id', uid).gte('log_date', since),
  ]);
  const map = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().split('T')[0];
    map[d] = { date: d, calories: 0, protein: 0, burned: 0, weight: null };
  }
  (foods.data || []).forEach(f => { if (map[f.log_date]) { map[f.log_date].calories += +f.calories || 0; map[f.log_date].protein += +f.protein || 0; } });
  (workouts.data || []).forEach(w => { if (map[w.log_date]) map[w.log_date].burned += +w.calories_burned || 0; });
  (weights.data || []).forEach(w => { if (map[w.log_date]) map[w.log_date].weight = +w.weight_kg; });
  // forward-fill weight
  let last = null;
  const out = Object.values(map).map(d => { if (d.weight != null) last = d.weight; return { ...d, weight: d.weight != null ? d.weight : last }; });
  return { days: out };
}

/* ---------- AI actions ---------- */
function ctxLine(c) {
  c = c || {};
  return `Name: ${c.name || 'user'}. Sex: ${c.gender || 'n/a'}. Age: ${c.age || 'n/a'}. Height: ${c.heightCm || 'n/a'} cm. ` +
    `Body weight: ${c.weightKg || 'n/a'} kg. Body fat: ${c.bodyFatPct || 'n/a'}%. Goal: ${c.goal || 'recomp'}. ` +
    `Daily calorie target: ${c.calorieTarget || 'n/a'} kcal, protein target: ${c.proteinTarget || 'n/a'} g. ` +
    `Already eaten today: ${c.todayCalories || 0} kcal, ${c.todayProtein || 0} g protein. Burned today: ${c.todayBurned || 0} kcal.`;
}
const FOOD_SCHEMA = 'Return ONLY JSON: {"name":string,"calories":integer_kcal,"protein":integer_g,"carbs":integer_g,"fat":integer_g,"confidence":"low|medium|high","note":short_string}.';

async function actionAiFood(supabase, user, body) {
  const text = str(body.text, 600).trim();
  if (!text) throw new Bad('invalid_input');
  const prompt = `${ctxLine(body.context)}\nEstimate the nutrition of this consumed meal, honoring the described portions/quantities.\nMeal: "${text}"\nCategory: ${str(body.category, 20, 'Meal')}.\n${FOOD_SCHEMA}`;
  const raw = await runOnce(supabase, prompt);
  const result = normalizeFood(parseJsonReply(raw), text.slice(0, 60));
  if (!result) throw new CloudAgentsError('ai_response_invalid');
  return { ok: true, result };
}

async function actionAiUrl(supabase, user, body) {
  const url = str(body.url, 800).trim();
  if (!url) throw new Bad('invalid_input');
  const prompt = `${ctxLine(body.context)}\nThe user pasted a food order link or dish name. Identify the specific dish and estimate calories/macros for one typical serving. Infer the dish from any URL path/slug or the text.\nInput: "${url}"\n${FOOD_SCHEMA}`;
  const raw = await runOnce(supabase, prompt);
  const result = normalizeFood(parseJsonReply(raw), 'Ordered item');
  if (!result) throw new CloudAgentsError('ai_response_invalid');
  return { ok: true, result };
}

async function actionAiBurn(supabase, user, body) {
  const c = body.context || {};
  let prompt;
  if (body.kind === 'cardio') {
    const activity = str(body.activity, 120).trim(); const mins = intg(body.minutes, 0);
    if (!activity || !mins) throw new Bad('invalid_input');
    prompt = `${ctxLine(c)}\nEstimate calories burned for this cardio session using an appropriate MET value for the activity and intensity, scaled to body weight and duration.\nActivity: "${activity}". Duration: ${mins} minutes. Intensity: ${str(body.intensity, 12, 'moderate')}.\nReturn ONLY JSON: {"caloriesBurned":integer_kcal,"met":number,"note":short_string}.`;
  } else {
    const exercise = str(body.exercise, 120).trim();
    if (!exercise) throw new Bad('invalid_input');
    const sets = intg(body.sets, 0), reps = intg(body.reps, 0), wkg = num(body.weightKg, 0), rest = intg(body.restSec, 90);
    prompt = `${ctxLine(c)}\nEstimate calories burned for this resistance-training work, using MET-based expenditure for resistance training scaled to body weight, total volume (sets x reps x load) and the work/rest timing. Account for the athlete's lean mass where possible.\nExercise: "${exercise}". Sets: ${sets}. Reps: ${reps}. Load: ${wkg} kg. Rest between sets: ${rest}s.\nReturn ONLY JSON: {"caloriesBurned":integer_kcal,"met":number,"note":short_string}.`;
  }
  const raw = await runOnce(supabase, prompt);
  const result = normalizeBurn(parseJsonReply(raw));
  if (!result) throw new CloudAgentsError('ai_response_invalid');
  return { ok: true, result };
}

async function actionAiChat(supabase, user, body) {
  const message = str(body.message, 1200).trim();
  if (!message) throw new Bad('invalid_input');
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const transcript = history.map(h => `${h.role === 'user' ? 'User' : 'Nex'}: ${str(h.content, 600)}`).join('\n');
  const prompt = `${ctxLine(body.context)}\nYou are Nex, this user's coach. Use their real data above. Be concise, specific and motivating, plain text (no JSON, no markdown tables).\n${transcript ? 'Conversation so far:\n' + transcript + '\n' : ''}Reply to the user's latest message: "${message}"`;
  const reply = await runOnce(supabase, prompt);
  return { ok: true, result: { reply: String(reply || '').slice(0, 2000) } };
}

/* ---------- AI macro/calorie targets ---------- */
function metaLine(m) {
  m = m || {};
  const parts = [];
  if (m.training_days != null) parts.push(`Training ${m.training_days} days/week`);
  if (m.training_type) parts.push(`training type ${m.training_type}`);
  if (m.occupation) parts.push(`occupation activity: ${m.occupation}`);
  if (m.steps_day != null) parts.push(`~${m.steps_day} steps/day`);
  if (m.sleep_hours != null) parts.push(`sleep ${m.sleep_hours} h/night`);
  if (m.stress) parts.push(`stress: ${m.stress}`);
  if (m.alcohol) parts.push(`alcohol: ${m.alcohol}`);
  if (m.caffeine) parts.push(`caffeine: ${m.caffeine}`);
  if (m.smoking) parts.push(`smoking: ${m.smoking}`);
  if (m.meals_per_day != null) parts.push(`prefers ${m.meals_per_day} meals/day`);
  if (m.allergies) parts.push(`allergies: ${m.allergies}`);
  if (m.intolerances) parts.push(`intolerances: ${m.intolerances}`);
  if (m.avoid_foods) parts.push(`avoids: ${m.avoid_foods}`);
  if (m.conditions) parts.push(`medical conditions: ${m.conditions}`);
  if (m.medications) parts.push(`medications: ${m.medications}`);
  if (m.injuries) parts.push(`injuries limiting training: ${m.injuries}`);
  if (m.supplements) parts.push(`supplements: ${m.supplements}`);
  if (m.cycle) parts.push(`menstrual cycle: ${m.cycle}`);
  if (m.timeline_weeks != null) parts.push(`goal timeline: ${m.timeline_weeks} weeks`);
  return parts.length ? parts.join('; ') + '.' : 'No additional lifestyle or health details were provided.';
}

function targetsPrompt(p) {
  const h = Number(p.height_cm), w = Number(p.weight_kg), tw = Number(p.target_weight_kg);
  const bmi = (h > 0 && w > 0) ? (w / Math.pow(h / 100, 2)).toFixed(1) : 'unknown';
  const overweight = Number.isFinite(+bmi) && +bmi >= 25;
  return `Plan precise daily nutrition targets for ONE real person using evidence-based sports nutrition. Use EVERY datum below; do not substitute generic averages or ignore any field.
Body data — Sex: ${p.gender || 'n/a'}. Age: ${p.age || 'n/a'}. Height: ${p.height_cm || 'n/a'} cm. Current weight: ${p.weight_kg || 'n/a'} kg. Target weight: ${p.target_weight_kg || 'n/a'} kg. Body fat: ${p.body_fat_pct != null ? p.body_fat_pct + '%' : 'unknown'}. BMI: ${bmi}${overweight ? ' (overweight — see adjusted-weight rule)' : ''}.
Goal: ${p.goal || 'recomp'}. Self-reported activity multiplier: ${p.activity || 1.55}.
Lifestyle, training & health: ${metaLine(p.meta)}
Dietary preference (interpret foods in an Indian context by default): ${p.diet_pref || 'none'}.

Method:
1. BMR via Mifflin-St Jeor. If BMI >= 25 or body fat is high, compute TDEE from an ADJUSTED body weight (target weight + 0.4 x (current - target)) so an overweight person is not over-fed; otherwise use current weight. TDEE = BMR x activity, cross-checked against steps/training days.
2. Calorie target by goal:
   - Fat loss / cut: a clear deficit of about 20-25% of TDEE (roughly 500-750 kcal). It must be low enough to actually lose fat — do NOT return a near-maintenance or high number. Never below 1200 kcal (female) or 1400 kcal (male), and never a deficit greater than 30% of TDEE.
   - Recomp: a small deficit (~10-15% of TDEE) with high protein.
   - Muscle gain / bulk: a modest surplus of ~200-350 kcal, never aggressive.
   - Maintain: at TDEE.
3. Macros in grams to fit the calorie target:
   - Protein: fat loss/recomp 1.8-2.4 g per kg of TARGET (or lean) body weight; muscle gain 1.6-2.2 g/kg. Keep protein high in a deficit to protect muscle.
   - Fat: 0.6-0.9 g/kg for hormonal health; in a fat-loss deficit keep fat moderate, not high.
   - Carbs: fill the remaining calories, scaled to training volume; in a fat-loss deficit keep carbs moderate and do not over-allocate. Prefer protein*4 + carbs*4 + fat*9 ≈ calorie target.
4. Daily water in ml (~30-35 ml/kg).
Return ONLY JSON: {"calories":int_kcal,"protein":int_g,"carbs":int_g,"fat":int_g,"waterMl":int_ml,"bmr":int,"tdee":int,"note":one_short_sentence_on_the_plan_and_its_main_uncertainty}.`;
}

// Backstop: never let a plan drop below a safe calorie floor, whatever the model returns.
function clampTargets(t, gender) {
  const floor = String(gender || '').toLowerCase() === 'female' ? 1200 : 1400;
  if (t.calories < floor) {
    const addKcal = floor - t.calories;
    t = { ...t, calories: floor, carbs: Math.max(0, t.carbs + Math.round(addKcal / 4)) };
  }
  return t;
}

async function actionAiTargets(supabase, user) {
  const { data: p, error } = await supabase.from('profiles').select('*').eq('user_id', user.user_id).maybeSingle();
  if (error) throw new Bad('database_error');
  if (!p) throw new Bad('invalid_input');
  const raw = await runOnce(supabase, targetsPrompt(p));
  let result = normalizeTargets(parseJsonReply(raw));
  if (!result) throw new CloudAgentsError('ai_response_invalid');
  result = clampTargets(result, p.gender);
  const { error: uerr } = await supabase.from('profiles')
    .update({ targets: result, updated_at: new Date().toISOString() }).eq('user_id', user.user_id);
  if (uerr) throw new Bad('write_rejected');
  return { ok: true, result };
}

const ROUTES = {
  boot: { get: actionBoot },
  today: { get: actionToday },
  quota: { get: actionQuota },
  profile: { post: actionProfile },
  'split-save': { post: actionSplitSave },
  'food-log': { post: actionFoodLog },
  'food-delete': { post: actionFoodDelete },
  'exercise-log': { post: actionExerciseLog },
  'exercise-delete': { post: actionExerciseDelete },
  water: { post: actionWater },
  'weight-save': { post: actionWeightSave },
  history: { get: actionHistory },
  'ai-targets': { post: actionAiTargets },
  'ai-food': { post: actionAiFood },
  'ai-url': { post: actionAiUrl },
  'ai-burn': { post: actionAiBurn },
  'ai-chat': { post: actionAiChat },
};

export async function handler({ request, supabase }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  const method = request.method.toUpperCase();
  const route = ROUTES[action];
  if (!route) return err('not_found', 404);

  let user;
  try { user = requireUser(request); }
  catch (e) { if (e instanceof UserContextError) return err(e.code, e.status); return err('login_required', 401); }

  const fn = method === 'GET' ? route.get : method === 'POST' ? route.post : null;
  if (!fn) return err('method_not_allowed', 405);

  try {
    const body = await readJson(request);
    let quota;
    if (method === 'POST' && AI_ACTIONS.has(action)) quota = await consumeQuota(supabase, user);
    const result = await fn(supabase, user, body, url);
    if (quota && result && typeof result === 'object') result.quota = quota;
    return json(result);
  } catch (e) {
    if (e instanceof Bad) {
      const status = e.code === 'write_rejected' ? 503 : e.code === 'database_error' ? 503 : e.code === 'quota_exceeded' ? 429 : 400;
      return err(e.code, status);
    }
    if (e instanceof UserContextError) return err(e.code, e.status);
    if (e instanceof CloudAgentsError) return err(e.code, e.status || 503);
    return err('service_unavailable', 503);
  }
}
