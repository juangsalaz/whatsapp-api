// src/server.js
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

const { client } = createClient({
  sessionDir: process.env.WWEBJS_SESSION_DIR || '/var/www/whatsapp-api/.wwebjs_auth',
  headless: process.env.PUPPETEER_HEADLESS !== 'false',
  puppeteerArgs: (process.env.PUPPETEER_ARGS || '').split(',').filter(Boolean)
});

app.locals.client = client;
app.locals.api = { sendTextToPhone, sendTextToGroup, sendMediaToTarget };

// log event penting
client.on('authenticated', () => console.log('[wwebjs] AUTHENTICATED'));
client.on('ready', () => console.log('[wwebjs] READY'));
client.on('auth_failure', m => console.error('[wwebjs] AUTH FAILURE:', m));
client.on('change_state', s => console.log('[wwebjs] STATE', s));
client.on('disconnected', r => console.error('[wwebjs] DISCONNECTED', r));

app.use('/api', buildRouter({ client, apiKey: process.env.API_KEY }));

const PORT = process.env.PORT || 3000;
client.initialize();                              // <-- pastikan ini dipanggil
app.listen(PORT, () => console.log(`[http] listening on :${PORT}`));
