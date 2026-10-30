import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/voz/preview — sintetiza uma frase curta com a voz escolhida
 * e devolve o áudio inline (base64), para a tela tocar antes de salvar.
 *
 * Fase 7 do plano de voz. Não persiste nada — nem Storage, nem `llm_calls`:
 * é descartável por natureza (o operador pode ouvir a mesma voz várias vezes
 * decidindo), e tratar como mensagem real cobraria do orçamento algo que o
 * cliente nunca recebeu. O custo de verdade (síntese de uma resposta real)
 * continua só em `lib/agent-engine/edge/crm/send-voice.ts`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { sintetizarVoz } from "@/lib/ai/voz/sintetizar";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const FRASE_PADRAO =
  "Olá! Esta é uma prévia de como o seu agente vai soar ao responder em áudio.";

// Sem orçamento nem registro de custo por desenho (prévia é descartável — ver
// o cabeçalho) — o rate limit é a ÚNICA coisa entre esta rota e um script
// gastando crédito real do ElevenLabs em loop. Achado na revisão de código.
// Generoso o bastante para "ouvir três ou quatro vozes decidindo", curto o
// bastante para não virar torneira: a mesma ordem de grandeza do rate limit
// de troca de logo (`app/api/v1/marca/logo/route.ts`).
const TETO_POR_ORGANIZACAO = 10;
const JANELA_SEGUNDOS = 60;

const corpo = z.object({
  voice_id: z.string().trim().min(1).max(200),
  model_id: z.string().trim().min(1).max(200).optional(),
  texto: z.string().trim().min(1).max(280).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_providers" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org } = authz;

  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_body", t("corpo inválido"), 422, { requestId, details: parsed.error.issues });
  }

  const limite = await checkRateLimit(`voz-preview:${org.orgId}`, TETO_POR_ORGANIZACAO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail(
      "rate_limited",
      t("Muitas prévias em sequência. Espere um minuto e tente de novo."),
      429,
      { requestId, headers: { "Retry-After": String(JANELA_SEGUNDOS) } },
    );
  }

  const admin = createAdminClient();
  const { data: cred } = await admin
    .from("ai_provider_credentials")
    .select("api_key_encrypted, api_key_iv, api_key_tag")
    .eq("organization_id", org.orgId)
    .eq("provider", "elevenlabs")
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cred) {
    return fail(
      "credential_required",
      t("Cadastre e valide uma chave do ElevenLabs em Agente de IA → Credenciais antes de ouvir a prévia."),
      422,
      { requestId },
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptKey({
      ciphertext: byteaToBuffer(cred.api_key_encrypted),
      iv: byteaToBuffer(cred.api_key_iv),
      tag: byteaToBuffer(cred.api_key_tag),
    });
  } catch {
    return fail("internal_error", t("Falha ao decifrar a credencial."), 500, { requestId });
  }

  try {
    const { audio, mimeType } = await sintetizarVoz({
      apiKey,
      voiceId: parsed.data.voice_id,
      ...(parsed.data.model_id ? { modelId: parsed.data.model_id } : {}),
      texto: parsed.data.texto ?? FRASE_PADRAO,
    });
    return ok(
      { audioBase64: audio.toString("base64"), mimeType },
      { requestId },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // `synthesis_401` = chave/voz inválida; qualquer outro = provedor fora —
    // nos dois casos a tela mostra "não consegui gerar a prévia", nunca um
    // áudio quebrado.
    return fail("synthesis_failed", t("Não consegui gerar a prévia agora. Tente de novo."), 502, {
      requestId,
      details: { error: msg.slice(0, 200) },
    });
  }
}
