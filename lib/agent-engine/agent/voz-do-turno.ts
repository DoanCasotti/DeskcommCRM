/**
 * A DECISÃO "O AGENTE FALA NESTE TURNO?" — Fase 6b do plano de voz
 * (`docs/superpowers/plans/2026-10-29-voz-elevenlabs.md`).
 *
 * Resolvida UMA vez por turno (não por chamada de `send_message`): a
 * pergunta não muda entre tentativas do MESMO turno, e resolver credencial a
 * cada bolha pagaria uma ida ao banco por mensagem sem motivo.
 *
 * Falha SEMPRE para texto, nunca para "turno travado": sem credencial, sem
 * `voice_id` configurado, ou qualquer erro de rede com o ElevenLabs, a
 * resposta é `null` — "não fale agora" — e quem chama segue pelo caminho de
 * bolhas de texto de sempre. Voz é um EXTRA sobre um caminho que já
 * funciona; travar o turno por causa dela seria pior que nunca ter oferecido.
 */
import type pg from 'pg';

import { resolveOrgLlmConfig, type LlmEdgeConfig } from '../edge/llm/credentials';
import { logger } from '@/lib/logger';

export type VozQuando = 'nunca' | 'espelhar' | 'sempre';

export interface ResolverVozDoTurnoInput {
  pool: pg.Pool;
  tenantId: string;
  vozEnabled: boolean;
  vozQuando: VozQuando;
  /** `messages.type` da mensagem inbound que disparou o turno — `null` quando não há (ex.: follow-up proativo). */
  inboundType: string | null;
}

export interface VozResolvidaDoTurno {
  apiKey: string;
  voiceId: string;
  modelId?: string;
}

/** `organizations.settings->'voz'` — mesmo padrão jsonb de `settings->'llm'`. */
interface VozSettings {
  voice_id?: string;
  model_id?: string;
}

function deveFalar(vozQuando: VozQuando, inboundType: string | null): boolean {
  if (vozQuando === 'nunca') return false;
  if (vozQuando === 'sempre') return true;
  // 'espelhar': só quando o CLIENTE mandou áudio nesta mensagem.
  return inboundType === 'audio';
}

export async function resolverVozDoTurno(
  input: ResolverVozDoTurnoInput,
): Promise<VozResolvidaDoTurno | null> {
  if (!input.vozEnabled) return null;
  if (!deveFalar(input.vozQuando, input.inboundType)) return null;

  try {
    const { rows } = await input.pool.query<{ settings: Record<string, unknown> | null }>(
      'select settings from organizations where id = $1',
      [input.tenantId],
    );
    const voz = (rows[0]?.settings?.voz ?? {}) as VozSettings;
    if (!voz.voice_id) {
      // Ninguém escolheu uma voz ainda (não há tela — Fase 7). `voz_enabled`
      // só chega a `true` hoje por quem edita o banco direto, e essa pessoa
      // também não configurou `settings.voz` — não é falha, é "faltou o
      // segundo passo". Loga para quem for depurar, não trava o turno.
      logger.warn('[voz-do-turno] voz_enabled sem voice_id configurado — respondendo em texto', {
        organization_id: input.tenantId,
      });
      return null;
    }

    const cfg: LlmEdgeConfig = {};
    const elevenlabs = await resolveOrgLlmConfig(input.pool, cfg, input.tenantId, {
      provider: 'elevenlabs',
    });
    return {
      apiKey: elevenlabs.apiKey,
      voiceId: voz.voice_id,
      ...(voz.model_id ? { modelId: voz.model_id } : {}),
    };
  } catch (err) {
    // `LlmNotConfiguredError` (sem credencial) e qualquer falha de rede caem
    // aqui igual — a resposta para o chamador é a MESMA: fale em texto agora.
    logger.warn('[voz-do-turno] não consegui resolver voz para este turno — respondendo em texto', {
      organization_id: input.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
