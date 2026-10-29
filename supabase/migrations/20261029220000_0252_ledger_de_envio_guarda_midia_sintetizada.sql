-- ============================================================================
-- 0252 — O LEDGER DE ENVIO PRECISA SABER ONDE A MÍDIA JÁ SINTETIZADA FICOU.
--
-- Prepara o terreno para o agente responder em ÁUDIO (ElevenLabs TTS, Onda de
-- voz — docs/superpowers/plans/2026-10-29-voz-elevenlabs.md, Fase 6a).
--
-- ## O problema que esta coluna resolve
--
-- Sintetizar voz custa por caractere e o `send_ledger` já é a peça que garante
-- intenção EXACTLY-ONCE para o envio de uma mensagem do turno (ver o cabeçalho
-- de `lib/agent-engine/edge/crm/send-message.ts`): `requested` nasce ANTES do
-- envio, e um crash entre o insert e o envio faz o retry reconciliar pela
-- MESMA chave, sem reenviar.
--
-- Síntese de voz tem a mesma forma de risco, um passo ANTES do envio: chamar o
-- ElevenLabs e subir o MP3 para o Storage são dois passos que podem falhar
-- NO MEIO, e sem um lugar para registrar "já sintetizei isto", um retry re-
-- sintetizaria (e pagaria) de novo pela MESMA mensagem lógica.
--
-- `media_storage_path` é esse lugar: gravado a primeira vez que a síntese
-- termina, keyed por `(job_id, seq)` — a mesma identidade que o ledger já usa.
-- Um `INSERT ... ON CONFLICT (job_id, seq) DO UPDATE SET media_storage_path =
-- coalesce(send_ledger.media_storage_path, excluded.media_storage_path)`
-- resolve o path de forma idempotente ANTES de `sendWithLedger` fazer a sua
-- própria dança de create/find/rotate — que continua INTOCADA: esta migration
-- não muda o comportamento de nenhum envio de TEXTO existente, só acrescenta
-- uma coluna que, hoje, ninguém grava ainda (Fase 6a entrega o escritor; a
-- Fase 6b, ainda não construída, é quem decide chamá-lo).
--
-- NULL (o estado de toda linha hoje, e de toda mensagem de texto para sempre)
-- significa "não é uma mensagem de voz, ou a síntese ainda não terminou" —
-- nunca "a mídia sumiu". A tabela já tem este padrão (`crm_message_id`
-- também nasce NULL e é preenchido depois).
-- ============================================================================

alter table public.send_ledger
  add column if not exists media_storage_path text;

comment on column public.send_ledger.media_storage_path is
  'Migration 0252. Caminho no Storage do áudio JÁ sintetizado para este '
  '(job_id, seq) — preenchido uma vez, antes do envio, para um retry não '
  'resintetizar (e pagar) de novo pela mesma mensagem lógica. NULL para toda '
  'mensagem que não é voz, e para voz cuja síntese ainda não terminou.';
