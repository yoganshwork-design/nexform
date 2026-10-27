// Server-only Qoder Cloud Agents integration: durable resource bootstrap + one-shot runs.
import { createCloudAgentsClient, ensureCloudResources, CloudAgentsError } from './cloud-agents.mjs';

// Trusted server configuration. Origin copied from sites.get_runtime_context.cloudAgents.apiOrigin.
export const CLOUD_ORIGIN = 'https://api.qoder.com';
const APP_SCOPE = 'nexform:global';
const AGENT_SYSTEM =
  'You are Nex, a precise sports-nutrition and exercise-physiology engine. ' +
  'When the user requests structured data you MUST reply with ONLY valid minified JSON, ' +
  'no prose, no markdown fences, matching the exact schema given. Use realistic evidence-based ' +
  'estimates (USDA-style food composition, MET-based energy expenditure adjusted for the given body mass). ' +
  'All calorie values are integers in kcal; macros are integers in grams. ' +
  'This app is used primarily in India: unless the user says otherwise, interpret foods as real Indian ' +
  'home-cooked or restaurant dishes with typical Indian portion sizes and cooking fat (oil/ghee), and use ' +
  'Indian food composition (e.g. roti, rice, dal, sabzi, paneer, curd, idli, dosa, biryani, sweets) rather than ' +
  'generic Western defaults. Use EVERY piece of user data you are given (age, sex, height, current and target ' +
  'weight, body fat, activity multiplier, steps, training days and type, sleep, stress, medical conditions, ' +
  'medications, dietary preference) — never ignore a provided input or substitute a hypothetical average. ' +
  'Be honest about uncertainty in the note field; do not present estimates as exact.';

const client = createCloudAgentsClient({ origin: CLOUD_ORIGIN, timeoutMs: 20000 });

/* ---------- Durable coordinator backed by a private table ---------- */
// A lock held longer than this is presumed orphaned (the isolate was recycled mid-init,
// e.g. a cold start that hit the wall-clock limit before its finally-block released).
// The upstream create POST timeout is 20s, so 30s safely outlives any live holder.
const LEASE_MS = 30000;

function makeCoordinator(supabase) {
  const TABLE = 'ai_locks';
  const ageMs = (row) => {
    const t = row?.updated_at ? Date.parse(row.updated_at) : NaN;
    return Number.isFinite(t) ? Date.now() - t : Infinity;
  };
  return {
    async withLock(key, cb) {
      const token = crypto.randomUUID();
      let cur;
      // Ensure a row exists.
      await supabase.from(TABLE).upsert({ lock_key: key }, { onConflict: 'lock_key', ignoreDuplicates: true });
      // Acquire with bounded retries via compare-and-set on lock_version.
      for (let attempt = 0; attempt < 50; attempt++) {
        const { data: row } = await supabase.from(TABLE).select('lock_version,token,updated_at').eq('lock_key', key).maybeSingle();
        const v = row?.lock_version ?? 0;
        const held = row?.token;
        // Free, OR held by an isolate that died mid-init (lease expired) -> (re)acquire.
        const stale = !held || ageMs(row) > LEASE_MS;
        if (stale) {
          const { data: got } = await supabase.from(TABLE)
            .update({ token, lock_version: v + 1, updated_at: new Date().toISOString() })
            .eq('lock_key', key).eq('lock_version', v).select('lock_key');
          if (got && got.length === 1) { cur = v + 1; break; }
        }
        await new Promise(r => setTimeout(r, 120));
      }
      if (cur === undefined) throw new CloudAgentsError('ai_initialization_pending', 202);

      let held = true;
      const lease = {
        async read() {
          const { data } = await supabase.from(TABLE).select('record').eq('lock_key', key).maybeSingle();
          const rec = data?.record ?? null;
          // We hold the lock, so any non-terminal record ('creating'/'unknown') is an orphan
          // left by a dead isolate. Returning null lets ensureCloudResources safely retry
          // creation: findResources has already confirmed no matching cloud resource exists,
          // and agent creation carries an idempotency key. 'ready'/'rejected' are preserved.
          if (rec && rec.state !== 'ready' && rec.state !== 'rejected') return null;
          return rec;
        },
        async write(rec) {
          const { data } = await supabase.from(TABLE)
            .update({ record: rec, lock_version: cur + 1, updated_at: new Date().toISOString() })
            .eq('lock_key', key).eq('lock_version', cur).eq('token', token).select('lock_key');
          if (!data || data.length !== 1) { held = false; throw new CloudAgentsError('ai_initialization_conflict', 409); }
          cur += 1;
        },
        async assertHeld() {
          const { data } = await supabase.from(TABLE).select('token,lock_version').eq('lock_key', key).maybeSingle();
          if (!data || data.token !== token || data.lock_version !== cur) { held = false; throw new CloudAgentsError('ai_initialization_conflict', 409); }
        },
      };
      try {
        return await cb(lease);
      } finally {
        if (held) await supabase.from(TABLE).update({ token: null, updated_at: new Date().toISOString() }).eq('lock_key', key).eq('token', token);
      }
    },
  };
}

let cachedModel = null;
async function selectModel() {
  if (cachedModel) return cachedModel;
  const res = await client.request('/api/v1/cloud/models');
  const list = Array.isArray(res?.data) ? res.data : [];
  const enabled = list.find(m => m && typeof m.id === 'string' && (m.enabled !== false));
  if (!enabled) throw new CloudAgentsError('ai_service_unavailable');
  cachedModel = enabled.id;
  return cachedModel;
}

// Cache the resolved agent/environment binding for the life of this isolate so the
// durable lock is only contended on the first initialization, not on every AI call.
let cachedBinding = null;
async function ensureBinding(supabase) {
  if (cachedBinding) return cachedBinding;
  const model = await selectModel();
  const binding = await ensureCloudResources({
    client,
    coordinator: makeCoordinator(supabase),
    applicationScope: APP_SCOPE,
    agent: {
      name: 'NexForm Health Engine', model, system: AGENT_SYSTEM,
      metadata: { app: 'nexform', purpose: 'nutrition-exercise-analysis' },
    },
    environment: { name: 'NexForm Health Environment', config: { type: 'cloud' } },
  });
  cachedBinding = binding;
  return binding;
}

/* ---------- One-shot run: create session, send prompt, poll for reply ---------- */
function extractText(events) {
  // Concatenate text content blocks from agent.message events (newest last).
  let out = '';
  for (const ev of events || []) {
    if (ev?.type !== 'agent.message') continue;
    const content = ev.content || ev.message?.content || [];
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === 'text' && typeof block.text === 'string') out += block.text;
    }
  }
  return out;
}

async function pollReply(sessionId, budgetMs = 45000) {
  const started = Date.now();
  let lastText = '';
  while (Date.now() - started < budgetMs) {
    let session;
    try { session = await client.request(`/api/v1/cloud/sessions/${sessionId}`); } catch { session = null; }
    let events = [];
    try {
      const evRes = await client.request(`/api/v1/cloud/sessions/${sessionId}/events?order=asc&limit=100`);
      events = Array.isArray(evRes?.data) ? evRes.data : [];
    } catch { /* transient */ }
    const text = extractText(events);
    if (text) lastText = text;
    const status = String(session?.status || '').toLowerCase();
    const busy = ['running', 'pending', 'queued', 'in_progress', 'working', 'created', ''].includes(status);
    if (status && ['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new CloudAgentsError('ai_service_unavailable');
    }
    if (!busy && lastText) return lastText;
    await new Promise(r => setTimeout(r, 1400));
  }
  if (lastText) return lastText;
  throw new CloudAgentsError('ai_timeout', 504);
}

export async function runOnce(supabase, prompt) {
  const binding = await ensureBinding(supabase);
  const session = await client.request('/api/v1/cloud/sessions', {
    method: 'POST', body: { ...binding, title: 'NexForm analysis' },
  });
  const sid = session?.id;
  if (!sid) throw new CloudAgentsError('ai_service_unavailable');
  await client.request(`/api/v1/cloud/sessions/${sid}/events`, {
    method: 'POST',
    body: { events: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }] },
  });
  const text = await pollReply(sid);
  return text;
}

/* ---------- JSON extraction + schemas ---------- */
export function parseJsonReply(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch { return null; }
}

const n = (v, d = 0) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? x : d; };

export function normalizeFood(r, fallbackName) {
  if (!r || typeof r !== 'object') return null;
  return {
    name: String(r.name || fallbackName || 'Food').slice(0, 120),
    calories: n(r.calories ?? r.kcal, 0),
    protein: n(r.protein ?? r.protein_g, 0),
    carbs: n(r.carbs ?? r.carbohydrates ?? r.carbs_g, 0),
    fat: n(r.fat ?? r.fat_g, 0),
    confidence: r.confidence ? String(r.confidence).slice(0, 20) : 'estimate',
    note: r.note ? String(r.note).slice(0, 280) : '',
  };
}

export function normalizeBurn(r) {
  if (!r || typeof r !== 'object') return null;
  return { caloriesBurned: n(r.caloriesBurned ?? r.calories_burned ?? r.kcal, 0), met: Number(r.met) || null, note: r.note ? String(r.note).slice(0, 240) : '' };
}

export function normalizeTargets(r) {
  if (!r || typeof r !== 'object') return null;
  const calories = n(r.calories ?? r.kcal ?? r.calorieTarget, 0);
  if (!calories) return null;
  const protein = n(r.protein ?? r.protein_g, 0);
  const carbs = n(r.carbs ?? r.carbohydrates ?? r.carbs_g, 0);
  const fat = n(r.fat ?? r.fat_g, 0);
  return {
    calories, protein, carbs, fat,
    waterMl: n(r.waterMl ?? r.water_ml ?? r.water, Math.round(calories)),
    tdee: n(r.tdee, 0) || null,
    bmr: n(r.bmr, 0) || null,
    note: r.note ? String(r.note).slice(0, 400) : '',
  };
}

export { CloudAgentsError };
