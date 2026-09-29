/**
 * Free Telegram proxy — deploy on Vercel (Hobby tier).
 * Environment: TELEGRAM_PROXY_SECRET = long secret string (same as in POS settings)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Proxy-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  const expected = process.env.TELEGRAM_PROXY_SECRET || '';
  const sent = req.headers['x-telegram-proxy-secret'] || '';
  if (!expected || sent !== expected) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const body = req.body || {};
  const botToken = String(body.botToken || '').trim();
  let chatId = body.chatId;
  const text = String(body.text || '').trim();
  if (chatId != null) {
    chatId = String(chatId).trim().replace(/[^\d-]/g, '');
    if (/^-?\d+$/.test(chatId)) chatId = Number(chatId);
  }
  if (!botToken || chatId === '' || chatId == null || !text) {
    return res.status(400).json({ ok: false, error: 'missing fields' });
  }

  const tgRes = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const data = await tgRes.json().catch(() => ({}));
  if (data.ok) return res.status(200).json({ ok: true });
  return res.status(200).json({ ok: false, description: data.description || 'telegram_error' });
}
