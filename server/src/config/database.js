import mongoose from 'mongoose';

export async function connectDatabase(uri, options = {}) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...options });
  return mongoose.connection;
}

export async function verifyTransactionSupport() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    throw new Error('MongoDB transactions require a replica set or sharded cluster; standalone MongoDB is not supported');
  }
  return true;
}
