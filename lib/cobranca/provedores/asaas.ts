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
import { z } from "zod";

import { logger } from "@/lib/logger";

import { ErroDoProvedor, type Modo } from "./contrato";

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

  return {
    id: "asaas" as const,
    clienteExiste,
  };
}
