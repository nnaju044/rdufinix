import { leadStatuses, displayStatus } from './LeadStatusBadge.jsx';

export default function LeadFilters({ filters, onChange, canViewArchived = false }) {
  const change = (key, value) => onChange({ ...filters, [key]: value, page: 1 });
  return <div className={`grid gap-3 rounded-xl border border-slate-200 bg-white p-4 ${canViewArchived ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
    <label className="text-sm font-medium text-slate-700 sm:col-span-1">Search
      <input value={filters.q} onChange={(event) => change('q', event.target.value)} placeholder="Name, phone, email or lead ID" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
    </label>
    <label className="text-sm font-medium text-slate-700">Status
      <select value={filters.status} onChange={(event) => change('status', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
        <option value="">All statuses</option>{leadStatuses.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}
      </select>
    </label>
    <label className="text-sm font-medium text-slate-700">Priority
      <select value={filters.priority} onChange={(event) => change('priority', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
        <option value="">All priorities</option>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
      </select>
    </label>
    {canViewArchived && <label className="text-sm font-medium text-slate-700">Record state<select value={filters.archived} onChange={(event) => change('archived', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="false">Active leads</option><option value="true">Archived leads</option><option value="all">All leads</option></select></label>}
  </div>;
}
