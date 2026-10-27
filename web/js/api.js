// Same-origin Function request helper (adapted from Qoder Sites api.ts).
(function () {
  class ApiError extends Error {
    constructor(message, code, status = 0) { super(message); this.name = 'ApiError'; this.code = code; this.status = status; }
  }
  const MESSAGES = {
    login_required: 'Sign in to continue.',
    invalid_user_context: 'Access could not be verified. Please reload.',
    access_denied: 'Check your site access and sign in again.',
    network_error: 'Network problem. Check the current state before retrying.',
    invalid_response: 'The service returned an unexpected response.',
    profile_unavailable: 'Result unavailable. Reload to check before saving again.',
    write_rejected: 'The save was rejected. Correct the input and retry.',
    write_result_unknown: 'The save result is unknown. Reload to check before saving again.',
    service_not_configured: 'AI is not configured yet on this site.',
    ai_not_configured: 'AI is not configured yet on this site.',
    ai_initialization_pending: 'AI is warming up — try again in a few seconds.',
    ai_rate_limited: 'AI is busy right now. Please try again shortly.',
    ai_service_unavailable: 'AI service is temporarily unavailable.',
    ai_request_unknown: 'AI result unknown. Check the log before retrying.',
    ai_access_denied: 'AI access denied.',
    ai_timeout: 'AI took too long to respond. Please try again.',
    quota_exceeded: "You've reached today's AI limit. It resets tomorrow.",
    invalid_input: 'Please check your input.',
  };

  async function requestJson(url, init = {}, messages = {}) {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    let response;
    try {
      response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new ApiError(MESSAGES.network_error, 'network_error');
    }
    if (response.status === 401) throw new ApiError(MESSAGES.login_required, 'login_required', 401);
    if (response.status === 403) throw new ApiError(MESSAGES.access_denied, 'access_denied', 403);
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) {
      throw new ApiError(MESSAGES.invalid_response, 'invalid_response', response.status);
    }
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError(MESSAGES.invalid_response, 'invalid_response', response.status); }
    const body = data && typeof data === 'object' ? data : null;
    const code = typeof body?.error === 'string' ? body.error
      : (!response.ok || body?.ok === false) && typeof body?.code === 'string' ? body.code
        : response.ok ? null : 'request_failed';
    if (!response.ok || body?.ok === false || code) {
      const resolved = code ?? 'request_failed';
      const message = messages[resolved] || MESSAGES[resolved] || 'The request failed. Check the current state before retrying.';
      throw new ApiError(message, resolved, response.status);
    }
    return data;
  }

  function isWriteOutcomeUnknown(error) {
    if (!(error instanceof ApiError) || error.status === 401 || error.status === 403) return false;
    if (error.code === 'write_rejected') return false;
    return ['network_error', 'invalid_response', 'write_result_unknown'].includes(error.code)
      || (error.status >= 500 && error.status < 600);
  }

  const API = '/functions/v1/app';
  window.Api = { requestJson, ApiError, isWriteOutcomeUnknown, MESSAGES, API };
})();
