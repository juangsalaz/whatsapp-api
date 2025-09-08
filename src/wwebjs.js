// src/wwebjs.js
import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;

export const QR_STORE = { lastQr: null, timestamp: null };

function setQr(qr) {
  QR_STORE.lastQr = qr;
  QR_STORE.timestamp = Date.now();
  console.log('[wwebjs] QR updated');
}
function clearQr() {
  QR_STORE.lastQr = null;
  QR_STORE.timestamp = null;
  console.log('[wwebjs] QR cleared');
}

export function createClient({
  sessionDir = '.wwebjs_auth',
  puppeteerArgs = [],
  headless = true
} = {}) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: {
      headless,
      args: puppeteerArgs,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
  });

  client.on('qr', setQr);

  client.on('authenticated', () => {
    console.log('[wwebjs] AUTHENTICATED');
    clearQr();
  });

  client.on('ready', () => {
    console.log('[wwebjs] READY');
    clearQr();
  });

  client.on('auth_failure', (m) => {
    console.error('[wwebjs] AUTH FAILURE:', m);
    // biarkan generate QR baru
  });

  client.on('change_state', (s) => console.log('[wwebjs] STATE', s));

  client.on('authenticated', () => {
    console.log('[wwebjs] AUTHENTICATED');
    clearQr();
    // Pancing WA Web lanjut loading
    client.getChats().then(
      () => console.log('[wwebjs] Prefetch chats ok'),
      (e) => console.warn('[wwebjs] Prefetch chats fail:', e?.message)
    );
  });

  client.on('disconnected', (reason) => {
    console.error('[wwebjs] DISCONNECTED:', reason);
    clearQr();
    if (String(reason).toUpperCase().includes('LOGOUT')) {
      try { client.destroy(); } catch {}
      try { fs.rmSync(path.resolve(sessionDir), { recursive: true, force: true }); } catch {}
      process.exit(1); // biar PM2 restart → QR baru terbit
    }
  });

  return { client, QR_STORE, MessageMedia };
}

export async function sendTextToPhone(client, phoneE164, message) {
  const clean = String(phoneE164).replace(/\D/g, '');
  const numberId = await client.getNumberId(clean).catch(() => null);
  if (!numberId) throw new Error(`Nomor ${phoneE164} tidak ditemukan / tidak terdaftar di WhatsApp`);
  return client.sendMessage(numberId._serialized, message);
}

export async function findGroupBy({ client, groupId, groupName }) {
  if (groupId) {
    const chat = await client.getChatById(groupId);
    return chat?.isGroup ? chat : null;
  }
  const chats = await client.getChats();
  return chats.find(c => c.isGroup && c.name === groupName) || null;
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
  const clean = String(to).replace(/\D/g, '');
  const numberId = await client.getNumberId(clean).catch(() => null);
  if (!numberId) throw new Error(`Nomor ${to} tidak ditemukan / tidak terdaftar di WhatsApp`);
  return client.sendMessage(numberId._serialized, media);
}
