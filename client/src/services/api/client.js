import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1',
  withCredentials: true,
  headers: { 'X-Edufinix-Request': '1' },
});

let accessToken = null;
export const setAccessToken = (token) => { accessToken = token; };

api.interceptors.request.use((request) => {
  if (accessToken) request.headers.Authorization = `Bearer ${accessToken}`;
  return request;
});

let refreshPromise = null;
api.interceptors.response.use((response) => response, async (error) => {
  const request = error.config;
  if (error.response?.status !== 401 || !request || request._retried || request.url?.includes('/auth/')) throw error;
  request._retried = true;
  refreshPromise ||= api.post('/auth/refresh').then(({ data }) => {
    setAccessToken(data.accessToken);
    return data.accessToken;
  }).finally(() => { refreshPromise = null; });
  request.headers.Authorization = `Bearer ${await refreshPromise}`;
  return api(request);
});

export default api;
