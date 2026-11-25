import { Link, useNavigate } from 'react-router-dom';
import LeadForm from '../components/LeadForm.jsx';
import { leadApi } from '../services/api/leads.js';

export default function LeadCreatePage() {
  const navigate = useNavigate();
  async function submit(values) {
    const lead = await leadApi.create(values);
    navigate(`/leads/${lead.leadId}`, { replace: true });
  }
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
    <div><Link to="/leads" className="text-sm font-medium text-indigo-700 hover:underline">← All leads</Link><h1 className="mt-3 text-2xl font-semibold text-slate-950">Create lead</h1><p className="mt-1 text-sm text-slate-600">Phone numbers must include an international country code.</p></div>
    <LeadForm onSubmit={submit} />
  </main>;
}
