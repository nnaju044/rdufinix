export function notFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(err, _req, res, _next) {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('API request failed', { name: err.name || 'Error' });
  res.status(status).json({ error: { code: err.code || 'INTERNAL_ERROR', message: status >= 500 ? 'An unexpected error occurred' : err.message, ...(status < 500 && err.details !== undefined ? { details: err.details } : {}) } });
}
