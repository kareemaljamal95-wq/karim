import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, clearToken, getToken, setToken } from './api';
import type { Role, SystemStatus, User } from './types';

/* -------------------------------------------------------------------------- */
/* Theme                                                                       */
/* -------------------------------------------------------------------------- */

type Theme = 'light' | 'dark';
const THEME_KEY = 'ai-ceo-theme';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): ThemeContextValue => useContext(ThemeContext);

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Role-hierarchy check: admin > operator > analyst > viewer. */
  can: (minimum: Role) => boolean;
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, analyst: 1, operator: 2, admin: 3 };

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  can: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<{ user: User }>('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const can = useCallback(
    (minimum: Role) => (user ? ROLE_RANK[user.role] >= ROLE_RANK[minimum] : false),
    [user],
  );

  const value = useMemo(() => ({ user, loading, login, logout, can }), [user, loading, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => useContext(AuthContext);

/* -------------------------------------------------------------------------- */
/* Data fetching                                                               */
/* -------------------------------------------------------------------------- */

export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

/** Minimal fetch-on-mount hook with a manual refetch trigger. */
export function useQuery<T>(path: string | null, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong');
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  const refetch = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, refetch };
}

/* -------------------------------------------------------------------------- */
/* System status (demo vs live banner)                                         */
/* -------------------------------------------------------------------------- */

const StatusContext = createContext<{ status: SystemStatus | null; refresh: () => void }>({
  status: null,
  refresh: () => {},
});

export function StatusProvider({ children }: { children: ReactNode }) {
  const { data, refetch } = useQuery<SystemStatus>('/system/status');
  const value = useMemo(() => ({ status: data, refresh: refetch }), [data, refetch]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export const useSystemStatus = () => useContext(StatusContext);

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */

export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

const ToastContext = createContext<{
  toasts: Toast[];
  push: (tone: Toast['tone'], message: string) => void;
  dismiss: (id: number) => void;
}>({ toasts: [], push: () => {}, dismiss: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: Toast['tone'], message: string) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current, { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);

/** Wraps an async action with loading state and toast feedback. */
export function useAction() {
  const { push } = useToast();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      options: { success?: string; onSuccess?: (result: T) => void } = {},
    ): Promise<T | null> => {
      setPending(true);
      try {
        const result = await fn();
        if (options.success) push('success', options.success);
        options.onSuccess?.(result);
        return result;
      } catch (error) {
        push('error', error instanceof ApiError ? error.message : 'Something went wrong');
        return null;
      } finally {
        setPending(false);
      }
    },
    [push],
  );

  return { run, pending };
}
