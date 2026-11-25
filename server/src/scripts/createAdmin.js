import 'dotenv/config';
import mongoose from 'mongoose';
import { loadConfig } from '../config/env.js';
import { connectDatabase } from '../config/database.js';
import { User } from '../models/User.js';
import { provisionInitialAdmin } from '../services/adminProvisioning.js';

const config = loadConfig();

try {
  const result = await provisionInitialAdmin({
    env: process.env,
    connect: () => connectDatabase(config.mongoUri),
    User,
  });
  console.log(`Initial Admin account created: ${result.email}`);
} catch (error) {
  console.error(`Admin provisioning failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
