import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  if (ready && user) return <Navigate to="/dashboard" replace />;
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await login({ email, password }); navigate(location.state?.from?.pathname || '/dashboard', { replace: true }); }
    catch (err) { setError(err.response?.data?.error?.message || 'Unable to sign in. Try again.'); }
    finally { setBusy(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-slate-100 px-4">
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl bg-white p-8 shadow-sm">
      <header><h1 className="text-2xl font-semibold text-slate-900">EduFinix CRM</h1><p className="mt-1 text-sm text-slate-600">Sign in to your account</p></header>
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <label className="block text-sm font-medium text-slate-700">Email<input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <label className="block text-sm font-medium text-slate-700">Password<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <button disabled={busy} className="w-full rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60">{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </main>;
}
