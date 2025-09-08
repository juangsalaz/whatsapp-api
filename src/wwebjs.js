import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;

const QR_TTL_MS = 2 * 60 * 1000; // 2 menit
const QR_STORE = { lastQr: null, timestamp: null };

// helper kecil
export function isQrActive() {
  if (!QR_STORE.lastQr) return false;
  if (!QR_STORE.timestamp) return false;
  return (Date.now() - QR_STORE.timestamp) < QR_TTL_MS;
}

export function createClient({ sessionDir = '.wwebjs_auth', puppeteerArgs = [], headless = true } = {}) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: {
      headless,
      args: puppeteerArgs,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
  });

  client.on('qr', (qr) => {
    QR_STORE.lastQr = qr;
    QR_STORE.timestamp = Date.now();
    console.log('[wwebjs] QR updated');
  });

  client.on('authenticated', () => {
    // sudah berhasil login → QR tidak lagi diperlukan
    QR_STORE.lastQr = null;
    QR_STORE.timestamp = null;
    console.log('[wwebjs] AUTHENTICATED');
  });

  client.on('ready', () => {
    // client siap kirim/terima pesan
    QR_STORE.lastQr = null;
    QR_STORE.timestamp = null;
    console.log('[wwebjs] READY');
  });

  client.on('auth_failure', (m) => {
    console.error('[wwebjs] AUTH FAILURE:', m);
    // biarkan generate QR baru nanti
  });

  client.on('disconnected', (reason) => {
    console.warn('[wwebjs] DISCONNECTED:', reason);
  });

  return { client, QR_STORE };
}

export { QR_STORE, MessageMedia };

export async function sendTextToPhone(client, phoneE164, message) {
  // phoneE164 contoh: +6281234567890
  const jid = phoneE164.replace(/\D/g, '') + '@c.us';
  return client.sendMessage(jid, message); // API sendMessage resmi. :contentReference[oaicite:2]{index=2}
}

export async function findGroupBy({ client, groupId, groupName }) {
  if (groupId) {
    // groupId format: 12345-67890@g.us
    const chat = await client.getChatById(groupId);
    return chat?.isGroup ? chat : null;
  }
  const chats = await client.getChats();
  return chats.find(c => c.isGroup && c.name === groupName) || null; // GroupChat tersedia di docs. :contentReference[oaicite:3]{index=3}
}

export async function sendTextToGroup(client, { groupId, groupName, message }) {
  const grp = await findGroupBy({ client, groupId, groupName });
  if (!grp) throw new Error('Group not found');
  return client.sendMessage(grp.id._serialized, message);
}

export async function sendMediaToTarget(client, { to, isGroup = false, base64, mimeType, filename }) {
  const media = new MessageMedia(mimeType, base64, filename);
  if (isGroup) {
    const grp = await findGroupBy({ client, groupId: to, groupName: to });
    if (!grp) throw new Error('Group not found');
    return client.sendMessage(grp.id._serialized, media);
  }
  const jid = to.replace(/\D/g, '') + '@c.us';
  return client.sendMessage(jid, media);
}
