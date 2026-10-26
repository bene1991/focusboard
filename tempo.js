(function (raiz) {
  'use strict';

  // Tempo decorrido de uma sessão, com as pausas descontadas.
  function decorridoDaSessao(sessao, agoraMs) {
    if (!sessao) return 0;
    let ms = sessao.pausedElapsed || 0;
    if (!sessao.isPaused && sessao.runningSince) ms += agoraMs - sessao.runningSince;
    return Math.max(0, ms);
  }

  // Tempo consumido (ms) de um evento planejado: sessões realizadas vinculadas a ele.
  // A sessão em andamento entra pelo cronômetro (o evento no Google ainda tem fim provisório).
  function consumoDaAtividade(eventos, sessao, idEvento, agoraMs) {
    let ms = 0;
    for (const ev of eventos || []) {
      if (ev._kind !== 'realized' || ev._origemId !== idEvento) continue;
      if (sessao && ev.id === sessao.gEventId) continue;
      const ini = new Date(ev.start && ev.start.dateTime);
      const fim = new Date(ev.end && ev.end.dateTime);
      if (!(fim > ini)) continue;
      ms += fim - ini;
    }
    if (sessao && sessao.sourceEventId === idEvento) ms += decorridoDaSessao(sessao, agoraMs);
    return Math.max(0, ms);
  }

  // Bloco planejado recortado: mantém o início e recua o fim pelo tempo consumido.
  function recortePlanejado(ev, consumidoMs) {
    const ini = ev && ev.start && new Date(ev.start.dateTime);
    const fim = ev && ev.end && new Date(ev.end.dateTime);
    if (!ini || !fim || isNaN(ini) || isNaN(fim) || fim <= ini) return null;
    const totalMs = fim - ini;
    const consumido = Math.min(Math.max(0, consumidoMs || 0), totalMs);
    const restanteMs = totalMs - consumido;
    return {
      inicio: ini,
      fimOriginal: fim,
      fimRestante: new Date(ini.getTime() + restanteMs),
      totalMs,
      consumidoMs: consumido,
      restanteMs,
      concluido: restanteMs <= 0,
    };
  }

  const api = { decorridoDaSessao, consumoDaAtividade, recortePlanejado };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Tempo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
