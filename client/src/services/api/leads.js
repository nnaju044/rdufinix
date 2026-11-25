import api from './client.js';

export const leadApi = {
  list: (params) => api.get('/leads', { params }).then(({ data }) => data),
  get: (id) => api.get(`/leads/${encodeURIComponent(id)}`).then(({ data }) => data.lead),
  create: (values) => api.post('/leads', values).then(({ data }) => data.lead),
  update: (id, values) => api.patch(`/leads/${encodeURIComponent(id)}`, values).then(({ data }) => data.lead),
  assign: (id, assignedTo) => api.patch(`/leads/${encodeURIComponent(id)}/assign`, { assignedTo }).then(({ data }) => data),
  changeStatus: (id, status) => api.patch(`/leads/${encodeURIComponent(id)}/status`, { status }).then(({ data }) => data.lead),
  events: (id, params = {}) => api.get(`/leads/${encodeURIComponent(id)}/events`, { params }).then(({ data }) => data),
  notes: (id, params = {}) => api.get(`/leads/${encodeURIComponent(id)}/notes`, { params }).then(({ data }) => data),
  addNote: (id, body) => api.post(`/leads/${encodeURIComponent(id)}/notes`, { body }).then(({ data }) => data.note),
  followUps: (id, params = {}) => api.get(`/leads/${encodeURIComponent(id)}/follow-ups`, { params }).then(({ data }) => data),
  createFollowUp: (id, values) => api.post(`/leads/${encodeURIComponent(id)}/follow-ups`, values).then(({ data }) => data.followUp),
  completeFollowUp: (id) => api.patch(`/follow-ups/${encodeURIComponent(id)}/complete`).then(({ data }) => data.followUp),
  assignees: () => api.get('/users/assignees').then(({ data }) => data.items),
};
