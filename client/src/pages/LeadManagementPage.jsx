import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { leadApi } from '../services/api/leads.js';
import { useAuth } from '../context/AuthContext.jsx';
import LeadFilters from '../components/LeadFilters.jsx';
import LeadTable from '../components/LeadTable.jsx';

const EMPTY_FILTERS = { q: '', status: '', priority: '', archived: 'false', page: 1 };

export default function LeadManagementPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [result, setResult] = useState({ items: [], pagination: { page: 1, pages: 0, total: 0, limit: 20 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setResult(await leadApi.list({ ...filters, limit: 20 })); }
    catch (err) { setError(err.response?.data?.error?.message || 'Could not load leads.'); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);

  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-indigo-700">CRM workspace</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">Lead management</h1><p className="mt-1 text-sm text-slate-600">Search and manage your lead pipeline.</p></div>
      {user.role === 'admin' && <div className="flex gap-2"><Link to="/imports/leads" className="rounded-lg border border-indigo-200 px-4 py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50">Import spreadsheet</Link><Link to="/leads/new" className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-800">Add lead</Link></div>}
    </header>
    <LeadFilters filters={filters} onChange={setFilters} canViewArchived={user.role !== 'salesperson'} />
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"><span>{error}</span><button onClick={() => void load()} className="font-semibold underline">Retry</button></div>}
    {loading ? <div className="rounded-xl border bg-white p-10 text-center text-sm text-slate-500">Loading leads…</div> : <>
      <p className="text-sm text-slate-500">{result.pagination.total} {result.pagination.total === 1 ? 'lead' : 'leads'}</p>
      <LeadTable items={result.items} role={user.role} />
      {result.pagination.pages > 1 && <nav aria-label="Lead pages" className="flex items-center justify-between"><button disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-sm text-slate-600">Page {filters.page} of {result.pagination.pages}</span><button disabled={filters.page >= result.pagination.pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Next</button></nav>}
    </>}
  </main>;
}
