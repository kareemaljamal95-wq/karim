import { useState, type FormEvent } from 'react';
import { BrainCircuit, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/hooks';
import { ApiError } from '../lib/api';
import { Spinner } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/20">
            <BrainCircuit className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">AI CEO</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Agentic business discovery &amp; sales automation
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@ai-ceo.local"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending && <Spinner />}
            Sign in
          </button>

          <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:bg-white/[0.03] dark:text-slate-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              First run creates an admin from <code className="font-mono">BOOTSTRAP_ADMIN_EMAIL</code> and{' '}
              <code className="font-mono">BOOTSTRAP_ADMIN_PASSWORD</code>. Change the password from Settings
              once you are in.
            </span>
          </p>
        </form>
      </div>
    </div>
  );
}
