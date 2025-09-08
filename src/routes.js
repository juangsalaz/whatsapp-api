import express from 'express';
import QRCode from 'qrcode';
import { isQrActive } from './wwebjs.js'; // <-- tambahkan

export function buildRouter({ client, QR_STORE, apiKey }) {
  const router = express.Router();


  // Middleware API key (simple)
  router.use((req, res, next) => {
    const key = req.header('x-api-key');
    if (!apiKey || key === apiKey) return next();
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  });

  router.get('/health', (req, res) => res.json({ ok: true }));

  router.get('/status', async (req, res) => {
    const info = client.info || null;
    const state = await client.getState().catch(() => null);
    res.json({
      ok: true,
      state,
      me: info ? { wid: info.wid?._serialized, pushname: info.pushname } : null,
      // qr_required true hanya jika QR masih aktif & belum authenticated
      qr_required: !info && isQrActive()
    });
  });

  router.get('/qr', async (req, res) => {
    // jika sudah login, tidak perlu QR
    if (client.info) return res.status(204).send();
    // kirim QR hanya kalau masih aktif
    if (!isQrActive()) return res.status(204).send();

    const png = await QRCode.toDataURL(QR_STORE.lastQr);
    res.json({ ok: true, dataURL: png, ts: QR_STORE.timestamp });
  });


  // Kirim pesan ke nomor
  router.post('/send-text', async (req, res) => {
    try {
      const { to, message } = req.body || {};
      if (!to || !message) return res.status(400).json({ ok: false, error: 'to & message required' });
      const msg = await req.app.locals.api.sendTextToPhone(req.app.locals.client, to, message);
      res.json({ ok: true, id: msg.id.id, to: msg.to, ack: msg.ack });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Kirim pesan ke grup (by groupId atau groupName)
  router.post('/send-group', async (req, res) => {
    try {
      const { groupId, groupName, message } = req.body || {};
      if (!message || (!groupId && !groupName))
        return res.status(400).json({ ok: false, error: 'message & (groupId or groupName) required' });

      const msg = await req.app.locals.api.sendTextToGroup(req.app.locals.client, { groupId, groupName, message });
      res.json({ ok: true, id: msg.id.id, to: msg.to, ack: msg.ack });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // (opsional) kirim media base64
  router.post('/send-media', async (req, res) => {
    try {
      const { to, isGroup, base64, mimeType, filename } = req.body || {};
      if (!to || !base64 || !mimeType) return res.status(400).json({ ok: false, error: 'to, base64, mimeType required' });
      const msg = await req.app.locals.api.sendMediaToTarget(req.app.locals.client, { to, isGroup, base64, mimeType, filename });
      res.json({ ok: true, id: msg.id.id, to: msg.to, ack: msg.ack });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
