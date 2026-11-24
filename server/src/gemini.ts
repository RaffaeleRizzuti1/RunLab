import { setTimeout as wait } from 'node:timers/promises';
import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import { aiMaxOutputTokens, aiRequestTimeoutMs, AiProviderError, trainingPlanInstructions, type AiProvider } from './ai-provider.js';
import { planSchema } from './training-plan.js';
import { logTrainingPlanDiagnostic } from './training-plan-diagnostics.js';

export const defaultGeminiModel = 'gemini-3.5-flash-lite';

type GeminiResult = Pick<Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>, 'text' | 'candidates'>;

function retryAfterMs(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

export function createGeminiProvider(
  apiKey?: string,
  model = defaultGeminiModel,
  request?: (params: GenerateContentParameters) => Promise<GeminiResult>,
  timeoutMs = aiRequestTimeoutMs,
): AiProvider | undefined {
  if (!apiKey || apiKey === 'your_gemini_api_key_here') return undefined;
  const client = request ? undefined : new GoogleGenAI({ apiKey, vertexai: false, enterprise: false });
  const diagnostic = (stage: Parameters<typeof logTrainingPlanDiagnostic>[0], rule: string,
    values?: Record<string, number | undefined>) => logTrainingPlanDiagnostic(stage, rule, values, 'gemini');
  const generate = request ?? ((params: GenerateContentParameters) => client!.models.generateContent(params));

  return {
    name: 'gemini',
    async generate(context) {
      const signal = AbortSignal.timeout(timeoutMs);
      const deadline = performance.now() + timeoutMs;
      const remaining = () => Math.ceil(deadline - performance.now());
      let result: GeminiResult;
      let attempt = 1;
      const contents = JSON.stringify(context);
      for (;;) {
        const timeLeft = remaining();
        if (signal.aborted || timeLeft <= 0) throw new AiProviderError('timeout');
        let retryAfter = 0;
        let received503 = false;
        try {
          result = await generate({
            model,
            contents,
            config: {
              systemInstruction: trainingPlanInstructions,
              responseMimeType: 'application/json',
              responseJsonSchema: planSchema,
              maxOutputTokens: aiMaxOutputTokens,
              abortSignal: signal,
              httpOptions: {
                timeout: timeLeft,
                retryOptions: { attempts: 1 },
                // The SDK's ApiError discards response headers.
                fetch: async (input, init) => {
                  const response = await fetch(input, init);
                  if (response.status === 503) {
                    received503 = true;
                    retryAfter = retryAfterMs(response.headers.get('Retry-After'));
                  }
                  return response;
                },
              },
            },
          });
          break;
        } catch (error) {
          const status = received503 ? 503
            : typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
          if (signal.aborted || remaining() <= 0 || status === 408 || status === 504
            || (error instanceof Error && ['AbortError', 'TimeoutError', 'RequestTimeoutError'].includes(error.name))) {
            throw new AiProviderError('timeout');
          }
          if (status === 503) {
            const delayMs = Math.max(retryAfter, 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 101));
            if (attempt >= 3 || delayMs >= remaining()) {
              diagnostic('provider_request', 'temporarily_unavailable', { upstreamStatus: 503, attempt });
              throw new AiProviderError('unavailable');
            }
            diagnostic('provider_request', 'retrying_unavailable', { upstreamStatus: 503, attempt, delayMs });
            try {
              await wait(delayMs, undefined, { signal });
            } catch {
              throw new AiProviderError('timeout');
            }
            attempt++;
            continue;
          }
          if (status !== 429) {
            diagnostic('provider_request', 'request_failed', {
              upstreamStatus: typeof status === 'number' ? status : undefined,
            });
          }
          if (status === 401 || status === 403) throw new AiProviderError('authentication');
          if (status === 404) throw new AiProviderError('unsupported-model');
          throw new AiProviderError(status === 429 ? 'rate-limited' : 'upstream');
        }
      }
      if (signal.aborted || remaining() <= 0) throw new AiProviderError('timeout');
      if (result.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        diagnostic('structured_output', 'model_reached_output_token_limit', { maxOutputTokens: aiMaxOutputTokens });
      }
      const text = result.text;
      if (!text) {
        diagnostic('structured_output', 'empty_model_text');
        throw new AiProviderError('invalid-plan');
      }
      return text;
    },
  };
}
