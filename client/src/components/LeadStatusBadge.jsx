const styles = {
  NEW: 'bg-slate-100 text-slate-700', ASSIGNED: 'bg-blue-100 text-blue-800', CONTACTED: 'bg-cyan-100 text-cyan-800',
  INTERESTED: 'bg-violet-100 text-violet-800', FOLLOW_UP_SCHEDULED: 'bg-amber-100 text-amber-800',
  CONVERTED: 'bg-emerald-100 text-emerald-800', NOT_INTERESTED: 'bg-rose-100 text-rose-800',
  NO_RESPONSE: 'bg-orange-100 text-orange-800', INVALID_NUMBER: 'bg-red-100 text-red-800',
};

export const leadStatuses = ['NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_SCHEDULED', 'CONVERTED', 'NOT_INTERESTED', 'NO_RESPONSE', 'INVALID_NUMBER'];
export const displayStatus = (status = '') => status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function LeadStatusBadge({ status }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[status] || styles.NEW}`}>{displayStatus(status)}</span>;
}
