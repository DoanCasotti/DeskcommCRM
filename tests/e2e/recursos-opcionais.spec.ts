/**
 * A ÁREA "RECURSOS OPCIONAIS", PELA TELA (pedido do mantenedor, doc 73; desenho no doc 80).
 *
 * O pedido era de achabilidade: "não entendi onde ficam os lugares para
 * ativar/desativar". Então esta spec prova o CAMINHO, não só a tela:
 *
 *   1. o admin da empresa chega pelo hub de Configurações (sem digitar URL),
 *      vê a lista e o "Ajustar" de uma chave o leva à tela onde ela mora;
 *   2. o dono do servidor vê a porta "Recursos opcionais" no menu do Admin, e a
 *      tela tem os três blocos, com o que depende do servidor só em leitura.
 *
 * O que ela NÃO prova: que cada leitura de estado bate com a tela do recurso —
 * isso é regra pura, coberta em `tests/unit/recursos-opcionais-catalogo.test.ts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { moduloLigado } from "../../lib/instalacao/modulos";

import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "recursos-opcionais");
function evidencia(nome: string): string {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  return path.join(EVIDENCIA, nome);
}

test.describe.configure({ timeout: 120_000 });

/**
 * ESPERA O BANCO, NÃO A TELA — e isto é o conserto de um defeito do teste que me custou duas
 * rodadas de CI, com dois sintomas opostos e UMA causa.
 *
 * O interruptor de `/admin/sistema` é OTIMISTA: `_form.tsx` vira o estado local no clique e só
 * depois aguarda a action. Então `aria-checked` (e a frase "Aparece no menu em:", que lê o mesmo
 * estado) ficam verdes ANTES de o banco ter a linha. Navegar nesse instante mede um servidor que
 * ainda não sabe da mudança:
 *
 *   - ao LIGAR, `/app/companies` caiu no `notFound()` do layout e não havia barra lateral —
 *     o link "não existia" (`element(s) not found`);
 *   - ao DESLIGAR, a porta continuou lá (`Expected: 0  Received: 4`).
 *
 * Os dois sintomas são opostos e a causa é a mesma, que é exatamente o que torna esse tipo de
 * corrida difícil de ler a partir de um só vermelho. A espera usa `moduloLigado`, a MESMA função
 * que a aplicação usa para decidir — não uma consulta paralela que poderia divergir dela. É o
 * padrão que `fluxo-de-atendimento.spec.ts` já usava.
 */
const db = createClient(
  credenciaisSupabaseDeTeste().url,
  credenciaisSupabaseDeTeste().serviceRole,
  { auth: { persistSession: false } },
);

async function esperarModuloNoBanco(ligado: boolean): Promise<void> {
  await expect.poll(async () => moduloLigado(db, "crm_b2b"), { timeout: 20_000 }).toBe(ligado);
}

test("admin da empresa acha os recursos opcionais e o Ajustar leva à tela certa", async ({ page }) => {
  await loginComoAdmin(page, lerCreds());

  // Pela porta, como o usuário: o hub de Configurações.
  await page.goto("/app/settings");
  await page.getByRole("link", { name: /Recursos opcionais/ }).first().click();
  await expect(page).toHaveURL(/\/app\/settings\/recursos$/);

  await expect(page.getByRole("heading", { level: 1, name: "Recursos opcionais" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Módulos desta instalação" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Da sua empresa" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Em cada agente" })).toBeVisible();

  const linha = page.locator('[data-recurso="conversa_fica_com_quem_atendeu"]');
  await expect(linha).toContainText("A conversa fica com quem atendeu");
  // O estado vem lido, não um placeholder: é um dos dois rótulos de chave da empresa.
  await expect(linha).toContainText(/Ligado|Desligado/);
  await page.screenshot({ path: evidencia("empresa.png"), fullPage: true });

  await linha.getByRole("link", { name: /Ajustar/ }).click();
  await expect(page).toHaveURL(/\/app\/settings\/atendimento$/);
  await expect(page.getByRole("heading", { level: 1, name: "Distribuição de atendimento" })).toBeVisible();
});

test("dono do servidor vê a porta Recursos opcionais e os três blocos no Admin", async ({ page }) => {
  // O `e2e-dono` só é platform admin se um seed anterior o promoveu; sem esta
  // afirmação a spec mediria a ordem de execução em vez do produto.
  await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  await loginComoDono(page, lerCreds());

  await page.goto("/admin");
  await page.getByRole("link", { name: "Recursos opcionais" }).first().click();
  await expect(page).toHaveURL(/\/admin\/sistema$/);

  await expect(page.getByRole("heading", { level: 1, name: "Recursos opcionais" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Módulos", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comportamento", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Depende do servidor" })).toBeVisible();

  // Só leitura, com estado detectado — e nada que se pareça com valor de segredo.
  const email = page.locator('[data-recurso="email"]');
  await expect(email).toContainText(/Configurado|Não configurado/);
  await expect(page.locator('[data-recurso="graph_parceiro"]')).toBeVisible();
  await page.screenshot({ path: evidencia("admin.png"), fullPage: true });
});

/**
 * A JORNADA QUE O MANTENEDOR RELATOU, DE PONTA A PONTA.
 *
 * O relato: "os módulos que são ativados aqui, eles não aparecem no CRM". Três
 * defeitos distintos produziam esse mesmo sintoma, e nenhum deles era o gate de
 * módulo (esse sempre funcionou):
 *
 *   1. a tela do interruptor nunca dizia ONDE o módulo apareceria — o dado
 *      existia (`ondeOModuloAparece`, lido do próprio menu) e só a tela da
 *      EMPRESA o consumia, nunca a de quem liga;
 *   2. `updateModuloDaInstalacao` revalidava só `/admin/sistema`; o menu do CRM
 *      vive no layout de `/app` e continuava o de antes;
 *   3. a empresa no preset "simplificada" nunca via porta de módulo nenhuma —
 *      a lista do preset é NOSSA, escrita antes de existir módulo opcional.
 *
 * Esta spec dirige o produto como o mantenedor dirigiu: liga pela tela, LÊ o que
 * a tela promete e vai ao CRM conferir se a promessa se cumpriu. Depois desliga
 * e exige que a porta saia — senão o verde seria só a metade fácil.
 */
test("liga um módulo, a tela diz onde ele aparece, e a porta está lá no CRM", async ({ page }) => {
  await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  await loginComoDono(page, lerCreds());

  const PORTA = "Empresas";
  const chave = page.getByRole("switch", { name: "Empresas e pessoas (venda para empresas)" });

  await test.step("a tela diz onde o módulo vai aparecer ANTES de ligar", async () => {
    await page.goto("/admin/sistema");
    await expect(chave).toBeVisible();
    const ligadoAntes = (await chave.getAttribute("aria-checked")) === "true";
    if (ligadoAntes) {
      await chave.click();
      await expect(chave).toHaveAttribute("aria-checked", "false");
    }
    await esperarModuloNoBanco(false);
    // A frase é o conserto: sem ela o operador liga e não sabe para onde olhar.
    //
    // ⚠️ ANCORADA NO MÓDULO, e com `^`. A primeira versão só procurava "Ao ligar,
    // aparece no menu em:" e o Playwright recusou em strict mode: resolveu para
    // QUATRO elementos, um por módulo com interruptor. O vermelho foi bom — ele
    // imprimiu o texto dos quatro e provou que a tela renderiza o que devia,
    // inclusive "Configurações › Dados externos", que é a exceção do grupo do
    // rodapé. Mas asserção que casa com quatro linhas não diz qual delas mediu.
    await expect(
      page.getByText(/^Ao ligar, aparece no menu em: CRM › Empresas, CRM › Pessoas/),
    ).toBeVisible();
    await page.screenshot({ path: evidencia("modulo-desligado-diz-onde.png"), fullPage: true });
  });

  await test.step("liga, e a frase passa a falar no presente", async () => {
    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await esperarModuloNoBanco(true);
    // `^` separa os dois estados: "Ao ligar, aparece…" CONTÉM "aparece no menu
    // em:", e sem a âncora o caso de ligado passaria com a frase de desligado.
    await expect(
      page.getByText(/^Aparece no menu em: CRM › Empresas, CRM › Pessoas/),
    ).toBeVisible();
    await page.screenshot({ path: evidencia("modulo-ligado-diz-onde.png"), fullPage: true });
  });

  await test.step("⭐ a porta ESTÁ no menu do CRM, sem recarregar à mão", async () => {
    // O passo que o defeito 2 reprovava: o layout de `/app` servia o menu de antes
    // porque nada o revalidava. Navegação normal, como o operador faz.
    //
    // ⚠️ A MEDIÇÃO É NO HUB, não no menu lateral — e isso é escolha, não desvio.
    //
    // A primeira versão procurava `link "Empresas"` depois de abrir
    // `/app/companies`, e deu `element(s) not found`. Levantei duas hipóteses e
    // DERRUBEI as duas, medindo: (a) "o dono não é membro de organização" é falso —
    // o seed lhe dá `role: "admin"` de organização (`scripts/seed-e2e-credentials.ts`);
    // (b) "o grupo do menu está colapsado" é falso — `gruposFechados` nasce vazio,
    // então tudo abre por padrão (`components/shell/Sidebar.tsx`).
    //
    // Sem causa provada, não troco um palpite por outro: mudo de INSTRUMENTO. O que
    // esta jornada precisa provar é "a porta passou a ser oferecida a esta empresa",
    // e o hub do grupo é a superfície que responde exatamente isso — ele recebe o
    // mesmo `modulosLigados` que o menu lateral (`app/app/crm/page.tsx` → `NavHub`),
    // é caminho real de usuário ("Ver tudo em CRM") e não depende de viewport, de
    // grupo aberto nem de barra inferior. A rota segue conferida logo abaixo.
    await page.goto("/app/crm");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: PORTA }).first()).toBeVisible();

    // E a rota abre de verdade — o gate do layout (`notFound()` com o módulo
    // desligado) não a está barrando.
    await page.goto("/app/companies");
    await expect(page).toHaveURL(/\/app\/companies$/);
    await page.screenshot({ path: evidencia("porta-no-menu-do-crm.png"), fullPage: true });
  });

  await test.step("desliga e a porta SAI — senão o verde era só a metade fácil", async () => {
    await page.goto("/admin/sistema");
    await expect(chave).toBeVisible();
    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await esperarModuloNoBanco(false);

    await page.goto("/app/crm");
    await expect(page.getByRole("link", { name: PORTA })).toHaveCount(0);
  });
});
