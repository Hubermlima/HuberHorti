// huberhorti-footprint — serve o footprint da Binance Futures guardado no R2.
// Os arquivos binance/AAAA-MM-DD.json (dia) e binance-live/AAAA-MM-DD.json (últimos 90 min) são gravados pelos
// scripts do Termux (r2-sync-hoje.js e r2-sync-historico.js). Este worker só LÊ e converte pro formato
// que o app usa: candles por minuto, com poc/delta/total já calculados.

const SYMBOL = 'BTCUSDT';

function candleMinuteKey(timestampMs) {
    return new Date(timestampMs).toISOString().slice(11, 16);
}

function dayKey(timestampMs) {
    return new Date(timestampMs).toISOString().slice(0, 10);
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// Lê o dia inteiro (binance/AAAA-MM-DD.json, gravado a cada ~10 min) E o arquivo "ao vivo" (binance-live/AAAA-MM-DD.json:
// só os últimos 90 min, gravado a cada ~20 s) e junta os dois: por minuto vale a fonte com MAIS volume (as duas só
// subestimam o real, e o ao vivo costuma ser o mais novo). Devolve
// { symbol, dia, candles: { 'HH:MM': { ts, poc, delta, total, niveis } } }.
// "desde" (ms, opcional) devolve só os minutos a partir dali — o app usa pra baixar só o que é novo.
async function lerJson(env, chave) {
    const obj = await env.FOOTPRINT_R2.get(chave);
    return obj ? await obj.json() : null;
}

function volumeDoMinuto(c) {
    let s = 0;
    for (const n of (c.niveis || [])) s += n.c + n.v;
    return s;
}

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
        candles[candleMinuteKey(c.ts)] = {
            ts: c.ts,
            poc,
            delta: round2(deltaTotal),
            total: round2(totalGeral),
            niveis: c.niveis.slice().sort((a, b) => a.p - b.p)
        };
    }
    return { symbol: SYMBOL, dia, candles };
}

export default {
    async fetch(request, env) {
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
            const dados = await lerArquivoDoDia(env, dia, desde);
            return Response.json(dados, {
                headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
            });
        }

        return new Response('huberhorti-footprint', { status: 200 });
    }
};
