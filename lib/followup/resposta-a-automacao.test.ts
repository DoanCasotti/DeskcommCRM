import { describe, expect, it } from "vitest";

import {
  contatosQueSoResponderamAAutomacao,
  JANELA_DA_RESPOSTA_A_AUTOMACAO_MS,
  type CandidatoDoSilencio,
} from "./resposta-a-automacao";

/**
 * `contatosQueSoResponderamAAutomacao` — a régua da issue #3720, contra a query
 * REAL (produção).
 *
 * O defeito, medido na instalação do relato (v1.94.0): 28/10 09h07 a automação
 * manda parabéns; 09h11 o cliente responde um coração; o fluxo "Lead novo sem
 * retorno" (silêncio, 60–180 min) passa a mandar até 6 mensagens de venda em 7
 * dias para quem só agradeceu. O que este arquivo prende é a pergunta que
 * ninguém fazia: a última mensagem recebida dele é RESPOSTA a uma automática
 * nossa?
 *
 * O fake é o PostgREST que GRAVA a cadeia de chamadas (mesmo desenho de
 * `silence-sweep-inscricao-viva-query.test.ts`): filtrar é trabalho do Postgres,
 * o que se prova aqui é (a) a pergunta e (b) a decisão sobre as linhas que
 * voltam. Os casos de "não é automática" e "fora das 48 h" existem para que o
 * conserto não vire um silenciador geral do fluxo.
 */
function fakeAdmin(respostas: Array<Array<Record<string, unknown>>>) {
  const consultas: Array<Array<{ metodo: string; args: unknown[] }>> = [];
  const from = (tabela: string) => {
    const chamadas: Array<{ metodo: string; args: unknown[] }> = [{ metodo: "from", args: [tabela] }];
    const rows = respostas[consultas.length] ?? [];
    consultas.push(chamadas);
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
          }
          return (...args: unknown[]) => {
            chamadas.push({ metodo: String(prop), args });
            return chain;
          };
        },
      },
    );
    return chain;
  };
  return { admin: { from } as never, consultas };
}

const ORG = "org-1";

function candidato(contactId: string, conversationId: string, inboundAt: string): CandidatoDoSilencio {
  return { contactId, conversationId, inboundAt };
}

describe("contatosQueSoResponderamAAutomacao — a pergunta e a decisão", () => {
  it("o caso do relato: parabéns da automação às 09h07, coração às 09h11 → fora do fluxo", async () => {
    const { admin, consultas } = fakeAdmin([
      [
        // A IA respondeu DEPOIS da mensagem dele (09h11:30) — não é o que ele respondeu.
        { conversation_id: "conv-1", sent_via: "ai", sent_at: "2026-10-28T12:11:30.000Z" },
        { conversation_id: "conv-1", sent_via: "automation", sent_at: "2026-10-28T12:07:00.000Z" },
      ],
    ]);

    const fora = await contatosQueSoResponderamAAutomacao(admin, ORG, [
      candidato("contato-1", "conv-1", "2026-10-28T12:11:00.000Z"),
    ]);

    expect(fora).toEqual(new Set(["contato-1"]));
    const chamadas = consultas[0]!;
    expect(chamadas[0]).toEqual({ metodo: "from", args: ["messages"] });
    expect(chamadas).toContainEqual({ metodo: "eq", args: ["organization_id", ORG] });
    expect(chamadas).toContainEqual({ metodo: "eq", args: ["direction", "outbound"] });
    expect(chamadas).toContainEqual({ metodo: "in", args: ["conversation_id", ["conv-1"]] });
    // A janela é a da régua, e não "a conversa inteira": nada antes de 48 h
    // pode ser a mensagem respondida — e o balde de um dia põe o teto em 72 h.
    const desde = chamadas.find((c) => c.metodo === "gte")!.args[1] as string;
    const janela = Date.parse("2026-10-28T12:11:00.000Z") - Date.parse(desde);
    expect(janela).toBeGreaterThanOrEqual(48 * 3_600_000);
    expect(janela).toBeLessThanOrEqual(72 * 3_600_000);
  });

  it("quem respondeu à IA (não a uma automação) continua elegível", async () => {
    const { admin } = fakeAdmin([
      [{ conversation_id: "conv-1", sent_via: "ai", sent_at: "2026-10-28T12:07:00.000Z" }],
    ]);

    const fora = await contatosQueSoResponderamAAutomacao(admin, ORG, [
      candidato("contato-1", "conv-1", "2026-10-28T12:11:00.000Z"),
    ]);

    expect(fora).toEqual(new Set());
  });

  it("a ÚLTIMA que saiu antes da resposta é a que conta: humano respondeu no meio → elegível", async () => {
    // A automação falou, mas um atendente escreveu depois dela e ANTES da
    // resposta do cliente. Ele respondeu ao atendente, não ao parabéns.
    const { admin } = fakeAdmin([
      [
        { conversation_id: "conv-1", sent_via: "user", sent_at: "2026-10-28T12:09:00.000Z" },
        { conversation_id: "conv-1", sent_via: "automation", sent_at: "2026-10-28T12:07:00.000Z" },
      ],
    ]);

    const fora = await contatosQueSoResponderamAAutomacao(admin, ORG, [
      candidato("contato-1", "conv-1", "2026-10-28T12:11:00.000Z"),
    ]);

    expect(fora).toEqual(new Set());
  });

  it("automação de dias atrás não é resposta a ela: fora da janela de 48 h, elegível", async () => {
    const { admin } = fakeAdmin([
      [{ conversation_id: "conv-1", sent_via: "automation", sent_at: "2026-10-20T12:07:00.000Z" }],
    ]);

    const fora = await contatosQueSoResponderamAAutomacao(admin, ORG, [
      candidato("contato-1", "conv-1", "2026-10-28T12:11:00.000Z"),
    ]);

    expect(fora).toEqual(new Set());
    expect(Date.parse("2026-10-28T12:11:00.000Z") - Date.parse("2026-10-20T12:07:00.000Z")).toBeGreaterThan(
      JANELA_DA_RESPOSTA_A_AUTOMACAO_MS,
    );
  });

  it("campanha cai na MESMA marca: o envio da campanha também sai como `automation`", async () => {
    // `lib/campanhas/rodada.ts` manda pelo `sendMessageHandler` com
    // `actor: { type: "webhook_source" }`, e a #652 grava isso como
    // `automation` — por isso a leitura da campanha não precisa de uma segunda
    // consulta a `campaign_recipients`.
    const { admin } = fakeAdmin([
      [{ conversation_id: "conv-campanha", sent_via: "automation", sent_at: "2026-10-28T11:00:00.000Z" }],
    ]);

    const fora = await contatosQueSoResponderamAAutomacao(admin, ORG, [
      candidato("contato-campanha", "conv-campanha", "2026-10-28T11:04:00.000Z"),
    ]);

    expect(fora).toEqual(new Set(["contato-campanha"]));
  });

  it("conversa sem nenhum outbound anterior: silêncio de verdade, elegível", async () => {
    const { admin } = fakeAdmin([[]]);

    const fora = await contatosQueSoResponderamAAutomacao(admin, ORG, [
      candidato("contato-1", "conv-1", "2026-10-28T12:11:00.000Z"),
    ]);

    expect(fora).toEqual(new Set());
  });

  it("um contato com dois números: só a conversa do inbound vencedor decide", async () => {
    // O inbound que o silêncio mediu é o da conv-b (resposta ao parabéns); a
    // conv-a, mais antiga, não muda nada.
    const { admin } = fakeAdmin([
      [{ conversation_id: "conv-b", sent_via: "automation", sent_at: "2026-10-28T12:07:00.000Z" }],
    ]);

    const fora = await contatosQueSoResponderamAAutomacao(admin, ORG, [
      candidato("contato-1", "conv-a", "2026-10-28T08:00:00.000Z"),
      candidato("contato-1", "conv-b", "2026-10-28T12:11:00.000Z"),
    ]);

    expect(fora).toEqual(new Set(["contato-1"]));
  });

  it("lista vazia não bate no banco", async () => {
    const { admin, consultas } = fakeAdmin([[{ conversation_id: "conv-1" }]]);

    const fora = await contatosQueSoResponderamAAutomacao(admin, ORG, []);

    expect(fora).toEqual(new Set());
    expect(consultas).toHaveLength(0);
  });
});
