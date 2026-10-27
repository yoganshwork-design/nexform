// AI client — calls the same-origin Function which talks to Qoder Cloud Agents.
(function () {
  const AI = {};

  async function call(action, body) {
    const res = await Api.requestJson(`${Api.API}?action=${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res && res.quota && window.State) State.setQuota(res.quota);
    return res;
  }

  // Describe-a-meal: returns {name, calories, protein, carbs, fat, confidence, note}
  AI.analyzeFood = async function (text, category) {
    const res = await call('ai-food', { text, category, context: State.aiContext() });
    return res.result;
  };

  // Food link / dish name: returns same shape
  AI.analyzeUrl = async function (urlOrDish) {
    const res = await call('ai-url', { url: urlOrDish, context: State.aiContext() });
    return res.result;
  };

  // Strength set burn: {sets, reps, weightKg, exercise, restSec} -> {caloriesBurned, met, note}
  AI.estimateLiftBurn = async function (payload) {
    const res = await call('ai-burn', { kind: 'lift', ...payload, context: State.aiContext() });
    return res.result;
  };

  // Cardio burn: {activity, minutes, intensity} -> {caloriesBurned, met, note}
  AI.estimateCardioBurn = async function (payload) {
    const res = await call('ai-burn', { kind: 'cardio', ...payload, context: State.aiContext() });
    return res.result;
  };

  // Coach chat: {message, history} -> {reply}
  AI.chat = async function (message, history) {
    const res = await call('ai-chat', { message, history, context: State.aiContext() });
    return res.result.reply;
  };

  // AI-planned daily calorie + macro targets from the persisted profile & lifestyle meta.
  // Returns {calories, protein, carbs, fat, waterMl, bmr, tdee, note}.
  AI.estimateTargets = async function () {
    const res = await call('ai-targets', { context: State.aiContext() });
    return res.result;
  };

  window.AI = AI;
})();
