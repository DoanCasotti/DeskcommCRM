/**
 * #3514 — a porteira da carteira quando quem chama é o SISTEMA.
 *
 * A passagem SDR → Closer move o negócio, o cliente e a conversa. O negócio já
 * era da ação; a conversa usa `fn_conversation_assign` sem mudança nenhuma; a
 * carteira precisava de uma porta e ela é a MESMA (`fn_definir_carteira_do_cliente`,
 * migration 0799 / apêndice do baseline) — com a regra que faltava: **quem não
 * tem ator é o sistema, e o sistema se identifica pela origem `automacao`.**
 *
 * Este arquivo prova as quatro pontas dessa bicondicional, porque errar
 * qualquer uma delas reabre um buraco fechado na 0622:
 *
 *   1. ator nulo + `automacao`  → grava (é a automação), e adota os negócios
 *      abertos sem dono na mesma transação;
 *   2. ator nulo + origem humana → `carteira_sem_ator` (42501): nada de gravar
 *      sem dizer quem foi;
 *   3. ator humano + `automacao` → `carteira_origem_invalida` (22023): a origem
 *      do sistema não é rótulo que uma pessoa escolhe para o próprio ato;
 *   4. a régua do DONO não afrouxa para a automação: `viewer` e revogado
 *      continuam recusados (`carteira_dono_invalido`), e contato de outra
 *      organização continua não sendo alcançável.
 *
 * Organização própria (namespace `ffffffff-`) para não encostar em `GOV_ORG`
 * nem na `eeeeeeee-` da irmã `carteira-do-cliente.test.ts`, que rodam em
 * paralelo no mesmo banco.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "ffffffff-0000-4000-8000-000000000001";
const OUTRA_ORG = "ffffffff-0000-4000-8000-000000000002";
const CLOSER = "ffffffff-1111-4000-8000-000000000001"; // agent: o novo dono
const SDR = "ffffffff-1111-4000-8000-000000000002"; // agent: o dono de antes
const GESTOR = "ffffffff-1111-4000-8000-000000000003"; // manager, com ator
const SOMENTE_LEITURA = "ffffffff-1111-4000-8000-000000000004"; // viewer
const SAIU_DA_EQUIPE = "ffffffff-1111-4000-8000-000000000005"; // agent revogado
const PIPELINE = "ffffffff-5555-4000-8000-000000000001";
const ETAPA = "ffffffff-5555-4000-8000-000000000002";
const CONTATO = "ffffffff-3333-4000-8000-000000000001";
const CONTATO_DA_OUTRA_ORG = "ffffffff-3333-4000-8000-000000000002";

/**
 * Chama a RPC como o MOTOR chama: `service_role`, sem ator humano, com a
 * origem declarada. Devolve o stderr quando a função recusa (psql com
 * ON_ERROR_STOP=1 aborta o script e o erro vem por aí).
 */
function chamaSemAtor(contato: string, dono: string, origem: string): string {
  try {
    sql(`
      set role service_role;
      select public.fn_definir_carteira_do_cliente('${ORG}', null, '${contato}', '${dono}', '${origem}');
    `);
    return "";
  } catch (err) {
    return ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
  }
}

/** Chama a RPC como a ROTA chama: `service_role`, com o ator humano explícito. */
function chamaComAtor(ator: string, contato: string, dono: string, origem: string): string {
  try {
    sql(`
      set role service_role;
      select public.fn_definir_carteira_do_cliente('${ORG}', '${ator}', '${contato}', '${dono}', '${origem}');
    `);
    return "";
  } catch (err) {
    return ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
  }
}

/** Uma linha só: dono | origem | data preenchida. É o retrato da carteira. */
function retratoDaCarteira(contato: string): string {
  return lastLine(
    sql(`
      select coalesce(carteira_user_id::text, 'NULL')
             || '|' || coalesce(carteira_origem, 'NULL')
             || '|' || (carteira_definida_em is not null)::text
        from public.contacts where id = '${contato}';
    `),
  );
}

function limpaCarteira(contato: string): void {
  sql(`update public.contacts
         set carteira_user_id = null, carteira_origem = null, carteira_definida_em = null
       where id = '${contato}';`);
}

function semCarteira(): string {
  return "NULL|NULL|false";
}

describe("carteira do cliente pela origem `automacao` (#3514)", () => {
  beforeAll(() => {
    sql(`
      insert into auth.users (id, email) values
        ('${CLOSER}', 'passagem-closer@invariant.test'),
        ('${SDR}', 'passagem-sdr@invariant.test'),
        ('${GESTOR}', 'passagem-gestor@invariant.test'),
        ('${SOMENTE_LEITURA}', 'passagem-viewer@invariant.test'),
        ('${SAIU_DA_EQUIPE}', 'passagem-revogado@invariant.test')
      on conflict (id) do nothing;
      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG}', 'passagem-inv', 'Passagem Invariant Org', 'Passagem Inv'),
        ('${OUTRA_ORG}', 'passagem-inv-2', 'Passagem Outra Org', 'Passagem Outra')
      on conflict (id) do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${CLOSER}', '${ORG}', 'agent', now()),
        ('${SDR}', '${ORG}', 'agent', now()),
        ('${GESTOR}', '${ORG}', 'manager', now()),
        ('${SOMENTE_LEITURA}', '${ORG}', 'viewer', now()),
        ('${SAIU_DA_EQUIPE}', '${ORG}', 'agent', now())
      on conflict (user_id, organization_id) do nothing;
      -- Reexecução não herda papel/estado dos testes anteriores.
      update public.user_organizations set role = 'agent', revoked_at = null
        where organization_id = '${ORG}' and user_id in ('${CLOSER}', '${SDR}', '${SAIU_DA_EQUIPE}');
      update public.user_organizations set role = 'manager', revoked_at = null
        where organization_id = '${ORG}' and user_id = '${GESTOR}';
      update public.user_organizations set role = 'viewer', revoked_at = null
        where organization_id = '${ORG}' and user_id = '${SOMENTE_LEITURA}';
      insert into public.contacts (id, organization_id, display_name) values
        ('${CONTATO}', '${ORG}', 'Contato da Passagem'),
        ('${CONTATO_DA_OUTRA_ORG}', '${OUTRA_ORG}', 'Contato de Outra Org')
      on conflict (id) do nothing;
      insert into public.crm_pipelines (id, organization_id, name, slug)
        values ('${PIPELINE}', '${ORG}', 'Passagem Invariant', 'passagem-inv')
        on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
        values ('${ETAPA}', '${ORG}', '${PIPELINE}', 'Reunião agendada', 'reuniao', 9100)
        on conflict (id) do nothing;
    `);
    limpaCarteira(CONTATO);
  });

  afterAll(() => {
    sql(`
      delete from public.crm_leads where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.user_organizations where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.crm_stages where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.crm_pipelines where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.contacts where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.organizations where id in ('${ORG}', '${OUTRA_ORG}');
      delete from auth.users where id in
        ('${CLOSER}', '${SDR}', '${GESTOR}', '${SOMENTE_LEITURA}', '${SAIU_DA_EQUIPE}');
    `);
  });

  it("o vocabulário da CHECK aceita `automacao` e segue recusando nome inventado", () => {
    // O valor novo entra pela porta (se a CHECK não o conhecesse, este INSERT
    // morria com `contacts_carteira_origem_vocabulario`).
    sql(`update public.contacts
            set carteira_user_id = '${SDR}', carteira_origem = 'automacao', carteira_definida_em = now()
          where id = '${CONTATO}';`);
    expect(retratoDaCarteira(CONTATO)).toBe(`${SDR}|automacao|true`);

    let recusa = "";
    try {
      sql(`update public.contacts set carteira_origem = 'sistema'
            where id = '${CONTATO}';`);
    } catch (err) {
      recusa = ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
    }
    expect(recusa).toContain("contacts_carteira_origem_vocabulario");
    limpaCarteira(CONTATO);
  });

  it("sem ator e com a origem `automacao`, o sistema grava a carteira — e adota o negócio aberto sem dono", () => {
    const negocioSemDono = randomUUID();
    const negocioDoSdr = randomUUID();
    sql(`
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, status)
        values ('${negocioSemDono}', '${ORG}', '${PIPELINE}', '${ETAPA}', 'reunião agendada', '${CONTATO}', 'open'),
               ('${negocioDoSdr}', '${ORG}', '${PIPELINE}', '${ETAPA}', 'negócio do SDR', '${CONTATO}', 'open');
      update public.crm_leads set owner_user_id = '${SDR}', owner_kind = 'user'
        where id = '${negocioDoSdr}';
    `);

    expect(chamaSemAtor(CONTATO, CLOSER, "automacao")).toBe("");
    expect(retratoDaCarteira(CONTATO)).toBe(`${CLOSER}|automacao|true`);
    // A adoção é a mesma da 0622: aberto e SEM dono vai junto; o que já tem dono
    // fica (a ação já moveu o negócio do evento — este é outro).
    expect(lastLine(sql(`select owner_user_id from public.crm_leads where id = '${negocioSemDono}';`))).toBe(CLOSER);
    expect(lastLine(sql(`select owner_user_id from public.crm_leads where id = '${negocioDoSdr}';`))).toBe(SDR);
  });

  it("sem ator e com origem humana, a função continua recusando: `carteira_sem_ator`", () => {
    limpaCarteira(CONTATO);
    for (const origem of ["manual", "importacao", "atribuicao_automatica"]) {
      expect(chamaSemAtor(CONTATO, CLOSER, origem)).toContain("carteira_sem_ator");
    }
    expect(retratoDaCarteira(CONTATO)).toBe(semCarteira());
  });

  it("com ator humano, a origem `automacao` é recusada: o ato do sistema não é rótulo de gente", () => {
    limpaCarteira(CONTATO);
    expect(chamaComAtor(GESTOR, CONTATO, SDR, "manual")).toBe("");
    // Gestor tentando gravar a própria troca como se fosse da automação.
    expect(chamaComAtor(GESTOR, CONTATO, CLOSER, "automacao")).toContain("carteira_origem_invalida");
    // A carteira ficou exatamente onde o gestor a deixou.
    expect(retratoDaCarteira(CONTATO)).toBe(`${SDR}|manual|true`);
  });

  it("a automação não afrouxa a régua do DONO: viewer e revogado continuam fora", () => {
    limpaCarteira(CONTATO);
    expect(chamaSemAtor(CONTATO, SOMENTE_LEITURA, "automacao")).toContain("carteira_dono_invalido");
    expect(retratoDaCarteira(CONTATO)).toBe(semCarteira());

    sql(`update public.user_organizations set revoked_at = now()
           where organization_id = '${ORG}' and user_id = '${SAIU_DA_EQUIPE}';`);
    expect(chamaSemAtor(CONTATO, SAIU_DA_EQUIPE, "automacao")).toContain("carteira_dono_invalido");
    expect(retratoDaCarteira(CONTATO)).toBe(semCarteira());
    sql(`update public.user_organizations set revoked_at = null
           where organization_id = '${ORG}' and user_id = '${SAIU_DA_EQUIPE}';`);
  });

  it("o contato de outra organização não é alcançável nem pela automação", () => {
    expect(chamaSemAtor(CONTATO_DA_OUTRA_ORG, CLOSER, "automacao")).toContain(
      "carteira_contato_de_outra_organizacao",
    );
    expect(retratoDaCarteira(CONTATO_DA_OUTRA_ORG)).toBe(semCarteira());
  });

  it("a sessão continua sem conseguir se dar carteira (o gatilho da 0622 segue de pé)", () => {
    let recusa = "";
    try {
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${CLOSER}"}', false);
        update public.contacts set carteira_user_id = '${CLOSER}' where id = '${CONTATO}';
      `);
    } catch (err) {
      recusa = ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
    }
    expect(recusa).toContain("contacts_carteira_so_pelo_servidor");
  });
});
