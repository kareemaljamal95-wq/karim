const TOKEN_KEY = 'ai-ceo-token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    // A 401 means the session expired — drop the token so the shell can redirect.
    if (response.status === 401) clearToken();
    const error = (payload as { error?: { message?: string; code?: string; details?: unknown } })?.error;
    throw new ApiError(
      response.status,
      error?.message ?? `Request failed with status ${response.status}`,
      error?.code,
      error?.details,
    );
  }

  return payload as T;
}

export const downloadCsv = async (path: string, filename: string): Promise<void> => {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new ApiError(response.status, 'Export failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
