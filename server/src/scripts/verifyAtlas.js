import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase, verifyTransactionSupport } from '../config/database.js';

const databaseName = `edufinix_crm_txn_verify_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
const collectionName = 'rollback_probe';
const probeId = crypto.randomUUID();
let connected = false;
let databaseRemoved = false;
let transactionVerified = false;
let phase = 'read server/.env';
let failureCategory = 'unknown';
let failurePhase = null;
let serverFailureCodes = [];

try {
  const envText = await readFile(new URL('../../.env', import.meta.url), 'utf8');
  const fileConfig = dotenv.parse(envText);
  const mongoUri = fileConfig.MONGODB_URI?.trim();
  if (!mongoUri) throw new Error('MONGODB_URI is not set in server/.env');
  phase = 'connect to Atlas test database';
  // `dbName` targets a generated database while preserving the original URI and auth settings.
  await connectDatabase(mongoUri, { dbName: databaseName });
  connected = true;
  phase = 'verify replica-set transaction topology';
  await verifyTransactionSupport();

  phase = 'create isolated probe collection';
  const collection = mongoose.connection.db.collection(collectionName);
  await mongoose.connection.db.createCollection(collectionName);
  const session = await mongoose.startSession();
  try {
    let visibleInsideTransaction = 0;
    try {
      phase = 'insert and roll back transaction probe';
      await session.withTransaction(async () => {
        await collection.insertOne({ _id: probeId, purpose: 'rollback-verification' }, { session });
        visibleInsideTransaction = await collection.countDocuments({ _id: probeId }, { session });
        throw new Error('Intentional transaction rollback');
      });
    } catch (error) {
      if (error.message !== 'Intentional transaction rollback') throw error;
    }
    const visibleAfterRollback = await collection.countDocuments({ _id: probeId });
    transactionVerified = visibleInsideTransaction === 1 && visibleAfterRollback === 0;
    if (!transactionVerified) throw new Error('Rollback verification did not pass');
  } finally {
    await session.endSession();
  }
} catch (error) {
  // Driver errors can contain connection metadata; keep console output credential-safe.
  failurePhase = phase;
  failureCategory = [error?.name, typeof error?.code === 'string' ? error.code : null].filter(Boolean).join(':') || 'configuration-or-database-error';
  const servers = error?.reason?.servers;
  if (servers && typeof servers.values === 'function') {
    for (const server of servers.values()) {
      let cause = server.error;
      for (let depth = 0; cause && depth < 4; depth += 1, cause = cause.cause) {
        const value = cause.code || cause.name;
        if (typeof value === 'string') serverFailureCodes.push(value);
      }
    }
    serverFailureCodes = serverFailureCodes.slice(0, 10);
  }
} finally {
  if (connected) {
    phase = 'remove isolated test database';
    try {
      await mongoose.connection.db.dropDatabase();
      databaseRemoved = true;
    } catch {
      databaseRemoved = false;
    }
    await mongoose.disconnect().catch(() => {});
  }
}

if (connected && transactionVerified && databaseRemoved) {
  console.log('Environment loading: MONGODB_URI loaded from server/.env (value suppressed)');
  console.log('MongoDB Atlas connectivity: passed');
  console.log('Replica-set or sharded transaction support: passed');
  console.log('Database transaction: test record visible inside transaction and absent after rollback');
  console.log('Test database cleanup: passed');
} else {
  const causeCodes = serverFailureCodes.length ? `; server causes: ${[...new Set(serverFailureCodes)].join(', ')}` : '';
  console.error(`Atlas verification failed during: ${failurePhase || phase}; category: ${failureCategory}${causeCodes}; connection details suppressed`);
  process.exitCode = 1;
}
