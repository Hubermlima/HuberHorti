const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const BUCKET = 'huberhorti-footprint';
const PREFIXO = 'binance/';
const PREFIXO_LIVE = 'binance-live/';
const TICK = 10;
const PAUSA_ENTRE_REQUISICOES_MS = 300;
const PAUSA_ENTRE_CICLOS_MS = 20 * 1000;
const PUBLICAR_DIA_A_CADA_MS = 10 * 60 * 1000;
const LIVE_MINUTOS = 90;
const AVISO_ATRASO_MS = 60 * 1000;
const CURSOR_LOCAL = os.homedir() + '/.r2-hoje-cursor.json';

const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

function log(msg) {
    const linha = `[${new Date().toISOString()}] [HOJE] ${msg}`;
    console.log(linha);
    try { fs.appendFileSync(os.homedir() + '/r2-sync-hoje.log', linha + '\n'); } catch (e) {}
}

function dataStr(offsetDias) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDias);
    return d.toISOString().slice(0, 10);
}

function inicioDoDia(dia) {
    return new Date(dia + 'T00:00:00.000Z').getTime();
}

function lerCursorLocal() {
    try {
        return JSON.parse(fs.readFileSync(CURSOR_LOCAL, 'utf8'));
    } catch (e) {
        return null;
    }
}

function salvarCursorLocal(cursor) {
    try {
        fs.writeFileSync(CURSOR_LOCAL, JSON.stringify(cursor));
    } catch (e) {
        log('  aviso: nao consegui salvar o cursor local (' + e.message + ')');
    }
}

function pedirWakeLock() {
    exec('termux-wake-lock', (err) => {
        if (err) log('  aviso: nao consegui ativar o wake lock (' + err.message.split('\n')[0] + '). Use "Acquire wakelock" na notificacao do Termux.');
        else log('  wake lock ativado (o Android nao vai suspender o Termux).');
    });
}

async function fetchComRetry(url, tentativas = 6) {
    for (let i = 0; i < tentativas; i++) {
        try {
            const r = await fetch(url);
            if (!r.ok) {
                const corpo = await r.text().catch(() => '(sem corpo)');
                throw new Error(`status ${r.status} - ${corpo.slice(0, 200)}`);
            }
            const d = await r.json();
            if (!Array.isArray(d)) throw new Error(d.msg || 'resposta inesperada');
            return d;
        } catch (e) {
            if (i === tentativas - 1) throw e;
            const espera = Math.min(15000, 1000 * Math.pow(2, i));
            log(`  erro (${e.message}), tentando de novo em ${espera}ms...`);
            await new Promise(res => setTimeout(res, espera));
        }
    }
}

async function buscarTradesNaJanela(tsInicio, tsFim) {
    const candlesPorMinuto = new Map();
    let janelaAtual = tsInicio;
    while (janelaAtual < tsFim) {
        const janelaFim = Math.min(janelaAtual + 3600 * 1000, tsFim);
        let usarFromId = null;
        while (true) {
            const url = usarFromId != null
                ? `https://fapi.binance.com/fapi/v1/aggTrades?symbol=BTCUSDT&fromId=${usarFromId}&limit=1000`
                : `https://fapi.binance.com/fapi/v1/aggTrades?symbol=BTCUSDT&startTime=${janelaAtual}&endTime=${janelaFim}&limit=1000`;
            const trades = await fetchComRetry(url);
            if (trades.length === 0) break;
            let passouDoFim = false;
            for (const t of trades) {
                if (t.T >= janelaFim) { passouDoFim = true; continue; }
                if (t.T < janelaAtual) continue;
                const preco = Math.round(parseFloat(t.p) / TICK) * TICK;
                const qtd = parseFloat(t.q);
                const isVenda = t.m === true;
                const minuto = new Date(t.T).toISOString().slice(11, 16);
                if (!candlesPorMinuto.has(minuto)) {
                    candlesPorMinuto.set(minuto, { ts: Math.floor(t.T / 60000) * 60000, niveis: new Map() });
                }
                const cm = candlesPorMinuto.get(minuto);
                if (!cm.niveis.has(preco)) cm.niveis.set(preco, { c: 0, v: 0, nc: 0, nv: 0 });
                const nivel = cm.niveis.get(preco);
                if (isVenda) { nivel.v += qtd; nivel.nv += 1; } else { nivel.c += qtd; nivel.nc += 1; }
            }
            if (trades.length < 1000 || passouDoFim) break;
            usarFromId = trades[trades.length - 1].a + 1;
            await new Promise(res => setTimeout(res, PAUSA_ENTRE_REQUISICOES_MS));
        }
        janelaAtual += 3600 * 1000;
    }
    return candlesPorMinuto;
}

async function lerDoR2(chave) {
    try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: chave }));
        const texto = await obj.Body.transformToString();
        return JSON.parse(texto);
    } catch (e) {
        return null;
    }
}

async function gravarNoR2(chave, objeto) {
    const body = JSON.stringify(objeto);
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: chave,
        Body: body,
        ContentType: 'application/json',
    }));
    return (Buffer.byteLength(body) / 1024).toFixed(1);
}

function mapaDoJson(json) {
    const mapa = new Map();
    if (json && json.candles) {
        for (const c of json.candles) {
            const minuto = new Date(c.ts).toISOString().slice(11, 16);
            const niveisMap = new Map(c.niveis.map(n => [n.p, { c: n.c, v: n.v, nc: n.nc, nv: n.nv }]));
            mapa.set(minuto, { ts: c.ts, niveis: niveisMap });
        }
    }
    return mapa;
}

function adicionar(mapa, novosPorMinuto) {
    for (const [minuto, cmNovo] of novosPorMinuto.entries()) {
        if (!mapa.has(minuto)) mapa.set(minuto, { ts: cmNovo.ts, niveis: new Map() });
        const cmExistente = mapa.get(minuto);
        for (const [preco, vNovo] of cmNovo.niveis.entries()) {
            if (!cmExistente.niveis.has(preco)) cmExistente.niveis.set(preco, { c: 0, v: 0, nc: 0, nv: 0 });
            const vExistente = cmExistente.niveis.get(preco);
            vExistente.c += vNovo.c;
            vExistente.v += vNovo.v;
            vExistente.nc += vNovo.nc;
            vExistente.nv += vNovo.nv;
        }
    }
}

function candlesDoMapa(mapa, tsMinimo) {
    return [...mapa.values()]
        .filter(cm => cm.ts >= tsMinimo)
        .sort((a, b) => a.ts - b.ts)
        .map(cm => ({
            ts: cm.ts,
            niveis: [...cm.niveis.entries()].map(([p, v]) => ({
                p, c: Math.round(v.c * 1000) / 1000, v: Math.round(v.v * 1000) / 1000, nc: v.nc, nv: v.nv
            }))
        }));
}

async function publicarDia(dia, mapa, ateTs) {
    const candles = candlesDoMapa(mapa, 0);
    const kb = await gravarNoR2(`${PREFIXO}${dia}.json`, { dia, fonte: 'binance-futures', ateTs, candles });
    return { kb, totalMinutos: candles.length };
}

async function publicarLive(dia, mapa, agora) {
    const candles = candlesDoMapa(mapa, agora - LIVE_MINUTOS * 60000);
    const kb = await gravarNoR2(`${PREFIXO_LIVE}${dia}.json`, { dia, fonte: 'binance-futures', ateTs: agora, candles });
    return { kb, totalMinutos: candles.length };
}

async function carregarEstadoDoDia(dia) {
    const existente = await lerDoR2(`${PREFIXO}${dia}.json`);
    const mapa = mapaDoJson(existente);
    const cursorLocal = lerCursorLocal();
    let ate;
    if (existente && existente.ateTs) ate = existente.ateTs;
    else if (existente && cursorLocal && cursorLocal.dia === dia) ate = cursorLocal.ultimoTs;
    else ate = inicioDoDia(dia);
    log(`Dia ${dia}: ${mapa.size} minutos ja no R2; retomando os trades a partir de ${new Date(ate).toISOString()}.`);
    return { dia, mapa, memCursor: ate, ultimoPublicarDia: 0 };
}

async function fecharDia(estado) {
    const fimDoDia = inicioDoDia(estado.dia) + 24 * 3600 * 1000;
    log(`Virou o dia - fechando ${estado.dia} (de ${new Date(estado.memCursor).toISOString()} ate meia-noite)...`);
    try {
        const ultimos = await buscarTradesNaJanela(estado.memCursor, fimDoDia);
        adicionar(estado.mapa, ultimos);
        const { kb, totalMinutos } = await publicarDia(estado.dia, estado.mapa, fimDoDia);
        log(`  ${estado.dia} fechado - ${totalMinutos} minutos, ${kb} KB.`);
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIXO_LIVE}${estado.dia}.json` })).catch(() => {});
    } catch (e) {
        log(`  aviso: nao consegui fechar ${estado.dia} direito (${e.message}) - o historico ainda pode corrigir isso depois.`);
    }
}

async function loopHoje() {
    log('Iniciando r2-sync-hoje v2 (ao vivo, ciclo de 20 s) - Ctrl+C pra parar a qualquer momento.');
    pedirWakeLock();
    let estado = null;
    let ultimoCiclo = Date.now();
    while (true) {
        const t0 = Date.now();
        const atraso = t0 - ultimoCiclo - PAUSA_ENTRE_CICLOS_MS;
        if (atraso > AVISO_ATRASO_MS) {
            log(`  ATENCAO: este ciclo atrasou ${Math.round(atraso / 1000)} s. O Android deve estar suspendendo o Termux - ative o wake lock (notificacao do Termux -> "Acquire wakelock") e tire o Termux da otimizacao de bateria.`);
        }
        ultimoCiclo = t0;
        try {
            const hoje = dataStr(0);
            if (estado && estado.dia !== hoje) {
                await fecharDia(estado);
                estado = null;
            }
            if (!estado) estado = await carregarEstadoDoDia(hoje);

            const agora = Date.now();
            let novosMinutos = 0;
            if (agora - estado.memCursor >= 2000) {
                const novos = await buscarTradesNaJanela(estado.memCursor, agora);
                adicionar(estado.mapa, novos);
                estado.memCursor = agora;
                novosMinutos = novos.size;
            }

            const live = await publicarLive(hoje, estado.mapa, estado.memCursor);

            if (agora - estado.ultimoPublicarDia >= PUBLICAR_DIA_A_CADA_MS) {
                const dia = await publicarDia(hoje, estado.mapa, estado.memCursor);
                estado.ultimoPublicarDia = agora;
                salvarCursorLocal({ dia: hoje, ultimoTs: estado.memCursor });
                log(`  DIA publicado - ${dia.totalMinutos} minutos, ${dia.kb} KB (ao vivo: ${live.totalMinutos} min, ${live.kb} KB).`);
            } else {
                log(`  ao vivo OK - ${live.totalMinutos} min, ${live.kb} KB (${novosMinutos} minutos com trades novos).`);
            }
        } catch (e) {
            log(`  ERRO INESPERADO (nao mata o processo): ${e.message}`);
        }
        await new Promise(res => setTimeout(res, PAUSA_ENTRE_CICLOS_MS));
    }
}

loopHoje().catch(e => log(`ERRO FATAL: ${e.message}`));
