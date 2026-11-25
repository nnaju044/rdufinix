import LeadStatusBadge, { displayStatus } from './LeadStatusBadge.jsx';

const labels = {
  LEAD_CREATED: 'Lead created', LEAD_UPDATED: 'Lead updated', LEAD_ARCHIVED: 'Lead archived',
  LEAD_ASSIGNED: 'Lead assigned', LEAD_REASSIGNED: 'Lead reassigned', STATUS_CHANGED: 'Status changed',
  NOTE_ADDED: 'Internal note added', FOLLOWUP_CREATED: 'Follow-up scheduled', FOLLOWUP_COMPLETED: 'Follow-up completed', FOLLOWUP_TRANSFERRED: 'Follow-up transferred',
};

export default function ActivityTimeline({ events, loading, emptyMessage = 'No activity yet.', hasMore = false, onLoadMore, loadingMore = false }) {
  if (loading) return <p className="py-5 text-sm text-slate-500">Loading activity…</p>;
  if (!events.length) return <p className="py-5 text-sm text-slate-500">{emptyMessage}</p>;
  return <ol className="space-y-5">{events.map((item) => <li key={item._id} className="relative flex gap-3">
    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500 ring-4 ring-indigo-50" />
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-900">{labels[item.eventType] || item.eventType}</p><time className="text-xs text-slate-500">{new Date(item.timestamp).toLocaleString()}</time></div>
      <p className="mt-1 text-sm text-slate-600">{item.description}</p><p className="mt-1 text-xs text-slate-500">{item.actorId?.name || 'System'}</p>
      {item.eventType === 'STATUS_CHANGED' && typeof item.previousValue === 'string' && <p className="mt-2 flex items-center gap-2 text-xs"><LeadStatusBadge status={item.previousValue} /><span aria-hidden>→</span><LeadStatusBadge status={item.newValue} /></p>}
      {item.eventType.includes('ASSIGN') && item.newValue?.assignedTo && <p className="mt-1 text-xs text-slate-500">New owner reference recorded</p>}
    </div>
  </li>)}{hasMore && <li className="pl-5"><button disabled={loadingMore} onClick={onLoadMore} className="text-sm font-medium text-indigo-700 hover:underline disabled:opacity-50">{loadingMore ? 'Loading older activity…' : 'Load older activity'}</button></li>}</ol>;
}
