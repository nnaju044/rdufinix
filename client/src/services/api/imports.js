import api from './client.js';

function form(file, fields = {}) { const data = new FormData(); data.append('file', file); for (const [key, value] of Object.entries(fields)) data.append(key, typeof value === 'string' ? value : JSON.stringify(value)); return data; }
export const importApi = {
  inspect: (file) => api.post('/imports/leads/inspect', form(file)).then(({ data }) => data.sheets),
  stage: (file, values) => api.post('/imports/leads', form(file, values)).then(({ data }) => data),
  list: (params) => api.get('/imports/leads', { params }).then(({ data }) => data),
  get: (id, params) => api.get(`/imports/leads/${id}`, { params }).then(({ data }) => data),
  commit: (id, confirmedDuplicateRows) => api.post(`/imports/leads/${id}/commit`, { confirmedDuplicateRows }).then(({ data }) => data.batch),
  rejectedReport: (id) => api.get(`/imports/leads/${id}/rejected.csv`, { responseType: 'blob' }).then(({ data }) => data),
  assignees: () => api.get('/users/assignees').then(({ data }) => data.items),
};
