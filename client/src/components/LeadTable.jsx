import { Link } from 'react-router-dom';
import LeadStatusBadge from './LeadStatusBadge.jsx';

export default function LeadTable({ items, role }) {
  if (!items.length) return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
    <h3 className="font-semibold text-slate-900">No leads found</h3><p className="mt-1 text-sm text-slate-500">Try changing the search or filters.</p>
  </div>;
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] divide-y divide-slate-200 text-left text-sm">
      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Lead</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Priority</th><th className="px-5 py-3">Assigned to</th><th className="px-5 py-3">Next follow-up</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{items.map((lead) => <tr key={lead._id} className="hover:bg-slate-50">
        <td className="px-5 py-4"><Link to={`/leads/${lead.leadId}`} className="font-semibold text-indigo-700 hover:text-indigo-900">{lead.name}</Link><p className="mt-0.5 text-xs text-slate-500">{lead.leadId} · {lead.source}</p></td>
        <td className="px-5 py-4 text-slate-700">{lead.phone}</td><td className="px-5 py-4"><LeadStatusBadge status={lead.status} /></td>
        <td className="px-5 py-4 text-slate-700">{lead.priority}</td><td className="px-5 py-4 text-slate-700">{lead.assignedTo?.name || (role === 'salesperson' ? 'You' : 'Unassigned')}</td>
        <td className="px-5 py-4 text-slate-600">{lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString() : '—'}</td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}
