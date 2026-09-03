const SYMBOL = 'BTCUSDT';
const PAIR = 'XBTUSD';
const TICK_SIZE = 10;
const KRAKEN_TRADES_URL = 'https://api.kraken.com/0/public/Trades';

const BACKFILL_CURSOR_CHAVE = 'footprint/_backfill_cursor.json';
const BACKFILL_DATA_INICIO = '2026-08-01T00:00:00.000Z';
const BACKFILL_DATA_FIM = '2026-09-01T00:00:00.000Z';
const BACKFILL_PAGINAS_POR_TICK = 6;

function candleMinuteKey(timestampMs) {
    const d = new Date(timestampMs);
    return d.toISOString().slice(11, 16);
}

function dayKey(timestampMs) {
    return new Date(timestampMs).toISOString().slice(0, 10);
}

function roundToTick(price) {
    return Math.round(price / TICK_SIZE) * TICK_SIZE;
}

async function buscarTradesNovos(sinceCursor) {
    const trades = [];
    let cursor = sinceCursor;
    for (let pagina = 0; pagina < 50; pagina++) {
        const url = cursor
            ? `${KRAKEN_TRADES_URL}?pair=${PAIR}&since=${cursor}`
            : `${KRAKEN_TRADES_URL}?pair=${PAIR}`;
        const res = await fetch(url);
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Kraken HTTP ${res.status}: ${errText.slice(0,300)}`);
        }
        const json = await res.json();
        if (json.error && json.error.length > 0) {
            throw new Error(`Kraken API error: ${json.error.join(', ')}`);
        }
        const chave = Object.keys(json.result).find(k => k !== 'last');
        const data = json.result[chave];
        if (!Array.isArray(data) || data.length === 0) break;
        trades.push(...data);
        const novoCursor = json.result.last;
        if (novoCursor === cursor) break;
        cursor = novoCursor;
        if (data.length < 1000) break;
    }
    return { trades, cursor };
}

async function buscarTradesBackfill(sinceCursor, maxPaginas) {
    const trades = [];
    let cursor = sinceCursor;
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
        const url = `${KRAKEN_TRADES_URL}?pair=${PAIR}&since=${cursor}`;
        const res = await fetch(url);
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Kraken HTTP ${res.status}: ${errText.slice(0,300)}`);
        }
        const json = await res.json();
        if (json.error && json.error.length > 0) {
            throw new Error(`Kraken API error: ${json.error.join(', ')}`);
        }
        const chave = Object.keys(json.result).find(k => k !== 'last');
        const data = json.result[chave];
        if (!Array.isArray(data) || data.length === 0) break;
        trades.push(...data);
        const novoCursor = json.result.last;
        if (novoCursor === cursor) break;
        cursor = novoCursor;
        if (pagina < maxPaginas - 1) await new Promise(r => setTimeout(r, 1000));
        if (data.length < 1000) break;
    }
    return { trades, cursor };
}

function agregarEmCandles(trades) {
    const candles = new Map();
    for (const t of trades) {
        const preco = roundToTick(parseFloat(t[0]));
        const qtd = parseFloat(t[1]);
        const isVendaAgressiva = t[3] === 's';
        const ts = Math.round(parseFloat(t[2]) * 1000);
        const minuto = candleMinuteKey(ts);

        if (!candles.has(minuto)) {
            candles.set(minuto, { niveis: new Map(), tsInicio: ts, tsFim: ts });
        }
        const candle = candles.get(minuto);
        candle.tsInicio = Math.min(candle.tsInicio, ts);
        candle.tsFim = Math.max(candle.tsFim, ts);

        if (!candle.niveis.has(preco)) {
            candle.niveis.set(preco, { compra: 0, venda: 0, nCompra: 0, nVenda: 0 });
        }
        const nivel = candle.niveis.get(preco);
        if (isVendaAgressiva) {
            nivel.venda += qtd;
            nivel.nVenda += 1;
        } else {
            nivel.compra += qtd;
            nivel.nCompra += 1;
        }
    }
    return candles;
}

function compactarCandle(candle) {
    let poc = null;
    let pocVolume = -1;
    let deltaTotal = 0;
    let totalGeral = 0;
    const niveis = [];

    for (const [preco, { compra, venda, nCompra, nVenda }] of candle.niveis.entries()) {
        const totalNivel = compra + venda;
        niveis.push({ p: preco, c: round2(compra), v: round2(venda), nc: nCompra, nv: nVenda });
        deltaTotal += (compra - venda);
        totalGeral += totalNivel;
        if (totalNivel > pocVolume) {
            pocVolume = totalNivel;
            poc = preco;
        }
    }

    niveis.sort((a, b) => a.p - b.p);

    return {
        ts: candle.tsInicio,
        poc,
        delta: round2(deltaTotal),
        total: round2(totalGeral),
        niveis
    };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

async function lerArquivoDoDia(env, dia) {
    const chave = `footprint/${SYMBOL}/${dia}.json`;
    const obj = await env.FOOTPRINT_R2.get(chave);
    if (!obj) return { chave, dados: { symbol: SYMBOL, dia, candles: {} } };
    const dados = await obj.json();
    return { chave, dados };
}

async function salvarArquivoDoDia(env, chave, dados) {
    await env.FOOTPRINT_R2.put(chave, JSON.stringify(dados));
}

async function processarFootprint(env) {
    const cursorSalvo = await env.FOOTPRINT_R2.get('footprint/_cursor.json');
    const cursorObj = cursorSalvo ? await cursorSalvo.json() : null;
    const cursorAtual = cursorObj ? cursorObj.cursor : null;

    const { trades, cursor } = await buscarTradesNovos(cursorAtual || undefined);
    if (trades.length === 0) return { processados: 0 };

    const agoraMs = Date.now();
    const minutoAtualIncompleto = candleMinuteKey(agoraMs);

    const candles = agregarEmCandles(trades);

    const porDia = new Map();
    for (const [minuto, candle] of candles.entries()) {
        if (minuto === minutoAtualIncompleto) continue;
        const dia = dayKey(candle.tsInicio);
        if (!porDia.has(dia)) porDia.set(dia, new Map());
        porDia.get(dia).set(minuto, candle);
    }

    for (const [dia, candlesDoDia] of porDia.entries()) {
        const { chave, dados } = await lerArquivoDoDia(env, dia);
        for (const [minuto, candle] of candlesDoDia.entries()) {
            dados.candles[minuto] = compactarCandle(candle);
        }
        await salvarArquivoDoDia(env, chave, dados);
    }

    if (cursor) {
        await env.FOOTPRINT_R2.put('footprint/_cursor.json', JSON.stringify({ cursor }));
    }

    return { processados: trades.length, dias: [...porDia.keys()] };
}

async function processarBackfillChunk(env) {
    const cursorObj = await env.FOOTPRINT_R2.get(BACKFILL_CURSOR_CHAVE);
    let estado = cursorObj ? await cursorObj.json() : null;

    if (estado && estado.concluido) return { backfill: 'já concluído' };

    let cursor = estado ? estado.cursor : Math.floor(new Date(BACKFILL_DATA_INICIO).getTime() / 1000);

    const { trades, cursor: novoCursor } = await buscarTradesBackfill(cursor, BACKFILL_PAGINAS_POR_TICK);
    if (trades.length === 0) {
        await env.FOOTPRINT_R2.put(BACKFILL_CURSOR_CHAVE, JSON.stringify({ cursor, concluido: true, terminadoEm: new Date().toISOString() }));
        return { backfill: 'concluído agora — sem mais trades pra buscar' };
    }

    const fimBackfillMs = new Date(BACKFILL_DATA_FIM).getTime();
    const candles = agregarEmCandles(trades);

    const porDia = new Map();
    let ultimoTsProcessado = trades.length > 0 ? Math.round(parseFloat(trades[0][2]) * 1000) : Date.now();
    for (const [minuto, candle] of candles.entries()) {
        if (candle.tsInicio >= fimBackfillMs) continue;
        ultimoTsProcessado = Math.max(ultimoTsProcessado, candle.tsFim);
        const dia = dayKey(candle.tsInicio);
        if (!porDia.has(dia)) porDia.set(dia, new Map());
        porDia.get(dia).set(minuto, candle);
    }

    for (const [dia, candlesDoDia] of porDia.entries()) {
        const { chave, dados } = await lerArquivoDoDia(env, dia);
        for (const [minuto, candle] of candlesDoDia.entries()) {
            if (!dados.candles[minuto]) dados.candles[minuto] = compactarCandle(candle);
        }
        await salvarArquivoDoDia(env, chave, dados);
    }

    const concluido = ultimoTsProcessado >= fimBackfillMs || !novoCursor || novoCursor === String(cursor);
    await env.FOOTPRINT_R2.put(BACKFILL_CURSOR_CHAVE, JSON.stringify({
        cursor: novoCursor || cursor,
        concluido,
        ultimaDataProcessada: (isFinite(ultimoTsProcessado) ? new Date(ultimoTsProcessado).toISOString() : 'invalido:'+ultimoTsProcessado),
        terminadoEm: concluido ? new Date().toISOString() : null
    }));

    return { backfill: concluido ? 'concluído agora' : 'em andamento', ultimaData: (isFinite(ultimoTsProcessado) ? new Date(ultimoTsProcessado).toISOString() : 'invalido:'+ultimoTsProcessado), trades: trades.length };
}

export default {
    async scheduled(controller, env, ctx) {
        ctx.waitUntil((async () => {
            await processarFootprint(env);
            try {
                await processarBackfillChunk(env);
            } catch (e) {
                console.log('Backfill falhou nesse tick, tenta de novo no próximo minuto:', e.message);
            }
        })());
    },

    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/test') {
            try {
                const resultado = await processarFootprint(env);
                return Response.json(resultado);
            } catch (e) {
                return Response.json({ erro: e.message }, { status: 500 });
            }
        }

        if (url.pathname === '/backfill-status') {
            const cursorObj = await env.FOOTPRINT_R2.get(BACKFILL_CURSOR_CHAVE);
            const estado = cursorObj ? await cursorObj.json() : { status: 'ainda não iniciado' };
            return Response.json(estado);
        }

        if (url.pathname === '/backfill-test') {
            try {
                const resultado = await processarBackfillChunk(env);
                return Response.json(resultado);
            } catch (e) {
                return Response.json({ erro: e.message }, { status: 500 });
            }
        }

        if (url.pathname === '/footprint') {
            const dia = url.searchParams.get('dia') || dayKey(Date.now());
            const { dados } = await lerArquivoDoDia(env, dia);
            return Response.json(dados, {
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        return new Response('huberhorti-footprint', { status: 200 });
    }
};
