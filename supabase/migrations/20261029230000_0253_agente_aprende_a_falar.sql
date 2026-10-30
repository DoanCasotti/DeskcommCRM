-- ============================================================================
-- 0253 — O AGENTE APRENDE A FALAR: `voz_enabled` + `voz_quando` por versão.
--
-- Fase 6b do plano de voz (docs/superpowers/plans/2026-10-29-voz-elevenlabs.md).
-- Precedente: `video_frames_enabled` (migration 0058) — feature que custa
-- dinheiro nasce DESLIGADA e por versão publicada, nunca por organização
-- inteira (um agente de teste e um de produção na mesma org podem discordar).
--
-- `voz_quando` tem o vocabulário FECHADO de propósito (ao contrário da maioria
-- das colunas novas deste repo, que nascem abertas): são três comportamentos
-- de PRODUTO com código dedicado para cada um
-- (`lib/agent-engine/agent/voz-do-turno.ts`), não um rótulo livre que o
-- operador inventa — mais parecido com `send_ledger.status` do que com
-- `agent_cases.kind`. Nenhum clone tem linha com valor fora da lista (coluna
-- nova), então o CHECK não arrisca quebrar o `update.sh` de ninguém.
--
-- ⚠️ NINGUÉM CONSEGUE LIGAR ISTO PELA TELA AINDA — não há UI (Fase 7). As duas
-- colunas nascem com DEFAULT que preserva o comportamento de hoje para toda
-- organização, em toda versão, publicada ou não. Quem ligar `voz_enabled` por
-- SQL direto precisa TAMBÉM configurar `organizations.settings.voz.voice_id`
-- e cadastrar a credencial ElevenLabs — sem os três, `resolverVozDoTurno`
-- cai em texto e loga um aviso (nunca trava o turno).
--
-- `fn_ai_agent_version_content_immutable` (trigger `trg_ai_agent_versions_
-- content_immutable`) precisa conhecer as duas colunas — é o MESMO trigger
-- que as migrations 0125 e 0181 estenderam para fechar o buraco de colunas
-- novas "esquecidas" (ficar editável numa versão JÁ PUBLICADA, sem virar
-- draft novo e sem deixar trilha). O corpo abaixo é DERIVADO da versão em
-- vigor (lida em supabase/baseline.sql, a autoridade sobre o estado atual —
-- não da migration 0125 nem da 0181 isoladas, que são só snapshots
-- históricos): partir de uma cópia velha apagaria `knowledge_source_ids`
-- (0181) silenciosamente, reabrindo um buraco já fechado.
-- ============================================================================

alter table public.ai_agent_versions
  add column if not exists voz_enabled boolean not null default false;

alter table public.ai_agent_versions
  add column if not exists voz_quando text not null default 'espelhar';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ai_agent_versions_voz_quando_check'
  ) then
    alter table public.ai_agent_versions
      add constraint ai_agent_versions_voz_quando_check
      check (voz_quando in ('nunca', 'espelhar', 'sempre'));
  end if;
end $$;

comment on column public.ai_agent_versions.voz_enabled is
  'Migration 0253. A resposta do agente pode saír como nota de voz nesta versão. '
  'Default FALSE preserva o comportamento de toda organização existente. '
  'Sem UI ainda (Fase 7) — quem liga por SQL direto também precisa configurar '
  'organizations.settings.voz.voice_id e a credencial ElevenLabs.';

comment on column public.ai_agent_versions.voz_quando is
  'Migration 0253. ''nunca'' (nunca fala, mesmo com voz_enabled=true — existe '
  'para desligar sem apagar a config), ''espelhar'' (fala só quando o CLIENTE '
  'mandou áudio nesta mensagem — o default) ou ''sempre''. Decidido em '
  'lib/agent-engine/agent/voz-do-turno.ts.';

create or replace function fn_ai_agent_version_content_immutable() returns trigger
language plpgsql as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    -- ↓ as duas desta migration
    or new.voz_enabled            is distinct from old.voz_enabled
    or new.voz_quando             is distinct from old.voz_quando
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;
