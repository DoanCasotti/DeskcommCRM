import { describe, expect, it } from "vitest";

import {
  casePromiseGate,
  type GateContext,
} from "@/lib/agent-engine/guardrails/before-send";
import { detectHumanPromise } from "@/lib/agent-engine/guardrails/human-promise";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";

/**
 * Issue #3725 — o cliente respondeu SÓ "Não" e o guardrail abriu caso dizendo que
 * "a IA prometeu envolver um humano". Não prometeu: OFERECEU.
 *
 * ## O cenário medido na issue
 *
 * A IA perguntou "tem algum dia ou período melhor para o contato?"; o cliente
 * respondeu só "Não"; a fala seguinte da IA foi uma OFERTA de humano com uma
 * abertura antes ("Entendi! Quer que eu encaminhe para a equipe?"). O
 * `casePromiseGate` tratou a oferta como promessa, vetou (erro-de-ensino), o
 * modelo reescreveu mantendo a oferta, o 2º veto caiu no fail-safe
 * (`inbound-turn.ts`, `case_promise_without_case`) — que abre caso e o cliente
 * recebe a frase fixa "Prefiro não arriscar aqui: passei seu pedido para um
 * atendente humano…" (lib/escalacao/aviso-ao-lead.ts, motivo `outro`).
 *
 * ## Por que o detector errava
 *
 * Em `human-promise.ts`, a isenção de consentimento era da mensagem INTEIRA:
 * `frases.every(...)` exigia TODAS as frases terminando em "?" e cada uma
 * ABRINDO com quer/posso/gostaria. Uma abertura de uma palavra — o "Entendi!"
 * que qualquer agente escreve depois de receber um "Não" — derrubava a isenção e
 * a pergunta virava promessa.
 *
 * ## O que este arquivo congela
 *
 * A OFERTA (pergunta de consentimento, com abertura antes) não pode vetar nem
 * abrir caso; a PROMESSA (ação já feita/anunciada ou retorno anunciado) continua
 * vetando, com a mesma régua de antes. O veto é bloqueio de envio: falso
 * positivo aqui não é cosmético — ele custa a conversa.
 */

function baseCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: new Date("2026-10-30T12:00:00Z"),
    body: "",
    optedOut: false,
    provider: "waha",
    pacing: {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
    },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    promise: { table: null },
    semanticPromise: null,
    disclosure: { template: null, isFirstOutbound: false, mode: "inject" },
    lgpd: null,
    casesEnabled: false,
    hasOpenCase: false,
    openedCaseThisTurn: false,
    ...overrides,
  };
}

/**
 * Falas de OFERTA — a IA pede autorização para envolver alguém. Nenhuma promete
 * humano: quem promete é quem responde afirmativamente DEPOIS. Todas têm a forma
 * que a issue mediu: uma abertura curta (a reação ao "Não") antes da pergunta.
 */
const OFERTAS_APOS_O_NAO: readonly string[] = [
  "Entendi! Quer que eu encaminhe para a equipe verificar?",
  "Sem problema! Quer que eu veja com a equipe outro horário?",
  "Tudo bem! Posso pedir para alguém do time te ligar em outro dia?",
  "Certo! Quer que eu fale com o responsável sobre isso?",
  "Ok! Quer que eu chame alguém do time para te ajudar?",
  "Entendi! Vou anotar aqui. Quer que eu encaminhe para a equipe?",
  "Tudo bem! Quer falar com alguém da equipe?",
  "Sem problema! Você quer que eu peça para o setor verificar?",
];

/**
 * Falas de PROMESSA — a mesma família de antes do conserto. Têm de seguir vetadas
 * sem caso aberto: é a invariante sagrada de que o cliente nunca ouve "passei
 * para um humano" sem alguém de fato assumindo.
 */
const PROMESSAS: readonly string[] = [
  "Já transferi para a equipe. Você quer continuar?",
  "Vou encaminhar para o setor. Você quer?",
  "Quer que eu te transfira? Nossa equipe vai retornar hoje.",
  "Você quer falar com a equipe que já acabei de chamar?",
  "Entendi! Já encaminhei para a equipe, tudo bem?",
  "Já acionei o time. Quer que eu encaminhe para a equipe?",
];

describe("#3725 — oferta de humano não é promessa de humano (detector)", () => {
  it.each(OFERTAS_APOS_O_NAO)("não detecta promessa na oferta: %s", (body) => {
    expect(detectHumanPromise(body)).toBe(false);
  });

  it.each(PROMESSAS)("continua detectando a promessa: %s", (body) => {
    expect(detectHumanPromise(body)).toBe(true);
  });

  it("a oferta com nome próprio do tenant (handoff_keywords) também não é promessa", () => {
    expect(detectHumanPromise("Entendi! Quer que eu confirme com o Fulano?", ["fulano"])).toBe(false);
  });

  it("mensagem que só pede consentimento continua isenta (comportamento de antes)", () => {
    expect(detectHumanPromise("Quer que eu verifique com a equipe?")).toBe(false);
  });
});

describe("#3725 — a cadeia de envio deixa passar a oferta (gate case_promise)", () => {
  it.each(OFERTAS_APOS_O_NAO)(
    "PASSA no gate, sem caso aberto e com casos ligados: %s",
    (body) => {
      const verdict = casePromiseGate.evaluate(
        baseCtx({ casesEnabled: true, hasOpenCase: false, openedCaseThisTurn: false, body }),
      );
      expect(verdict.pass).toBe(true);
    },
  );

  it.each(PROMESSAS)("VETA no gate, sem caso aberto: %s", (body) => {
    const verdict = casePromiseGate.evaluate(
      baseCtx({ casesEnabled: true, hasOpenCase: false, openedCaseThisTurn: false, body }),
    );
    expect(verdict.pass).toBe(false);
    if (!verdict.pass) expect(verdict.code).toBe("case_promise_without_case");
  });

  it("a réplica completa do cenário da issue (cliente disse só 'Não') é enviável", () => {
    // O que o modelo escreveu logo depois do "Não": reação curta + oferta.
    const corpo =
      "Sem problema, entendi! Quer que eu peça para a equipe verificar se existe outro período melhor?";
    const verdict = casePromiseGate.evaluate(baseCtx({ casesEnabled: true, body: corpo }));
    expect(verdict.pass).toBe(true);
  });
});
