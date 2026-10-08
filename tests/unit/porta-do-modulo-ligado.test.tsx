/**
 * LIGAR UM MÓDULO TEM DE ACENDER A PORTA DELE — e o que mede isso é este arquivo.
 *
 * O defeito que ele fecha: o dono da instalação liga um módulo em Recursos
 * opcionais e nada aparece no CRM. A causa não é o gate de módulo (esse
 * funciona: `permitidos()` solta a porta assim que o módulo entra na lista), é a
 * SEGUNDA camada — `destinosDaInterface()` intersecta o permitido com o que a
 * empresa escolheu mostrar, e o preset `simplificada` é uma lista NOSSA, escrita
 * antes dos módulos existirem. Nenhuma empresa decidiu esconder "Empresas": ela
 * escolheu "menu enxuto" num dia em que a porta não existia.
 *
 * A distinção que este arquivo trava é entre as DUAS origens de `chosen`:
 *
 * - `destinos` explícito  → escolha de uma PESSOA, item por item. Continua mandando.
 * - preset `simplificada` → lista do PRODUTO. Não pode ser lida como decisão da
 *   empresa sobre uma porta que ela nunca viu na tela.
 */
import { describe, expect, it } from "vitest";

import { NAV_CATALOG, NAV_GROUPS, type NavMetadata } from "@/lib/navigation/catalogo";
import { ondeOModuloAparece } from "@/lib/navigation/onde-o-modulo-aparece";
import { MODULOS_NA_TELA } from "@/app/admin/(protected)/sistema/_form";
import { combinarInterfaces, destinosDaInterface, permitidos } from "@/lib/navigation/interface";
import { MODULOS_OPCIONAIS, type ModuloOpcional } from "@/lib/instalacao/modulos";

/**
 * ⚠️ `NAV_CATALOG` é UNIÃO DE TIPOS LITERAIS, não `NavMetadata[]`: cada entrada tem só os
 * campos que ela escreve, então `d.modulo` e `d.minRole` não existem no tipo da união e o
 * acesso é `TS2339`. O arquivo da lib faz este mesmo alargamento; o teste tem de fazer
 * igual.
 *
 * Como isto chegou ao CI: eu rodei `npx tsc --noEmit`, que usa o `tsconfig.json` — e esse
 * EXCLUI os testes. A régua do projeto é `pnpm typecheck`
 * (`tsc --noEmit -p tsconfig.typecheck.json`), que os inclui. Alias diferente, régua
 * diferente, e o verde do comando errado não vale.
 */
const CATALOGO = NAV_CATALOG as readonly NavMetadata[];

/** A primeira porta do menu que declara este módulo, ou `null` se ele não tem porta. */
function portaDo(modulo: ModuloOpcional): string | null {
  return CATALOGO.find((d) => d.modulo === modulo)?.href ?? null;
}

const COM_PORTA = MODULOS_OPCIONAIS.filter((m) => portaDo(m) !== null);

describe("módulo ligado acende a porta mesmo no preset simplificada", () => {
  it("controle: há módulo com porta para medir (senão o resto é vácuo)", () => {
    expect(COM_PORTA.length).toBeGreaterThan(0);
  });

  it.each(COM_PORTA)("%s: a porta aparece com o preset simplificada", (modulo) => {
    const porta = portaDo(modulo)!;
    const vistos = destinosDaInterface({ preset: "simplificada" }, false, "admin", [modulo]).map(
      (d) => d.href,
    );
    expect(vistos).toContain(porta);
  });

  it.each(COM_PORTA)("%s: DESLIGADO a porta continua fora (controle negativo)", (modulo) => {
    const porta = portaDo(modulo)!;
    const vistos = destinosDaInterface({ preset: "simplificada" }, false, "admin", []).map(
      (d) => d.href,
    );
    expect(vistos).not.toContain(porta);
  });

  it("a escolha EXPLÍCITA de uma pessoa continua mandando: porta desmarcada fica fora", () => {
    // Um `destinos` item a item é decisão humana sobre portas que estavam na
    // tela. Respeitá-la é o oposto do preset: aqui alguém olhou e desmarcou.
    const modulo = COM_PORTA[0]!;
    const porta = portaDo(modulo)!;
    const escolhidos = permitidos(false, "admin")
      .map((d) => d.href)
      .filter((h) => h !== porta);
    const vistos = destinosDaInterface(
      { preset: "completa", destinos: escolhidos as never },
      false,
      "admin",
      [modulo],
    ).map((d) => d.href);
    expect(vistos).not.toContain(porta);
  });

  it("quem não passa o papel mínimo não ganha a porta pelo módulo (controle negativo)", () => {
    // O módulo é APRESENTAÇÃO; o papel continua decidindo. Sem este caso, a
    // exceção acima poderia estar abrindo porta de admin para `viewer`.
    const soDeAdmin = CATALOGO.find((d) => d.modulo && d.minRole === "admin");
    const modulo = soDeAdmin?.modulo;
    if (!soDeAdmin || !modulo) return; // nada a medir nesta versão do catálogo
    const vistos = destinosDaInterface({ preset: "simplificada" }, false, "viewer", [
      modulo,
    ]).map((d) => d.href);
    expect(vistos).not.toContain(soDeAdmin.href);
  });
});

/**
 * E A SEGUNDA METADE DO MESMO DEFEITO: a tela onde o interruptor vive nunca
 * dizia o que acontecia depois de ligar.
 *
 * O dado para dizer isso já existia — `portaDoModuloNaEmpresa()` sai do próprio
 * menu — e tinha UM consumidor só: `/app/settings/recursos`, a tela da EMPRESA.
 * Quem liga o módulo é quem administra a instalação, em `/admin/sistema`, e ali
 * a informação não chegava. Dois dos módulos por interruptor (`cobranca`,
 * `login_codex`) não criam porta nenhuma no CRM — ligar e procurar no menu é
 * procurar o que não existe.
 */
describe("ondeOModuloAparece: a tela pode dizer o que ligar vai mudar", () => {
  it("módulo com porta devolve o caminho E o grupo do menu", () => {
    const onde = ondeOModuloAparece("crm_b2b");
    expect(onde.map((p) => p.href)).toEqual(["/app/companies", "/app/people", "/app/imports"]);
    expect(onde.every((p) => p.grupo === "CRM")).toBe(true);
    expect(onde[0]!.label).toBe("Empresas");
  });

  it("módulo SEM porta no CRM devolve lista vazia — e não um palpite", () => {
    // Falhar aberto na informação: vazio é "não cria porta", que é a verdade, e
    // deixa a tela dizer isso. Inventar uma porta mandaria o operador procurar
    // no lugar errado.
    expect(ondeOModuloAparece("cobranca")).toEqual([]);
    expect(ondeOModuloAparece("login_codex")).toEqual([]);
  });

  it("o grupo vem do CATÁLOGO do menu, não de uma segunda lista escrita à mão", () => {
    // Nome de grupo OU rótulo do hub dele — as duas únicas palavras que o menu
    // chega a escrever. Uma segunda lista à mão divergiria na primeira tela que
    // mudasse de grupo, e o teste não veria.
    const noMenu = NAV_GROUPS.flatMap((g) => [g.label, g.hub?.label]).filter(Boolean);
    for (const modulo of MODULOS_OPCIONAIS) {
      for (const porta of ondeOModuloAparece(modulo)) {
        expect(noMenu).toContain(porta.grupo);
      }
    }
  });

  it("⭐ TODO módulo responde a pergunta: ou tem porta no CRM, ou declara onde aparece", () => {
    // O invariante que impede o defeito de voltar com o próximo módulo. Sem ele,
    // um módulo novo sem porta entra na tela com um interruptor e nenhuma pista.
    // A tela é a fonte: cada linha de módulo ou tem porta no menu (lida de
    // `NAV_CATALOG`) ou declara `foraDoMenu`. O módulo de TABELA (`honorarios`,
    // ADR-0002) não tem linha aqui porque não se liga por interruptor — ele se
    // instala em `/admin/modulos`, e a porta dele já é medida acima.
    const semResposta = MODULOS_NA_TELA.filter(
      (m) => ondeOModuloAparece(m.modulo).length === 0 && !m.foraDoMenu,
    ).map((m) => m.modulo);
    expect(semResposta).toEqual([]);

    // Controle: a varredura enxerga mesmo. Sem isto, uma lista que viesse vazia
    // por erro de import leria como "todo módulo respondido".
    expect(MODULOS_NA_TELA.length).toBeGreaterThan(0);
    expect(MODULOS_NA_TELA.filter((m) => m.foraDoMenu).map((m) => m.modulo)).toEqual([
      "cobranca",
      "login_codex",
    ]);
  });
});

describe("o grupo é o que está NA TELA, não o rótulo do modelo de dados", () => {
  /**
   * ⚠️ O CAMINHO PRECISA DO PASSO DO HUB, e esta é a decisão do dono do produto (opção B).
   *
   * As nove portas de módulo têm `sidebar` ausente no catálogo, e isso significa "só no hub"
   * (`NavMetadata.sidebar`: "Ausente = só no hub"). O filtro do menu lateral é
   * `d.sidebar || (!group.hub && settings?.destinos)` — então elas NÃO aparecem no menu diário:
   * só dentro de "Ver tudo em CRM".
   *
   * Era essa a causa do relato "liguei e não aparece no CRM": a pessoa ligou, olhou o menu
   * lateral, e a porta está um clique adentro. E o meu texto dizia "CRM › Empresas", que sugere
   * menu lateral — ou seja, ele mandava procurar no lugar errado.
   *
   * A decisão foi manter a porta no hub (o menu foi medido em 15 itens com folga 0 a 1280×900, e
   * o hub existe para não reabrir essa corrida) e fazer o texto dizer o caminho de verdade.
   */
  it("⭐ porta que mora no hub declara o passo do hub", () => {
    const onde = ondeOModuloAparece("crm_b2b");
    expect(onde[0]!.grupo).toBe("CRM");
    expect(onde[0]!.hub).toBe("Ver tudo em CRM");
    expect(onde[0]!.label).toBe("Empresas");
  });

  it("⭐ grupo do RODAPÉ não ganha passo extra: o rodapé já É o hub", () => {
    // O `Sidebar` desenha o grupo do rodapé mostrando SÓ o hub dele, então "Configurações" é o
    // primeiro passo e não há um segundo. Dizer "Configurações › Configurações › Dados externos"
    // seria inventar um clique que não existe.
    const onde = ondeOModuloAparece("banco_externo");
    expect(onde[0]!.grupo).toBe("Configurações");
    expect(onde[0]!.hub).toBeUndefined();
    expect(onde[0]!.label).toBe("Dados externos");
  });

  it("toda porta de módulo é de hub hoje — se alguma subir ao menu, este caso avisa", () => {
    // Controle de vivacidade com dente: se um dia uma porta de módulo ganhar `sidebar: true`, ela
    // deixa de precisar do passo do hub e este caso fica vermelho, forçando a revisão do texto.
    const comHub = MODULOS_OPCIONAIS.flatMap((m) => ondeOModuloAparece(m)).filter((p) => p.hub);
    const semHub = MODULOS_OPCIONAIS.flatMap((m) => ondeOModuloAparece(m)).filter((p) => !p.hub);
    // As de `organizacao` (rodapé) não têm `hub`; todas as outras têm.
    expect(comHub.length).toBeGreaterThan(0);
    expect(semHub.every((p) => p.grupo === "Configurações")).toBe(true);
  });

  it("⭐ grupo do rodapé: diz 'Configurações', que é o que o menu escreve", () => {
    // `banco_externo` e `propostas` moram no grupo `organizacao`, e esse grupo é
    // `GRUPO_NO_RODAPE`: o Sidebar o desenha mostrando só o hub ("Configurações").
    // A palavra "Organização" não aparece na tela — mandar procurar por ela é
    // instrução errada com ar de certeza.
    expect(ondeOModuloAparece("banco_externo")[0]!.grupo).toBe("Configurações");
    expect(ondeOModuloAparece("propostas")[0]!.grupo).toBe("Configurações");
  });

  it("os outros grupos seguem pelo próprio rótulo (controle)", () => {
    expect(ondeOModuloAparece("crm_b2b")[0]!.grupo).toBe("CRM");
    expect(ondeOModuloAparece("fluxos_atendimento")[0]!.grupo).toBe("Agente de IA");
    expect(ondeOModuloAparece("honorarios")[0]!.grupo).toBe("Análise");
  });
});

/**
 * ⚠️ A FORMA QUE A PRODUÇÃO ENTREGA, e não a crua — o conserto anterior era CÓDIGO MORTO.
 *
 * `destinosDaInterface` nunca recebe `{ preset: "simplificada" }` em produção. O caminho real é
 * `lib/auth/server.ts` → `combinarInterfaces`, que converte qualquer escolha em
 * `{ preset: "completa", destinos: [...] }`. Com `destinos` definido, a minha exceção para porta de
 * módulo ligado não dispara: ela testava `settings.destinos === undefined`.
 *
 * Ou seja: os casos que eu havia escrito passavam numa forma de entrada que o produto não produz.
 * É a mesma armadilha do dublê que inventa o formato do dado, só que aqui o "dublê" era a minha
 * própria escolha de entrada. Um cético achou, medindo `combinarInterfaces` nas quatro combinações.
 *
 * Estes casos entram pela porta de produção. Eles reprovam enquanto a exceção não sobreviver à
 * combinação.
 */
describe("a exceção da porta de módulo sobrevive ao caminho de produção", () => {
  const vistos = (daEmpresa: unknown, doVinculo: unknown, modulo: ModuloOpcional) =>
    destinosDaInterface(combinarInterfaces(daEmpresa, doVinculo), false, "admin", [modulo]).map(
      (d) => d.href,
    );

  it("controle: sem escolha de ninguém, a porta do módulo ligado aparece", () => {
    const porta = portaDo("crm_b2b")!;
    expect(vistos(null, null, "crm_b2b")).toContain(porta);
  });

  it("⭐ empresa no preset simplificado: a porta do módulo ligado aparece", () => {
    const porta = portaDo("crm_b2b")!;
    expect(vistos({ preset: "simplificada" }, null, "crm_b2b")).toContain(porta);
  });

  it("⭐ vínculo no preset simplificado: idem", () => {
    const porta = portaDo("crm_b2b")!;
    expect(vistos(null, { preset: "simplificada" }, "crm_b2b")).toContain(porta);
  });

  it("⭐ os DOIS no preset simplificado: idem", () => {
    const porta = portaDo("crm_b2b")!;
    expect(vistos({ preset: "simplificada" }, { preset: "simplificada" }, "crm_b2b")).toContain(
      porta,
    );
  });

  it("escolha item a item de uma PESSOA continua mandando, mesmo pela combinação", () => {
    // A distinção que o conserto tem de preservar: lista escrita à mão é decisão humana sobre
    // portas que estavam na tela; preset é lista do produto.
    const porta = portaDo("crm_b2b")!;
    const escolhidos = permitidos(false, "admin")
      .map((d) => d.href)
      .filter((h) => h !== porta);
    expect(vistos({ preset: "completa", destinos: escolhidos }, null, "crm_b2b")).not.toContain(
      porta,
    );
  });

  it("módulo DESLIGADO não aparece por esta porta (controle negativo)", () => {
    const porta = portaDo("crm_b2b")!;
    const sem = destinosDaInterface(
      combinarInterfaces({ preset: "simplificada" }, null),
      false,
      "admin",
      [],
    ).map((d) => d.href);
    expect(sem).not.toContain(porta);
  });
});
