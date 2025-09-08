// src/routes.js
import express from 'express';
import QRCode from 'qrcode';
import { QR_STORE } from './wwebjs.js';

function ensureReady(client) {
  return async (req, res, next) => {
    const state = await client.getState().catch(() => null);
    if (state !== 'CONNECTED') {
      return res.status(503).json({ ok: false, error: `Client not connected (state=${state}).` });
    }
    next();
  };
}

export function buildRouter({ client, apiKey }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const key = req.header('x-api-key');
    if (!apiKey || key === apiKey) return next();
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  });

  router.get('/health', (req, res) => res.json({ ok: true }));

  router.get('/status', async (req, res) => {
    const info = client.info || null;
    const state = await client.getState().catch(() => null);
    // ready = CONNECTED + info sudah ada (menandakan event 'ready' sudah terjadi)
    const ready = state === 'CONNECTED';
    res.json({
      ok: true,
      state,
      me: info ? { wid: info.wid?._serialized, pushname: info.pushname } : null,
      ready,
      qr_required: !info && !!QR_STORE.lastQr // QR diperlukan jika belum authenticated dan QR tersimpan
    });
  });

    router.post('/warmup', async (req, res) => {
        try {
            await client.getChats();
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

  // QR snapshot (kalau sudah login → 204)
  router.get('/qr', async (req, res) => {
    if (client.info) return res.status(204).send();
    if (!QR_STORE.lastQr) return res.status(204).send();
    const png = await QRCode.toDataURL(QR_STORE.lastQr);
    res.json({ ok: true, dataURL: png, ts: QR_STORE.timestamp || Date.now() });
  });

  // QR "menunggu sampai ada" (maks 30 detik)
  router.get('/qr/wait', async (req, res) => {
    if (client.info) return res.status(204).send();
    if (QR_STORE.lastQr) {
      const png = await QRCode.toDataURL(QR_STORE.lastQr);
      return res.json({ ok: true, dataURL: png, ts: QR_STORE.timestamp || Date.now() });
    }
    let timeoutId;
    const onQr = async (qr) => {
      clearTimeout(timeoutId);
      client.off('qr', onQr);
      const png = await QRCode.toDataURL(qr);
      res.json({ ok: true, dataURL: png, ts: Date.now() });
    };
    timeoutId = setTimeout(() => {
      client.off('qr', onQr);
      res.status(204).send();
    }, 30000);
    client.on('qr', onQr);
  });

  router.post('/send-text', ensureReady(client), async (req, res) => {
    try {
      const { to, message } = req.body || {};
      if (!to || !message) return res.status(400).json({ ok: false, error: 'to & message required' });
      const msg = await req.app.locals.api.sendTextToPhone(req.app.locals.client, to, message);
      res.json({ ok: true, id: msg.id?.id, to: msg.to, ack: msg.ack });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/send-group', ensureReady(client), async (req, res) => {
    try {
      const { groupId, groupName, message } = req.body || {};
      if (!message || (!groupId && !groupName)) return res.status(400).json({ ok: false, error: 'message & (groupId or groupName) required' });
      const msg = await req.app.locals.api.sendTextToGroup(req.app.locals.client, { groupId, groupName, message });
      res.json({ ok: true, id: msg.id?.id, to: msg.to, ack: msg.ack });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/send-media', ensureReady(client), async (req, res) => {
    try {
      const { to, isGroup, base64, mimeType, filename } = req.body || {};
      if (!to || !base64 || !mimeType) return res.status(400).json({ ok: false, error: 'to, base64, mimeType required' });
      const msg = await req.app.locals.api.sendMediaToTarget(req.app.locals.client, { to, isGroup, base64, mimeType, filename });
      res.json({ ok: true, id: msg.id?.id, to: msg.to, ack: msg.ack });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
}
