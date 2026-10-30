/**
 * GUARDA do recorte de MÊS — sem servidor, sem banco, sem Supabase.
 *
 * ═══ O defeito que este arquivo congela ══════════════════════════════════════
 *
 * Em 2026-10-30, 16:55 BRT, o `e2e-parte (2)` de todo PR reprovou com nove casos
 * de agenda. O trace do job 124255171221 mostra o painel parado num mês que
 * acabou:
 *
 *     text: outubro de 2026
 *     button "30 de outubro — nenhum horário publicado neste dia"   (encaixe)
 *     button "31 de outubro — nenhum horário publicado neste dia"   (encaixe)
 *     … e nenhum `data-disponivel="true"` no mês inteiro
 *
 * Os helpers da semana esperavam um dia aceso NO MÊS EM TELA com teto de 20 s e
 * só DEPOIS clicavam em "próximo mês". Com o mês morto a espera estourava antes
 * do salto — e o salto nunca acontecia.
 *
 * A página abaixo imita exatamente esse estado: outubro de 2026, todos os dias
 * apagados, 30 e 31 clicáveis pelo encaixe, e **nenhum avanço automático de
 * mês** (o produto decide isso uma vez só, e no dia da falha decidiu errado com
 * os horários de duas horas antes). O mês seguinte responde cheio. Com o helper
 * antigo estes três casos reprovam com a mesma mensagem do CI; com o novo,
 * escolhem dia.
 *
 * ⚠️ O teto é curto de propósito, como em `agenda-portao-de-hidratacao.spec.ts`:
 * aqui o mês em tela está morto de propósito, e passar o teto de produção só
 * faria o guarda gastar meio minuto provando o mesmo.
 */
import { test, expect } from "./helpers/test";

import {
  escolherDiaDesenhado,
  escolherPrimeiroDiaCheio,
  escolherUltimoDiaCheio,
} from "./helpers/agenda-semana-integra";
import { mesVisivelNoPainel } from "./helpers/agenda-mes-com-vaga";

test.use({ timezoneId: "America/Sao_Paulo" });

const ORIGEM = "http://painel-falso.test";
/** Sexta-feira, 30/10/2026, 20:00 BRT — o instante da falha medida. */
const AGORA = new Date("2026-10-30T23:00:00Z");
/** A semana que a GRADE estaria desenhando depois de um salto de período. */
const SEMANA_DESENHADA = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];

/** O teto do guarda: curto, ver o cabeçalho. */
const TETO = 3_000;

// O painel reduzido ao que os helpers leem: `dia-<yyyy-MM-dd>` com
// `data-disponivel`, e os dois botões de mês. `pedir(mes)` repete a conta de
// `janelaDoMesVisivel` — do 1º (ou de agora) até `endOfMonth + 1 dia`.
const PAGINA = `<!doctype html><html lang="pt-BR"><body><div id="painel"></div>
<button data-testid="mes-anterior">‹</button>
<button data-testid="mes-seguinte">›</button>
<script>
  const chave = (d) => d.toISOString().slice(0, 10);
  const agora = new Date();
  const hoje = chave(agora);
  let mes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  let horarios = null;
  const pedir = async (m) => {
    horarios = null; pintar();
    const inicioDoMes = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1));
    const depoisDoMes = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1, 23, 59));
    const de = inicioDoMes < agora ? agora : inicioDoMes;
    const r = await fetch("/api/v1/agenda/horarios-livres?de=" + de.toISOString() + "&ate=" + depoisDoMes.toISOString());
    horarios = await r.json(); pintar();
  };
  function pintar() {
    const primeiro = new Date(mes); primeiro.setUTCDate(1 - mes.getUTCDay());
    const fimDoMes = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 0));
    const ultimo = new Date(fimDoMes); ultimo.setUTCDate(fimDoMes.getUTCDate() + (6 - fimDoMes.getUTCDay()));
    let html = "";
    for (let d = new Date(primeiro); d <= ultimo; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = chave(d);
      const doMes = d.getUTCMonth() === mes.getUTCMonth();
      const disponivel = doMes && !!horarios && !!horarios[k];
      // Encaixe: dia do mês, de hoje em diante, clicável mesmo sem vaga — é o
      // estado que o trace mostra nos dias 30 e 31.
      const clicavel = disponivel || (doMes && k >= hoje);
      html += '<button data-testid="dia-' + k + '" data-disponivel="' + disponivel + '"' +
        (clicavel ? "" : " disabled") + ">" + d.getUTCDate() + "</button>";
    }
    document.getElementById("painel").innerHTML = html;
  }
  document.querySelector('[data-testid="mes-seguinte"]').onclick = () => {
    mes = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 1)); pedir(mes);
  };
  document.querySelector('[data-testid="mes-anterior"]').onclick = () => {
    mes = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() - 1, 1)); pedir(mes);
  };
  pedir(mes);
</script></body></html>`;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
  await page.route(`${ORIGEM}/api/v1/agenda/horarios-livres*`, async (rota) => {
    const u = new URL(rota.request().url());
    const de = new Date(u.searchParams.get("de")!);
    const ate = new Date(u.searchParams.get("ate")!);
    // A jornada do seed: seg–sex, e — como o motor — nada antes do aviso mínimo.
    const livres: Record<string, number> = {};
    for (let d = new Date(de); d < ate; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow >= 1 && dow <= 5 && chaveDoDia(d) > "2026-10-30") livres[chaveDoDia(d)] = 18;
    }
    await rota.fulfill({ json: livres });
  });
  await page.route(`${ORIGEM}/`, (rota) => rota.fulfill({ contentType: "text/html", body: PAGINA }));
  await page.goto(`${ORIGEM}/`);
});

function chaveDoDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

test("o painel abre num mês que acabou e o primeiro dia cheio vem do mês SEGUINTE", async ({
  page,
}) => {
  // Pré-condição do defeito: outubro de 2026 em tela, nenhum dia com vaga.
  await expect(page.getByTestId("dia-2026-10-30")).toHaveAttribute("data-disponivel", "false");
  expect(
    await page.locator('[data-testid^="dia-"][data-disponivel="true"]').count(),
    "o guarda precisa de um mês MORTO em tela — se outubro acender, ele não está testando nada",
  ).toBe(0);
  expect(await mesVisivelNoPainel(page), "o mês em tela é lido dos dias desenhados").toBe("2026-10");

  const dia = await escolherPrimeiroDiaCheio(page, { teto: TETO });

  expect(dia, "o mês em tela acabou e o helper não avançou — é o vermelho de 30/10").toBe(
    "2026-11-02",
  );
  expect(await mesVisivelNoPainel(page), "o calendário deveria ter ficado no mês do dia escolhido").toBe(
    "2026-11",
  );
});

test("o ÚLTIMO dia cheio é do MÊS EM TELA, não da ponta da janela do mês", async ({ page }) => {
  // A janela de novembro vai até 1º de dezembro (`janelaDoMesVisivel`), e 01/12
  // é um dia útil: sem o filtro pelo mês do calendário, "o último dia" seria
  // 01/12 — que não está desenhado em novembro.
  const dia = await escolherUltimoDiaCheio(page, { teto: TETO });

  expect(dia).toBe("2026-11-30");
  expect(await mesVisivelNoPainel(page)).toBe("2026-11");
});

test("a semana desenhada manda: o mês é o DELA, e o painel é levado até lá", async ({ page }) => {
  const dia = await escolherDiaDesenhado(page, SEMANA_DESENHADA);

  expect(dia).toBe("2026-11-02");
  expect(
    await mesVisivelNoPainel(page),
    "o painel tem de ter sido NAVEGADO até o mês da semana desenhada",
  ).toBe("2026-11");
});
