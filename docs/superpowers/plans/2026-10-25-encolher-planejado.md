# Encolher atividade planejada conforme o play — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O tempo de foco registrado numa atividade planejada passa a consumir o bloco planejado daquela ocorrência, que encolhe em tempo real e some quando zera — sem tocar no Google Calendar e sem afetar séries recorrentes.

**Architecture:** A conta (consumo e recorte) vira um módulo puro `tempo.js` testável com `node:test`. O `v2.html` usa essas funções só na hora de desenhar: cada evento planejado do dia é desenhado com o fim recuado pelo tempo consumido, e as sessões realizadas vinculadas a ele deixam de ser desenhadas como bloco separado (o planejado já as representa). O cronômetro atualiza só o bloco em andamento a cada segundo.

**Tech Stack:** HTML + JavaScript vanilla (script clássico, sem build), `node:test` para os testes, `python3 -m http.server` + agent-browser para o smoke test.

**Spec:** `docs/superpowers/specs/2026-10-25-encolher-planejado-design.md`

## Global Constraints

- O app real é `v2.html` (script inline). `v2.js` é cópia antiga de agosto e **não é carregada** — não alterar.
- Nenhuma escrita no Google Calendar nesta feature (nem patch, nem delete de evento planejado).
- Encolher **somente a ocorrência** (id da instância). A série nunca muda.
- `agregar()` e o relatório ficam intactos: Planejado = plano original, Foco registrado = tempo real.
- O projeto não é um repositório git. Não há passos de commit; cada tarefa termina com `v2.html` funcionando.
- `tempo.js` é um arquivo novo: precisa viajar junto com `v2.html` em qualquer deploy, e entrar no `ASSETS` do `sw.js`.

## Review Focus

- Sessão vinculada a um planejado de **outro dia** visível: continua aparecendo como bloco próprio (não pode sumir).
- Play **fora do horário previsto** (14h num bloco 9h–11h): desconta igual.
- Sessão **pausada** por muito tempo: o desconto congela.
- Consumo **maior que o planejado**: bloco some, sem altura negativa nem `NaN`.
- **Recorrência**: só a ocorrência daquele dia encolhe; outra ocorrência com id diferente fica cheia.
- Evento sem duração válida / dia inteiro: renderiza como hoje, sem recorte.
- Descrição sem `ID original` (sessão livre ou editada no Google): não desconta e continua visível.
- Planejado sem nenhum play: bloco idêntico ao de hoje (sem badge).

---

### Task 1: Módulo puro de consumo e recorte

**Files:**
- Create: `tempo.js`
- Test: `tests/tempo.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `Tempo.decorridoDaSessao(sessao, agoraMs: number) -> number` (ms, pausas descontadas)
  - `Tempo.consumoDaAtividade(eventos, sessao, idEvento: string, agoraMs: number) -> number` (ms)
  - `Tempo.recortePlanejado(ev, consumidoMs: number) -> { inicio: Date, fimOriginal: Date, fimRestante: Date, totalMs: number, consumidoMs: number, restanteMs: number, concluido: boolean } | null`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/tempo.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { decorridoDaSessao, consumoDaAtividade, recortePlanejado } = require('../tempo.js');

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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/tempo.test.js`
Expected: FAIL — `Cannot find module '../tempo.js'`.

- [ ] **Step 3: Implementar `tempo.js`**

```js
(function (raiz) {
  'use strict';

  // Tempo decorrido de uma sessão, com as pausas descontadas.
  function decorridoDaSessao(sessao, agoraMs) {
    if (!sessao) return 0;
    let ms = sessao.pausedElapsed || 0;
    if (!sessao.isPaused && sessao.runningSince) ms += agoraMs - sessao.runningSince;
    return Math.max(0, ms);
  }

  // Minutos consumidos de um evento planejado: sessões realizadas vinculadas a ele.
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/tempo.test.js`
Expected: PASS — 12 testes.

---

### Task 2: Encolher no desenho e esconder a sessão vinculada

**Files:**
- Modify: `v2.html` (script tag novo, `renderDayColumns`, `renderEvent`, `fmtDur`, CSS)
- Modify: `sw.js` (ASSETS e CACHE)

**Interfaces:**
- Consumes: `Tempo.consumoDaAtividade`, `Tempo.recortePlanejado` (Task 1).
- Produces: eventos planejados com `_recorte` no momento do desenho; classe CSS `.event-resto`; `fmtDur` passa a omitir `00`.

- [ ] **Step 1: Carregar o módulo**

Em `v2.html`, imediatamente antes da linha `<script>` do script inline (a que abre o bloco que define `state`), inserir:

```html
<script src="tempo.js"></script>
```

- [ ] **Step 2: Encolher e filtrar em `renderDayColumns`**

Substituir todo o trecho que hoje vai de `let lista = dayEvents;` até a linha `for (const [ev, lane, lanes] of layoutDay(lista)) html += renderEvent(ev, lane, lanes);` — isso inclui `sessAtiva`, `origem`, `sessaoDe`, `state.preenchendo` e o `trecho` — por:

```js
    // O planejado é desenhado com o tempo que ainda falta; a sessão realizada
    // vinculada a ele não vira bloco separado (o planejado já a representa).
    const agora = Date.now();
    const planejadosDoDia = new Set(dayEvents.filter(e => e._kind === 'planned').map(e => e.id));
    const visiveis = [];
    for (const ev of dayEvents) {
      if (ev._kind === 'planned' && ev.start.dateTime) {
        const consumido = Tempo.consumoDaAtividade(state.events, state.session, ev.id, agora);
        const r = Tempo.recortePlanejado(ev, consumido);
        if (!r || r.consumidoMs === 0) { visiveis.push(ev); continue; }
        if (r.concluido) continue; // zerou: some da grade
        visiveis.push({
          ...ev,
          start: { ...ev.start, dateTime: r.inicio.toISOString() },
          end: { ...ev.end, dateTime: r.fimRestante.toISOString() },
          _recorte: r,
        });
      } else if (ev._kind === 'realized' && ev._origemId && planejadosDoDia.has(ev._origemId)) {
        continue;
      } else {
        visiveis.push(ev);
      }
    }
    for (const [ev, lane, lanes] of layoutDay(visiveis)) html += renderEvent(ev, lane, lanes);
```

Remover também `state.preenchendo = false;` no início de `renderDayColumns`.

- [ ] **Step 3: Ajustar `renderEvent`**

Trocar a linha do `seguindo` e a do `playBtn` por:

```js
  const rodandoAqui = !!(state.session && state.session.sourceEventId === ev.id);
  const playBtn = (ev._kind === 'planned' && !isActive && !rodandoAqui)
    ? `<button class="event-play" data-id="${ev.id}" title="Iniciar sessão real">▶</button>`
    : '';
```

**Manter** o `const isActive = ...` e o bloco `if (isActive) { cls = 'event-active'; } else { ... }` como estão — eles continuam pintando de vermelho a sessão livre em andamento (que não tem evento de origem e segue visível). Remover apenas `fillHtml`, `infoHtml` e o trecho `if (seguindo) { ... }` (o preenchimento antigo).

Depois de `const timeStr = ...`, adicionar:

```js
  const recorte = ev._recorte || null;
  const restoStr = recorte && recorte.consumidoMs > 0
    ? `${fmtDur(recorte.consumidoMs)} feita · falta ${fmtDur(recorte.restanteMs)}`
    : '';
```

No HTML do bloco, antes de `${playBtn}`:

```js
      ${restoStr && !compact ? `<div class="event-resto">${restoStr}</div>` : ''}
```

- [ ] **Step 4: Deixar `fmtDur` legível**

Trocar a função `fmtDur` por:

```js
function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60), resto = m % 60;
  return resto ? `${h}h${pad(resto)}` : `${h}h`;
}
```

- [ ] **Step 5: CSS do texto de saldo**

Adicionar junto às regras `.event-title`:

```css
  .event-resto { font-size: 10px; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 6: Service worker**

Em `sw.js`, trocar `const CACHE = 'focusboard-v38';` por `'focusboard-v39'` e adicionar `'./tempo.js'` ao `ASSETS`.

- [ ] **Step 7: Testes unitários continuam passando**

Run: `node --test tests/tempo.test.js`
Expected: PASS — 12 testes.

- [ ] **Step 8: Smoke no navegador**

```bash
cd "/Users/vinicius/Foco no trabalho" && python3 -m http.server 8080
```

Abrir `http://localhost:8080/v2.html` com agent-browser e, no console da página, injetar estado falso:

```js
document.getElementById('onboarding').classList.add('hidden');
document.getElementById('main-view').classList.remove('hidden');
state.view = 'day'; state.cursor = new Date();
const base = new Date(); base.setHours(9, 0, 0, 0);
const iso = (h, m = 0) => { const d = new Date(base); d.setHours(h, m, 0, 0); return d.toISOString(); };
state.events = [
  { id: 'p1', _kind: 'planned', _calId: 'x', summary: 'Cotação', start: { dateTime: iso(9) }, end: { dateTime: iso(11) } },
  { id: 'r1', _kind: 'realized', _origemId: 'p1', _calId: 'y', summary: 'Cotação', start: { dateTime: iso(9) }, end: { dateTime: iso(10) } },
];
renderAll();
const p = document.querySelector('.event[data-id="p1"]');
({
  altura: p && p.style.height,
  horario: p && p.querySelector('.event-time')?.textContent,
  sessaoVisivel: !!document.querySelector('.event[data-id="r1"]'),
  saldo: p && p.querySelector('.event-resto')?.textContent,
});
```

Expected: `altura: "66px"`, `horario: "09:00–10:00"`, `sessaoVisivel: false`, `saldo: "1h feita · falta 1h"`.

Repetir sem a sessão realizada (`state.events = [só o p1]`): bloco volta a `134px`, horário `09:00–11:00`, sem `.event-resto`.

---

### Task 3: Atualização ao vivo e remoção do preenchimento antigo

**Files:**
- Modify: `v2.html` (`atualizarRestante`, `tickTimer`, remoção de `sessaoDe` / `textoPreenchimento` / `atualizarPreenchimento` / CSS antigo / `state.preenchendo`)

**Interfaces:**
- Consumes: `Tempo.consumoDaAtividade`, `Tempo.recortePlanejado`, `fmtDur`, `HOUR_HEIGHT`, `zDec`, `zHm` (já existentes).
- Produces: `atualizarRestante()` chamada a cada segundo pelo `tickTimer`.

- [ ] **Step 1: Criar `atualizarRestante`**

Adicionar onde estava `atualizarPreenchimento`:

```js
// A cada segundo, atualiza só o bloco planejado da sessão em andamento.
function atualizarRestante() {
  const sess = state.session;
  if (!sess || !sess.sourceEventId) return;
  const origem = state.events.find(e => e.id === sess.sourceEventId);
  if (!origem || origem._kind !== 'planned' || !origem.start.dateTime) return;
  const el = [...document.querySelectorAll('#day-columns .event')]
    .find(x => x.dataset.id === origem.id);
  if (!el) return;
  const consumido = Tempo.consumoDaAtividade(state.events, sess, origem.id, Date.now());
  const r = Tempo.recortePlanejado(origem, consumido);
  if (!r) return;
  if (r.concluido) { renderDayColumns(); return; }
  el.style.height = Math.max(18, (zDec(r.fimRestante) - zDec(r.inicio)) * HOUR_HEIGHT - 2) + 'px';
  const rotulo = `${zHm(r.inicio)}–${zHm(r.fimRestante)}`;
  const t = el.querySelector('.event-time') || el.querySelector('.event-time-inline');
  if (t) t.textContent = rotulo;
  const saldo = el.querySelector('.event-resto');
  if (saldo) saldo.textContent = `${fmtDur(r.consumidoMs)} feita · falta ${fmtDur(r.restanteMs)}`;
}
```

- [ ] **Step 2: Chamar no tique**

Em `tickTimer`, trocar `atualizarPreenchimento();` por `atualizarRestante();`.

- [ ] **Step 3: Remover o código morto do preenchimento**

Apagar:

- as funções `sessaoDe`, `textoPreenchimento` e `atualizarPreenchimento`;
- `state.preenchendo` (usos);
- as regras CSS `.event-seguindo`, `.event-fill`, `.event-fill::after`, `.event-seguindo > *`, `.event-seguindo.fill-claro ...`, `.fill-info`, `.fill-info.alem`;
- referências a `.event-fill`, `.fill-info-linha`, `fillHtml`/`infoHtml` em `renderEvent` (já removidas na Task 2).

Conferir que não sobrou referência:

```bash
grep -n "sessaoDe\|textoPreenchimento\|atualizarPreenchimento\|preenchendo\|event-fill\|fill-info\|event-seguindo" v2.html
```

Expected: nenhuma linha.

- [ ] **Step 4: Testes unitários**

Run: `node --test tests/tempo.test.js`
Expected: PASS — 12 testes.

- [ ] **Step 5: Smoke da sessão em andamento**

Com o estado falso da Task 2, substituir os eventos por um planejado e a sessão em andamento (sem sessão já concluída):

```js
state.session = {
  title: 'Cotação', gEventId: 'g0', sourceEventId: 'p1',
  startedAt: Date.now() - 30 * 60000, isPaused: false,
  pausedElapsed: 30 * 60000, runningSince: null,
};
state.events = [
  { id: 'p1', _kind: 'planned', _calId: 'x', summary: 'Cotação', start: { dateTime: iso(9) }, end: { dateTime: iso(11) } },
  { id: 'g0', _kind: 'realized', _origemId: 'p1', _calId: 'y', summary: 'Cotação', start: { dateTime: iso(9) }, end: { dateTime: iso(9, 30) } },
];
renderAll();
atualizarRestante();
const p = document.querySelector('.event[data-id="p1"]');
({ altura: p && p.style.height, horario: p && p.querySelector('.event-time')?.textContent, saldo: p && p.querySelector('.event-resto')?.textContent });
```

Expected: `altura: "100px"` (1h30 restante), `horario: "09:00–10:30"`, `saldo: "30min feita · falta 1h30"`. O evento `g0` não aparece como bloco.

---

### Task 4: Apagar sessão a partir do evento planejado

**Files:**
- Modify: `v2.html` (`abrirEvento`)

**Interfaces:**
- Consumes: `state.events`, `fmtDur`, `zHm`, `apagarSessao(ev)` (existente).
- Produces: botões `[data-apagar-sessao]` no corpo do modal do evento planejado.

- [ ] **Step 1: Listar as sessões vinculadas no modal**

Em `abrirEvento`, depois do `const linhas = [...]`:

```js
  // Sessões vinculadas: a sessão realizada não aparece na grade, então o
  // caminho para ver e apagar é aqui no evento planejado. A sessão em
  // andamento fica de fora (apagá-la quebraria o cronômetro).
  const vinculadas = ev._kind === 'planned'
    ? state.events.filter(x => x._kind === 'realized' && x._origemId === ev.id
        && x.start.dateTime && x.end.dateTime
        && !(state.session && x.id === state.session.gEventId))
    : [];
```

Trocar o `document.getElementById('event-modal-body').innerHTML = linhas.map(...)...` por:

```js
  const sessoesHtml = vinculadas.length ? `
    <div class="pt-3 mt-3 border-t border-neutral-800">
      <dt class="text-[11px] uppercase tracking-wider text-neutral-500">Sessões registradas</dt>
      ${vinculadas.map(s => {
        const i = new Date(s.start.dateTime), f = new Date(s.end.dateTime);
        return `<div class="flex items-center justify-between gap-2 py-1 text-neutral-200">
          <span>${i.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${zHm(i)}–${zHm(f)} · ${fmtDur(f - i)}</span>
          <button data-apagar-sessao="${escapeHtml(s.id)}" title="Apagar sessão" class="text-red-400 hover:text-red-300 px-2">🗑</button>
        </div>`;
      }).join('')}
    </div>` : '';

  document.getElementById('event-modal-body').innerHTML =
    linhas.map(([rot, val]) => `
    <div>
      <dt class="text-[11px] uppercase tracking-wider text-neutral-500">${escapeHtml(rot)}</dt>
      <dd class="text-neutral-200 whitespace-pre-wrap break-words">${escapeHtml(val)}</dd>
    </div>`).join('') + sessoesHtml;

  document.querySelectorAll('[data-apagar-sessao]').forEach(b => {
    b.onclick = async () => {
      const s = state.events.find(x => x.id === b.dataset.apagarSessao);
      if (!s) return;
      fecharEvento();
      await apagarSessao(s);
    };
  });
```

- [ ] **Step 2: Smoke do modal**

Com o estado falso da Task 2, executar `await abrirEvento('p1')` e conferir:

```js
({
  modalAberto: !document.getElementById('event-modal').classList.contains('hidden'),
  lista: !!document.querySelector('[data-apagar-sessao="r1"]'),
});
```

Expected: `modalAberto: true`, `lista: true`.

---

## Verificação final

- [ ] `node --test tests/tempo.test.js` → 12 PASS.
- [ ] `grep -n "sessaoDe\|textoPreenchimento\|atualizarPreenchimento\|preenchendo\|event-fill\|fill-info" v2.html` → vazio.
- [ ] Smoke das Tasks 2, 3 e 4 com os valores esperados.
- [ ] Abrir o app conectado ao Google e conferir com uma atividade real: play, parar, bloco encolhido; apagar a sessão pelo modal do planejado, bloco volta; conferir que a mesma atividade na semana seguinte continua cheia.
