import { config } from './config/env.js';
import { connectDatabase, verifyTransactionSupport } from './config/database.js';
import { createApp } from './app.js';
import { resumeInterruptedImports } from './services/importService.js';
import mongoose from 'mongoose';

try {
  await connectDatabase(config.mongoUri);
  await verifyTransactionSupport();
  await resumeInterruptedImports();
  const app = createApp(config);
  const server = app.listen(config.port, () => console.log(`EduFinix CRM API listening on port ${config.port}`));
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down CRM API`);
    server.close(async (error) => {
      if (error) console.error('HTTP server shutdown failed');
      try { await mongoose.disconnect(); }
      catch { console.error('Database shutdown failed'); }
      process.exit(error ? 1 : 0);
    });
    server.closeIdleConnections?.();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  // Avoid logging driver errors because their messages may include connection details.
  console.error('Server startup failed; verify server configuration and database availability');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
