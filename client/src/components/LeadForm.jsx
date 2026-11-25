import { useState } from 'react';

const initial = { name: '', phone: '', email: '', source: '', priority: 'MEDIUM' };

export default function LeadForm({ value, onSubmit, onCancel, submitLabel = 'Save lead' }) {
  const [form, setForm] = useState(() => ({ ...initial, ...(value ? Object.fromEntries(Object.keys(initial).map((key) => [key, value[key] ?? initial[key]])) : {}) }));
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [busy, setBusy] = useState(false);

  async function save(confirmDuplicate = false) {
    setBusy(true); setError('');
    try { await onSubmit({ ...form, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }); }
    catch (err) {
      const result = err.response?.data?.error;
      if (result?.code === 'DUPLICATE_LEAD') setDuplicates(result.details?.duplicates || []);
      else setError(result?.message || 'Could not save this lead. Please try again.');
    } finally { setBusy(false); }
  }
  function submit(event) { event.preventDefault(); setDuplicates([]); void save(false); }

  return <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-slate-700">Name *<input required maxLength="160" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
      <label className="text-sm font-medium text-slate-700">Phone with country code *<input required maxLength="40" placeholder="+1 415 555 0198" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
      <label className="text-sm font-medium text-slate-700">Email<input type="email" maxLength="254" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
      <label className="text-sm font-medium text-slate-700">Source *<input required maxLength="120" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
      <label className="text-sm font-medium text-slate-700">Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => <option key={priority}>{priority}</option>)}</select></label>
    </div>
    {duplicates.length > 0 && <aside className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">{duplicates[0].duplicateType === 'exact' ? 'Exact phone match' : 'Possible phone matches'}</p>
      <ul className="mt-2 list-inside list-disc">{duplicates.map((match) => <li key={match.leadId}>{match.name} · {match.leadId} · {match.phone}</li>)}</ul>
      <p className="mt-2">No records will be merged. Confirm only if this is a separate lead.</p>
      <button type="button" disabled={busy} onClick={() => void save(true)} className="mt-3 rounded-lg bg-amber-900 px-3 py-2 font-medium text-white disabled:opacity-50">Create separate lead</button>
    </aside>}
    <div className="flex flex-wrap gap-2"><button disabled={busy} className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-50">{busy ? 'Saving…' : submitLabel}</button>{onCancel && <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700">Cancel</button>}</div>
  </form>;
}
