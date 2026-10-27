import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  IMPEDIMENTOS_SO_DO_ENVIO,
  INSTRUCAO_DO_PEDIDO_HUMANO,
  impedimentoEhSoDoEnvio,
  previaContinuaAtePropor,
} from "./proposta-sob-pedido";

/**
 * PROPOSTA SOB PEDIDO (#3281) — propor ≠ enviar.
 *
 * O defeito medido pelo autor da issue: "Sugerir resposta" rodava o mesmo turno
 * do agente automático e, quando o prompt mandava calar, o rascunho herdava o
 * silêncio. Aqui a régua é medida caso a caso:
 *
 * - o silêncio de REGRA (sem impedimento) e os impedimentos do MOMENTO DO ENVIO
 *   liberam o passo do pedido humano;
 * - falha de geração e guardrail de CONTEÚDO não liberam — ali a prévia tem de
 *   continuar vazia, com o motivo na tela.
 *
 * A sabotagem prevista: devolver `true` sempre derruba os controles (falha de
 * geração, conteúdo, nada a responder). Devolver `false` sempre derruba os casos
 * do silêncio de regra e dos impedimentos de envio — os dois lados da régua.
 */

const sinais = (over: Partial<Parameters<typeof previaContinuaAtePropor>[0]> = {}) =>
  previaContinuaAtePropor({
    candidatos: 0,
    impedimentos: [],
    inboundsSemResposta: 2,
    saidaTruncada: false,
    tetoDePassosAtingido: false,
    ...over,
  });

describe("o turno que calou por regra do prompt libera a proposta (#3281)", () => {
  it("⛔ silêncio sem impedimento nenhum — o caso medido na issue — propõe", () => {
    // "Bom dia!" e "Como posso ajudar?" escritas por uma pessoa, e a regra de
    // recepção do prompt lendo as duas como robô: o turno automático cala, o
    // rascunho herda o silêncio e o operador fica sem texto.
    expect(sinais()).toBe(true);
  });

  it("impedimento do MOMENTO DO ENVIO não impede a proposta", () => {
    for (const codigo of IMPEDIMENTOS_SO_DO_ENVIO)
      expect(sinais({ impedimentos: [codigo] }), codigo).toBe(true);
  });

  it("opt-out e janela de 24 h — os dois nomeados na issue — propõem", () => {
    // O texto é proposto; o ENVIO continua vetado pela cadeia, no clique. Quem
    // revisa precisa saber o que está escrito antes de decidir.
    expect(sinais({ impedimentos: ["contato_bloqueado"] })).toBe(true);
    expect(sinais({ impedimentos: ["messaging_window_closed"] })).toBe(true);
  });
});

describe("CONTROLE: o que não é do envio mantém a prévia VAZIA", () => {
  it("⛔ falha de geração (truncamento no teto de tokens) não vira proposta", () => {
    expect(sinais({ saidaTruncada: true })).toBe(false);
  });

  it("⛔ teto de passos esgotado não vira proposta", () => {
    expect(sinais({ tetoDePassosAtingido: true })).toBe(false);
  });

  it("⛔ conteúdo vetado não vira proposta — o texto é o problema, não a hora", () => {
    for (const codigo of [
      "commercial_requires_human",
      "promise_out_of_table",
      "promise_semantic",
      "case_promise_without_case",
      "clinical_claim",
      "internal_vocabulary_leak",
      "lgpd_anonymized",
      "lgpd_missing_legal_basis",
      "contato_interno",
      "disclosure_required",
      "midia_sem_fotos",
    ])
      expect(sinais({ impedimentos: [codigo] }), codigo).toBe(false);
  });

  it("⛔ código DESCONHECIDO conta como conteúdo — a allowlist é fechada", () => {
    // Código novo na cadeia não pode liberar proposta por omissão: o padrão é
    // calar, e quem classificar o código novo diz de que lado ele está.
    expect(impedimentoEhSoDoEnvio("gate_novo_ainda_nao_classificado")).toBe(false);
    expect(sinais({ impedimentos: ["gate_novo_ainda_nao_classificado"] })).toBe(false);
    // Um de envio + um de conteúdo: o de conteúdo manda.
    expect(sinais({ impedimentos: ["contato_bloqueado", "promise_out_of_table"] })).toBe(false);
  });

  it("⛔ CONTROLE 'nada a responder': sem inbound pendente a prévia fica vazia", () => {
    // Conversa já respondida (ou sem inbound): a instrução não inventa assunto.
    expect(sinais({ inboundsSemResposta: 0 })).toBe(false);
  });

  it("CONTROLE: com candidato aceito o passo extra não é pedido", () => {
    // O caminho feliz não paga uma chamada de modelo a mais.
    expect(sinais({ candidatos: 1 })).toBe(false);
  });
});

describe("a instrução do pedido humano não autoriza furar guardrail", () => {
  it("diz que quem pediu foi uma pessoa, e que a cadeia de envio continua valendo", () => {
    expect(INSTRUCAO_DO_PEDIDO_HUMANO).toMatch(/pessoa da equipe/i);
    expect(INSTRUCAO_DO_PEDIDO_HUMANO).toMatch(/Sugerir resposta/);
    expect(INSTRUCAO_DO_PEDIDO_HUMANO).toMatch(/cadeia de envio continuam valendo/i);
    expect(INSTRUCAO_DO_PEDIDO_HUMANO).toMatch(/sem a aprovação/i);
  });

  it("fala do turno AUTOMÁTICO como o que se está suspendendo, não da regra de conteúdo", () => {
    expect(INSTRUCAO_DO_PEDIDO_HUMANO).toMatch(/turno automático/);
  });
});

describe("o motor usa ESTAS decisões — e só no rascunho assistido (#3281)", () => {
  const ler = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("o passo do pedido humano está ligado à régua do módulo", () => {
    const motor = ler("lib/agent-engine/agent/inbound-turn.ts");
    expect(motor).toMatch(/previaContinuaAtePropor\(\{/);
    expect(motor).toMatch(/INSTRUCAO_DO_PEDIDO_HUMANO/);
  });

  it("⛔ o passo mora dentro do ramo `assisted` — o automático não recebe a instrução", () => {
    const motor = ler("lib/agent-engine/agent/inbound-turn.ts");
    // O gate que prende a instrução ao rascunho: `preview?.kind === 'assisted'`
    // virando uma const nula para todo o resto.
    expect(motor).toMatch(/preview\?\.kind === 'assisted' \? preview : null/);
    // UMA única mensagem com a instrução no motor: a do passo assistido. A
    // outra menção possível é o `import` — nenhum outro ponto a usa como valor.
    expect(motor.match(/content: INSTRUCAO_DO_PEDIDO_HUMANO/g)).toHaveLength(1);
  });

  it("a proposta continua saindo pelas ferramentas da prévia (cadeia antes do envio)", () => {
    const motor = ler("lib/agent-engine/agent/inbound-turn.ts");
    // O passo usa `tools` (o ToolSet da prévia, que roda `evaluateBeforeSend`)
    // e para na primeira resposta aceita — nada é enviado de verdade.
    expect(motor).toMatch(/pararQuando: \(\) => previaAssistida\.result\.candidates\.length > 0/);
  });

  it("a aprovação continua passando a cadeia `before_send` inteira", () => {
    // Guarda de que o conserto não encostou no envio: o caminho do clique segue
    // rodando `runBeforeSend` (opt-out, janela, ritmo, promessa, disclosure).
    expect(ler("lib/agent-engine/agent/approved-reply.ts")).toMatch(/runBeforeSend\(/);
  });
});
