const baseUrl = 'https://personal.connectapi.garmin.com';
const tokenPath = '/personalapitoken-service/personal-api/personal-api-key/token';
const activitiesPath = '/activitylist-service/activities/search/activities?start=0&limit=5';
const refreshBufferMs = 60_000;

type AccessToken = { value: string; expiresAt: number };

export class GarminError extends Error {
  constructor(readonly kind: 'not-configured' | 'rate-limited') {
    super(kind);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Unexpected Garmin response');
  }
  return value as Record<string, unknown>;
}

function readToken(value: string): AccessToken {
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[\w-]+$/.test(part))) {
    throw new Error('Invalid Garmin token');
  }

  // The expiration claim is used only to schedule cache refresh.
  const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const { exp } = asRecord(payload);
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp * 1_000 <= Date.now()) {
    throw new Error('Invalid Garmin token expiration');
  }
  return { value, expiresAt: exp * 1_000 };
}

function summarizeActivity(value: unknown) {
  const activity = asRecord(value);
  const type = activity.activityType == null ? {} : asRecord(activity.activityType);
  return {
    name: typeof activity.activityName === 'string' ? activity.activityName : undefined,
    date: typeof activity.startTimeLocal === 'string' ? activity.startTimeLocal.slice(0, 10) : undefined,
    activityType: typeof type.typeKey === 'string' ? type.typeKey : undefined,
    distance: typeof activity.distance === 'number' ? activity.distance : undefined,
    duration: typeof activity.duration === 'number' ? activity.duration : undefined,
    averageHeartRate: typeof activity.averageHR === 'number' ? activity.averageHR : undefined,
  };
}

export function createGarminClient(apiKey?: string, request: typeof fetch = fetch) {
  let cachedToken: AccessToken | undefined;
  let pendingToken: Promise<AccessToken> | undefined;

  async function send(path: string, method: 'GET' | 'POST', authorization: string) {
    const response = await request(baseUrl + path, {
      method,
      headers: { Authorization: authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429) {
      await response.body?.cancel();
      throw new GarminError('rate-limited');
    }
    return response;
  }

  async function getToken() {
    if (!apiKey || apiKey === 'your_personal_api_key_here') {
      throw new GarminError('not-configured');
    }
    if (cachedToken && Date.now() < cachedToken.expiresAt - refreshBufferMs) {
      return cachedToken;
    }

    pendingToken ??= (async () => {
      try {
        const response = await send(tokenPath, 'POST', `ApiKey ${apiKey}`);
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('Garmin token exchange failed');
        }
        cachedToken = readToken((await response.text()).trim());
        return cachedToken;
      } finally {
        pendingToken = undefined;
      }
    })();

    return pendingToken;
  }

  return {
    async getActivities() {
      const token = await getToken();
      const response = await send(activitiesPath, 'GET', `Bearer ${token.value}`);
      if (!response.ok) {
        if (response.status === 401 && cachedToken === token) {
          cachedToken = undefined;
        }
        await response.body?.cancel();
        throw new Error('Garmin activity search failed');
      }
      if (response.status === 204) {
        return [];
      }

      const activities: unknown = await response.json();
      if (!Array.isArray(activities)) {
        throw new Error('Unexpected Garmin activity list');
      }
      return activities.slice(0, 5).map(summarizeActivity);
    },
  };
}
