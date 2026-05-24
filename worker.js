const VAPID_JWK = {
  kty: 'EC', crv: 'P-256',
  d: 'IBcTQxA0GcoRK8Kp6BB4D1qAQOySOMWBstyrGuKYlUw',
  x: 'D_THAjYHkyMPyiNw97D6Pr6NnfN09doryo1LcORc0gQ',
  y: 'D7Hia1THsR_1Nb8XcsAg_qIpdr1U72vmt5aInVOB6WE',
  key_ops: ['sign']
};
const VAPID_PUBLIC_KEY = 'BA_0xwI2B5MjD8ojcPew-j6-jZ3zdPXaK8qNS3DkXNIED7Hia1THsR_1Nb8XcsAg_qIpdr1U72vmt5aInVOB6WE';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

async function bitgetRequest(env, method, path, body = null) {
  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const prehash = timestamp + method.toUpperCase() + path + bodyStr;
  const keyBytes = new TextEncoder().encode(env.BITGET_SECRET_KEY);
  const msgBytes = new TextEncoder().encode(prehash);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  const res = await fetch('https://api.bitget.com' + path, {
    method,
    headers: {
      'ACCESS-KEY': env.BITGET_API_KEY,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': env.BITGET_PASSPHRASE,
      'Content-Type': 'application/json',
'User-Agent': 'PostmanRuntime/7.43.0'

    },
    body: body ? bodyStr : undefined
  });
  return res.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    if (request.method === 'GET' && path === '/bitget/saldo') {
      try {
        const data = await bitgetRequest(env, 'GET', '/api/v2/spot/account/assets');
        return Response.json(data, { headers: CORS });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: CORS });
      }
    }

    if (request.method === 'GET' && path === '/bitget/saldo-futuros') {
      try {
        const productType = url.searchParams.get('productType') || 'USDT-FUTURES';
        const data = await bitgetRequest(env, 'GET', `/api/v2/mix/account/accounts?productType=${productType}`);
        return Response.json(data, { headers: CORS });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: CORS });
      }
    }

    if (request.method === 'GET' && path === '/bitget/candles') {
  try {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const granularity = url.searchParams.get('granularity') || '4H';
    const limit = url.searchParams.get('limit') || '100';
    const res = await fetch(`https://api.bitget.com/api/v2/spot/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}`, {
      headers: { 'User-Agent': 'PostmanRuntime/7.43.0' }
    });
    const data = await res.json();
    return Response.json(data, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

      try {
        const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
        const res = await fetch(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${symbol}`);
        const data = await res.json();
        return Response.json(data, { headers: CORS });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: CORS });
      }
    }

    if (request.method === 'GET' && path === '/bitget/posicoes') {
      try {
        const productType = url.searchParams.get('productType') || 'USDT-FUTURES';
        const symbol = url.searchParams.get('symbol') || '';
        const query = symbol
          ? `/api/v2/mix/position/single-position?productType=${productType}&symbol=${symbol}`
          : `/api/v2/mix/position/all-position?productType=${productType}`;
        const data = await bitgetRequest(env, 'GET', query);
        return Response.json(data, { headers: CORS });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: CORS });
      }
    }

    if (request.method === 'GET' && path === '/bitget/ordens') {
      try {
        const [futuros, spot] = await Promise.all([
          bitgetRequest(env, 'GET', '/api/v2/mix/order/orders-pending?productType=USDT-FUTURES'),

          bitgetRequest(env, 'GET', '/api/v2/spot/trade/unfilled-orders')
        ]);
        return Response.json({ futuros, spot }, { headers: CORS });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: CORS });
      }
    }


    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const { subscription, title, body } = await request.json();

    try {
      await sendPush(subscription, JSON.stringify({ title, body }));
      return new Response('OK', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' }});
    } catch (e) {
      console.error('Push error:', e.message, e.stack);
      return new Response('Error: ' + e.message, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' }});
    }
  }
};

async function sendPush(subscription, payload) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys.p256dh;
  const auth = subscription.keys.auth;

  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const jwt = await buildVapidJwt(endpoint, exp);
  const { ciphertext, salt, serverPublicKey } = await encrypt(payload, p256dh, auth);

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

// RFC 8291 aes128gcm encryption
async function encrypt(payloadStr, p256dh, auth) {
  const encoder = new TextEncoder();
  const payload = encoder.encode(payloadStr);

  // Generate server ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey));

  // Import client public key
  const clientPublicKeyRaw = b64decode(p256dh);
  const clientPublicKey = await crypto.subtle.importKey('raw', clientPublicKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // ECDH shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPublicKey }, serverKeyPair.privateKey, 256);
  const sharedSecret = new Uint8Array(sharedSecretBits);

  const authSecret = b64decode(auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK_key = HKDF-Extract(auth_secret, ecdh_secret)
  const prkKey = await hkdfExtract(authSecret, sharedSecret);

  // key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = concat(encoder.encode('WebPush: info\x00'), clientPublicKeyRaw, serverPublicKeyRaw);

  // IKM = HKDF-Expand(PRK_key, key_info, 32)
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // PRK = HKDF-Extract(salt, IKM)
  const prk = await hkdfExtract(salt, ikm);

  // CEK = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\x00", 16)
  const cekInfo = encoder.encode('Content-Encoding: aes128gcm\x00');
  const cek = await hkdfExpand(prk, cekInfo, 16);

  // NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce\x00", 12)
  const nonceInfo = encoder.encode('Content-Encoding: nonce\x00');
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  // Encrypt: plaintext || 0x02 (padding delimiter)
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const encKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertextRaw = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encKey, plaintext));

  // Build aes128gcm header: salt(16) + rs(4) + keyid_len(1) + keyid(65) + ciphertext
  const rs = payload.length + 16 + 1 + 100; // generous rs
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKeyRaw.length);
  header.set(salt, 0);
  // rs as big-endian uint32
  const rsView = new DataView(header.buffer, 16, 4);
  rsView.setUint32(0, 4096, false);
  header[20] = serverPublicKeyRaw.length; // keyid length = 65
  header.set(serverPublicKeyRaw, 21);

  const ciphertext = concat(header, ciphertextRaw);
  return { ciphertext, salt, serverPublicKey: serverPublicKeyRaw };
}

async function hkdfExtract(salt, ikm) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));
}

async function hkdfExpand(prk, info, length) {
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = concat(info, new Uint8Array([0x01]));
  const result = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, infoWithCounter));
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
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array([...atob(base64)].map(c => c.charCodeAt(0)));
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url2(arr) {
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}