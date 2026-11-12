/**
 * Lets the production demo site call the local llama.cpp server.
 * Binds 127.0.0.1:8081 and forwards to llama on 127.0.0.1:8082.
 * Adds CORS + Private-Network-Access headers. Does not open the model to the internet.
 */
import http from 'node:http';

const listenPort = Number(process.env.ZELVERO_AI_PROXY_PORT || 8081);
const upstream = (process.env.ZELVERO_AI_UPSTREAM || 'http://127.0.0.1:8082').replace(/\/$/, '');
const allowed = new Set([
  'https://zelvoropos.web.app',
  'https://zelvoropos.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    Vary: 'Origin',
  };
  if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const extra = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, extra);
    res.end();
    return;
  }
  if (origin && !allowed.has(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'origin-denied' }));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  try {
    const upstreamRes = await fetch(upstream + (req.url || '/'), {
      method: req.method,
      headers: { 'Content-Type': req.headers['content-type'] || 'application/json' },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.writeHead(upstreamRes.status, {
      ...extra,
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
    });
    res.end(buf);
  } catch {
    res.writeHead(502, { ...extra, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream-down' }));
  }
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`[ai-cors] http://127.0.0.1:${listenPort} → ${upstream}`);
});
