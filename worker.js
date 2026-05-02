const VAPID_JWK = {
  kty: 'EC',
  crv: 'P-256',
  d: 'IBcTQxA0GcoRK8Kp6BB4D1qAQOySOMWBstyrGuKYlUw',
  x: 'D_THAjYHkyMPyiNw97D6Pr6NnfN09doryo1LcORc0gQ',
  y: 'D7Hia1THsR_1Nb8XcsAg_qIpdr1U72vmt5aInVOB6WE',
  key_ops: ['sign']
};
const VAPID_PUBLIC_KEY = 'BA_0xwI2B5MjD8ojcPew-j6-jZ3zdPXaK8qNS3DkXNIED7Hia1THsR_1Nb8XcsAg_qIpdr1U72vmt5aInVOB6WE';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    const { subscription, title, body } = await request.json();
    try {
      await sendPushNotification(subscription, JSON.stringify({ title, body }));
      return new Response('OK', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
    } catch (e) {
      console.error('Worker error:', e.message, e.stack);
      return new Response('Error: ' + e.message, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
  }
};

async function sendPushNotification(subscription, payload) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys.p256dh;
  const auth = subscription.keys.auth;

  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const jwt = await buildVapidJwt(endpoint, exp);
  const encrypted = await encryptPayload(payload, p256dh, auth);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC_KEY,
      'Crypto-Key': 'p256ecdsa=' + VAPID_PUBLIC_KEY + ';dh=' + encrypted.dh,
      'Content-Encoding': 'aesgcm',
      'Encryption': 'salt=' + encrypted.salt,
      'Content-Type': 'application/octet-stream',
      'TTL': '86400'
    },
    body: encrypted.ciphertext
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Push failed: ${response.status} ${text}`);
  }
}

async function buildVapidJwt(endpoint, exp) {
  const url = new URL(endpoint);
  const audience = url.origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud: audience, exp, sub: 'mailto:huber.produtos@gmail.com' }));
  const unsigned = header + '.' + payload;

  const cryptoKey = await crypto.subtle.importKey('jwk', VAPID_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(unsigned));
  return unsigned + '.' + uint8ArrayToBase64Url(new Uint8Array(signature));
}

async function encryptPayload(payload, p256dh, auth) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublicKey = await crypto.subtle.exportKey('raw', serverKeys.publicKey);
  const clientPublicKey = await crypto.subtle.importKey('raw', base64UrlToUint8Array(p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const authBuffer = base64UrlToUint8Array(auth);
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPublicKey }, serverKeys.privateKey, 256);
  const prk = await hkdf(authBuffer, new Uint8Array(sharedSecret), new TextEncoder().encode('Content-Encoding: auth\0'), 32);
  const context = buildContext(new Uint8Array(serverPublicKey), base64UrlToUint8Array(p256dh));
  const cek = await hkdf(salt, prk, buildInfo('aesgcm', context), 16);
  const nonce = await hkdf(salt, prk, buildInfo('nonce', context), 12);
  const encKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encKey, new TextEncoder().encode(payload));
  return {
    ciphertext: new Uint8Array(ciphertext),
    salt: uint8ArrayToBase64Url(salt),
    dh: uint8ArrayToBase64Url(new Uint8Array(serverPublicKey))
  };
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

function buildContext(serverKey, clientKey) {
  const ctx = new Uint8Array(1 + 2 + serverKey.length + 2 + clientKey.length);
  let i = 0;
  ctx[i++] = 0;
  ctx[i++] = 0; ctx[i++] = serverKey.length;
  ctx.set(serverKey, i); i += serverKey.length;
  ctx[i++] = 0; ctx[i++] = clientKey.length;
  ctx.set(clientKey, i);
  return ctx;
}

function buildInfo(type, context) {
  const enc = new TextEncoder();
  const typeBytes = enc.encode('Content-Encoding: ' + type + '\0P-256\0');
  const info = new Uint8Array(typeBytes.length + context.length);
  info.set(typeBytes); info.set(context, typeBytes.length);
  return info;
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

function uint8ArrayToBase64Url(arr) {
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}