import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { documentsRouter } from './routes/documents';
import { sharesRouter } from './routes/shares';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/health', healthRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/shares', sharesRouter);

app.use(errorHandler);

export { app };
