/**
 * #3514 — a passagem SDR → Closer na ação `assign_owner`.
 *
 * São DUAS perguntas, e elas não se misturam:
 *
 *   1. **A opção desligada não muda nada.** Uma automação que hoje move só o
 *      negócio não pode passar a mover o cliente e a conversa porque o schema
 *      ganhou duas chaves. O desfecho (`detail`) e as chamadas ao banco ficam
 *      idênticos aos de antes: nem carteira, nem conversa, nem consulta de
 *      contato.
 *   2. **A opção ligada passa o cliente** pela PORTA que já existe — a carteira
 *      por `fn_definir_carteira_do_cliente` (sem ator, origem `automacao`) e as
 *      conversas por `fn_conversation_assign` (reason `transfer`, com o dono
 *      esperado), nunca por UPDATE direto.
 *
 * O que este arquivo NÃO prova (e o `tests/invariants/carteira-da-automacao.test.ts`
 * prova): que o banco aceita o ator nulo com a origem `automacao` e segue
 * recusando o ator nulo com qualquer outra origem.
 */
import { describe, it, expect, vi } from "vitest";

import type { ActionCtx } from "@/lib/automation/types";
import { getAction } from "@/lib/automation/actions";
import { STATUS_ENCERRADOS } from "@/lib/inbox/comando-da-conversa";
import "@/lib/automation/actions/assign-owner";

const NOVO_DONO = "11111111-1111-4111-8111-111111111111";
const SDR = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const CONVERSA_DO_SDR = "44444444-4444-4444-8444-444444444444";
const CONVERSA_SEM_DONO = "55555555-5555-4555-8555-555555555555";

interface RpcRegistrada {
  nome: string;
  args: Record<string, unknown>;
}

/** O encadeamento que a ação usa em `conversations`: eq → eq → not → order. */
interface Passo {
  eq(coluna: string, valor: unknown): Passo;
  not(coluna: string, operador: string, valor: unknown): Passo;
  order(coluna: string): Promise<{ data: Array<{ id: string; assigned_to_user_id: string | null }>; error: null }>;
}

interface EstadoDoBanco {
  membro?: { user_id: string; role: string } | null;
  conversas?: Array<{ id: string; assigned_to_user_id: string | null }>;
  erroDaCarteira?: string;
  /** Ids de conversa cuja transferência a função recusa. */
  conversasQueFalham?: string[];
  /** contato do negócio quando o contexto não o traz (fallback da consulta). */
  contatoDoNegocio?: string | null;
}

/**
 * Um banco pequeno o bastante para o que a ação faz: consulta de membro, UPDATE
 * do negócio, a lista de conversas abertas do contato e as duas RPCs. Ele
 * REGISTRA tudo — é o registro que transforma "não fez nada" em asserção.
 */
function bancoFalso(estado: EstadoDoBanco = {}) {
  const rpcs: RpcRegistrada[] = [];
  const atualizacoes: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
  const consultasDeConversa: Array<Array<[string, string, unknown]>> = [];

  const admin = {
    rpc: vi.fn(async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome === "fn_definir_carteira_do_cliente") {
        return estado.erroDaCarteira
          ? { data: null, error: { message: estado.erroDaCarteira } }
          : { data: args.p_dono, error: null };
      }
      if (nome === "fn_conversation_assign") {
        return estado.conversasQueFalham?.includes(String(args.p_conversation_id))
          ? { data: null, error: { message: "conversation_outside_visibility_scope" } }
          : { data: [{ id: args.p_conversation_id }], error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((tabela: string) => {
      if (tabela === "crm_leads") {
        return {
          update: (valores: Record<string, unknown>) => ({
            eq: () => ({
              eq: async () => {
                atualizacoes.push({ tabela, valores });
                return { error: null };
              },
            }),
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { contact_id: estado.contatoDoNegocio ?? null }, error: null }),
              }),
            }),
          }),
        };
      }
      if (tabela === "user_organizations") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: estado.membro ?? { user_id: NOVO_DONO, role: "agent" }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      // conversations
      const filtros: Array<[string, string, unknown]> = [];
      consultasDeConversa.push(filtros);
      const passo = (coluna: string | null, operador: string, valor: unknown): Passo => {
        if (coluna) filtros.push([coluna, operador, valor]);
        return {
          eq: (c: string, v: unknown) => passo(c, "eq", v),
          not: (c: string, o: string, v: unknown) => passo(c, o, v),
          order: async () => ({ data: estado.conversas ?? [], error: null }),
        };
      };
      return {
        select: () => ({
          eq: (coluna: string, valor: unknown) => passo(coluna, "eq", valor),
        }),
      };
    }),
  };

  return { admin, rpcs, atualizacoes, consultasDeConversa };
}

function ctx(
  admin: ReturnType<typeof bancoFalso>["admin"],
  negocio: { id: string; contact_id?: string | null } = { id: "lead-1", contact_id: CONTATO },
  contatoDoContexto = true,
): ActionCtx {
  return {
    admin: admin as unknown as ActionCtx["admin"],
    organizationId: "org-1",
    ruleId: "rule-1",
    ruleName: "Passagem para o Closer",
    requestId: "evt-1",
    event: {
      id: "evt-1",
      organization_id: "org-1",
      event_type: "lead.stage_changed",
      entity_kind: "crm_lead",
      entity_id: negocio.id,
      payload: {},
      metadata: {},
      consumed_by: [],
      attempts: 0,
    },
    context: contatoDoContexto ? { lead: negocio, contact: { id: CONTATO } } : { lead: negocio },
  };
}

const soONegocio = { user_id: NOVO_DONO };

describe("assign_owner — a passagem SDR → Closer (#3514)", () => {
  it("com as duas opções desligadas, faz EXATAMENTE o que fazia: só o negócio", async () => {
    const banco = bancoFalso();
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin), soONegocio);

    // O contrato antigo, byte a byte: nem chave nova no detalhe.
    expect(r).toEqual({ type: "assign_owner", status: "success", detail: { user_id: NOVO_DONO } });
    // Uma escrita, no negócio. Nenhuma RPC, nenhuma consulta de conversa.
    expect(banco.atualizacoes).toHaveLength(1);
    expect(banco.atualizacoes[0]?.tabela).toBe("crm_leads");
    expect(banco.rpcs).toEqual([]);
    expect(banco.consultasDeConversa).toEqual([]);
  });

  it("a chave explícita `false` é o mesmo que ausente: ninguém liga a passagem por engano", async () => {
    const banco = bancoFalso();
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin), {
      ...soONegocio,
      contato: false,
      conversas: false,
    });
    expect(r.detail).toEqual({ user_id: NOVO_DONO });
    expect(banco.rpcs).toEqual([]);
  });

  it("com `contato` ligado, a carteira passa pela porta única, sem ator e com a origem do sistema", async () => {
    const banco = bancoFalso();
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin), { ...soONegocio, contato: true });

    expect(banco.rpcs).toEqual([
      {
        nome: "fn_definir_carteira_do_cliente",
        args: {
          p_org: "org-1",
          // Sem ator: a automação não tem sessão. A função só aceita isso com a
          // origem `automacao` — é o que o invariante do banco prova.
          p_actor: null,
          p_contact: CONTATO,
          p_dono: NOVO_DONO,
          p_origem: "automacao",
        },
      },
    ]);
    // Nada de UPDATE direto em contacts: a carteira tem UMA porta.
    expect(banco.atualizacoes.map((a) => a.tabela)).toEqual(["crm_leads"]);
    // As conversas não foram pedidas, então nem são lidas.
    expect(banco.consultasDeConversa).toEqual([]);
    expect(r.status).toBe("success");
    expect(r.detail).toEqual({ user_id: NOVO_DONO, carteira: "ok" });
  });

  it("com `conversas` ligado, passa as ABERTAS com dono — pela função de atribuição, não por UPDATE", async () => {
    const banco = bancoFalso({
      conversas: [
        { id: CONVERSA_DO_SDR, assigned_to_user_id: SDR },
        // Já é do destino: não há o que passar.
        { id: "66666666-6666-4666-8666-666666666666", assigned_to_user_id: NOVO_DONO },
        // Fila/IA, sem dono anterior: fica onde está (transferir calaria o bot).
        { id: CONVERSA_SEM_DONO, assigned_to_user_id: null },
      ],
    });
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin), { ...soONegocio, conversas: true });

    // A régua de "aberta" vem de uma fonte só, e o filtro vai na consulta: é
    // assim que a conversa ENCERRADA não é tocada.
    expect(banco.consultasDeConversa).toHaveLength(1);
    expect(banco.consultasDeConversa[0]).toContainEqual([
      "status",
      "in",
      `(${[...STATUS_ENCERRADOS].join(",")})`,
    ]);

    // Uma chamada, e só para a conversa com dono de outra pessoa.
    expect(banco.rpcs).toEqual([
      {
        nome: "fn_conversation_assign",
        args: {
          p_organization_id: "org-1",
          p_conversation_id: CONVERSA_DO_SDR,
          p_to_user_id: NOVO_DONO,
          p_reason: "transfer",
          // O dono LIDO: se alguém transferir no meio do caminho, a função
          // devolve vazio em vez de atropelar.
          p_expected_assignee: SDR,
          p_enforce_expected: true,
        },
      },
    ]);
    expect(banco.atualizacoes.map((a) => a.tabela)).toEqual(["crm_leads"]);
    expect(r.status).toBe("success");
    expect(r.detail).toEqual({ user_id: NOVO_DONO, conversas: { movidas: 1, falhas: 0 } });
  });

  it("as duas opções juntas: negócio, carteira e conversas, nesta ordem", async () => {
    const banco = bancoFalso({ conversas: [{ id: CONVERSA_DO_SDR, assigned_to_user_id: SDR }] });
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin), {
      ...soONegocio,
      contato: true,
      conversas: true,
    });

    expect(banco.rpcs.map((c) => c.nome)).toEqual([
      "fn_definir_carteira_do_cliente",
      "fn_conversation_assign",
    ]);
    expect(r).toEqual({
      type: "assign_owner",
      status: "success",
      detail: { user_id: NOVO_DONO, carteira: "ok", conversas: { movidas: 1, falhas: 0 } },
    });
  });

  it("a carteira que falha não desfaz o negócio, mas a ação NÃO diz que deu tudo certo", async () => {
    const banco = bancoFalso({ erroDaCarteira: "carteira_dono_invalido" });
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin), { ...soONegocio, contato: true });

    expect(banco.atualizacoes).toHaveLength(1); // o negócio mudou de dono
    expect(r.status).toBe("failed");
    expect(r.error).toBe("carteira_nao_passou");
    expect(r.detail).toEqual({
      user_id: NOVO_DONO,
      carteira: "falhou",
      erro: "carteira_dono_invalido",
    });
  });

  it("conversa que falha é contada, e a mensagem da primeira vai para o detalhe técnico", async () => {
    const banco = bancoFalso({
      conversas: [{ id: CONVERSA_DO_SDR, assigned_to_user_id: SDR }],
      conversasQueFalham: [CONVERSA_DO_SDR],
    });
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin), { ...soONegocio, conversas: true });

    expect(r.status).toBe("failed");
    expect(r.error).toBe("conversas_nao_passaram");
    expect(r.detail).toEqual({
      user_id: NOVO_DONO,
      conversas: { movidas: 0, falhas: 1 },
      erro_conversas: `${CONVERSA_DO_SDR}: conversation_outside_visibility_scope`,
      // Sem falha de carteira, a conversa ocupa o lugar que a tela lê — a frase
      // "o detalhe técnico abaixo diz quais" não pode prometer o que não há.
      erro: `${CONVERSA_DO_SDR}: conversation_outside_visibility_scope`,
    });
  });

  it("quando as duas pernas falham, a mensagem da carteira fica no detalhe e a da conversa ao lado", async () => {
    const banco = bancoFalso({
      conversas: [{ id: CONVERSA_DO_SDR, assigned_to_user_id: SDR }],
      conversasQueFalham: [CONVERSA_DO_SDR],
      erroDaCarteira: "carteira_dono_invalido",
    });
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin), {
      ...soONegocio,
      contato: true,
      conversas: true,
    });

    expect(r.error).toBe("carteira_nao_passou");
    expect(r.detail).toEqual({
      user_id: NOVO_DONO,
      carteira: "falhou",
      erro: "carteira_dono_invalido",
      conversas: { movidas: 0, falhas: 1 },
      erro_conversas: `${CONVERSA_DO_SDR}: conversation_outside_visibility_scope`,
    });
  });

  it("negócio sem contato: o dono muda e a passagem é declarada, sem inventar erro", async () => {
    const banco = bancoFalso();
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin, { id: "lead-1", contact_id: null }, false), {
      ...soONegocio,
      contato: true,
      conversas: true,
    });

    expect(banco.rpcs).toEqual([]);
    expect(r).toEqual({ type: "assign_owner", status: "success", detail: { user_id: NOVO_DONO, passagem: "sem_contato" } });
  });

  it("sem contato no contexto, o fallback lê o contato do NEGÓCIO", async () => {
    const banco = bancoFalso({ contatoDoNegocio: CONTATO });
    const r = await getAction("assign_owner")!.execute(ctx(banco.admin, { id: "lead-1" }, false), {
      ...soONegocio,
      contato: true,
    });
    expect(banco.rpcs[0]?.args.p_contact).toBe(CONTATO);
    expect(r.detail).toEqual({ user_id: NOVO_DONO, carteira: "ok" });
  });

  it("no rodízio as duas caixas não existem: a ação segue andando a fila", async () => {
    const banco = bancoFalso();
    const r = await getAction("assign_owner")!.execute(
      ctx(banco.admin),
      { modo: "rodizio", fila: [{ user_id: NOVO_DONO, pausado: false }] },
    );
    expect(banco.rpcs.map((c) => c.nome)).toEqual(["fn_automation_rodizio_atribuir"]);
    expect(banco.consultasDeConversa).toEqual([]);
    expect(r.status).toBe("failed"); // o dublê não devolve desfecho: `sem_rodizio`
  });
});
