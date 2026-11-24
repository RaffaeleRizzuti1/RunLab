import { aiMaxOutputTokens, aiRequestTimeoutMs, AiProviderError, trainingPlanInstructions, type AiProvider } from './ai-provider.js';
import { planSchema } from './training-plan.js';
import { logTrainingPlanDiagnostic } from './training-plan-diagnostics.js';

export const defaultGroqModel = 'openai/gpt-oss-120b';
const strictModels = new Set([defaultGroqModel, 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'meta-models/muse-spark-open']);
const endpoint = 'https://api.groq.com/openai/v1/chat/completions';

export function createGroqProvider(
  apiKey?: string, model = defaultGroqModel, request: typeof fetch = fetch, timeoutMs = aiRequestTimeoutMs,
): AiProvider | undefined {
  if (!apiKey || apiKey === 'your_groq_api_key_here') return undefined;
  return {
    name: 'groq',
    async generate(context) {
      if (!strictModels.has(model)) {
        logTrainingPlanDiagnostic('configuration', 'model_lacks_strict_output_support', undefined, 'groq');
        throw new AiProviderError('unsupported-model');
      }
      const signal = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await request(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          redirect: 'error',
          signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: trainingPlanInstructions },
              { role: 'user', content: JSON.stringify(context) },
            ],
            max_completion_tokens: aiMaxOutputTokens,
            response_format: { type: 'json_schema', json_schema: { name: 'training_plan', strict: true, schema: planSchema } },
          }),
        });
      } catch {
        logTrainingPlanDiagnostic('provider_request', signal.aborted ? 'timeout' : 'request_failed', undefined, 'groq');
        throw new AiProviderError(signal.aborted ? 'timeout' : 'upstream');
      }
      if (signal.aborted) throw new AiProviderError('timeout');
      if (!response.ok) {
        const status = response.status;
        const kind = status === 429 ? 'rate-limited'
          : status === 503 || status === 502 ? 'unavailable'
          : status === 408 || status === 504 ? 'timeout'
          : status === 404 ? 'unsupported-model'
          : status === 401 || status === 403 ? 'authentication'
          : status === 422 ? 'invalid-plan' : 'upstream';
        logTrainingPlanDiagnostic('provider_request', kind, { upstreamStatus: status }, 'groq');
        void response.body?.cancel().catch(() => {});
        throw new AiProviderError(kind);
      }
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        if (signal.aborted) throw new AiProviderError('timeout');
        logTrainingPlanDiagnostic('structured_output', 'invalid_provider_response_json', undefined, 'groq');
        throw new AiProviderError('invalid-plan');
      }
      if (signal.aborted) throw new AiProviderError('timeout');
      const payload = result as { choices?: { finish_reason?: unknown; message?: { content?: unknown } }[] } | null;
      const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
      const text = choice?.message?.content;
      if (choice?.finish_reason === 'length' || typeof text !== 'string' || !text.trim()) {
        logTrainingPlanDiagnostic('structured_output',
          choice?.finish_reason === 'length' ? 'model_reached_output_token_limit' : 'empty_model_text', undefined, 'groq');
        throw new AiProviderError('invalid-plan');
      }
      return text;
    },
  };
}
