/**
 * O ADAPTADOR DO ASAAS da cobrança do revendedor (spec
 * docs/superpowers/specs/2026-09-29-cobranca-do-revendedor-design.md §6.2).
 *
 * Por que o Asaas existe ao lado da Stripe: Pix e boleto RECORRENTES para o
 * cliente brasileiro, que a Stripe BR não faz. Sem SDK: `fetch` + `node:crypto`
 * (§1.2). Regras, cada uma com caso em asaas.test.ts:
 * - A chave vai SÓ no header `access_token`: nunca em query string, log,
 *   mensagem de erro, audit ou Sentry. `ErroDoProvedor` leva o status HTTP e o
 *   `code` do Asaas, nunca a `description`, que ecoa dado do pagador.
 * - O MODO e a BASE saem do prefixo da chave (`$aact_prod_` produção,
 *   `$aact_hmlg_` sandbox): a chave de um ambiente nunca é enviada ao outro, e
 *   a de produção nunca vai ao dublê em loopback do e2e.
 * - O Asaas não aceita chave de idempotência. GET, PUT e DELETE repetem em 429,
 *   5xx e rede; POST repete SÓ em 429 (recusado antes de processar). A
 *   idempotência do POST é a RELEITURA antes de criar: cliente pela
 *   `externalReference`, assinatura ACTIVE, webhook pela URL ou pelo nome.
 *   No máximo 3 tentativas e 5 s por espera.
 * - Toda resposta passa por Zod lendo só o que é usado; forma inesperada vira
 *   `ErroDoProvedor(200, "resposta_invalida")`, que `sincronizar` grava como
 *   `leitura_invalida` sem tocar o estado.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { FUSO_PADRAO } from "@/lib/cobranca/fuso";
import { logger } from "@/lib/logger";

import { ErroDoProvedor, type AdaptadorDeCobranca, type Modo, type SinalDoWebhook } from "./contrato";

/** A base de cada ambiente. Qual vale sai do prefixo da chave. */
export const ASAAS_API_BASE = {
  producao: "https://api.asaas.com/v3",
  teste: "https://api-sandbox.asaas.com/v3",
} as const satisfies Record<Modo, string>;

const TENTATIVAS = 3;
const ESPERA_MAXIMA_MS = 5_000;
const TEMPO_LIMITE_MS = 20_000;
const PREFIXO_DA_CHAVE = /^\$aact_(prod|hmlg)_\S{16,}$/;
/** O `code` do Asaas só sai do adaptador se for um identificador: nada de texto livre. */
const CODIGO_SEGURO = /^[A-Za-z0-9_.:-]{1,80}$/;
const HOSTS_DE_LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface DependenciasDoAsaas {
  /** A chave em claro, lida A CADA chamada (a tela pode trocá-la). `null` = não configurada. */
  lerChave: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** Só loopback (o dublê do e2e), e então só chave de sandbox. Outra base lança na construção. */
  baseUrl?: string;
  esperar?: (ms: number) => Promise<void>;
  agora?: () => Date;
  /** `marcaDaInstalacao(NEXT_PUBLIC_APP_URL)`: nomeia o webhook DESTA instalação e vai no User-Agent. */
  marca: string;
}

/** `teste`/`producao` pelo prefixo; `null` = não é chave do Asaas com ambiente declarado. */
export function modoDaChaveAsaas(chave: string): Modo | null {
  const m = PREFIXO_DA_CHAVE.exec(chave);
  if (!m) return null;
  return m[1] === "prod" ? "producao" : "teste";
}

function baseDeLoopback(base: string): boolean {
  if (!URL.canParse(base)) return false;
  const u = new URL(base);
  return (u.protocol === "http:" || u.protocol === "https:") && HOSTS_DE_LOOPBACK.has(u.hostname);
}

const corpoDeErro = z.object({ errors: z.array(z.object({ code: z.string().optional() })) });

/** Status HTTP + `code` do Asaas → `ErroDoProvedor`. Nunca a `description`. */
export function erroDoAsaas(status: number, corpo: unknown): ErroDoProvedor {
  const lido = corpoDeErro.safeParse(corpo);
  const bruto = lido.success ? lido.data.errors[0]?.code : undefined;
  const codigo = bruto !== undefined && CODIGO_SEGURO.test(bruto) ? bruto : undefined;
  if (status === 401) return new ErroDoProvedor(401, "chave_invalida", false, true);
  if (status === 403) return new ErroDoProvedor(403, codigo ?? "sem_permissao", false, true);
  if (status === 429) return new ErroDoProvedor(429, "rate_limit", true);
  if (status >= 500) return new ErroDoProvedor(status, "provedor_fora", true);
  return new ErroDoProvedor(status, codigo ?? (status === 404 ? "nao_encontrado" : "recusado"), false);
}

function espera(tentativa: number, pedida: string | null): number {
  const ms = pedida !== null && /^\d+$/.test(pedida) ? Number(pedida) * 1000 : 500 * 2 ** (tentativa - 1);
  return Math.min(ms, ESPERA_MAXIMA_MS);
}

function ler<T>(schema: z.ZodType<T>, dados: unknown): T {
  const lido = schema.safeParse(dados);
  if (!lido.success) throw new ErroDoProvedor(200, "resposta_invalida", false);
  return lido.data;
}

const comId = z.object({ id: z.string().min(1), deleted: z.boolean().nullish() });
const listaDoAsaas = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

const DATA_CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;
const PARTES_EM_SP = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_PADRAO,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const DIAS_DO_CICLO: Record<string, number> = { WEEKLY: 7, BIWEEKLY: 14 };
const MESES_DO_CICLO: Record<string, number> = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUALLY: 6, YEARLY: 12 };

function partesEmSaoPaulo(instante: number) {
  const partes = PARTES_EM_SP.formatToParts(new Date(instante));
  const v = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((p) => p.type === tipo)?.value);
  return { ano: v("year"), mes: v("month"), dia: v("day"), hora: v("hour"), minuto: v("minute"), segundo: v("second") };
}

function lerDataCivil(data: string): [number, number, number] {
  const m = DATA_CIVIL.exec(data);
  const [a, mes, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number.NaN, Number.NaN, Number.NaN];
  const conferida = new Date(Date.UTC(a, mes - 1, d));
  if (!m || conferida.getUTCFullYear() !== a || conferida.getUTCMonth() !== mes - 1 || conferida.getUTCDate() !== d) {
    throw new ErroDoProvedor(200, "resposta_invalida", false);
  }
  return [a, mes, d];
}

/** O dia civil em São Paulo de um instante (`AAAA-MM-DD`). */
export function dataCivilEmSaoPaulo(instante: Date): string {
  const p = partesEmSaoPaulo(instante.getTime());
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/**
 * `dueDate` do Asaas é data civil e o cliente paga até o fim do dia: vale até
 * 23:59:59 em São Paulo. O deslocamento vem da tabela de fusos (duas voltas: a
 * 2ª corrige o chute que caiu do outro lado de uma virada de horário), nunca
 * de um "-3" fixo — o horário de verão já existiu e pode voltar.
 */
export function fimDoDiaEmSaoPaulo(data: string): Date {
  const [a, m, d] = lerDataCivil(data);
  const relogio = Date.UTC(a, m - 1, d, 23, 59, 59);
  let instante = relogio + 3 * 3_600_000;
  for (let volta = 0; volta < 2; volta += 1) {
    const p = partesEmSaoPaulo(instante);
    instante = relogio - (Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - instante);
  }
  return new Date(instante);
}

/** Data civil + um `cycle` do Asaas. Dia 31 num mês menor cai no último dia dele. */
export function somarCiclo(data: string, ciclo: string): string {
  const [a, m, d] = lerDataCivil(data);
  const dias = DIAS_DO_CICLO[ciclo];
  if (dias !== undefined) return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
  const meses = MESES_DO_CICLO[ciclo];
  if (meses === undefined) throw new ErroDoProvedor(200, "resposta_invalida", false);
  const ultimoDia = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
}

const eventoDoAsaas = z.object({
  // Tetos de tamanho: com o token vazado, cada aviso válido vira uma linha no arquivo de avisos.
  id: z.string().min(1).max(100),
  event: z.string().regex(/^[A-Z_]{1,64}$/),
  payment: z.object({ customer: z.string().nullish() }).nullish(),
  subscription: z.object({ customer: z.string().nullish() }).nullish(),
});

/**
 * O Asaas autentica o aviso com o `authToken` que NÓS geramos, ecoado em
 * `asaas-access-token`: sem HMAC nem horário, então o corpo só serve de
 * ponteiro (§6.2; risco 5 da §15) e toda decisão vem da releitura. Compara o
 * sha256 dos dois lados com `timingSafeEqual`: tamanho sempre igual, sem
 * atalho que vaze tamanho ou prefixo do token. Nunca lança. `_agora` existe só
 * para a forma do contrato (o Asaas não manda horário): sem ele, o objeto do
 * adaptador teria `verificarWebhook` de 3 parâmetros até a Task 10 o anotar, e o
 * teste que chama com 4 não compilaria (TS2554).
 */
export function verificarWebhookAsaas(corpoCru: string, headers: Headers, segredo: string, _agora?: Date): SinalDoWebhook | null {
  const recebido = headers.get("asaas-access-token");
  if (!recebido || !segredo) return null;
  const esperado = createHash("sha256").update(segredo, "utf8").digest();
  if (!timingSafeEqual(createHash("sha256").update(recebido, "utf8").digest(), esperado)) return null;
  let json: unknown;
  try {
    json = JSON.parse(corpoCru);
  } catch {
    // Token certo e corpo que não é JSON: o Asaas não manda isso. Recusar é a leitura segura.
    return null;
  }
  const evento = eventoDoAsaas.safeParse(json);
  if (!evento.success) return null;
  const { id, event, payment, subscription } = evento.data;
  return { eventoId: id, tipo: event, clienteRef: payment?.customer ?? subscription?.customer ?? null };
}

export function criarAdaptadorAsaas(dep: DependenciasDoAsaas) {
  if (dep.baseUrl !== undefined && !baseDeLoopback(dep.baseUrl)) {
    throw new Error("base da API do Asaas recusada: só a oficial ou loopback");
  }
  const buscar = dep.fetch ?? fetch;
  const esperar = dep.esperar ?? ((ms: number) => new Promise<void>((pronto) => setTimeout(pronto, ms)));
  const userAgent = `cobranca-do-revendedor/${dep.marca}`;

  async function credencial(): Promise<{ chave: string; base: string }> {
    const chave = await dep.lerChave();
    const modo = chave === null ? null : modoDaChaveAsaas(chave);
    if (chave === null || modo === null) throw new ErroDoProvedor(null, "sem_chave", false, true);
    if (dep.baseUrl === undefined) return { chave, base: ASAAS_API_BASE[modo] };
    if (modo === "producao") throw new ErroDoProvedor(null, "chave_real_fora_do_asaas", false, true);
    return { chave, base: dep.baseUrl.replace(/\/+$/, "") };
  }

  async function chamar(
    metodo: "GET" | "POST" | "PUT" | "DELETE",
    caminho: string,
    corpo?: Record<string, unknown>,
  ): Promise<unknown> {
    const { chave, base } = await credencial();
    const headers: Record<string, string> = { access_token: chave, "user-agent": userAgent, accept: "application/json" };
    const body = corpo === undefined ? undefined : JSON.stringify(corpo);
    if (body !== undefined) headers["content-type"] = "application/json";
    for (let tentativa = 1; ; tentativa += 1) {
      let erro: ErroDoProvedor;
      let pedida: string | null = null;
      try {
        const r = await buscar(`${base}${caminho}`, {
          method: metodo,
          headers,
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        });
        if (r.ok) {
          return await r.json().catch(() => {
            throw new ErroDoProvedor(r.status, "resposta_invalida", false);
          });
        }
        // Corpo de erro que não é JSON (proxy, HTML): fica só o status.
        erro = erroDoAsaas(r.status, await r.json().catch(() => null));
        pedida = r.headers.get("retry-after") ?? r.headers.get("ratelimit-reset");
      } catch (e) {
        if (e instanceof ErroDoProvedor) throw e;
        erro = new ErroDoProvedor(null, "sem_resposta", true);
      }
      // Sem chave de idempotência, um POST que caiu na rede ou levou 5xx pode ter
      // sido processado: repetir criaria em dobro. 429 é recusa antes de processar.
      const repetivel = metodo === "POST" ? erro.status === 429 : erro.transitorio;
      if (!(tentativa < TENTATIVAS && repetivel)) throw erro;
      logger.warn("cobranca.asaas.nova_tentativa", { status: erro.status, codigo: erro.codigo, tentativa });
      await esperar(espera(tentativa, pedida));
    }
  }

  /** O cliente existe na conta DESTA chave? 404 ou removido → false; o resto sobe. */
  async function clienteExiste(clienteRef: string): Promise<boolean> {
    try {
      return ler(comId, await chamar("GET", `/customers/${encodeURIComponent(clienteRef)}`)).deleted !== true;
    } catch (e) {
      if (e instanceof ErroDoProvedor && e.status === 404) return false;
      throw e;
    }
  }

  /**
   * O modo é o do prefixo; a chamada confirma que a chave autentica NA base
   * daquele ambiente. `modoExigido` e o dublê em loopback recusam o modo
   * trocado ANTES de enviar: chave real nunca sai só para confirmar que é real.
   */
  async function testarChave(opcoes?: { modoExigido?: Modo }): ReturnType<AdaptadorDeCobranca["testarChave"]> {
    const chave = await dep.lerChave();
    const modo = chave === null ? null : modoDaChaveAsaas(chave);
    if (modo === null) return { ok: false, motivo: "chave_invalida" };
    const outroModo = opcoes?.modoExigido !== undefined && opcoes.modoExigido !== modo;
    if (outroModo || (modo === "producao" && dep.baseUrl !== undefined)) return { ok: false, motivo: "modo_divergente", modo };
    try {
      ler(listaDoAsaas(z.unknown()), await chamar("GET", "/customers?limit=1"));
      return { ok: true, modo };
    } catch (e) {
      if (!(e instanceof ErroDoProvedor)) throw e;
      if (e.status === 401) return { ok: false, motivo: "chave_invalida" };
      if (e.status === 403) return { ok: false, motivo: "sem_permissao" };
      return { ok: false, motivo: "provedor_fora" };
    }
  }

  return {
    id: "asaas" as const,
    clienteExiste,
    testarChave,
    verificarWebhook: verificarWebhookAsaas,
  };
}
