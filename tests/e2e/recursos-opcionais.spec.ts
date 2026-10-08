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

import { expect, test } from "./helpers/test";

import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "recursos-opcionais");
function evidencia(nome: string): string {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  return path.join(EVIDENCIA, nome);
}

test.describe.configure({ timeout: 120_000 });

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
    // `^` separa os dois estados: "Ao ligar, aparece…" CONTÉM "aparece no menu
    // em:", e sem a âncora o caso de ligado passaria com a frase de desligado.
    await expect(
      page.getByText(/^Aparece no menu em: CRM › Empresas, CRM › Pessoas/),
    ).toBeVisible();
    await page.screenshot({ path: evidencia("modulo-ligado-diz-onde.png"), fullPage: true });
  });

  await test.step("⭐ a porta ESTÁ no menu do CRM, sem recarregar à mão", async () => {
    // O passo que o defeito 2 reprovava: o layout de `/app` servia o menu de
    // antes porque nada o revalidava. Navegação normal, como o operador faz.
    await page.goto("/app/companies");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: PORTA }).first()).toBeVisible();
    await page.screenshot({ path: evidencia("porta-no-menu-do-crm.png"), fullPage: true });
  });

  await test.step("desliga e a porta SAI — senão o verde era só a metade fácil", async () => {
    await page.goto("/admin/sistema");
    await expect(chave).toBeVisible();
    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await page.goto("/app/inbox");
    await expect(page.getByRole("link", { name: PORTA })).toHaveCount(0);
  });
});
