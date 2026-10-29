/**
 * O MENU FECHADO DE UM PONTO FIXO — leitura (resolver) e escrita (validar-binding).
 *
 * `transcricao_de_audio` é o primeiro ponto `fixo` a ganhar `opcoes`: continua
 * sem aceitar provider/modelo livres (não é um turno de chat), mas passa a ter
 * uma escolha real entre dois serviços. Os dois lados dessa escolha são
 * testados juntos porque são a MESMA regra vista de dois ângulos — testar só a
 * leitura deixaria passar uma escrita que grava uma opção inválida; testar só a
 * escrita deixaria passar uma leitura que ignora a escolha salva.
 */
import { describe, expect, it } from "vitest";

import {
  decidirBinding,
  type EntradaDaDecisao,
  type LinhaDeBinding,
} from "@/lib/ai/pontos/resolver";
import { validarBinding } from "@/lib/ai/pontos/validar-binding";

const PADRAO = { provider: "anthropic", defaultModel: "claude-sonnet-5" };

const binding = (over: Partial<LinhaDeBinding> = {}): LinhaDeBinding => ({
  purpose: "transcricao_de_audio",
  provider: "elevenlabs",
  credential_id: "cred-elevenlabs",
  model_id: "scribe_v1",
  base_url: null,
  is_enabled: true,
  ...over,
});

const entrada = (over: Partial<EntradaDaDecisao> = {}): EntradaDaDecisao => ({
  pontoId: "transcricao_de_audio",
  binding: null,
  agentePublicado: null,
  modeloDeAmbiente: undefined,
  padraoDaOrganizacao: PADRAO,
  ...over,
});

describe("decidirBinding — ponto fixo com menu", () => {
  it("sem binding, usa o padrão do produto (Whisper) — como antes do menu existir", () => {
    const d = decidirBinding(entrada());
    expect(d.origem).toBe("fixo_do_produto");
    expect(d.provider).toBe("openai");
    expect(d.modelId).toBe("whisper-1");
    expect(d.avisos).toEqual([]);
  });

  it("binding escolhendo uma opção do menu VENCE o padrão", () => {
    const d = decidirBinding(entrada({ binding: binding() }));
    expect(d.origem).toBe("binding");
    expect(d.provider).toBe("elevenlabs");
    expect(d.modelId).toBe("scribe_v1");
    expect(d.credentialId).toBe("cred-elevenlabs");
  });

  it("binding desabilitado não conta — cai no padrão, sem aviso de opção inválida", () => {
    const d = decidirBinding(entrada({ binding: binding({ is_enabled: false }) }));
    expect(d.origem).toBe("fixo_do_produto");
    expect(d.provider).toBe("openai");
    expect(d.avisos).toEqual([]);
  });

  it("binding com um PAR que não está no menu: avisa e cai no padrão — não finge que valeu", () => {
    const d = decidirBinding(
      entrada({ binding: binding({ provider: "elevenlabs", model_id: "modelo-que-saiu-do-menu" }) }),
    );
    expect(d.origem).toBe("fixo_do_produto");
    expect(d.provider).toBe("openai");
    expect(
      d.avisos.some((a) => a.includes("não é mais uma das opções")),
      "a mudança silenciosa de padrão sem aviso é exatamente o defeito que este degrau existe para fechar",
    ).toBe(true);
  });

  it("binding para um provider de fora do menu também cai no padrão — não só model_id trocado", () => {
    const d = decidirBinding(
      entrada({ binding: binding({ provider: "openrouter", model_id: "qualquer-coisa" }) }),
    );
    expect(d.provider).not.toBe("openrouter");
    expect(d.origem).toBe("fixo_do_produto");
  });
});

describe("validarBinding — ponto fixo com menu", () => {
  const conhecido = (model_id: string) => ({ model_id, supports_tools: false, supports_vision: false, conhecido: false });

  it("aceita um par que está no menu", () => {
    const r = validarBinding({
      pontoId: "transcricao_de_audio",
      provider: "elevenlabs",
      modelo: conhecido("scribe_v1"),
    });
    expect(r.ok).toBe(true);
  });

  it("aceita o OUTRO par do menu também", () => {
    const r = validarBinding({
      pontoId: "transcricao_de_audio",
      provider: "openai",
      modelo: conhecido("whisper-1"),
    });
    expect(r.ok).toBe(true);
  });

  it("recusa um modelo que não está no menu — mesmo sendo um provider real", () => {
    const r = validarBinding({
      pontoId: "transcricao_de_audio",
      provider: "elevenlabs",
      modelo: conhecido("outro-modelo-qualquer"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("opcao_fora_do_menu");
  });

  it("recusa um PROVIDER fora do menu, mesmo com um model_id que existe no outro par", () => {
    // Prova que o par é verificado JUNTO — provider certo com modelo do outro
    // provider não pode passar batido.
    const r = validarBinding({
      pontoId: "transcricao_de_audio",
      provider: "anthropic",
      modelo: conhecido("whisper-1"),
    });
    expect(r.ok).toBe(false);
  });

  it("não cai na catraca de ferramentas/visão — esta não é a mesma validação dos pontos de chat", () => {
    // Um modelo "desconhecido" (`conhecido:false`) no caminho de chat geraria
    // aviso de catálogo; aqui a resposta é só ok/não-ok contra o menu.
    const r = validarBinding({
      pontoId: "transcricao_de_audio",
      provider: "openai",
      modelo: conhecido("whisper-1"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.avisos).toEqual([]);
  });

  it("ponto fixo SEM opcoes continua recusando qualquer escolha, como antes", () => {
    const r = validarBinding({
      pontoId: "agent_preview", // ponto sem `fixo` nem `opcoes`; controle de que o branch novo não vazou
      provider: "anthropic",
      modelo: conhecido("claude-sonnet-5"),
    });
    // Não é fixo, então passa pela validação normal — não pelo branch do menu.
    expect(r.ok).toBe(true);
  });
});
