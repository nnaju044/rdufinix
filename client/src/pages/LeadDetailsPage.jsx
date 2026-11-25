import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { leadApi } from '../services/api/leads.js';
import { useAuth } from '../context/AuthContext.jsx';
import LeadForm from '../components/LeadForm.jsx';
import LeadStatusBadge, { displayStatus, leadStatuses } from '../components/LeadStatusBadge.jsx';
import ActivityTimeline from '../components/ActivityTimeline.jsx';
import FollowUpPanel from '../components/FollowUpPanel.jsx';

function Card({ title, children, action }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="mb-4 flex items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">{title}</h2>{action}</div>{children}</section>;
}

export default function LeadDetailsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const canWorkLead = ['admin', 'salesperson'].includes(user.role);
  const [lead, setLead] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventPage, setEventPage] = useState(1);
  const [eventPages, setEventPages] = useState(1);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [notes, setNotes] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [noteError, setNoteError] = useState('');
  const [pageError, setPageError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setPageError('');
    try {
      const [nextLead, eventResult, noteResult, followUpResult] = await Promise.all([
        leadApi.get(id), leadApi.events(id, { limit: 50 }), leadApi.notes(id, { limit: 50 }), leadApi.followUps(id, { limit: 50 }),
      ]);
      setLead(nextLead); setStatus(nextLead.status); setSelectedAssignee(nextLead.assignedTo?._id || nextLead.assignedTo || '');
      setEvents(eventResult.items); setEventPage(1); setEventPages(eventResult.pagination.pages); setNotes(noteResult.items); setFollowUps(followUpResult.items);
      if (isAdmin) setAssignees(await leadApi.assignees());
    } catch (err) { setPageError(err.response?.data?.error?.message || 'Could not load this lead.'); }
    finally { setLoading(false); }
  }, [id, isAdmin]);
  useEffect(() => { void load(); }, [load]);

  async function runAction(action) {
    setSaving(true); setActionError('');
    try { await action(); await load(); return true; }
    catch (err) { setActionError(err.response?.data?.error?.message || 'That action could not be completed.'); return false; }
    finally { setSaving(false); }
  }
  async function addNote(event) {
    event.preventDefault(); setNoteError('');
    try { await leadApi.addNote(id, noteBody); setNoteBody(''); await load(); }
    catch (err) { setNoteError(err.response?.data?.error?.message || 'Could not add note.'); }
  }
  async function loadOlderEvents() {
    setLoadingEvents(true);
    try {
      const result = await leadApi.events(id, { page: eventPage + 1, limit: 50 });
      setEvents((current) => [...current, ...result.items]); setEventPage(result.pagination.page); setEventPages(result.pagination.pages);
    } catch (err) { setActionError(err.response?.data?.error?.message || 'Could not load older activity.'); }
    finally { setLoadingEvents(false); }
  }

  if (loading) return <main className="mx-auto max-w-6xl px-4 py-10 text-center text-slate-500">Loading lead…</main>;
  if (pageError || !lead) return <main className="mx-auto max-w-3xl px-4 py-8"><Link to="/leads" className="text-sm text-indigo-700">← All leads</Link><div role="alert" className="mt-4 rounded-xl bg-red-50 p-5 text-red-800">{pageError || 'Lead was not found.'}<button onClick={() => void load()} className="ml-3 font-semibold underline">Retry</button></div></main>;

  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link to="/leads" className="text-sm font-medium text-indigo-700 hover:underline">← All leads</Link><div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold text-slate-950">{lead.name}</h1><LeadStatusBadge status={lead.status} /></div><p className="mt-1 text-sm text-slate-500">{lead.leadId} · Added {new Date(lead.createdAt).toLocaleDateString()}</p></div>
      {isAdmin && !editing && <div className="flex gap-2"><button onClick={() => setEditing(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium">Edit lead</button>{!lead.isArchived ? <button disabled={saving} onClick={() => void runAction(() => leadApi.update(id, { isArchived: true }))} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700">Archive</button> : <button disabled={saving} onClick={() => void runAction(() => leadApi.update(id, { isArchived: false }))} className="rounded-lg border px-3 py-2 text-sm">Restore</button>}</div>}
    </div>
    {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
    {editing && <Card title="Edit lead"><LeadForm value={lead} submitLabel="Save changes" onCancel={() => setEditing(false)} onSubmit={async (values) => { await leadApi.update(id, values); setEditing(false); await load(); }} /></Card>}

    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <Card title="Lead details">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2"><div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Phone</dt><dd className="mt-1 text-sm text-slate-900">{lead.phone}</dd></div><div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</dt><dd className="mt-1 break-all text-sm text-slate-900">{lead.email || '—'}</dd></div><div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Source</dt><dd className="mt-1 text-sm text-slate-900">{lead.source}</dd></div><div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Priority</dt><dd className="mt-1 text-sm text-slate-900">{lead.priority}</dd></div><div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Assigned to</dt><dd className="mt-1 text-sm text-slate-900">{lead.assignedTo?.name || 'Unassigned'}</dd></div><div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Last contacted</dt><dd className="mt-1 text-sm text-slate-900">{lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleString() : '—'}</dd></div></dl>
        </Card>
        {isAdmin && !lead.isArchived && <Card title="Assignment">
          <div className="flex flex-wrap gap-2"><select aria-label="Assign salesperson" value={selectedAssignee} onChange={(event) => setSelectedAssignee(event.target.value)} className="min-w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Choose a salesperson</option>{assignees.map((person) => <option key={person._id} value={person._id}>{person.name} · {person.email}</option>)}</select><button disabled={!selectedAssignee || saving || String(selectedAssignee) === String(lead.assignedTo?._id || lead.assignedTo || '')} onClick={() => void runAction(() => leadApi.assign(id, selectedAssignee))} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Assign / reassign</button></div>
        </Card>}
        {canWorkLead && !lead.isArchived && <Card title="Update status">
          <div className="flex flex-wrap gap-2"><select aria-label="Lead status" value={status} onChange={(event) => setStatus(event.target.value)} className="min-w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">{leadStatuses.map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}</select><button disabled={saving || status === lead.status} onClick={() => void runAction(() => leadApi.changeStatus(id, status))} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Save status</button></div>
        </Card>}
        <Card title="Follow-ups"><FollowUpPanel followUps={followUps} canManage={canWorkLead && !lead.isArchived} onCreate={async (values) => { if (!(await runAction(() => leadApi.createFollowUp(id, values)))) throw new Error('Follow-up could not be scheduled'); }} onComplete={(followUpId) => void runAction(() => leadApi.completeFollowUp(followUpId))} /></Card>
        <Card title="Internal notes">
          {canWorkLead && !lead.isArchived && <form onSubmit={addNote} className="space-y-2"><label className="sr-only" htmlFor="lead-note">Add an internal note</label><textarea id="lead-note" required maxLength="5000" rows="3" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="Record a useful detail for the team…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />{noteError && <p role="alert" className="text-sm text-red-700">{noteError}</p>}<button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">Add note</button></form>}
          <ul className="mt-4 space-y-3">{notes.map((note) => <li key={note._id} className="rounded-lg bg-slate-50 p-3"><p className="whitespace-pre-wrap text-sm text-slate-800">{note.body}</p><p className="mt-2 text-xs text-slate-500">{note.authorId?.name || 'Team member'} · {new Date(note.createdAt).toLocaleString()}</p></li>)}{!notes.length && <li className="text-sm text-slate-500">No internal notes yet.</li>}</ul>
        </Card>
      </div>
      <Card title="Activity history"><ActivityTimeline events={events} hasMore={eventPage < eventPages} onLoadMore={() => void loadOlderEvents()} loadingMore={loadingEvents} /></Card>
    </div>
  </main>;
}
