import { useState } from 'react';

function toLocalInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function FollowUpPanel({ followUps, canManage, onCreate, onComplete }) {
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await onCreate({ scheduledAt: new Date(scheduledAt).toISOString(), notes }); setNotes(''); }
    catch (err) { setError(err.response?.data?.error?.message || 'Could not schedule follow-up.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    {canManage && <form onSubmit={submit} className="rounded-lg bg-slate-50 p-3">
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      <label className="block text-sm font-medium text-slate-700">Schedule for<input required type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
      <label className="mt-3 block text-sm font-medium text-slate-700">Note (optional)<input maxLength="2000" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
      <button disabled={busy} className="mt-3 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Scheduling…' : 'Schedule follow-up'}</button>
    </form>}
    {!followUps.length ? <p className="py-3 text-sm text-slate-500">No follow-ups scheduled.</p> : <ul className="divide-y divide-slate-100">{followUps.map((item) => <li key={item._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><p className="font-medium text-slate-800">{new Date(item.scheduledAt).toLocaleString()}</p><p className="mt-0.5 text-xs text-slate-500">{item.status} · {item.assignedTo?.name || ''}{item.notes ? ` · ${item.notes}` : ''}</p></div>
      {canManage && item.status === 'pending' && <button onClick={() => onComplete(item._id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">Complete</button>}
    </li>)}</ul>}
  </div>;
}
