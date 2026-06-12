// ── trading-monitor.js ────────────────────────────────────────────
// Monitoramento de alertas e alvos em tempo real via WebSocket Binance
// Inclua em qualquer página: <script src="trading-monitor.js"></script>
// Depende de: window.db (Supabase client) já inicializado

(function() {
    'use strict';

    const OPERADOR_ID   = 'e8a7bf50-ea0f-4134-b222-88ff489b69e8';
    const PUSH_URL      = 'https://huberhorti-push.huber-produtos.workers.dev';
    const WS_URL        = 'wss://stream.binance.com/ws/btcusdt@aggTrade';
    const THROTTLE_MS   = 5000;

    let _precoAntes     = 0;
    let _precoAtual     = 0;
    let _lastCheck      = 0;
    let _alertas        = [];
    let _trades         = [];
    let _ws             = null;
    let _iniciado       = false;

    // ── Busca dados do Supabase ───────────────────────────────────
    async function carregarAlertas() {
        if (!window.db) return;
        const { data } = await window.db.from('alertas')
            .select('id,preco,habilitado')
            .eq('habilitado', true);
        _alertas = data || [];
    }

    async function carregarTrades() {
        if (!window.db) return;
        const { data } = await window.db.from('trades')
            .select('id,tipo,alvo,alvo_realizacao,alvo_ativo,stop,stop_realizacao,stop_ativo')
            .eq('operacional', true);
        _trades = data || [];
    }

    // ── Busca subscription ────────────────────────────────────────
    async function buscarSubscription() {
        if (!window.db) return null;
        const { data } = await window.db.from('push_subscriptions')
            .select('subscription')
            .eq('operador_id', OPERADOR_ID);
        return data?.[0]?.subscription || null;
    }

    // ── Envia push ────────────────────────────────────────────────
    async function enviarPush(title, body) {
        try {
            const subscription = await buscarSubscription();
            if (!subscription) return;
            await fetch(PUSH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription, title, body, tag: 'trading-alert' })
            });
        } catch(e) {
            console.error('[TradingMonitor] Push error:', e);
        }
    }

    // ── Detecção de cruzamento ────────────────────────────────────
    async function verificarCruzamentos(novoPreco) {
        const antes = _precoAntes;
        if (!antes || !novoPreco) return;

        const dir = novoPreco > antes ? '↗ Cruzando Acima' : '↘ Cruzando Abaixo';

        // Alertas
        for (const alerta of _alertas) {
            const preco = parseFloat(alerta.preco);
            const cruzou = (antes < preco && novoPreco >= preco) ||
                           (antes > preco && novoPreco <= preco);
            if (cruzou) {
                await enviarPush(
                    '🔔 Alerta de preço!',
                    `BTC/USD cruzou ${preco.toLocaleString('pt-BR', {minimumFractionDigits:2})} USD · ${dir}`
                );
            }
        }

        // Trades — alvo e stop
        for (const trade of _trades) {
            const tipo = trade.tipo?.toLowerCase() === 'short' ? 'short' : 'long';

            // Alvo
            if (trade.alvo && trade.alvo_ativo) {
                const alvo = parseFloat(trade.alvo);
                const cruzou = tipo === 'long'
                    ? (antes < alvo && novoPreco >= alvo)
                    : (antes > alvo && novoPreco <= alvo);
                if (cruzou) {
                    await enviarPush(
                        '🎯 Alvo atingido!',
                        `BTC/USD · ${alvo.toLocaleString('pt-BR', {minimumFractionDigits:2})} USD · Realização: ${trade.alvo_realizacao || 0}%`
                    );
                    // Desativa alvo no Supabase
                    if (window.db) {
                        await window.db.from('trades').update({ alvo_ativo: false }).eq('id', trade.id);
                        trade.alvo_ativo = false;
                    }
                }
            }

            // Stop
            if (trade.stop && trade.stop_ativo) {
                const stop = parseFloat(trade.stop);
                const cruzou = tipo === 'long'
                    ? (antes > stop && novoPreco <= stop)
                    : (antes < stop && novoPreco >= stop);
                if (cruzou) {
                    await enviarPush(
                        '🛑 Stop atingido!',
                        `BTC/USD · ${stop.toLocaleString('pt-BR', {minimumFractionDigits:2})} USD · Realização: ${trade.stop_realizacao || 0}%`
                    );
                    // Desativa stop no Supabase
                    if (window.db) {
                        await window.db.from('trades').update({ stop_ativo: false }).eq('id', trade.id);
                        trade.stop_ativo = false;
                    }
                }
            }
        }
    }

    // ── WebSocket Binance ─────────────────────────────────────────
    function conectarWS() {
        if (_ws) return;
        _ws = new WebSocket(WS_URL);

        _ws.onmessage = async (e) => {
            try {
                const d = JSON.parse(e.data);
                const novoPreco = parseFloat(d.p);
                if (!novoPreco) return;

                _precoAtual = novoPreco;

                const agora = Date.now();
                if (agora - _lastCheck < THROTTLE_MS) return;
                _lastCheck = agora;

                await verificarCruzamentos(novoPreco);
                _precoAntes = novoPreco;

            } catch(err) {
                console.error('[TradingMonitor] WS error:', err);
            }
        };

        _ws.onclose = () => {
            _ws = null;
            // Reconecta após 5s
            setTimeout(conectarWS, 5000);
        };

        _ws.onerror = () => {
            _ws?.close();
        };
    }

    // ── Inicialização ─────────────────────────────────────────────
    async function iniciar() {
        if (_iniciado) return;
        _iniciado = true;

        // Aguarda db estar disponível
        let tentativas = 0;
        while (!window.db && tentativas < 20) {
            await new Promise(r => setTimeout(r, 500));
            tentativas++;
        }
        if (!window.db) {
            console.warn('[TradingMonitor] db não disponível');
            return;
        }

        await carregarAlertas();
        await carregarTrades();

        // Recarrega dados a cada 5 minutos
        setInterval(async () => {
            await carregarAlertas();
            await carregarTrades();
        }, 5 * 60 * 1000);

        conectarWS();
        console.log('[TradingMonitor] Iniciado');
    }

    // Inicia quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }

})();