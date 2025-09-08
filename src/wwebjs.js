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

  // Pastikan nomor valid & dapatkan JID
  const numberId = await client.getNumberId(clean).catch(() => null);
  if (!numberId) throw new Error(`Nomor ${phoneE164} tidak ditemukan / tidak terdaftar di WhatsApp`);
  const jid = numberId._serialized;

  const MAX_RETRY = 10;
  let delay = 800; // ms
  let lastErr;

  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      // ping state (tetap ringan)
      await client.getState().catch(() => {});
      return await client.sendMessage(jid, message);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const transient =
        msg.includes('getChat') ||
        msg.includes('Evaluation failed') ||
        msg.includes('disconnected port') ||
        msg.includes('not ready') ||
        msg.includes('TypeError');

      if (!transient && !msg.includes('Evaluation')) {
        // error non-transien → lempar langsung
        throw e;
      }

      // retry dengan exponential backoff
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 4000);
    }
  }

  // Jika tetap gagal berkali-kali → soft reinit tanpa hapus sesi
  try {
    console.warn('[wwebjs] Send failed repeatedly. Soft reinit...');
    await client.destroy();
  } catch {}
  client.initialize();
  throw new Error('Koneksi WA belum siap (soft reinit dilakukan). Coba lagi sebentar.');
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
