import { useAuth } from '../context/AuthContext.jsx';
import { Link } from 'react-router-dom';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  return <main className="min-h-screen bg-slate-50">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4"><div><h1 className="font-semibold text-slate-900">EduFinix CRM</h1><p className="text-sm text-slate-500">Signed in as {user.name} · {user.role}</p></div><nav className="flex items-center gap-2"><Link to="/leads" className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50">Leads</Link>{user.role === 'admin' && <Link to="/imports/leads" className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50">Import</Link>}<button onClick={logout} className="rounded border px-3 py-2 text-sm">Sign out</button></nav></header>
    <section className="mx-auto max-w-5xl p-6"><h2 className="text-xl font-semibold text-slate-900">Dashboard</h2><p className="mt-2 text-slate-600">Your protected workspace is ready.</p><Link to="/leads" className="mt-5 inline-flex rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-medium text-white">Open lead management</Link></section>
  </main>;
}
