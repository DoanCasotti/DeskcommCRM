import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { formatadorDeData } from "@/lib/cobranca/fuso";

import { ErroDoProvedor } from "./contrato";
import {
  ASAAS_API_BASE,
  criarAdaptadorAsaas,
  erroDoAsaas,
  modoDaChaveAsaas,
  dataCivilEmSaoPaulo,
  fimDoDiaEmSaoPaulo,
  somarCiclo,
  type DependenciasDoAsaas,
} from "./asaas";

/**
 * O ADAPTADOR DO ASAAS (spec da cobrança do revendedor §6.2), contra um Asaas
 * de mentira que responde na forma real da API v3 e respeita os filtros que o
 * adaptador depende (includeDeleted, status, subscription, customer). Nenhuma
 * chamada real: a prova contra o sandbox roda fora do CI.
 */

const CHAVE_SANDBOX = ["$aact", "hmlg", "000ChaveDeMentiraDoSandbox00"].join("_");
const CHAVE_PRODUCAO = ["$aact", "prod", "000ChaveDeMentiraDaProducao0"].join("_");
const CHAVE_SEM_AMBIENTE = ["$aact", "YTU5YTE0M2M2N2I4MTliNzk0YTI5N2U5MzdjNWZmNDQ"].join("_");
const MARCA = "a1b2c3d4e5f60718";
/** 12:00 em São Paulo: "hoje" é 2026-10-05. */
const AGORA = new Date("2026-10-05T15:00:00Z");
const CLIENTE = "cus_000005219613";
const ORG = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

type Resposta = { status?: number; corpo?: unknown; headers?: Record<string, string> } | "rede_caiu" | "html";
type Responder = Resposta | Resposta[] | ((url: URL, corpo: unknown) => Resposta);
type Chamada = { rota: string; url: URL; headers: Headers; corpo: unknown };

/** Rota = "MÉTODO /caminho" sem `/v3` e sem query. Lista = fila (a última se repete). Rota não declarada → 404. */
function asaasFalso(rotas: Record<string, Responder>) {
  const filas = new Map<string, Responder>(Object.entries(rotas).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const chamadas: Chamada[] = [];
  const fetchFalso: typeof fetch = async (entrada, init) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    const rota = `${init?.method ?? "GET"} ${url.pathname.replace(/^\/v3/, "")}`;
    const corpo: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    chamadas.push({ rota, url, headers: new Headers(init?.headers), corpo });
    const r = filas.get(rota);
    const resposta = typeof r === "function" ? r(url, corpo) : Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
    if (resposta === undefined) return Response.json({ errors: [{ code: "rota_nao_declarada" }] }, { status: 404 });
    if (resposta === "rede_caiu") throw new TypeError("fetch failed");
    if (resposta === "html") return new Response("<html>proxy</html>", { status: 200, headers: { "content-type": "text/html" } });
    return Response.json(resposta.corpo ?? {}, { status: resposta.status ?? 200, headers: resposta.headers });
  };
  return { fetchFalso, chamadas };
}

function montar(rotas: Record<string, Responder>, extra: Partial<DependenciasDoAsaas> = {}) {
  const { fetchFalso, chamadas } = asaasFalso(rotas);
  const esperas: number[] = [];
  const adaptador = criarAdaptadorAsaas({
    lerChave: async () => CHAVE_SANDBOX,
    fetch: fetchFalso,
    esperar: async (ms) => {
      esperas.push(ms);
    },
    agora: () => AGORA,
    marca: MARCA,
    ...extra,
  });
  return { adaptador, chamadas, esperas };
}

const lista = (...data: unknown[]): Resposta => ({
  corpo: { object: "list", hasMore: false, totalCount: data.length, limit: 100, offset: 0, data },
});
const CLIENTE_OK = { corpo: { object: "customer", id: CLIENTE, deleted: false } };
const ROTA_DO_CLIENTE = `GET /customers/${CLIENTE}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o transporte do Asaas", () => {
  it("⭐ a chave vai só no access_token, com User-Agent, e a URL não carrega segredo", async () => {
    const { adaptador, chamadas } = montar({ [ROTA_DO_CLIENTE]: CLIENTE_OK });
    expect(await adaptador.clienteExiste(CLIENTE)).toBe(true);
    const [c] = chamadas;
    expect(c?.headers.get("access_token")).toBe(CHAVE_SANDBOX);
    expect(c?.headers.get("authorization")).toBeNull();
    expect(c?.headers.get("user-agent")).toBe(`cobranca-do-revendedor/${MARCA}`);
    expect(`${c?.url.origin}${c?.url.pathname}`).toBe(`${ASAAS_API_BASE.teste}/customers/${CLIENTE}`);
    expect(c?.url.search).not.toContain("aact");
  });

  it("⭐ a base sai do prefixo: chave de produção vai à API de produção, nunca ao sandbox", async () => {
    const { adaptador, chamadas } = montar({ [ROTA_DO_CLIENTE]: CLIENTE_OK }, { lerChave: async () => CHAVE_PRODUCAO });
    await adaptador.clienteExiste(CLIENTE);
    expect(chamadas[0]?.url.origin).toBe(new URL(ASAAS_API_BASE.producao).origin);
  });

  it.each([
    [CHAVE_SANDBOX, "teste"],
    [CHAVE_PRODUCAO, "producao"],
    [CHAVE_SEM_AMBIENTE, null],
    [["$aact", "hmlg", "curta"].join("_"), null],
    [["sk", "test", "51HfakeKeyForUnitTests00"].join("_"), null],
    [` ${["$aact", "hmlg", "000ChaveDeMentiraDoSandbox00"].join("_")}`, null],
    ["", null],
  ])("modoDaChaveAsaas(%#) = %s", (chave, modo) => {
    expect(modoDaChaveAsaas(chave)).toBe(modo);
  });

  it("chave ausente ou sem ambiente no prefixo: credencial inválida, sem tocar a rede", async () => {
    for (const chave of [null, CHAVE_SEM_AMBIENTE]) {
      const { adaptador, chamadas } = montar({ [ROTA_DO_CLIENTE]: CLIENTE_OK }, { lerChave: async () => chave });
      await expect(adaptador.clienteExiste(CLIENTE)).rejects.toMatchObject({ codigo: "sem_chave", credencialInvalida: true });
      expect(chamadas).toHaveLength(0);
    }
  });

  it.each([
    [401, null, { status: 401, codigo: "chave_invalida", transitorio: false, credencialInvalida: true }],
    [403, null, { status: 403, codigo: "sem_permissao", transitorio: false, credencialInvalida: true }],
    [403, { errors: [{ code: "insufficient_permission" }] }, { status: 403, codigo: "insufficient_permission", credencialInvalida: true }],
    [404, null, { status: 404, codigo: "nao_encontrado", transitorio: false, credencialInvalida: false }],
    [400, { errors: [{ code: "invalid_cpfCnpj", description: "O CPF/CNPJ informado é inválido." }] }, { status: 400, codigo: "invalid_cpfCnpj", transitorio: false }],
    [400, { errors: [{ code: "texto livre com espaço" }] }, { status: 400, codigo: "recusado", transitorio: false }],
    [429, null, { status: 429, codigo: "rate_limit", transitorio: true }],
    [503, null, { status: 503, codigo: "provedor_fora", transitorio: true }],
  ])("HTTP %i vira o ErroDoProvedor certo", (status, corpo, esperado) => {
    const erro = erroDoAsaas(status, corpo);
    expect(erro).toBeInstanceOf(ErroDoProvedor);
    expect(erro).toMatchObject(esperado);
  });

  it("⭐ o erro nunca carrega a description do Asaas — ela ecoa dado do pagador", () => {
    const erro = erroDoAsaas(400, {
      errors: [{ code: "invalid_cpfCnpj", description: `CPF 529.982.247-25 recusado para ${CHAVE_SANDBOX}` }],
    });
    expect(erro.message).toBe("provedor 400 invalid_cpfCnpj");
    const tudo = JSON.stringify({ ...erro, m: erro.message });
    expect(tudo).not.toContain("529");
    expect(tudo).not.toContain("aact");
  });

  it("GET: 429, 429, 200 — três tentativas, respeitando o Retry-After", async () => {
    const { adaptador, chamadas, esperas } = montar({
      [ROTA_DO_CLIENTE]: [{ status: 429, headers: { "retry-after": "1" } }, { status: 429 }, CLIENTE_OK],
    });
    expect(await adaptador.clienteExiste(CLIENTE)).toBe(true);
    expect(chamadas).toHaveLength(3);
    expect(esperas).toEqual([1000, 1000]);
  });

  it("5xx persistente: desiste na 3ª e sobe transitório", async () => {
    const { adaptador, chamadas, esperas } = montar({ [ROTA_DO_CLIENTE]: { status: 503 } });
    await expect(adaptador.clienteExiste(CLIENTE)).rejects.toMatchObject({ codigo: "provedor_fora", transitorio: true });
    expect(chamadas).toHaveLength(3);
    expect(esperas).toEqual([500, 1000]);
  });

  it("RateLimit-Reset do Asaas é respeitado; espera enorme é limitada a 5 s", async () => {
    const reset = montar({ [ROTA_DO_CLIENTE]: [{ status: 429, headers: { "ratelimit-reset": "2" } }, CLIENTE_OK] });
    await reset.adaptador.clienteExiste(CLIENTE);
    expect(reset.esperas).toEqual([2000]);
    const longo = montar({ [ROTA_DO_CLIENTE]: [{ status: 429, headers: { "retry-after": "30" } }, CLIENTE_OK] });
    await longo.adaptador.clienteExiste(CLIENTE);
    expect(longo.esperas).toEqual([5000]);
  });

  it("rede caiu uma vez e voltou: segue; 400 comum não repete", async () => {
    const rede = montar({ [ROTA_DO_CLIENTE]: ["rede_caiu", CLIENTE_OK] });
    expect(await rede.adaptador.clienteExiste(CLIENTE)).toBe(true);
    const ruim = montar({ [ROTA_DO_CLIENTE]: { status: 400, corpo: { errors: [{ code: "invalid_action" }] } } });
    await expect(ruim.adaptador.clienteExiste(CLIENTE)).rejects.toMatchObject({ codigo: "invalid_action" });
    expect(ruim.chamadas).toHaveLength(1);
  });

  it("200 que não é JSON vira resposta_invalida", async () => {
    const { adaptador } = montar({ [ROTA_DO_CLIENTE]: "html" });
    await expect(adaptador.clienteExiste(CLIENTE)).rejects.toMatchObject({ status: 200, codigo: "resposta_invalida" });
  });

  it("o log da nova tentativa não leva a chave", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { adaptador } = montar({ [ROTA_DO_CLIENTE]: [{ status: 503 }, CLIENTE_OK] });
    await adaptador.clienteExiste(CLIENTE);
    const escrito = aviso.mock.calls.flat().join(" ");
    expect(escrito).toContain("cobranca.asaas.nova_tentativa");
    expect(escrito).not.toContain(CHAVE_SANDBOX);
  });

  it("base fora da lista (nem oficial, nem loopback) lança na construção", () => {
    expect(() =>
      criarAdaptadorAsaas({ lerChave: async () => CHAVE_SANDBOX, baseUrl: "https://coletor.example.com/v3", marca: MARCA }),
    ).toThrow(/recusada/);
  });

  it("⭐ com o dublê em loopback: sandbox vai ao dublê, produção nunca sai da máquina", async () => {
    const dubleOk = montar({ [ROTA_DO_CLIENTE]: CLIENTE_OK }, { baseUrl: "http://127.0.0.1:3995/v3" });
    await dubleOk.adaptador.clienteExiste(CLIENTE);
    expect(dubleOk.chamadas[0]?.url.origin).toBe("http://127.0.0.1:3995");
    const real = montar({ [ROTA_DO_CLIENTE]: CLIENTE_OK }, { baseUrl: "http://127.0.0.1:3995/v3", lerChave: async () => CHAVE_PRODUCAO });
    await expect(real.adaptador.clienteExiste(CLIENTE)).rejects.toMatchObject({ codigo: "chave_real_fora_do_asaas" });
    expect(real.chamadas).toHaveLength(0);
  });
});

describe("clienteExiste", () => {
  it("200 → true; removido (deleted) → false; 404 → false", async () => {
    expect(await montar({ [ROTA_DO_CLIENTE]: CLIENTE_OK }).adaptador.clienteExiste(CLIENTE)).toBe(true);
    const removido = { corpo: { object: "customer", id: CLIENTE, deleted: true } };
    expect(await montar({ [ROTA_DO_CLIENTE]: removido }).adaptador.clienteExiste(CLIENTE)).toBe(false);
    expect(await montar({ [ROTA_DO_CLIENTE]: { status: 404 } }).adaptador.clienteExiste(CLIENTE)).toBe(false);
  });

  it("chave inválida sobe (a Conexão não pode ler 'cliente sumiu' onde é chave errada)", async () => {
    await expect(montar({ [ROTA_DO_CLIENTE]: { status: 401 } }).adaptador.clienteExiste(CLIENTE)).rejects.toMatchObject({
      credencialInvalida: true,
    });
  });
});

// Usados pelas tarefas seguintes (a Task 4 lê a fonte; a Task 6 usa ORG).
void readFileSync;
void join;
void ORG;
void lista;

describe("datas civis do Asaas", () => {
  it("⭐ '2026-10-05' vale até 23:59:59 em São Paulo = 2026-10-06T02:59:59Z, e o texto diz 05/10", () => {
    const fim = fimDoDiaEmSaoPaulo("2026-10-05");
    expect(fim.toISOString()).toBe("2026-10-06T02:59:59.000Z");
    expect(formatadorDeData("pt-BR", "America/Sao_Paulo", { day: "2-digit", month: "2-digit" }).format(fim)).toBe("05/10");
  });

  it("⭐ virada de horário: usa a tabela de fusos, nunca '-3' fixo (horário de verão de 2018 começou em 04/11)", () => {
    expect(fimDoDiaEmSaoPaulo("2018-11-03").toISOString()).toBe("2018-11-04T02:59:59.000Z");
    expect(fimDoDiaEmSaoPaulo("2018-11-04").toISOString()).toBe("2018-11-05T01:59:59.000Z");
  });

  it("⭐ 02:30 UTC de 06/10 ainda é 05/10 em São Paulo; 03:00 já é 06/10 (Review Focus 5)", () => {
    expect(dataCivilEmSaoPaulo(new Date("2026-10-06T02:30:00Z"))).toBe("2026-10-05");
    expect(dataCivilEmSaoPaulo(new Date("2026-10-06T03:00:00Z"))).toBe("2026-10-06");
  });

  it.each([
    ["2026-01-31", "MONTHLY", "2026-02-28"],
    ["2028-01-31", "MONTHLY", "2028-02-29"],
    ["2026-12-15", "MONTHLY", "2027-01-15"],
    ["2026-11-30", "QUARTERLY", "2027-02-28"],
    ["2026-08-31", "BIMONTHLY", "2026-10-31"],
    ["2026-08-31", "SEMIANNUALLY", "2027-02-28"],
    ["2028-02-29", "YEARLY", "2029-02-28"],
    ["2026-10-05", "WEEKLY", "2026-10-12"],
    ["2026-12-25", "BIWEEKLY", "2027-01-08"],
  ])("⭐ fim de mês: %s + %s = %s (o período nunca invade o mês seguinte)", (data, ciclo, esperado) => {
    expect(somarCiclo(data, ciclo)).toBe(esperado);
  });

  it("31/01 pago no mensal vale até 28/02 23:59:59 em São Paulo", () => {
    expect(fimDoDiaEmSaoPaulo(somarCiclo("2026-01-31", "MONTHLY")).toISOString()).toBe("2026-03-01T02:59:59.000Z");
  });

  it.each([["2026-02-30"], ["05/10/2026"], [""]])("data impossível %j → resposta_invalida", (data) => {
    expect(() => fimDoDiaEmSaoPaulo(data)).toThrow(ErroDoProvedor);
  });

  it("ciclo desconhecido → resposta_invalida (nunca um período inventado)", () => {
    expect(() => somarCiclo("2026-10-05", "DAILY")).toThrow(ErroDoProvedor);
  });
});
