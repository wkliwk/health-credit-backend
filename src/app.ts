import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { documentsRouter } from './routes/documents';
import { sharesRouter } from './routes/shares';
import { pushRouter } from './routes/push';
import { errorHandler } from './middleware/errorHandler';
import { startExpiryReminderJob } from './jobs/expiryNotifications';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/push', pushRouter);

app.use(errorHandler);

// Start scheduled jobs (skip in test environment)
if (process.env.NODE_ENV !== 'test') {
  startExpiryReminderJob();
}

export { app };
