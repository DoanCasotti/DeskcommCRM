-- manifest: O card que ENTRA numa etapa passa a nascer no TOPO da coluna, e não no fim (issue #3461, item 1). `fn_mover_leads_em_lote` (o caminho do "mover para…" em lote, que é o do painel do Inbox) troca o piso `max(position_in_stage) + 1000 por card` por `min(position_in_stage) − 1000 por card`: o lote encosta ACIMA do primeiro card da etapa de destino e mantém entre si a ordem em que estava no quadro. Assinatura, colunas de retorno, atomicidade, os dois ramos do #2887 e a distinção de posições da 0209 continuam os mesmos. Etapa vazia segue nascendo em 1000, 2000, … Nenhuma coluna nova, nenhum backfill.
--
-- 9022 — issue #3461, item 1 (o defeito medido: conversa iniciada ou
-- transferida do Inbox para uma etapa aparecia no FIM da coluna).
--
-- ─── O que se mediu, e onde ────────────────────────────────────────────────
--
-- A ordem da coluna é `position_in_stage` CRESCENTE (menor primeiro), lida em
-- `app/api/v1/pipelines/[id]/board/route.ts` (`.order("position_in_stage")`).
-- Três escritores decidiam onde o recém-chegado entra, e os três gravavam o
-- FIM: a criação (`createLeadHandler`, `MAX + 1000`), o move sem posição
-- (`moveLeadHandler` e `PATCH /leads/[id]/move`) e ESTA função, que é quem o
-- painel do Inbox dispara (`components/inbox/CRMSidePanel.tsx` → ação "move"
-- em `POST /api/v1/leads/bulk` → `fn_mover_leads_em_lote`).
--
-- Medido no Postgres local, numa coluna com três cards (1000, 2000, 3000),
-- antes desta migration: conversa iniciada caía em 4000 e transferida do Inbox
-- em 5000 — as duas no fim, que é exatamente o que a issue relata.
--
-- ─── O que muda ────────────────────────────────────────────────────────────
--
-- O piso passa a ser o TOPO: `min(position_in_stage) − 1000` por card, na
-- ordem do lote. É a mesma régua que a resposta rápida já usa desde a 0729
-- ("a resposta NOVA nasce no topo — um passo acima da primeira") e a mesma que
-- o TypeScript passou a aplicar em `lib/kanban/entrada-na-etapa.ts`. Só a
-- ponta muda: continua UM `return query execute`, as posições continuam
-- DISTINTAS entre os cards do lote (a razão de existir da 0209 — `midpoint`
-- empata em NaN quando dois vizinhos têm o mesmo número) e a contagem continua
-- atômica.
--
-- ⚠️ CONSEQUÊNCIA DECLARADA: mover em lote pelo quadro (barra de ações em
-- lote) também passa a empilhar no topo da etapa de destino. É o mesmo verbo —
-- "chegou nesta etapa" — e a alternativa (dois pisos, um para o Inbox e outro
-- para a barra do quadro) seria a mesma regra escrita duas vezes, que é como
-- as duas divergem na primeira mudança.
--
-- ⚠️ `%` no texto do `format` é marcador: o corpo abaixo não pode conter
-- nenhum além dos três `%s` (não contém). Quem for editar, confira.
--
-- Idempotente (`create or replace`, mesma assinatura da 0674 — sem `drop
-- function`, para não perder os grants no meio da cadeia), sem coluna nova e
-- sem dado tocado: os cards que já estão nas colunas não se movem.

create or replace function public.fn_mover_leads_em_lote(
  p_organization_id uuid,
  p_lead_ids uuid[],
  p_stage_id uuid,
  p_lost_reason text default null
) returns table (lead_id uuid, from_stage_id uuid, pipeline_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_min numeric;
  v_total int;
  -- Motivo em branco é ausência de motivo, nunca um motivo de uma letra.
  v_motivo text := nullif(btrim(coalesce(p_lost_reason, '')), '');
  v_coluna_motivo text := '';
  v_filtro_novos text := '';
  v_filtro_preservados text := 'false';
begin
  -- Quantos cards o lote tem DE VERDADE. O predicado é o MESMO do `alvo` da
  -- escrita (organização + ids): contar por `array_length(p_lead_ids)` somaria
  -- id de outra organização — que o `alvo` descarta —, e a posição do primeiro
  -- card sairia de uma conta que inclui card que não vai ser movido.
  select count(*)
    into v_total
    from public.crm_leads l
   where l.organization_id = p_organization_id
     and l.id = any(p_lead_ids);

  -- Onde o lote ENCOSTA: o primeiro card da etapa de destino, sem contar os que
  -- já estão no lote. `null` é a etapa vazia — e aí o lote ocupa o miolo de
  -- sempre (1000, 2000, …), pelo `coalesce` da escrita.
  select min(l.position_in_stage)
    into v_min
    from public.crm_leads l
   where l.organization_id = p_organization_id
     and l.stage_id = p_stage_id
     and not (l.id = any(p_lead_ids));

  -- Só com motivo a gravar a coluna entra na escrita (0263; ver o cabeçalho) —
  -- e só quem NÃO estava perdido recebe a coluna (#2887). Sem motivo, o ramo dos
  -- novos leva o lote inteiro e o dos preservados não casa nenhuma linha.
  if v_motivo is not null then
    v_coluna_motivo := ', lost_reason = $4';
    v_filtro_novos := ' and l.status is distinct from ''lost''';
    v_filtro_preservados := 'l.status = ''lost''';
  end if;

  return query execute format($f$
  with alvo as (
    select l.id,
           l.stage_id    as from_stage_id,
           l.pipeline_id as pipeline_id,
           -- A ordem do lote no destino é a ordem em que ele estava no quadro:
           -- etapa, depois posição. `id` só desempata para o resultado ser
           -- determinístico (dois cards podem legitimamente empatar hoje —
           -- é justamente o estado que a migration 0209 deixa de produzir).
           row_number() over (order by l.stage_id, l.position_in_stage, l.id) as ordem
      from public.crm_leads l
     where l.organization_id = $1
       and l.id = any($2)
  ),
  novos as (
    update public.crm_leads l
       set stage_id          = $3,
           -- O TOPO da etapa (issue #3461): o lote inteiro encosta ACIMA do
           -- primeiro card e mantém entre si a ordem de origem. $5 é esse
           -- primeiro card; $6, o tamanho do lote. Etapa vazia ($5 nulo) cai
           -- no `coalesce` e ocupa 1000, 2000, … como um card criado à mão.
           position_in_stage = coalesce($5 - (($6 - a.ordem + 1) * 1000), a.ordem * 1000),
           updated_at        = now()%s
      from alvo a
     where l.id = a.id
       and l.organization_id = $1%s
    returning l.id, a.from_stage_id, a.pipeline_id
  ),
  preservados as (
    update public.crm_leads l
       set stage_id          = $3,
           position_in_stage = coalesce($5 - (($6 - a.ordem + 1) * 1000), a.ordem * 1000),
           updated_at        = now()
      from alvo a
     where l.id = a.id
       and l.organization_id = $1
       and %s
    returning l.id, a.from_stage_id, a.pipeline_id
  )
  select n.id, n.from_stage_id, n.pipeline_id from novos n
  union all
  select p.id, p.from_stage_id, p.pipeline_id from preservados p
  $f$, v_coluna_motivo, v_filtro_novos, v_filtro_preservados)
  using p_organization_id, p_lead_ids, p_stage_id, v_motivo, v_min, v_total;
end;
$$;

comment on function public.fn_mover_leads_em_lote(uuid, uuid[], uuid, text) is
  'Move um lote de leads para uma etapa dando a cada um posição DISTINTA no TOPO da coluna de destino (issue #3461): o lote encosta acima do primeiro card (`min - 1000` por card, na ordem em que estava no quadro) e não mais abaixo do último (`max + 1000`), que era o motivo de a conversa transferida do Inbox aparecer no fim. Etapa vazia continua nascendo em 1000, 2000, … Existe porque gravar a mesma position_in_stage em N linhas quebra o midpoint() do arrasto seguinte (prev === next → NaN) e deixa a ordem do quadro indefinida. `p_lost_reason` (0263, issue #917) grava o motivo da perda na MESMA escrita quando a etapa de destino é de perda — sem ele a CHECK crm_leads_lost_reason_required recusava o lote inteiro com 23514; a coluna só entra na escrita quando há motivo, para não revalidar o valor que já estava na linha. #2887: a coluna só entra na escrita de quem NÃO estava perdido (`status is distinct from ''lost''`) — o negócio que já estava perdido é movido por um segundo ramo sem a coluna, e preserva o motivo dele. Devolve uma linha por card movido, com a etapa de ORIGEM, para o handler emitir a atividade de timeline de cada um.';

revoke all     on function public.fn_mover_leads_em_lote(uuid, uuid[], uuid, text) from public;
revoke execute on function public.fn_mover_leads_em_lote(uuid, uuid[], uuid, text) from anon;
grant  execute on function public.fn_mover_leads_em_lote(uuid, uuid[], uuid, text)
  to authenticated, service_role;
