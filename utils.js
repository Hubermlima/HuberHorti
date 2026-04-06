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

  // Namespace global
  global.HHUtils = {
    formatarDataBR,
    calcularCicloAtual,
    atualizarCicloAtualGlobal,
    getAgoraLocalISO,
    toLocalInputValue,
    getRangeOntemAteHoje,
    getInicioAntesDeOntem
  };

})(window);