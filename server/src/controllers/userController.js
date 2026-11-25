import { User } from '../models/User.js';

export async function listAssigneesController(_req, res, next) {
  try {
    const items = await User.find({ role: 'salesperson', active: true }).select('name email').sort({ name: 1 }).lean();
    res.json({ items });
  } catch (error) { next(error); }
}
