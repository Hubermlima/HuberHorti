// huberhorti-footprint — serve o footprint da Binance Futures guardado no R2.
// Os arquivos binance/AAAA-MM-DD.json (dia) e binance-live/AAAA-MM-DD.json (últimos 90 min) são gravados pelos
// scripts do Termux (r2-sync-hoje.js e r2-sync-historico.js). Este worker só LÊ e converte pro formato
// que o app usa: candles por minuto, com poc/delta/total já calculados.
//
// Cache de borda (Cache API): montar isso do zero (parse do JSON do dia inteiro + somar cada nível de cada
// minuto) é a parte pesada — em dia de volume alto passa fácil do limite de CPU do plano Free (10 ms) e a
// requisição morre com "Worker exceeded resource limits" (Error 1102), mesmo com o R2 respondendo rápido.
// Dia PASSADO nunca muda mais (os arquivos do Termux já pararam de escrever nele) — cacheia por muito tempo,
// então só a PRIMEIRA vez que aquele dia é pedido corre o risco de estourar CPU; das próximas, sai do cache
// sem reprocessar nada. Dia de HOJE ainda recebe escrita ao vivo (a cada ~20 s) — cache curto, só pra
// absorver os pedidos repetidos que o app faz em rajada (ativar o Fluxo + auto-refresh de 15 em 15 s).
const SYMBOL = 'BTCUSDT';
const CACHE_TTL_DIA_PASSADO = 30 * 24 * 60 * 60; // 30 dias — dado fechado, não muda mais
const CACHE_TTL_HOJE = 12; // um pouco menor que o intervalo de refresh do app (15s), pra nunca servir dado velho

function candleMinuteKey(timestampMs) {
    return new Date(timestampMs).toISOString().slice(11, 16);
}

function dayKey(timestampMs) {
    return new Date(timestampMs).toISOString().slice(0, 10);
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

async function lerJson(env, chave) {
    const obj = await env.FOOTPRINT_R2.get(chave);
    return obj ? await obj.json() : null;
}

function volumeDoMinuto(c) {
    let s = 0;
    for (const n of (c.niveis || [])) s += n.c + n.v;
    return s;
}

// Lê o dia inteiro (binance/AAAA-MM-DD.json, gravado a cada ~10 min) E o arquivo "ao vivo" (binance-live/AAAA-MM-DD.json:
// só os últimos 90 min, gravado a cada ~20 s) e junta os dois: por minuto vale a fonte com MAIS volume (as duas só
// subestimam o real, e o ao vivo costuma ser o mais novo). Devolve
// { symbol, dia, candles: { 'HH:MM': { ts, poc, delta, total, niveis } } }.
// "desde" (ms, opcional) devolve só os minutos a partir dali — o app usa pra baixar só o que é novo.
async function lerArquivoDoDia(env, dia, desde) {
    const [bruto, live] = await Promise.all([
        lerJson(env, `binance/${dia}.json`),
        lerJson(env, `binance-live/${dia}.json`).catch(() => null)
    ]);
    const porTs = new Map();
    for (const c of ((bruto && bruto.candles) || [])) {
        if (desde && c.ts < desde) continue; // pedido incremental
        porTs.set(c.ts, c);
    }
    for (const c of ((live && live.candles) || [])) {
        if (desde && c.ts < desde) continue;
        const existente = porTs.get(c.ts);
        if (!existente || volumeDoMinuto(c) >= volumeDoMinuto(existente)) porTs.set(c.ts, c);
    }

    const candles = {};
    for (const c of porTs.values()) {
        let poc = null, pocVolume = -1, deltaTotal = 0, totalGeral = 0;
        for (const n of c.niveis) {
            const totalNivel = n.c + n.v;
            deltaTotal += (n.c - n.v);
            totalGeral += totalNivel;
            if (totalNivel > pocVolume) { pocVolume = totalNivel; poc = n.p; }
        }
        // sort direto no próprio array (sem .slice()) — c já é um objeto novo, lido agora do JSON, ninguém mais
        // segura referência pra ele: a cópia defensiva não protegia nada, só custava CPU à toa.
        c.niveis.sort((a, b) => a.p - b.p);
        candles[candleMinuteKey(c.ts)] = {
            ts: c.ts,
            poc,
            delta: round2(deltaTotal),
            total: round2(totalGeral),
            niveis: c.niveis
        };
    }
    return { symbol: SYMBOL, dia, candles };
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname === '/footprint') {
            const dia = url.searchParams.get('dia') || dayKey(Date.now());
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
                return Response.json({ erro: 'dia inválido (use AAAA-MM-DD)' }, {
                    status: 400,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }
            const desde = parseInt(url.searchParams.get('desde') || '0', 10) || 0;

            // Cache de borda por URL exata (dia + desde + fonte já fazem parte da query string, então cada
            // combinação pedida pelo app cai numa chave própria). Chave própria (em vez da request crua) porque
            // a request original tem "Cache-Control: no-store" na RESPOSTA anterior — isso não afeta a leitura
            // do cache, só deixa claro que quem decide o TTL é este worker, não o navegador.
            const cache = caches.default;
            const chaveCache = new Request(url.toString(), request);
            const emCache = await cache.match(chaveCache);
            if (emCache) return emCache;

            const dados = await lerArquivoDoDia(env, dia, desde);

            const ehHoje = dia === dayKey(Date.now());
            const ttl = ehHoje ? CACHE_TTL_HOJE : CACHE_TTL_DIA_PASSADO;
            const resposta = Response.json(dados, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=' + ttl
                }
            });
            // Guarda no cache de borda SEM segurar a resposta ao app — ele já recebeu o dado, o cache é só
            // pra quem pedir a MESMA combinação (dia+desde) em seguida (outra aba, o auto-refresh, etc).
            ctx.waitUntil(cache.put(chaveCache, resposta.clone()));
            return resposta;
        }

        return new Response('huberhorti-footprint', { status: 200 });
    }
};
