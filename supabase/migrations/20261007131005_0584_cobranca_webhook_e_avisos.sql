-- 0584 — COBRANÇA DO REVENDEDOR, PR 3a: o webhook, os avisos e a reconciliação
--        (spec docs/superpowers/specs/2026-09-29-cobranca-do-revendedor-design.md §2.4, §2.5, §8, §11)
-- manifest: **Cobrança do revendedor, PR 3a: o webhook, os avisos e a reconciliação.** (A) `webhook_events_log_provider_check` ganha `stripe` e `asaas`, editado no bloco único do baseline (alargamento puro, issue #159). (B) `uniq_webhook_events_log_cobranca`: `(provider, external_id)` único só para os provedores de cobrança — a rota do webhook trata o `23505` (linha `processed` responde 200; `received` reemite o sinal). A linha de cobrança nasce com `organization_id` nulo e corpo `{id,type}`, invisível ao tenant pela própria policy. Apêndice antes da VARREDURA anon, depois do bloco do PR 2. (C) `agent_inbox_items_kind_check` ganha `cobranca` no bloco único do baseline (lista completa; esta passa a ser a última migration que a reconstrói): avisos da régua à empresa, sem referência, e o de 80% do teto de IA do plano, com `ref_kind='plano'`; os dois abrem Plano e cobrança, só para o admin. (D) `fn_cobranca_reconciliaveis()` — o predicado único de quem a reconciliação relê (§8): o cron filtra `precisa_reler` e a Visão geral lê `max(relida_em)` do mesmo conjunto; INVOKER, EXECUTE só do `service_role`. (E) `cobranca_assinaturas.link_de_pagamento` (o link em aberto da última releitura; faixa, hub, Central e e-mail leem dele, nenhuma tela chama o provedor) e três funções INVOKER, EXECUTE só do `service_role`: `fn_cobranca_registrar_aviso` grava `ultimo_aviso` e o item `cobranca` da Central na mesma transação (o mesmo aviso da mesma dívida ganha uma vez; o novo fecha o anterior), `fn_cobranca_avisar_teto_de_ia` (um aviso de 80% por org por mês, com trava consultiva) e `fn_cobranca_suspender_se_devendo` (trava a linha e só suspende quem AINDA deve: o pagamento gravado no meio vence). (F) `cobranca_planos.oferecido_ao_cliente` (padrão true): o plano que a empresa pode escolher sozinha; false = só o dono atribui (plano negociado). (G) gatilho `trg_cobranca_trava_exclusao_com_assinatura_viva` (`BEFORE DELETE` em `organizations`): a empresa com assinatura viva no provedor — mais de uma não terminal, ou uma que não cancela no fim do período, pelo que a última releitura gravou — não sai do banco (`PT409 organizacao_com_assinatura_viva`), por qualquer caminho de exclusão; pendência do recorte do #1967. Gate da 0584: `tests/invariants/cobranca-exclusao-com-assinatura-viva.test.ts`, `tests/invariants/cobranca-plano-oferecido.test.ts`, `tests/invariants/cobranca-avisos.test.ts`, `tests/invariants/cobranca-reconciliacao.test.ts`, `tests/unit/kind-check-migration-x-baseline.test.ts`, `tests/invariants/vocabulario-banco-x-typescript.test.ts`, `tests/invariants/cobranca-webhook-e-avisos.test.ts`.
--
-- ── A causa ───────────────────────────────────────────────────────────────────
-- A cobrança passa a falar com um provedor de pagamento (Stripe nesta PR; o
-- Asaas chega na 3b, no mesmo contrato). O provedor avisa por webhook, e o aviso
-- é só PONTEIRO: toda decisão vem da releitura na API do provedor. O arquivo do
-- webhook precisa aceitar os dois provedores e recusar o mesmo evento duas vezes.
--
-- ── O que muda ────────────────────────────────────────────────────────────────
-- A. `webhook_events_log_provider_check` ganha 'stripe' e 'asaas'.
-- B. `uniq_webhook_events_log_cobranca`: um evento de cobrança, uma linha.
-- C. `agent_inbox_items_kind_check` ganha 'cobranca': avisos da régua e do teto de IA.
-- D. `fn_cobranca_reconciliaveis()`: quem a reconciliação relê, num predicado só.
-- E. `link_de_pagamento`, `fn_cobranca_registrar_aviso`, `fn_cobranca_avisar_teto_de_ia` e `fn_cobranca_suspender_se_devendo`.
-- F. `cobranca_planos.oferecido_ao_cliente`: o plano que a empresa pode escolher sozinha.
-- G. A empresa com assinatura viva no provedor não sai do banco (gatilho na exclusão).
--
-- No baseline, as seções que ALARGAM constraint de vocabulário editam o bloco
-- único dela (regra da issue #159); as demais entram no apêndice desta
-- migration, antes da VARREDURA anon.
-- Idempotente (`drop constraint if exists` + `add`, `if not exists`, `create or
-- replace`); sem BEGIN/COMMIT.
-- Toda função nova perde EXECUTE de public, anon e authenticated.
-- Gates: tests/invariants/cobranca-webhook-e-avisos.test.ts, cobranca-reconciliacao.test.ts, cobranca-avisos.test.ts, cobranca-plano-oferecido.test.ts, cobranca-exclusao-com-assinatura-viva.test.ts.

-- ── A. o arquivo do webhook aceita os provedores de cobrança ─────────────────
-- Lista COMPLETA do bloco único do baseline (0151, alargado pela 0387) mais
-- 'stripe' e 'asaas'. Alargamento puro: linha que passava continua passando.
-- A linha de cobrança nasce com organization_id NULO, cabeçalhos NULOS e corpo
-- {id,type}: a policy de leitura da tabela vale para qualquer membro, e é a org
-- nula que a esconde do tenant (spec §2.4).
alter table public.webhook_events_log
  drop constraint if exists webhook_events_log_provider_check;
alter table public.webhook_events_log
  add constraint webhook_events_log_provider_check check (provider in (
    'waha', 'nuvemshop', 'generic', 'meta_cloud', 'zernio', 'datafy', 'stripe', 'asaas'
  ));

-- ── B. um evento de cobrança, uma linha ─────────────────────────────────────
-- A rota grava a linha ANTES de emitir o sinal, e o provedor reentrega. O 23505
-- deste índice é a idempotência: linha `processed` → 200 sem reemitir; linha
-- `received` → reemite (o emit anterior falhou; o consumidor relê, então
-- reemitir é inofensivo). Parcial: o arquivo dos canais não muda. Nenhuma
-- linha desses provedores existia antes do CHECK acima, então não há o que
-- deduplicar antes de criar o índice.
create unique index if not exists uniq_webhook_events_log_cobranca
  on public.webhook_events_log (provider, external_id)
  where provider in ('stripe', 'asaas');

-- ── C. a Central da empresa ganha os avisos da cobrança ──────────────────────
-- Lista COMPLETA do bloco único do baseline (kind-check-migration-x-baseline):
-- esta passa a ser a última migration que reconstrói a constraint. 'cobranca'
-- é o aviso da régua (teste acabando, venceu, suspende em breve, suspensa) e o
-- de 80% do teto de IA do plano (ref_kind plano). Os dois abrem Configurações ›
-- Plano e cobrança, só para quem administra a empresa.
alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;
alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required','appointment_recovery_review','qr_rescan','routing_unassigned',
    'job_dead','event_dead','budget_exceeded','handoff','promotion_review','judge_unaligned',
    'followup_dead','snooze_expired','next_action_ambiguous','risk_backlog_seeded',
    'reactivation_expired','capabilities_missing','message_send_stuck','midia_nao_lida',
    'channel_template_review','channel_number_alert','promise_unfulfilled','contact_proposal_expired',
    'budget_warning','conhecimento_nao_indexado','voice_call_missed','case_stale',
    'aviso_de_caso_nao_entregue','followup_sem_agente','canal_mudo_sem_numero',
    'proposal_expired_notice','proposal_acceptance_rate_drop','proposal_promised_not_created',
    'proposta_travada',
    'proposta_pronta_para_revisao',
    'org_reativada',
    'jev_pedido_de_humano','jev_parar_de_receber',
    -- os avisos da cobrança do revendedor à empresa.
    'cobranca',
    'other'
  ));

-- ── D. quem a reconciliação relê: um predicado só ────────────────────────────
-- A reconciliação (cron da cobrança, §8) relê pela API as assinaturas com
-- provedor cujo estado ainda pode mudar sem aviso nosso: toda não cancelada; a
-- cancelada de org suspensa POR COBRANÇA (pode ter reassinado e pago por boleto
-- com o webhook perdido); e a cancelada com checkout dos últimos 30 dias (o
-- checkout pode ter virado pagamento). `precisa_reler` diz quem entra na
-- rodada: nunca lida, lida há mais de 6h, ou com o aviso final dado em org
-- ativa e sem leitura da última hora (a régua só suspende com leitura < 1h).
-- A Visão geral de /admin/cobranca lê max(relida_em) deste MESMO conjunto.
-- INVOKER: quem chama é o service_role, que já lê as duas tabelas.
create or replace function public.fn_cobranca_reconciliaveis()
returns table (organization_id uuid, relida_em timestamptz, precisa_reler boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.organization_id,
         a.relida_em,
         (a.relida_em is null
          or a.relida_em < now() - interval '6 hours'
          or (o.status = 'active'
              and a.ultimo_aviso = 'suspende_em_breve'
              and a.relida_em < now() - interval '1 hour')) as precisa_reler
    from public.cobranca_assinaturas a
    join public.organizations o on o.id = a.organization_id
   where a.provedor is not null
     and (a.estado <> 'cancelada'
          or (o.status = 'suspended' and o.suspended_kind = 'cobranca')
          or a.checkout_expira_em > now() - interval '30 days');
$$;

revoke execute on function public.fn_cobranca_reconciliaveis() from public, anon, authenticated;
grant execute on function public.fn_cobranca_reconciliaveis() to service_role;

-- ── E. o link de pagamento guardado, e o aviso gravado com o item da Central ─
-- `link_de_pagamento`: o link da cobrança em aberto que a última releitura viu
-- (`Situacao.linkDePagamento`). A faixa em /app, o hub do suspenso, a Central e
-- o e-mail leem daqui — nenhuma tela chama o provedor para desenhar um botão.
-- Só `sincronizar` escreve (nulo = nada a pagar).
alter table public.cobranca_assinaturas add column if not exists link_de_pagamento text;

-- O aviso da régua e o item na Central nascem NA MESMA transação (D-5: aviso
-- "enviado" = gravado com o item). Ganha só quem MUDA o aviso: o mesmo aviso da
-- mesma dívida (ultimo_aviso_em >= p_desde) devolve false, e cron e sinal
-- concorrentes não duplicam o item. O aviso novo fecha o anterior na Central.
create or replace function public.fn_cobranca_registrar_aviso(
  p_org uuid, p_aviso text, p_desde timestamptz, p_titulo text, p_corpo text, p_severidade text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ganhou boolean;
begin
  update public.cobranca_assinaturas
     set ultimo_aviso = p_aviso, ultimo_aviso_em = now(), updated_at = now()
   where organization_id = p_org
     and (ultimo_aviso is distinct from p_aviso
          or ultimo_aviso_em is null
          or (p_desde is not null and ultimo_aviso_em < p_desde))
  returning true into v_ganhou;
  if not coalesce(v_ganhou, false) then
    return false;
  end if;
  update public.agent_inbox_items
     set status = 'resolved', resolved_at = now()
   where organization_id = p_org and kind = 'cobranca' and ref_kind is null and status = 'open';
  insert into public.agent_inbox_items (organization_id, kind, severity, title, body)
  values (p_org, 'cobranca', p_severidade, p_titulo, p_corpo);
  return true;
end;
$$;

revoke execute on function public.fn_cobranca_registrar_aviso(uuid, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_cobranca_registrar_aviso(uuid, text, timestamptz, text, text, text) to service_role;

-- 80% do teto de IA do plano: um aviso por organização por mês (mês em UTC).
-- A trava consultiva por org (chave 2284, vizinha das 2281-2282 do PR 2)
-- faz do "já avisei este mês?" e do INSERT uma coisa só.
create or replace function public.fn_cobranca_avisar_teto_de_ia(p_org uuid, p_titulo text, p_corpo text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 2284));
  if exists (select 1 from public.agent_inbox_items
              where organization_id = p_org and kind = 'cobranca' and ref_kind = 'plano'
                and created_at >= date_trunc('month', now())) then
    return false;
  end if;
  insert into public.agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
  values (p_org, 'cobranca', 'warn', p_titulo, p_corpo, 'plano', p_org);
  return true;
end;
$$;

revoke execute on function public.fn_cobranca_avisar_teto_de_ia(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_cobranca_avisar_teto_de_ia(uuid, text, text) to service_role;

-- A régua decide suspender lendo a linha ANTES; um pagamento pode ser gravado
-- no meio. Esta função trava a linha da assinatura e só suspende se ela AINDA
-- está em dívida: com a linha travada, a gravação do pagamento espera, e depois
-- dela a reativação corre como sempre. Sem isto, quem acabou de pagar seria
-- suspenso e só voltaria na rodada seguinte do cron, com dois e-mails no meio.
create or replace function public.fn_cobranca_suspender_se_devendo(p_org uuid, p_motivo text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.cobranca_assinaturas
   where organization_id = p_org and estado in ('em_atraso', 'cancelada')
   for update;
  if not found then
    return jsonb_build_object('changed', false, 'motivo', 'nao_deve');
  end if;
  return public.fn_suspender_organizacao(p_org, 'cobranca', p_motivo, null);
end;
$$;

revoke execute on function public.fn_cobranca_suspender_se_devendo(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_cobranca_suspender_se_devendo(uuid, text) to service_role;

-- ── F. o plano que a empresa pode escolher sozinha ───────────────────────────
-- false = só o dono atribui (plano negociado, com desconto): a tela da empresa
-- não o lista e a rota da empresa o recusa. Padrão true: o plano que já existia
-- segue aparecendo depois do update.sh.
alter table public.cobranca_planos
  add column if not exists oferecido_ao_cliente boolean not null default true;

-- ── G. a empresa com assinatura viva no provedor não sai do banco ───────────
-- Apagar a organização leva `cobranca_assinaturas` em cascata, e o provedor
-- seguiria cobrando o cliente final sem ninguém do lado de cá para cancelar
-- (pendência do recorte do #1967). A trava mora na PRÓPRIA exclusão: vale para
-- a função do painel, para script e para SQL à mão. "Viva" é o que a última
-- releitura gravou (`sincronizar`): mais de uma assinatura não terminal, ou uma
-- que não cancela no fim do período. Quem exclui pelo painel relê o provedor
-- ANTES (`lerSituacao`); isto é a segunda linha. Para liberar: cancelar no
-- provedor e deixar o aviso dele (ou a reconciliação) reler. Sem HTTP: só
-- leitura de linha. DEFINER de propósito: gatilho roda com o papel de quem
-- apaga, e um admin de plataforma apagando pela sessão (policy
-- `orgs_write_platform_admin`) leria `cobranca_assinaturas` sob RLS e não
-- veria a assinatura de outra empresa — a trava abriria justo nesse caminho.
create or replace function public.fn_cobranca_trava_exclusao_com_assinatura_viva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.cobranca_assinaturas a
     where a.organization_id = old.id
       and a.provedor is not null
       and (a.assinaturas_vivas > 1 or (a.assinaturas_vivas = 1 and not a.cancela_no_fim))
  ) then
    raise exception 'organizacao_com_assinatura_viva' using errcode = 'PT409';
  end if;
  return old;
end;
$$;

revoke execute on function public.fn_cobranca_trava_exclusao_com_assinatura_viva() from public, anon, authenticated;
grant execute on function public.fn_cobranca_trava_exclusao_com_assinatura_viva() to service_role;

drop trigger if exists trg_cobranca_trava_exclusao_com_assinatura_viva on public.organizations;
create trigger trg_cobranca_trava_exclusao_com_assinatura_viva
  before delete on public.organizations
  for each row execute function public.fn_cobranca_trava_exclusao_com_assinatura_viva();
