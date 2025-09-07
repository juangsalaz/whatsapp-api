import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createClient, sendTextToPhone, sendTextToGroup, sendMediaToTarget } from './wwebjs.js';
import { buildRouter } from './routes.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(helmet());
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_WINDOW_MS || 60000),
  max: Number(process.env.RATE_MAX || 120)
});
app.use(limiter);

// Buat client wwebjs
const { client, QR_STORE } = createClient({
  sessionDir: process.env.WWEBJS_SESSION_DIR || '.wwebjs_auth',
  headless: process.env.PUPPETEER_HEADLESS !== 'false',
  puppeteerArgs: (process.env.PUPPETEER_ARGS || '').split(',').filter(Boolean)
});

app.locals.client = client;
app.locals.api = { sendTextToPhone, sendTextToGroup, sendMediaToTarget };

// Router API
app.use('/api', buildRouter({ client, QR_STORE, apiKey: process.env.API_KEY }));

const PORT = process.env.PORT || 3000;
client.initialize(); // Inisialisasi client: event `qr`/`ready`/`message` dsb. :contentReference[oaicite:4]{index=4}

app.listen(PORT, () => {
  console.log(`[http] listening on :${PORT}`);
});
