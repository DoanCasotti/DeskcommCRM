import { describe, expect, it, vi, beforeEach } from "vitest";

const { resolveOrgLlmConfigMock } = vi.hoisted(() => ({ resolveOrgLlmConfigMock: vi.fn() }));
vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({
  resolveOrgLlmConfig: resolveOrgLlmConfigMock,
}));

import { resolverVozDoTurno } from "@/lib/agent-engine/agent/voz-do-turno";

function pool(settings: Record<string, unknown> | null = { voz: { voice_id: "v1" } }) {
  return { query: vi.fn(async () => ({ rows: [{ settings }] })) } as never;
}

beforeEach(() => {
  resolveOrgLlmConfigMock.mockReset();
});

describe("resolverVozDoTurno", () => {
  it("voz_enabled=false: nunca fala, nem consulta o banco", async () => {
    const db = pool();
    const r = await resolverVozDoTurno({
      pool: db,
      tenantId: "org1",
      vozEnabled: false,
      vozQuando: "sempre",
      inboundType: "audio",
    });
    expect(r).toBeNull();
    expect((db as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled();
  });

  it("vozQuando='nunca': não fala mesmo com voz_enabled=true", async () => {
    const r = await resolverVozDoTurno({
      pool: pool(),
      tenantId: "org1",
      vozEnabled: true,
      vozQuando: "nunca",
      inboundType: "audio",
    });
    expect(r).toBeNull();
  });

  it("vozQuando='espelhar' e o cliente mandou TEXTO: não fala", async () => {
    const r = await resolverVozDoTurno({
      pool: pool(),
      tenantId: "org1",
      vozEnabled: true,
      vozQuando: "espelhar",
      inboundType: "text",
    });
    expect(r).toBeNull();
  });

  it("vozQuando='espelhar' e o cliente mandou ÁUDIO: resolve a voz", async () => {
    resolveOrgLlmConfigMock.mockResolvedValue({ apiKey: "sk_elevenlabs" });
    const r = await resolverVozDoTurno({
      pool: pool({ voz: { voice_id: "v1", model_id: "eleven_turbo_v2" } }),
      tenantId: "org1",
      vozEnabled: true,
      vozQuando: "espelhar",
      inboundType: "audio",
    });
    expect(r).toEqual({ apiKey: "sk_elevenlabs", voiceId: "v1", modelId: "eleven_turbo_v2" });
    expect(resolveOrgLlmConfigMock).toHaveBeenCalledWith(
      expect.anything(),
      {},
      "org1",
      { provider: "elevenlabs" },
    );
  });

  it("vozQuando='sempre' sem mensagem inbound nenhuma (ex.: follow-up proativo): ainda fala", async () => {
    resolveOrgLlmConfigMock.mockResolvedValue({ apiKey: "sk" });
    const r = await resolverVozDoTurno({
      pool: pool(),
      tenantId: "org1",
      vozEnabled: true,
      vozQuando: "sempre",
      inboundType: null,
    });
    expect(r).not.toBeNull();
  });

  it("sem voice_id configurado (Fase 7 não existe ainda): fala em texto, não trava", async () => {
    const r = await resolverVozDoTurno({
      pool: pool({}),
      tenantId: "org1",
      vozEnabled: true,
      vozQuando: "sempre",
      inboundType: null,
    });
    expect(r).toBeNull();
    expect(resolveOrgLlmConfigMock).not.toHaveBeenCalled();
  });

  it("sem credencial ElevenLabs cadastrada: fala em texto, não lança", async () => {
    resolveOrgLlmConfigMock.mockRejectedValue(new Error("llm_not_configured"));
    const r = await resolverVozDoTurno({
      pool: pool(),
      tenantId: "org1",
      vozEnabled: true,
      vozQuando: "sempre",
      inboundType: null,
    });
    expect(r).toBeNull();
  });

  it("falha de rede ao resolver credencial: fala em texto, não lança", async () => {
    resolveOrgLlmConfigMock.mockRejectedValue(new TypeError("fetch failed"));
    const r = await resolverVozDoTurno({
      pool: pool(),
      tenantId: "org1",
      vozEnabled: true,
      vozQuando: "sempre",
      inboundType: null,
    });
    expect(r).toBeNull();
  });
});
