import mongoose from 'mongoose';

export async function inTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let value;
    await session.withTransaction(async () => { value = await work(session); });
    return value;
  } finally {
    await session.endSession();
  }
}
