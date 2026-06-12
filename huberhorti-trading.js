// ── VAPID (igual ao huberhorti-push) ─────────────────────────────────────────
const VAPID_JWK = {
  kty: 'EC', crv: 'P-256',
  d: 'IBcTQxA0GcoRK8Kp6BB4D1qAQOySOMWBstyrGuKYlUw',
  x: 'D_THAjYHkyMPyiNw97D6Pr6NnfN09doryo1LcORc0gQ',
  y: 'D7Hia1THsR_1Nb8XcsAg_qIpdr1U72vmt5aInVOB6WE',
  key_ops: ['sign']
};
const VAPID_PUBLIC_KEY = 'BA_0xwI2B5MjD8ojcPew-j6-jZ3zdPXaK8qNS3DkXNIED7Hia1THsR_1Nb8XcsAg_qIpdr1U72vmt5aInVOB6WE';

const SUPABASE_URL  = 'https://suwaqkxkhhfopjkhsptf.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1d2Fxa3hraGhmb3Bqa2hzcHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MDI2MDQsImV4cCI6MjA5MDM3ODYwNH0.HcLs3bkZZ0lATGSQbWtTt7oIxcM8inYmLZHm2K5v39U';
const OPERADOR_ID   = 'e8a7bf50-ea0f-4134-b222-88ff489b69e8';

// ── Supabase fetch helper ─────────────────────────────────────────────────────
async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return res.json();
}

// ── Busca preço atual BTC/USD na Binance ──────────────────────────────────────
async function buscarPreco() {
    const res = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
  const data = await res.json();
  return parseFloat(data?.result?.XXBTZUSD?.c?.[0] || 0);

}


// ── Busca subscription do celular pessoal ─────────────────────────────────────
async function buscarSubscription() {
  const data = await sbFetch(`/push_subscriptions?operador_id=eq.${OPERADOR_ID}&select=subscription`);
  return data?.[0]?.subscription || null;
}

// ── Busca alertas ativos ──────────────────────────────────────────────────────
async function buscarAlertas() {
  return await sbFetch('/alertas?habilitado=eq.true&select=id,preco');
}

// ── Busca trades operacionais com alvo/stop ativos ────────────────────────────
async function buscarTrades() {
  return await sbFetch('/trades?operacional=eq.true&select=id,tipo,alvo,alvo_realizacao,alvo_ativo,stop,stop_realizacao,stop_ativo');
}

// ── Lógica principal de verificação ──────────────────────────────────────────
async function verificar(env) {
  // Busca preço anterior do KV
  const precoAntesStr = await env.KV.get('btc_preco_anterior');
  const precoAntes = precoAntesStr ? parseFloat(precoAntesStr) : 0;

  // Busca preço atual
  const precoAtual = await buscarPreco();
  if (!precoAtual) return;

  // Salva preço atual no KV para próxima execução
  await env.KV.put('btc_preco_anterior', String(precoAtual));

  // Sem preço anterior não tem como detectar cruzamento
  if (!precoAntes) return;

  const subscription = await buscarSubscription();
  if (!subscription) return;

  // ── Verifica alertas ────────────────────────────────────────────────────────
  const alertas = await buscarAlertas();
  for (const alerta of (alertas || [])) {
    const preco = parseFloat(alerta.preco);
    const cruzou = (precoAntes < preco && precoAtual >= preco) ||
                   (precoAntes > preco && precoAtual <= preco);
    if (cruzou) {
      const dir = precoAtual > precoAntes ? '↗ Cruzando Acima' : '↘ Cruzando Abaixo';
      await sendPush(subscription, JSON.stringify({
        title: '🔔 Alerta de preço!',
        body: `BTC/USD cruzou ${preco.toLocaleString('pt-BR', {minimumFractionDigits:2})} USD · ${dir}`,
        tag: 'trading-alert'
      }));
    }
  }

  // ── Verifica alvo/stop dos trades ──────────────────────────────────────────
  const trades = await buscarTrades();
  for (const trade of (trades || [])) {
    const dir = trade.tipo?.toLowerCase() === 'short' ? 'short' : 'long';

    // Alvo
    if (trade.alvo && trade.alvo_ativo) {
      const alvo = parseFloat(trade.alvo);
      const cruzou = dir === 'long'
        ? (precoAntes < alvo && precoAtual >= alvo)
        : (precoAntes > alvo && precoAtual <= alvo);
      if (cruzou) {
        const pct = trade.alvo_realizacao || 0;
        await sendPush(subscription, JSON.stringify({
          title: '🎯 Alvo atingido!',
          body: `BTC/USD · ${alvo.toLocaleString('pt-BR', {minimumFractionDigits:2})} USD · Realização: ${pct}%`,
          tag: 'trading-alert'
        }));
        // Desativa alvo no Supabase
        await sbFetch(`/trades?id=eq.${trade.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ alvo_ativo: false })
        });
      }
    }

    // Stop
    if (trade.stop && trade.stop_ativo) {
      const stop = parseFloat(trade.stop);
      const cruzou = dir === 'long'
        ? (precoAntes > stop && precoAtual <= stop)
        : (precoAntes < stop && precoAtual >= stop);
      if (cruzou) {
        const pct = trade.stop_realizacao || 0;
        await sendPush(subscription, JSON.stringify({
          title: '🛑 Stop atingido!',
          body: `BTC/USD · ${stop.toLocaleString('pt-BR', {minimumFractionDigits:2})} USD · Realização: ${pct}%`,
          tag: 'trading-alert'
        }));
        // Desativa stop no Supabase
        await sbFetch(`/trades?id=eq.${trade.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ stop_ativo: false })
        });
      }
    }
  }
}

// ── Export ────────────────────────────────────────────────────────────────────
export default {
  // Cron trigger — executa a cada minuto
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(verificar(env));
  },

  // Fetch — permite testar manualmente via HTTP
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/test') {
      await verificar(env);
      return new Response('OK', { status: 200 });
    }
    return new Response('huberhorti-trading', { status: 200 });
  }
};

// ── Push (igual ao huberhorti-push) ──────────────────────────────────────────
async function sendPush(subscription, payload) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys.p256dh;
  const auth = subscription.keys.auth;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const jwt = await buildVapidJwt(endpoint, exp);
  const { ciphertext } = await encrypt(payload, p256dh, auth);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body: ciphertext
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Push failed: ${response.status} ${text}`);
  }
}

async function encrypt(payloadStr, p256dh, auth) {
  const encoder = new TextEncoder();
  const payload = encoder.encode(payloadStr);
  const serverKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey));
  const clientPublicKeyRaw = b64decode(p256dh);
  const clientPublicKey = await crypto.subtle.importKey('raw', clientPublicKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecretBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPublicKey }, serverKeyPair.privateKey, 256);
  const sharedSecret = new Uint8Array(sharedSecretBits);
  const authSecret = b64decode(auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = concat(encoder.encode('WebPush: info\x00'), clientPublicKeyRaw, serverPublicKeyRaw);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdfExpand(prk, encoder.encode('Content-Encoding: nonce\x00'), 12);
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const encKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertextRaw = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encKey, plaintext));
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKeyRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer, 16, 4).setUint32(0, 4096, false);
  header[20] = serverPublicKeyRaw.length;
  header.set(serverPublicKeyRaw, 21);
  return { ciphertext: concat(header, ciphertextRaw), salt, serverPublicKey: serverPublicKeyRaw };
}

async function hkdfExtract(salt, ikm) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));
}

async function hkdfExpand(prk, info, length) {
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, concat(info, new Uint8Array([0x01]))));
  return result.slice(0, length);
}

async function buildVapidJwt(endpoint, exp) {
  const url = new URL(endpoint);
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud: url.origin, exp, sub: 'mailto:huber.produtos@gmail.com' }));
  const unsigned = header + '.' + payload;
  const cryptoKey = await crypto.subtle.importKey('jwk', VAPID_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(unsigned));
  return unsigned + '.' + b64url2(new Uint8Array(sig));
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

function b64decode(s) {
  return new Uint8Array([...atob(s.replace(/-/g, '+').replace(/_/g, '/'))].map(c => c.charCodeAt(0)));
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url2(arr) {
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}