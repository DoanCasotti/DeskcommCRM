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
  verificarWebhookAsaas,
  EVENTOS_DO_WEBHOOK_ASAAS,
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

describe("testarChave", () => {
  const VAZIA = { "GET /customers": lista() };

  it("⭐ sandbox: ok em teste, e a chave foi SÓ à base do sandbox", async () => {
    const { adaptador, chamadas } = montar(VAZIA);
    expect(await adaptador.testarChave()).toEqual({ ok: true, modo: "teste" });
    expect(chamadas.map((c) => `${c.url.origin}${c.url.pathname}${c.url.search}`)).toEqual([`${ASAAS_API_BASE.teste}/customers?limit=1`]);
  });

  it("⭐ produção: ok em produção, e a chave foi SÓ à base de produção", async () => {
    const { adaptador, chamadas } = montar(VAZIA, { lerChave: async () => CHAVE_PRODUCAO });
    expect(await adaptador.testarChave()).toEqual({ ok: true, modo: "producao" });
    expect(chamadas.map((c) => c.url.origin)).toEqual([new URL(ASAAS_API_BASE.producao).origin]);
  });

  it("chave sem ambiente no prefixo, de outro provedor ou ausente: chave_invalida SEM chamar o Asaas", async () => {
    for (const chave of [CHAVE_SEM_AMBIENTE, ["sk", "test", "51HfakeKeyForUnitTests00"].join("_"), null]) {
      const { adaptador, chamadas } = montar(VAZIA, { lerChave: async () => chave });
      expect(await adaptador.testarChave()).toEqual({ ok: false, motivo: "chave_invalida" });
      expect(chamadas).toHaveLength(0);
    }
  });

  it("401 → chave_invalida; 403 → sem_permissao; 5xx persistente → provedor_fora", async () => {
    expect(await montar({ "GET /customers": { status: 401 } }).adaptador.testarChave()).toEqual({ ok: false, motivo: "chave_invalida" });
    expect(await montar({ "GET /customers": { status: 403 } }).adaptador.testarChave()).toEqual({ ok: false, motivo: "sem_permissao" });
    expect(await montar({ "GET /customers": { status: 502 } }).adaptador.testarChave()).toEqual({ ok: false, motivo: "provedor_fora" });
  });

  it("⭐ instalação em teste recusa a chave de PRODUÇÃO antes de enviá-la; e o inverso", async () => {
    const real = montar(VAZIA, { lerChave: async () => CHAVE_PRODUCAO });
    expect(await real.adaptador.testarChave({ modoExigido: "teste" })).toEqual({ ok: false, motivo: "modo_divergente", modo: "producao" });
    const sandbox = montar(VAZIA);
    expect(await sandbox.adaptador.testarChave({ modoExigido: "producao" })).toEqual({ ok: false, motivo: "modo_divergente", modo: "teste" });
    expect([...real.chamadas, ...sandbox.chamadas]).toHaveLength(0);
  });

  it("⭐ com o dublê em loopback, chave de produção é modo_divergente e não sai da máquina", async () => {
    const { adaptador, chamadas } = montar(VAZIA, { lerChave: async () => CHAVE_PRODUCAO, baseUrl: "http://127.0.0.1:3995/v3" });
    expect(await adaptador.testarChave()).toEqual({ ok: false, motivo: "modo_divergente", modo: "producao" });
    expect(chamadas).toHaveLength(0);
  });
});

describe("verificarWebhook", () => {
  // Montado em tempo de execução, como as chaves.
  const TOKEN = ["tok", "fixtureDoWebhookDoAsaas0000000000000000"].join("_");
  const EVENTO = {
    id: "evt_05b708f961d739ea7eba7e4db318f621&368604920",
    event: "PAYMENT_RECEIVED",
    dateCreated: "2026-10-05 12:00:00",
    payment: { object: "payment", id: "pay_1", customer: CLIENTE, value: 49.9, status: "RECEIVED", billingType: "PIX" },
  };
  const CORPO = JSON.stringify(EVENTO);
  const cab = (valor: string) => new Headers({ "asaas-access-token": valor });

  it("⭐ token certo: sinal só com ponteiros, nada do corpo", () => {
    expect(verificarWebhookAsaas(CORPO, cab(TOKEN), TOKEN)).toEqual({ eventoId: EVENTO.id, tipo: "PAYMENT_RECEIVED", clienteRef: CLIENTE });
  });

  it("⭐ token vazado: corpo que jura 'pago' com o token certo vira só ponteiros (Review Focus 1)", () => {
    // Quem tem o token manda um pagamento que não existe, com valor, status e data.
    // Nada disso pode sair do adaptador: a decisão é sempre da releitura (§6.2, risco 5).
    const mentira = JSON.stringify({
      id: "evt_forjado&1",
      event: "PAYMENT_RECEIVED",
      payment: { object: "payment", id: "pay_inventado", customer: CLIENTE, status: "RECEIVED", value: 9999, paymentDate: "2026-10-05" },
      subscription: { id: "sub_x", status: "ACTIVE", customer: CLIENTE },
    });
    const sinal = verificarWebhookAsaas(mentira, cab(TOKEN), TOKEN);
    expect(Object.keys(sinal ?? {}).sort()).toEqual(["clienteRef", "eventoId", "tipo"]);
    // O `tipo` ("PAYMENT_RECEIVED") é o nome do evento, não um status: o que não pode passar é o resto.
    expect(JSON.stringify(sinal)).not.toMatch(/9999|pay_inventado|2026-10-05|sub_x/);
  });

  it("evento de assinatura: o cliente sai de subscription.customer", () => {
    const corpo = JSON.stringify({ id: "evt_sub_1", event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_1", customer: CLIENTE } });
    expect(verificarWebhookAsaas(corpo, cab(TOKEN), TOKEN)).toEqual({ eventoId: "evt_sub_1", tipo: "SUBSCRIPTION_DELETED", clienteRef: CLIENTE });
  });

  it("evento sem payment nem subscription: clienteRef null (a rota grava cliente_desconhecido)", () => {
    const corpo = JSON.stringify({ id: "evt_x", event: "ACCOUNT_STATUS_UPDATED" });
    expect(verificarWebhookAsaas(corpo, cab(TOKEN), TOKEN)?.clienteRef).toBeNull();
  });

  it.each([
    ["token errado do mesmo tamanho", cab(`${TOKEN.slice(0, -1)}X`), TOKEN],
    ["⭐ token de outro tamanho (timingSafeEqual cru lançaria RangeError)", cab("curto"), TOKEN],
    ["sem header", new Headers(), TOKEN],
    ["segredo vazio nunca valida", cab(""), ""],
  ])("%s → null, sem lançar", (_nome, headers, segredo) => {
    expect(verificarWebhookAsaas(CORPO, headers, segredo)).toBeNull();
  });

  it.each([
    ["não é JSON", "lixo"],
    ["JSON sem id", JSON.stringify({ event: "PAYMENT_RECEIVED" })],
    ["JSON sem event", JSON.stringify({ id: "evt_1" })],
    // Token vazado: sem teto, cada aviso gravaria uma linha do tamanho que quem manda quiser.
    ["⭐ com id de 5 KB", JSON.stringify({ id: "x".repeat(5_000), event: "PAYMENT_RECEIVED" })],
    ["⭐ com event fora do vocabulário do Asaas", JSON.stringify({ id: "evt_1", event: "payment_received" })],
  ])(
    "token certo e corpo %s → null",
    (_nome, corpo) => {
      expect(verificarWebhookAsaas(corpo, cab(TOKEN), TOKEN)).toBeNull();
    },
  );

  it("⭐ tempo constante: compara sha256 dos dois lados com timingSafeEqual, nunca ===", () => {
    const fonte = readFileSync(join(__dirname, "asaas.ts"), "utf8");
    const corpo = fonte.slice(fonte.indexOf("export function verificarWebhookAsaas"), fonte.indexOf("export function criarAdaptadorAsaas"));
    expect(corpo).toMatch(/timingSafeEqual\(createHash\("sha256"\)/);
    expect(corpo).not.toMatch(/recebido\s*[!=]==|[!=]==\s*recebido/);
  });

  it("é o verificarWebhook do adaptador", () => {
    expect(montar({}).adaptador.verificarWebhook(CORPO, cab(TOKEN), TOKEN, AGORA)?.eventoId).toBe(EVENTO.id);
  });
});

describe("prepararWebhook e removerWebhooks", () => {
  const URL_DO_AVISO = "https://crm.example.com/api/v1/webhooks/cobranca/asaas";
  const NOME = `Cobrança do revendedor ${MARCA}`;
  const CRIADO = { corpo: { object: "webhook", id: "wh_novo", name: NOME, url: URL_DO_AVISO } };
  const TOKEN_43 = /^[A-Za-z0-9_-]{43}$/;

  it("⭐ cria com os 11 eventos e o token que devolve, e NÃO apaga nada antes de confirmar", async () => {
    const { adaptador, chamadas } = montar({ "POST /webhooks": CRIADO });
    const preparo = await adaptador.prepararWebhook(URL_DO_AVISO, "dono@example.com");
    if (!("segredo" in preparo)) throw new Error("esperava o ramo automático");
    expect(preparo.segredo).toMatch(TOKEN_43);
    expect(Buffer.from(preparo.segredo, "base64url")).toHaveLength(32);
    expect(chamadas.map((c) => c.rota)).toEqual(["POST /webhooks"]);
    expect(chamadas[0]?.corpo).toEqual({
      name: NOME,
      url: URL_DO_AVISO,
      email: "dono@example.com",
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      sendType: "SEQUENTIALLY",
      authToken: preparo.segredo,
      events: [...EVENTOS_DO_WEBHOOK_ASAAS],
    });
    expect(EVENTOS_DO_WEBHOOK_ASAAS).toHaveLength(11);
  });

  it("cada conexão gera um token novo", async () => {
    const a = await montar({ "POST /webhooks": CRIADO }).adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com");
    const b = await montar({ "POST /webhooks": CRIADO }).adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com");
    expect("segredo" in a && "segredo" in b && a.segredo !== b.segredo).toBe(true);
  });

  it("⭐ confirmar apaga os desta instalação (mesma URL ou mesmo nome), poupa o novo e o de outra instalação; 404 é sucesso", async () => {
    const { adaptador, chamadas } = montar({
      "POST /webhooks": CRIADO,
      "GET /webhooks": lista(
        { id: "wh_novo", name: NOME, url: URL_DO_AVISO },
        { id: "wh_velho", name: "Outro nome", url: URL_DO_AVISO },
        { id: "wh_marca", name: NOME, url: "https://antigo.example.com/api/v1/webhooks/cobranca/asaas" },
        { id: "wh_outra", name: "Cobrança do revendedor 0000000000000000", url: "https://homolog.example.com/x" },
      ),
      "DELETE /webhooks/wh_velho": { corpo: { deleted: true, id: "wh_velho" } },
      "DELETE /webhooks/wh_marca": { status: 404 },
    });
    const preparo = await adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com");
    if (!("segredo" in preparo)) throw new Error("esperava o ramo automático");
    await preparo.confirmar();
    expect(chamadas.filter((c) => c.rota.startsWith("DELETE")).map((c) => c.rota)).toEqual([
      "DELETE /webhooks/wh_velho",
      "DELETE /webhooks/wh_marca",
    ]);
  });

  it("desfazer apaga só o novo", async () => {
    const { adaptador, chamadas } = montar({ "POST /webhooks": CRIADO, "DELETE /webhooks/wh_novo": { corpo: { deleted: true } } });
    const preparo = await adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com");
    if (!("segredo" in preparo)) throw new Error("esperava o ramo automático");
    await preparo.desfazer();
    expect(chamadas.map((c) => c.rota)).toEqual(["POST /webhooks", "DELETE /webhooks/wh_novo"]);
  });

  it.each([
    [400, { errors: [{ code: "invalid_action" }] }],
    [403, null],
  ])("⭐ recusa definitiva (%i) → ramo manual com URL, token e eventos; nada apagado, nada repetido", async (status, corpo) => {
    const { adaptador, chamadas } = montar({ "POST /webhooks": { status, corpo } });
    expect(await adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com")).toEqual({
      manual: { url: URL_DO_AVISO, segredo: expect.stringMatching(TOKEN_43), eventos: [...EVENTOS_DO_WEBHOOK_ASAAS] },
    });
    expect(chamadas).toHaveLength(1);
  });

  it("401 sobe como credencial inválida (chave errada não é passo a passo manual)", async () => {
    await expect(
      montar({ "POST /webhooks": { status: 401 } }).adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com"),
    ).rejects.toMatchObject({ credencialInvalida: true });
  });

  it("⭐ POST não repete 5xx nem rede (sem chave de idempotência, criaria dois); repete 429", async () => {
    const fora = montar({ "POST /webhooks": { status: 503 } });
    await expect(fora.adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com")).rejects.toMatchObject({ transitorio: true });
    expect(fora.chamadas).toHaveLength(1);
    const rede = montar({ "POST /webhooks": ["rede_caiu", CRIADO] });
    await expect(rede.adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com")).rejects.toMatchObject({ codigo: "sem_resposta" });
    expect(rede.chamadas).toHaveLength(1);
    const limite = montar({ "POST /webhooks": [{ status: 429 }, CRIADO] });
    expect("segredo" in (await limite.adaptador.prepararWebhook(URL_DO_AVISO, "d@example.com"))).toBe(true);
    expect(limite.chamadas).toHaveLength(2);
  });

  it("removerWebhooks devolve quantos apagou", async () => {
    const { adaptador } = montar({
      "GET /webhooks": lista({ id: "wh_1", name: NOME, url: URL_DO_AVISO }, { id: "wh_2", name: "x", url: "https://x.example.com" }),
      "DELETE /webhooks/wh_1": { corpo: { deleted: true } },
    });
    expect(await adaptador.removerWebhooks(URL_DO_AVISO)).toBe(1);
  });
});

describe("garantirCliente", () => {
  const ORG_DADOS = { id: ORG, nome: "Clínica Exemplo Ltda", email: "financeiro@example.com", documento: "11.222.333/0001-81" };

  it("⭐ cliente que já existe pela externalReference é reaproveitado, sem POST", async () => {
    const { adaptador, chamadas } = montar({ "GET /customers": lista({ object: "customer", id: CLIENTE, deleted: false }) });
    expect(await adaptador.garantirCliente(ORG_DADOS)).toBe(CLIENTE);
    expect(chamadas.map((c) => c.rota)).toEqual(["GET /customers"]);
    expect(chamadas[0]?.url.searchParams.get("externalReference")).toBe(ORG);
  });

  it("⭐ novo: POST com o documento só em caracteres, a org na externalReference e as notificações do Asaas desligadas", async () => {
    const { adaptador, chamadas } = montar({
      "GET /customers": lista(),
      "POST /customers": { corpo: { object: "customer", id: "cus_novo" } },
    });
    expect(await adaptador.garantirCliente(ORG_DADOS)).toBe("cus_novo");
    expect(chamadas[1]?.corpo).toEqual({
      name: "Clínica Exemplo Ltda",
      email: "financeiro@example.com",
      cpfCnpj: "11222333000181",
      externalReference: ORG,
      // A régua do sistema avisa, com a marca da empresa; o Asaas avisaria em dobro, com a marca dele (Divergência 32).
      notificationDisabled: true,
    });
  });

  it("cliente removido na busca não conta: cria outro", async () => {
    const { adaptador } = montar({
      "GET /customers": lista({ object: "customer", id: "cus_velho", deleted: true }),
      "POST /customers": { corpo: { id: "cus_novo" } },
    });
    expect(await adaptador.garantirCliente(ORG_DADOS)).toBe("cus_novo");
  });

  it("⭐ sem documento → documento_obrigatorio; dígito errado → documento_invalido; nenhum dos dois toca a rede", async () => {
    const sem = montar({});
    await expect(sem.adaptador.garantirCliente({ ...ORG_DADOS, documento: null })).rejects.toMatchObject({ codigo: "documento_obrigatorio", transitorio: false });
    const errado = montar({});
    await expect(errado.adaptador.garantirCliente({ ...ORG_DADOS, documento: "11222333000182" })).rejects.toMatchObject({ codigo: "documento_invalido" });
    expect([...sem.chamadas, ...errado.chamadas]).toHaveLength(0);
  });

  it("org que não é uuid → org_invalida, sem tocar a rede (nunca ZodError)", async () => {
    const { adaptador, chamadas } = montar({});
    await expect(adaptador.garantirCliente({ ...ORG_DADOS, id: "abc" })).rejects.toMatchObject({ codigo: "org_invalida" });
    expect(chamadas).toHaveLength(0);
  });

  it("⭐ POST /customers que levou 503 NÃO se repete; o 2º clique acha o cliente pela externalReference", async () => {
    const primeiro = montar({ "GET /customers": lista(), "POST /customers": { status: 503 } });
    await expect(primeiro.adaptador.garantirCliente(ORG_DADOS)).rejects.toMatchObject({ transitorio: true });
    expect(primeiro.chamadas.filter((c) => c.rota === "POST /customers")).toHaveLength(1);
    const segundo = montar({ "GET /customers": lista({ id: CLIENTE }) });
    expect(await segundo.adaptador.garantirCliente(ORG_DADOS)).toBe(CLIENTE);
  });

  it("o documento nunca vai em URL nem em log", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { adaptador, chamadas } = montar({ "GET /customers": [{ status: 503 }, lista()], "POST /customers": { corpo: { id: "c" } } });
    await adaptador.garantirCliente(ORG_DADOS);
    expect(chamadas.map((c) => c.url.toString()).join(" ")).not.toContain("11222333000181");
    expect(aviso.mock.calls.flat().join(" ")).not.toContain("11222333000181");
  });
});
