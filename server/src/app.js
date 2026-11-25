import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import userRoutes from './routes/userRoutes.js';
import importRoutes from './routes/importRoutes.js';
import { errorHandler, notFound } from './middleware/errors.js';

export function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false);
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Edufinix-Request'] }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1', userRoutes);
  app.use('/api/v1', importRoutes);
  app.use('/api/v1', leadRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
