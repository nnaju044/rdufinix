import { httpError } from './httpError.js';

export function normalizePagination(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw httpError(400, 'INVALID_PAGINATION', 'Page must be positive and limit must be between 1 and 100');
  }
  return { page, limit, skip: (page - 1) * limit };
}
