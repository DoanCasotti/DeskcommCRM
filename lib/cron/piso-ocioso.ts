/**
 * O PISO OCIOSO DO CRON (#3731, parte 1) — a saída antecipada que NÃO custa
 * requisição ao Supabase.
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * Numa instalação ociosa, o `event_log` e ~13,9 chamadas/min do crontab
 * (`docker/scheduler/entrypoint.sh`) sustentam ~44 req/min enquanto ninguém usa
 * o produto. Boa parte delas é de recurso que a organização NÃO TEM LIGADO:
 * prospecção sem campanha, campanhas sem campanha, importação de histórico sem
 * importação e Google Agenda sem conexão. Cada uma dessas rotas ia ao PostgREST
 * a cada minuto só para descobrir que a fila está vazia — e no plano grátis do
 * Supabase isso consome o projeto até o `PGRST002` derrubar a instalação.
 *
 * ─── O SINAL: um RETRATO em memória, alimentado por UMA consulta por janela ──
 *
 * O portão lê, de uma vez só, quatro `exists` (um por recurso) e guarda o
 * resultado num mapa de PROCESSO com validade de `TTL_DO_RETRATO_MS` (5 min).
 *
 * Por que ele não custa requisição:
 *
 * - **Não é PostgREST.** A consulta vai pelo pool `pg` direto (`getRequestPool`),
 *   então não gasta a cota de requisições do PostgREST — é justamente a cota que
 *   o `PGRST002` estoura.
 * - **Uma por janela, não uma por rota.** As cinco rotas que consultam o portão
 *   dividem o MESMO retrato: no pior caso são 12 consultas/h para a instalação
 *   inteira (uma a cada 5 min), contra 60/h por rota que cada uma fazia antes.
 *   No caminho quente (retrato válido) a resposta é do mapa: ZERO idas ao banco.
 * - **Uma consulta, quatro recursos.** As quatro perguntas cabem num `select`
 *   só; quatro consultas separadas seriam quatro vezes o mesmo custo.
 *
 * O que se perde: ligar um recurso vale para o cron em até 5 min. É folgado de
 * propósito — o que este portão decide é uma varredura cuja régua conta em
 * minutos e dias, e 5 min de atraso no primeiro tick de uma campanha recém
 * ligada não muda nada para quem está usando.
 *
 * ─── A REGRA DE FALHA: na dúvida, RODA ──────────────────────────────────────
 *
 * Erro de leitura (tabela ausente numa instalação antiga, banco fora, pool sem
 * `SUPABASE_DB_URL`) = `true`, ou seja, a rota segue o caminho normal. Este
 * portão existe para economizar cota, não para decidir se um recurso funciona:
 * um "não sei" que virasse "desligado" apagaria a prospecção de quem tem
 * campanha rodando, e o sintoma apareceria dias depois, sem log de erro.
 * O retrato com falha também fica em cache pela mesma janela — senão a leitura
 * quebrada voltaria a ser uma consulta por minuto, que é o que este arquivo
 * veio remover.
 */
import type pg from "pg";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { logger } from "@/lib/logger";

/** Os recursos cujo cron pode ficar ocioso sem que a organização perca nada. */
export const RECURSOS_DO_CRON = ["prospeccao", "campanhas", "historico", "agenda_google"] as const;
export type RecursoDoCron = (typeof RECURSOS_DO_CRON)[number];

/**
 * Validade do retrato. 5 min = 12 consultas/h para a instalação inteira, contra
 * 60/h POR ROTA antes (as cinco rotas do portão somavam 252/h). Mais que isso
 * atrasaria demais o primeiro tick de um recurso recém-ligado; menos voltaria a
 * pesar na cota que este arquivo existe para proteger.
 */
export const TTL_DO_RETRATO_MS = 5 * 60_000;

/**
 * Teto da consulta do retrato. Um banco que aceita conexão e não responde não
 * pode segurar um cron de minuto a minuto: passado o teto, vale a regra de falha
 * (roda) e o resultado fica em cache como qualquer outro.
 */
const TETO_DA_LEITURA_MS = 2_000;

/**
 * Uma linha, quatro booleanos. `exists` para na primeira linha encontrada — é o
 * predicado mais barato que responde "esta fila tem trabalho?" sem contar nada.
 *
 * As colunas de status são as mesmas que as rotas já filtram:
 * - `prospecting_campaigns`: `rascunho`/`pausada` também contam — elas têm
 *   candidatos que a rodada promove (`rascunho -> rodando`), então "só rodando"
 *   deixaria a promoção sem tick.
 * - `campaigns`: `agendada` é a fila que o worker promove para `rodando`.
 * - `importacoes_de_historico`: o único status que esta rota anda.
 * - `calendar_connections`: só conexão saudável sincroniza; `google_calendar` é
 *   o único valor que o CHECK da coluna aceita.
 */
const SQL_DO_RETRATO = `
select
  exists (
    select 1 from prospecting_campaigns
     where status in ('running', 'draft', 'paused')
        or search_status in ('starting', 'running')
  ) as prospeccao,
  exists (
    select 1 from campaigns where status in ('running', 'scheduled')
  ) as campanhas,
  exists (
    select 1 from importacoes_de_historico where status = 'rodando'
  ) as historico,
  exists (
    select 1 from calendar_connections
     where status = 'healthy' and provider = 'google_calendar'
  ) as agenda_google
`;

type Retrato = { emUso: Record<RecursoDoCron, boolean>; ate: number };

let retrato: Retrato | null = null;
/**
 * A leitura em andamento. Sem ela, os cinco crons que batem na mesma janela
 * (o crontab dispara vários no mesmo segundo) começariam CINCO leituras em
 * paralelo — o retrato só existe depois do primeiro `await`, então todos veem
 * "vazio". Uma promessa dividida mantém a promessa do arquivo: uma leitura por
 * janela, não uma por rota.
 */
let carregando: Promise<Record<RecursoDoCron, boolean>> | null = null;

/** O banco do portão. Só `query` é usado — o pool inteiro não entra aqui. */
export type BancoDoPortao = Pick<pg.Pool, "query">;

function retratoCompleto(linha: Record<string, unknown> | undefined): Record<RecursoDoCron, boolean> {
  const ligado = (v: unknown) => v === true;
  return {
    prospeccao: ligado(linha?.prospeccao),
    campanhas: ligado(linha?.campanhas),
    historico: ligado(linha?.historico),
    agenda_google: ligado(linha?.agenda_google),
  };
}

/** O retrato de "tudo em uso" — o lado seguro, usado quando a leitura falha. */
const TUDO_EM_USO: Record<RecursoDoCron, boolean> = {
  prospeccao: true,
  campanhas: true,
  historico: true,
  agenda_google: true,
};

function comTeto<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error(`leitura do retrato passou de ${ms} ms`)), ms);
    promessa.then(
      (valor) => {
        clearTimeout(relogio);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(relogio);
        reject(erro);
      },
    );
  });
}

async function lerRetrato(db?: BancoDoPortao): Promise<Record<RecursoDoCron, boolean>> {
  try {
    const banco = db ?? getRequestPool();
    const { rows } = await comTeto(
      Promise.resolve(banco.query(SQL_DO_RETRATO)) as Promise<{ rows: unknown[] }>,
      TETO_DA_LEITURA_MS,
    );
    return retratoCompleto(rows[0] as Record<string, unknown> | undefined);
  } catch (erro) {
    // Falha fechada ao contrário: "não sei" vira "tem trabalho" e a rota segue.
    logger.warn("piso ocioso do cron: leitura do retrato falhou — as rotas seguem o caminho normal", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return TUDO_EM_USO;
  }
}

/**
 * `true` = o recurso tem trabalho nesta instalação, a rota deve rodar.
 * `false` = fila vazia, a rota pode sair ANTES de qualquer outra ida ao banco.
 *
 * `agora` e `db` são pontos de injeção do teste (`lib/cron/piso-ocioso.test.ts`);
 * nenhuma rota os passa.
 */
export async function recursoTemTrabalho(
  recurso: RecursoDoCron,
  agora: number = Date.now(),
  db?: BancoDoPortao,
): Promise<boolean> {
  if (retrato !== null && retrato.ate > agora) return retrato.emUso[recurso];
  carregando ??= lerRetrato(db);
  const emUso = await carregando;
  carregando = null;
  retrato = { emUso, ate: agora + TTL_DO_RETRATO_MS };
  return retrato.emUso[recurso];
}

/**
 * O atalho que as rotas chamam: `true` = pode sair.
 *
 * Existe para a rota não repetir `!(await recursoTemTrabalho(...))` — a negação
 * dupla é o tipo de detalhe que alguém "conserta" ao revisar e transforma a
 * saída antecipada em `return` prematuro do caminho normal.
 */
export async function recursoOcioso(
  recurso: RecursoDoCron,
  agora: number = Date.now(),
  db?: BancoDoPortao,
): Promise<boolean> {
  return !(await recursoTemTrabalho(recurso, agora, db));
}

/** Esquece o retrato. Só o teste usa — em produção o TTL é quem manda. */
export function esquecerRetrato(): void {
  retrato = null;
  carregando = null;
}

/**
 * Semeia o retrato sem tocar no banco. Só o teste usa (`tests/unit/piso-ocioso-dos-crons.test.ts`):
 * as rotas chamam `recursoOcioso(recurso)` sem argumentos, então este é o único
 * jeito de exercitar a saída antecipada de cada rota pelo caminho REAL do
 * portão, sem depender de banco nem de mock do módulo (mock de módulo vaza
 * entre arquivos da suíte — medido nesta entrega).
 */
export function semearRetrato(
  emUso: Record<RecursoDoCron, boolean>,
  ate: number = Date.now() + TTL_DO_RETRATO_MS,
): void {
  retrato = { emUso, ate };
  carregando = null;
}
