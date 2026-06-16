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
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1
'
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
        const productType = url.searchParams.get('productType') || 'usdt-futures';
        const data = await bitgetRequest(env, 'GET', `/api/v2/mix/account/accounts?productType=${productType}`);
        return Response.json(data, { headers: CORS });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: CORS });
      }
    }

    if (request.method === 'GET' && path === '/bitget/candles') {
      try {
        const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
        const granularity = (url.searchParams.get('granularity') || '4h').toLowerCase();


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

    if (request.method === 'GET' && path === '/bitget/cotacao') {
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
          bitgetRequest(env, 'GET', '/api/v2/mix/order/orders-pending?productType=usdt-futures'),
          bitgetRequest(env, 'GET', '/api/v2/spot/trade/unfilled-orders')
        ]);
        return Response.json({ futuros, spot }, { headers: CORS });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: CORS });
      }
    }

            // ── Sentimento de Mercado via Cloudflare AI ───────────────────
    if (request.method === 'POST' && path === '/ai/sentimento') {
      try {
        const { funding, fundingDiag, fundingDelta, oi, oiDelta, ratio, ratioDiag, ratioDelta, score, preco, varPct, tendencia, rsi, vd } = await request.json();
const prompt = `Você é um analista sênior de trading de Bitcoin. Com base nos dados abaixo, escreva em português brasileiro relacionando cada indicador com a direção atual do preço:\n\nBTC/USD: ${preco} (${tendencia} ${varPct}% no dia)\nRSI: ${rsi} | Volume Delta: ${vd}\n\n1. Funding Rate ${funding}% (${fundingDiag}, variação ${fundingDelta}%): explique o que significa em relação ao preço ${tendencia}\n2. Open Interest ${oi} (variação ${oiDelta}%): explique o que significa em relação ao preço ${tendencia}\n3. Top Trader Ratio ${ratio} (${ratioDiag}, variação ${ratioDelta}%): explique o que significa em relação ao preço ${tendencia}\nConclusão: 1-2 frases sobre o risco principal dado esse contexto, considerando o RSI ${rsi} e VD ${vd}.\n\nScore: ${score}. Sem introdução, sem formatação, só as 4 linhas.`;



        const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
    })
});
const data = await res.json();
const narrativa = data.content?.[0]?.text || 'Análise indisponível.';

        return Response.json({ narrativa }, { headers: CORS });
      } catch (e) {
        return Response.json({ narrativa: null, error: e.message }, { status: 500, headers: CORS });
      }
    }

    // ── Narrativa via Cloudflare AI ───────────────────────────────
    if (request.method === 'POST' && path === '/ai/narrativa') {

      try {
        const { titulo, tipo, preco, rsi, ema200, ema9, ema21, atr, sup1, res1, stop, alvo, score, rr, volStatus, divStatus } = await request.json();
        const prompt = `Você é um analista de trading profissional. Escreva um parágrafo curto (3-5 frases) em português brasileiro explicando este setup de ${tipo === 'long' ? 'compra' : 'venda'} no BTC/USD.\n\nDados:\n- Setup: ${titulo}\n- Preço: ${preco} | RSI: ${rsi} | EMA200: ${ema200} | EMA9: ${ema9} | EMA21: ${ema21}\n- ATR: ${atr} | Suporte: ${sup1} | Resistência: ${res1}\n- Entrada: ${preco} | Stop: ${stop} | Alvo: ${alvo} | R/R: 1:${rr}\n- Score: ${score}/9 | Volume: ${volStatus}${divStatus ? ' | ' + divStatus : ''}\n\nEscreva de forma direta e técnica. Explique o que está acontecendo, por que o setup faz sentido e o que esperar. Sem formatação, só o parágrafo.`;
        const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 300
        });
        const narrativa = aiResponse.response || aiResponse.result?.response || 'Narrativa indisponível.';
        return Response.json({ narrativa }, { headers: CORS });
      } catch (e) {
        return Response.json({ narrativa: null, error: e.message }, { status: 500, headers: CORS });
      }
    }


     // ── Extrato via Anthropic Claude Vision ──────────────────────
    if (request.method === 'POST' && path === '/ai/extrato') {
           try {
        const body = await request.json();
        console.log('Body recebido, imagens:', body.imagens?.length);
        const { imagens } = body;
        const hoje = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Manaus'});


        const prompt = `Analise essa página do extrato bancário (pode ser uma de várias páginas sequenciais) e extraia TODOS os lançamentos visíveis NESSA imagem. Não repita lançamentos que possam aparecer em outras páginas.\nRetorne SOMENTE um array JSON válido, sem texto adicional, sem markdown, sem explicações. Cada item deve ter exatamente estes campos:\n- "data": string no formato YYYY-MM-DD. Preste atenção nos separadores de data da tela (ex: "Hoje" = ${hoje}, "Quinta, 28 de maio" = ${hoje.substring(0,4)}-05-28). O ano é SEMPRE ${hoje.substring(0,4)}, nunca use outro ano. Cada lançamento usa a data do separador mais recente acima dele.\n- "tipo": "entrada" se for crédito/recebimento, "saida" se for débito/pagamento/envio\n- "forma": sempre "deposito"\n- "valor": número positivo sem sinal\n- "descricao": nome/descrição do lançamento. Nunca inclua separadores de data como lançamentos.\n\nAlém dos lançamentos, extraia o saldo disponível e retorne: {"saldo_final": 8595.20, "lancamentos": [...]}. Se não achar o saldo, use null.\n\nExemplo: {"saldo_final": 8595.20, "lancamentos": [{"data":"${hoje.substring(0,4)}-05-29","tipo":"saida","forma":"deposito","valor":100.00,"descricao":"Fabio Adriano Passos"}]}`;



                const todos = [];
        let saldoFinal = null;
        for (const img of imagens) {

          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',

              max_tokens: 2048,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: img.startsWith('/9j/') ? 'image/jpeg' : 'image/png', data: img } },

                  { type: 'text', text: prompt }
                ]
              }]
            })
          });
          const data = await res.json();
          console.log('Anthropic raw:', JSON.stringify(data).substring(0, 500));
                    const text = data.content?.[0]?.text ?? '';
          console.log('Claude response:', text.substring(0, 500));
                    const matchObj = text.match(/\{[\s\S]*\}/);
          if (matchObj) {
            try {
              const parsed = JSON.parse(matchObj[0]);
              todos.push(...(parsed.lancamentos || parsed));
              if (parsed.saldo_final != null) saldoFinal = parsed.saldo_final;
            } catch(e) { console.log('Parse error:', e.message); }
          }


        }
        const vistos = new Set();
        const unicos = todos.filter(l => {
          const key = `${l.data}-${l.valor}-${l.descricao}`;
          if (vistos.has(key)) return false;
          vistos.add(key);
          return true;
        });
        return Response.json({ lancamentos: unicos, saldo_final: saldoFinal }, { headers: CORS });


          } catch (e) {
        return Response.json({ lancamentos: [], error: e.message, stack: e.stack }, { status: 200, headers: CORS });
      }

    }


    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const { subscription, title, body, tag } = await request.json();



    try {
      await sendPush(subscription, JSON.stringify({ title, body, tag }));

      return new Response('OK', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
    } catch (e) {
      console.error('Push error:', e.message, e.stack);
      return new Response('Error: ' + e.message, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
  }
};

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