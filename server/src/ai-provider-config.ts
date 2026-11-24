import { createGeminiProvider } from './gemini.js';
import { createGroqProvider } from './groq.js';
import { logTrainingPlanDiagnostic } from './training-plan-diagnostics.js';

export function selectAiProvider(env: Record<string, string | undefined>) {
  switch (env.AI_PROVIDER?.trim().toLowerCase() || 'groq') {
    case 'groq': {
      const provider = createGroqProvider(env.GROQ_API_KEY?.trim(), env.GROQ_MODEL?.trim() || undefined);
      if (!provider) logTrainingPlanDiagnostic('configuration', 'missing_api_key', undefined, 'groq');
      return provider;
    }
    case 'gemini': {
      const provider = createGeminiProvider(env.GEMINI_API_KEY?.trim(), env.GEMINI_MODEL?.trim() || undefined);
      if (!provider) logTrainingPlanDiagnostic('configuration', 'missing_api_key', undefined, 'gemini');
      return provider;
    }
    default:
      logTrainingPlanDiagnostic('configuration', 'unknown_provider');
      return undefined;
  }
}
