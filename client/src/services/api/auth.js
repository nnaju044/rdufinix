import api from './client.js';

export const authApi = {
  login: (credentials) => api.post('/auth/login', credentials).then(({ data }) => data),
  refresh: () => api.post('/auth/refresh').then(({ data }) => data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me').then(({ data }) => data),
};
