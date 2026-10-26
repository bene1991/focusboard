const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const arquivo of ['index.html', 'v2.html']) {
  test(`${arquivo} usa a mesma regra que mantém sessões finalizadas na grade`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');

    assert.match(
      html,
      /Tempo\.prepararEventosDaGrade\(dayEvents, state\.events, state\.session, agora\)/,
    );
    assert.doesNotMatch(
      html,
      /if \(!rodandoAqui && r && r\.consumidoMs > 0 && !r\.concluido\) continue/,
    );
  });
}
