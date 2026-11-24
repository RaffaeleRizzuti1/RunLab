import type { AiProviderName } from './ai-provider.js';

type DiagnosticStage = 'provider_request' | 'configuration' | 'structured_output' | 'safety_validation' | 'history_context' | 'backend';

export function logTrainingPlanDiagnostic(
  stage: DiagnosticStage, rule: string, values?: Record<string, number | undefined>, provider?: AiProviderName,
): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.warn('[RunLab training plan]', { ...(provider ? { provider } : {}), stage, rule, ...values });
}
