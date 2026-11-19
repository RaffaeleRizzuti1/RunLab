import { useEffect, useState } from 'react';

type ConnectionStatus = 'checking' | 'connected' | 'error' | 'timeout';

const messages: Record<ConnectionStatus, string> = {
  checking: 'Checking backend connection…',
  connected: 'Backend connected',
  error: 'Could not connect to the RunLab backend. Check that the server is running and reload the page.',
  timeout: 'The RunLab backend did not respond within 5 seconds. Reload the page to try again.',
};

export function App() {
  const [status, setStatus] = useState<ConnectionStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      setStatus('timeout');
    }, 5_000);

    async function checkHealth() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Health check returned HTTP ${response.status}`);
        }

        const health: unknown = await response.json();
        if (
          typeof health !== 'object' ||
          health === null ||
          !('status' in health) ||
          health.status !== 'ok' ||
          !('app' in health) ||
          health.app !== 'RunLab'
        ) {
          throw new Error('Unexpected health response');
        }

        if (!controller.signal.aborted) {
          setStatus('connected');
        }
      } catch {
        if (!controller.signal.aborted) {
          setStatus('error');
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void checkHealth();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  return (
    <main>
      <h1>RunLab</h1>
      <p role="status">{messages[status]}</p>
    </main>
  );
}
