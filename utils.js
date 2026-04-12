// utils.js
// Utilitários compartilhados do HuberHorti

(function (global) {
  'use strict';

  function formatarDataBR(data) {
    const d = data instanceof Date ? data : new Date(data);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  function calcularCicloAtual(base = new Date()) {
    const hoje = new Date(base);
    hoje.setHours(0, 0, 0, 0);

    const diaSemana = hoje.getDay(); // dom=0 ... sab=6
    const diasDesdeQuarta = (diaSemana - 3 + 7) % 7;

    const d0 = new Date(hoje);
    d0.setDate(hoje.getDate() - diasDesdeQuarta);
    d0.setHours(0, 0, 0, 0);

    const d7 = new Date(d0);
    d7.setDate(d0.getDate() + 6);
    d7.setHours(23, 59, 59, 999);

    return { d0, d7 };
  }

  function atualizarCicloAtualGlobal(base = new Date()) {
    const { d0, d7 } = calcularCicloAtual(base);
    global.cicloAtual = { d0, d7 };
    return global.cicloAtual;
  }

  function getAgoraLocalISO() {
    const agora = new Date();
    const offset = agora.getTimezoneOffset();
    return new Date(agora.getTime() - offset * 60000)
      .toISOString()
      .slice(0, 16);
  }

  function toLocalInputValue(dataISO) {
    if (!dataISO) return '';
    const d = new Date(dataISO);
    if (Number.isNaN(d.getTime())) return '';
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000)
      .toISOString()
      .slice(0, 16);
  }

  function getRangeOntemAteHoje() {
    const agora = new Date();

    const inicio = new Date(agora);
    inicio.setDate(inicio.getDate() - 1);
    inicio.setHours(0, 0, 0, 0);

    const fim = new Date(agora);
    fim.setHours(23, 59, 59, 999);

    return {
      inicio,
      fim,
      inicioISO: inicio.toISOString(),
      fimISO: fim.toISOString()
    };
  }

  function getInicioAntesDeOntem() {
    const agora = new Date();
    const inicio = new Date(agora);
    inicio.setDate(inicio.getDate() - 1);
    inicio.setHours(0, 0, 0, 0);
    return inicio.toISOString();
  }

  /**
   * Calcula o saldo em aberto de um fornecedor, reconciliando pedidos e movimentos.
   */
  async function emAbertoFornecedor(id, numero_compra) {
    try {
      // 1. Soma dos Pedidos de Compras (Dívida Bruta)
      let queryPedidos = global.supabase
        .from('pedidos_compras')
        .select('em_aberto')
        .eq('fornecedor_id', id)
        .gt('em_aberto', 0);

      // Exceção: Se houver numero_compra, ignora ele no somatório
      if (numero_compra && numero_compra !== 0 && numero_compra !== "") {
        queryPedidos = queryPedidos.neq('id', numero_compra);
      }

      const { data: pedidos, error: errorPedidos } = await queryPedidos;
      if (errorPedidos) throw errorPedidos;

      const totalPedidos = pedidos.reduce((acc, item) => acc + Number(item.em_aberto || 0), 0);

      // 2. Soma dos Movimentos de Fornecedores (Pagamentos Pendentes)
      const { data: movimentos, error: errorMovimentos } = await global.supabase
        .from('movimentos_fornecedores')
        .select('valor')
        .eq('fornecedor_id', id)
        .eq('status', 0)
        .not('data', 'is', null);

      if (errorMovimentos) throw errorMovimentos;

      const totalMovimentos = movimentos.reduce((acc, item) => acc + Number(item.valor || 0), 0);

      // 3. Retorna apenas o cálculo dos movimentos para validação
      return totalMovimentos;

    } catch (error) {
      console.error("Erro ao calcular saldo em aberto:", error.message);
      return 0;
    }
  }

  // Namespace global
  global.HHUtils = {
    formatarDataBR,
    calcularCicloAtual,
    atualizarCicloAtualGlobal,
    getAgoraLocalISO,
    toLocalInputValue,
    getRangeOntemAteHoje,
    getInicioAntesDeOntem,
    emAbertoFornecedor // Injetada aqui
  };

})(window);
