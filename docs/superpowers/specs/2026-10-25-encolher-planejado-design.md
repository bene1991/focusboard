# Encolher atividade planejada conforme o play (design)

Data: 2026-10-25
Status: aguardando aprovação

## Intenção

Hoje, ao apertar ▶ numa atividade planejada (ex.: Cotação 9h–11h), o FocusBoard cria uma sessão
realizada num calendário separado e **mantém o bloco planejado intacto**. Na grade aparecem os dois
blocos e o tempo trabalhado não "baixa" do planejado.

Objetivo: o tempo de play **consome** o bloco planejado daquele dia. Fez 1h de uma cotação de 2h,
o bloco planejado passa a representar 1h restante.

## Objetivos

- Encolher o bloco planejado da ocorrência conforme o tempo de foco registrado nela.
- Encolher **somente a ocorrência do dia**. A série recorrente no Google Calendar nunca é tocada.
- Atualizar em tempo real enquanto o play está rodando.
- Reverter sozinho se a sessão for apagada.

## Não-objetivos

- Não alterar eventos no Google Calendar (nem avulsos nem recorrentes).
- Não alterar as estatísticas de Planejado x Realizado (ver Decisões).
- Não mexer em sessões livres (sem evento de origem).

## Abordagens consideradas

1. **Encolher só no FocusBoard (escolhida).** O bloco é desenhado com a duração restante calculada
   em memória. Google intocado, série intacta, reversível.
2. **Encolher no Google Calendar.** Evento avulso é um patch simples; ocorrência de série exige
   criar exceção ("desgrudar" a instância), com risco de bagunçar a recorrência. Rejeitada.
3. **Híbrido.** Google para avulsos, local para recorrentes. Comportamento imprevisível. Rejeitada.

## Como funciona

### Cálculo

Para cada evento planejado `P` (id `P.id`, início `P.start`, fim `P.end`):

```
consumido(P) = soma das durações das sessões realizadas com _origemId == P.id
             + (se houver sessão em andamento vinculada a P) tempo decorrido dela
restante(P) = max(0, duração(P) - consumido(P))
```

Observações:

- A sessão em andamento já existe como evento realizado no calendário, mas nasce com fim
  provisório de +30 min. Por isso ela é **excluída da soma** (pelo `gEventId`) e entra pelo
  tempo decorrido real de `state.session` (pausas não contam).
- Sessões livres (sem `_origemId`) não descontam nada.
- Sessões de outro dia que apontem para a mesma ocorrência continuam descontando daquela ocorrência.
- O vínculo já existe: `startSession` grava `ID original: <id>` na descrição da sessão e a leitura
  do calendário reconstrói `_origemId`.

### Desenho do bloco

- O bloco planejado mantém o **início** e encolhe pelo **fim** (9h–11h com 1h feita vira 9h–10h).
  *(decisão minha; corrija se preferir encolher pelo início)*
- O texto de horário do bloco mostra o intervalo restante calculado.
- A sessão **em andamento** também aparece na grade, no horário real em que o play foi apertado
  (bloco vermelho). As sessões **já concluídas** continuam ocultas enquanto o planejado tem
  saldo — nelas, o planejado encolhido é o bloco único.
- Quando `restante == 0`, o bloco planejado some da grade; fica só a sessão realizada.
- Se trabalhar mais que o planejado, não há valor negativo: o bloco some e o excedente aparece
  apenas na sessão realizada.

### Atualização

- Ao iniciar, pausar, retomar e parar a sessão: `renderAll()`.
- Enquanto rodando: o bloco vinculado é atualizado a cada segundo (altura/posição/horário),
  sem redesenhar a grade inteira.

### Estatísticas

Ficam como estão: "Planejado" continua sendo o plano original e "Foco registrado" o tempo real.
Mudar o planejado para "restante" faria a aderência (`real / plan`) estourar 100%.
O encolhimento vale para a grade do calendário.

## Onde mexer

O app real é o **`v2.html`** (script inline, ~1923 linhas). O `v2.js` é uma cópia antiga de agosto
que não é carregada por nenhuma página — não será alterado.

Pontos previstos:

- `renderEvent` — altura/topo/horário do bloco planejado a partir do restante.
- `renderDayColumns` — permitir omitir bloco com restante zero (e não quebrar o cálculo de faixas).
- `startSession` / `stopSession` / `pauseSession` / `resumeSession` — re-render ao mudar estado.
- `tickTimer` — atualizar o bloco vinculado a cada segundo.
- Nova função `restanteDoPlanejado(ev)` com o cálculo acima.

## Riscos

- Eventos com duração zero ou inválida: tratar como sem desconto.
- Ocultar o bloco pode mudar o empilhamento (faixas) dos eventos vizinhos: o cálculo de faixas
  precisa rodar só com os eventos visíveis.
- Fuso: comparar ids, não datas; o desconto é por ocorrência, então não depende de fuso.
