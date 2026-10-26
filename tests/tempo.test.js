const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decorridoDaSessao,
  consumoDaAtividade,
  recortePlanejado,
  prepararEventosDaGrade,
} = require('../tempo.js');

const MIN = 60000;
const iso = (min) => new Date(Date.UTC(2026, 9, 25, 9, min)).toISOString();
const planejado = (id, iniMin, fimMin) => ({
  id, _kind: 'planned', start: { dateTime: iso(iniMin) }, end: { dateTime: iso(fimMin) },
});
const realizado = (id, origemId, iniMin, fimMin) => ({
  id, _kind: 'realized', _origemId: origemId,
  start: { dateTime: iso(iniMin) }, end: { dateTime: iso(fimMin) },
});

test('decorridoDaSessao soma o tempo pausado e o trecho em andamento', () => {
  const sessao = { pausedElapsed: 10 * MIN, isPaused: false, runningSince: 1000 };
  assert.equal(decorridoDaSessao(sessao, 1000 + 5 * MIN), 15 * MIN);
});

test('decorridoDaSessao congela quando a sessão está pausada', () => {
  const sessao = { pausedElapsed: 12 * MIN, isPaused: true, runningSince: null };
  assert.equal(decorridoDaSessao(sessao, 999999999), 12 * MIN);
});

test('consumoDaAtividade soma todas as sessões realizadas vinculadas', () => {
  const eventos = [planejado('p1', 0, 120), realizado('r1', 'p1', 0, 60), realizado('r2', 'p1', 70, 100)];
  assert.equal(consumoDaAtividade(eventos, null, 'p1', 0), 90 * MIN);
});

test('consumoDaAtividade ignora sessões de outra atividade e sessões livres', () => {
  const eventos = [realizado('r1', 'p2', 0, 60), realizado('r2', null, 0, 60), realizado('r3', 'p1', 0, 30)];
  assert.equal(consumoDaAtividade(eventos, null, 'p1', 0), 30 * MIN);
});

test('consumoDaAtividade só desconta a ocorrência cujo id foi passado (recorrência)', () => {
  const eventos = [planejado('p1', 0, 120), planejado('p2', 0, 120), realizado('r1', 'p1', 0, 60)];
  assert.equal(consumoDaAtividade(eventos, null, 'p1', 0), 60 * MIN);
  assert.equal(consumoDaAtividade(eventos, null, 'p2', 0), 0);
});

test('consumoDaAtividade conta a sessão em andamento pelo cronômetro, não pelo evento provisório', () => {
  // o evento realizado nasce com fim provisório de +30min; não pode contar 30min
  const eventos = [realizado('g1', 'p1', 0, 30)];
  const sessao = { gEventId: 'g1', sourceEventId: 'p1', pausedElapsed: 20 * MIN, isPaused: false, runningSince: 1000 };
  assert.equal(consumoDaAtividade(eventos, sessao, 'p1', 1000), 20 * MIN);
});

test('consumoDaAtividade desconta play fora do horário previsto', () => {
  // planejado 9h–11h; sessão feita às 14h–15h
  const eventos = [planejado('p1', 0, 120), realizado('r1', 'p1', 300, 360)];
  assert.equal(consumoDaAtividade(eventos, null, 'p1', 0), 60 * MIN);
});

test('consumoDaAtividade ignora eventos com duração inválida', () => {
  const eventos = [realizado('r1', 'p1', 60, 60), realizado('r2', 'p1', 0, 30)];
  assert.equal(consumoDaAtividade(eventos, null, 'p1', 0), 30 * MIN);
});

test('recortePlanejado mantém o início e encurta o fim', () => {
  const r = recortePlanejado(planejado('p1', 0, 120), 60 * MIN);
  assert.equal(r.inicio.toISOString(), iso(0));
  assert.equal(r.restanteMs, 60 * MIN);
  assert.equal(r.fimRestante.toISOString(), iso(60));
  assert.equal(r.concluido, false);
});

test('recortePlanejado sem consumo devolve o bloco cheio', () => {
  const r = recortePlanejado(planejado('p1', 0, 120), 0);
  assert.equal(r.restanteMs, 120 * MIN);
  assert.equal(r.concluido, false);
});

test('recortePlanejado zera quando o consumo passa do total', () => {
  const r = recortePlanejado(planejado('p1', 0, 120), 180 * MIN);
  assert.equal(r.restanteMs, 0);
  assert.equal(r.concluido, true);
});

test('recortePlanejado devolve null para evento sem duração válida', () => {
  assert.equal(recortePlanejado(planejado('p1', 60, 60), 0), null);
  assert.equal(recortePlanejado({ id: 'x', start: {}, end: {} }, 0), null);
});

test('grade mantém visível a sessão finalizada vinculada ao planejado', () => {
  const plano = planejado('p1', 0, 120);
  const sessaoFinalizada = realizado('r1', 'p1', 130, 160);

  const visiveis = prepararEventosDaGrade(
    [plano, sessaoFinalizada],
    [plano, sessaoFinalizada],
    null,
    0,
  );

  assert.deepEqual(visiveis.map(ev => ev.id), ['p1', 'r1']);
  assert.equal(visiveis[0]._recorte.restanteMs, 90 * MIN);
});
