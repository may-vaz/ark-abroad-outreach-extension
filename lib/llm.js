// Thin Anthropic client: timeouts, a bounded retry with backoff, plain-language errors,
// and usage/latency metrics for each call.

export const MODEL = 'claude-haiku-5-5';
const URL = 'https://api.anthropic.com/v1/messages';

export class LLMError extends Error {
  constructor(message, { retryable = false, status = 0 } = {}) { super(message); this.retryable = retryable; this.status = status; }
}

function friendly(status, apiMsg) {
  if (status === 401) return 'Your API key was rejected. Check it in Settings.';
  if (status === 403) return 'This API key does not have access to the model.';
  if (status === 429) return 'Rate limited by Anthropic. Wait a few seconds and try again.';
  if (status === 529 || status >= 500) return 'Anthropic is temporarily overloaded. Retrying usually works.';
  return apiMsg || `Request failed (${status}).`;
}

export async function callClaude({ apiKey, system, messages, tools, toolChoice, maxTokens = 600, timeoutMs = 25000, retries = 1, fetchImpl = fetch }) {
  let attempt = 0;
  const started = Date.now();
  while (true) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages, ...(tools ? { tools, tool_choice: toolChoice } : {}) })
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch { /* HTML error page from a proxy or gateway */ }
      if (!res.ok) throw new LLMError(friendly(res.status, data?.error?.message), { retryable: res.status === 429 || res.status >= 500, status: res.status });
      return { data, metrics: { latencyMs: Date.now() - started, inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, attempts: attempt + 1 } };
    } catch (err) {
      const e = err.name === 'AbortError' ? new LLMError('The request timed out.', { retryable: true }) :
        err instanceof LLMError ? err : new LLMError('Network error. Check your connection.', { retryable: true });
      if (attempt < retries && e.retryable) { attempt++; await new Promise(r => setTimeout(r, 800 * attempt)); continue; }
      throw e;
    } finally { clearTimeout(timer); }
  }
}

export function toolInput(data, name) {
  const block = (data.content || []).find(b => b.type === 'tool_use' && b.name === name);
  if (!block) throw new LLMError('The model did not return a structured result.');
  return block.input;
}
