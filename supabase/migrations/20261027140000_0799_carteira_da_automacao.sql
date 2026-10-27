-- manifest: **A passagem SDR → Closer passa a ter porta para a CARTEIRA do cliente (#3514).** A ação de automação `assign_owner` trocava só o dono do NEGÓCIO; `contacts.carteira_user_id` continuava com o SDR, então o aviso de "cliente da sua carteira falou" seguia indo para quem já não atende e o negócio seguinte daquele cliente nascia no nome dele. A única porta de escrita da carteira (`fn_definir_carteira_do_cliente`, 0622) exige ator humano manager+, e uma automação não tem sessão: sem esta migration, "passar a carteira" só existiria por UPDATE direto — a terceira régua de dono que a #3479 mede. Aqui a MESMA função aceita `p_actor` NULO **somente** com `p_origem = 'automacao'`, e recusa a origem `automacao` a quem chega COM ator (bicondicional, nas duas direções). O nome entra no vocabulário da CHECK `contacts_carteira_origem_vocabulario` (é o que separa "o sistema fez, a pedido desta regra" de "uma pessoa fez, com o papel dela" — `atribuicao_automatica` continua sendo o rodízio). Tudo o mais do corpo da 0622 fica idêntico: só o service_role executa (EXECUTE revogado de public/anon/authenticated); o dono candidato continua obrigado a ser membro ativo `agent`/`manager`/`admin` da MESMA organização (viewer e revogado não contam); a adoção dos negócios abertos sem dono continua na mesma transação. Sem coluna, sem backfill, sem mudança de assinatura (5 argumentos, `create or replace`), idempotente.
-- 0799 — a carteira do cliente ganha a origem `automacao` e a ator-nulo do servidor
--
-- ─── O defeito ───────────────────────────────────────────────────────────────
--
-- O funil passa o cliente de um vendedor para outro num ponto conhecido (SDR
-- agenda a reunião, Closer assume). A automação move o NEGÓCIO; a carteira do
-- CONTATO e as conversas ABERTAS ficam com o SDR. O sistema não reconhece o que
-- ele mesmo fez: o negócio é do Closer e o cliente é do SDR.
--
-- As conversas têm porta e ela é usada sem mudança nenhuma daqui
-- (`fn_conversation_assign`, com `p_reason='transfer'`). A carteira não tinha:
-- a 0622 fechou a escrita na função DEFINER justamente porque a policy de
-- UPDATE de `contacts` é cega a papel (um Atendente se punha como dono pela
-- REST), e a função exige ator humano manager+.
--
-- ─── Por que a porta é ESTA e não uma função nova ──────────────────────────
--
-- Duas réguas de dono já custaram caro neste repositório (a #3479 mediu papel ×
-- escopo de dados). Uma função `fn_carteira_da_automacao` seria a TERCEIRA: ela
-- teria de repetir a validação do dono candidato, a coerência do trio e a
-- adoção dos negócios sem dono — quatro cópias da mesma regra para envelhecer
-- em ritmos diferentes. Em vez disso, a regra que faltava é UMA: quem não tem
-- ator é o sistema, e o sistema se identifica pela origem.
--
--   * ator nulo + `automacao`  → passa (é a automação);
--   * ator nulo + qualquer outra origem → `carteira_sem_ator` (42501), como hoje;
--   * ator humano + `automacao` → `carteira_origem_invalida` (22023): a origem
--     do sistema não é rótulo que uma pessoa escolhe para o próprio ato.
--
-- A autorização do caminho sem ator é o GRANT: a função só é executável por
-- `service_role` (medido: `revoke ... from public, anon, authenticated`), e é por
-- onde a rota da carteira e o motor de automação já falam com o banco. O papel
-- do dono candidato continua sendo checado do mesmo jeito — a automação não
-- ganha o direito de entregar a carteira a um viewer.

-- ─── (A) o vocabulário da origem ────────────────────────────────────────────

alter table public.contacts
  drop constraint if exists contacts_carteira_origem_vocabulario;
alter table public.contacts
  add constraint contacts_carteira_origem_vocabulario
  check (carteira_origem is null
         or carteira_origem in ('manual', 'importacao', 'atribuicao_automatica', 'automacao'));

-- ─── (B) a porta única, agora com a vez do sistema ──────────────────────────

create or replace function public.fn_definir_carteira_do_cliente(
  p_org uuid,
  p_actor uuid,
  p_contact uuid,
  p_dono uuid,
  p_origem text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := p_actor;
  v_papel text;
  v_dono_papel text;
  v_contato_org uuid;
  v_origem text := coalesce(p_origem, 'manual');
begin
  if v_origem not in ('manual', 'importacao', 'atribuicao_automatica', 'automacao') then
    raise exception 'carteira_origem_invalida' using errcode = '22023';
  end if;

  if v_ator is null then
    -- #3514: sem ator humano, quem grava é o SISTEMA — e só ele. A automação
    -- não tem sessão; o que a identifica é a origem `automacao`, que a função
    -- recusa a quem chega com ator (senão a origem do sistema virava um rótulo
    -- que qualquer manager escolhia para esconder o próprio ato).
    if v_origem <> 'automacao' then
      raise exception 'carteira_sem_ator' using errcode = '42501';
    end if;
  end if;

  if p_org is null or p_contact is null then
    raise exception 'carteira_parametro_invalido' using errcode = '22023';
  end if;

  if v_ator is not null then
    -- Quem muda: manager+ da MESMA organização (e membro aceito, não revogado).
    select uo.role into v_papel
      from public.user_organizations uo
     where uo.user_id = v_ator
       and uo.organization_id = p_org
       and uo.accepted_at is not null
       and uo.revoked_at is null;
    if v_papel is null or v_papel not in ('manager', 'admin') then
      raise exception 'carteira_permissao_negada'
        using errcode = '42501',
              detail = 'Só manager e admin definem a carteira do cliente.';
    end if;
    if v_origem = 'automacao' then
      raise exception 'carteira_origem_invalida'
        using errcode = '22023',
              detail = 'A origem automacao é do servidor, sem ator: quem chama com ator grava manual ou atribuicao_automatica.';
    end if;
  end if;

  select c.organization_id into v_contato_org
    from public.contacts c
   where c.id = p_contact;
  if v_contato_org is null then
    raise exception 'carteira_contato_nao_encontrado' using errcode = '22023';
  end if;
  if v_contato_org <> p_org then
    raise exception 'carteira_contato_de_outra_organizacao' using errcode = '42501';
  end if;

  if p_dono is not null then
    -- Quem CONTA: membro ativo da mesma org com papel de trabalho. `viewer` e
    -- membro revogado não contam — o cliente volta ao fluxo normal.
    select uo.role into v_dono_papel
      from public.user_organizations uo
     where uo.user_id = p_dono
       and uo.organization_id = p_org
       and uo.accepted_at is not null
       and uo.revoked_at is null;
    if v_dono_papel is null or v_dono_papel not in ('agent', 'manager', 'admin') then
      raise exception 'carteira_dono_invalido'
        using errcode = '22023',
              detail = 'O dono precisa ser membro ativo da mesma organização com papel agent, manager ou admin.';
    end if;
  end if;

  update public.contacts
     set carteira_user_id = p_dono,
         carteira_origem = case when p_dono is null then null else v_origem end,
         carteira_definida_em = case when p_dono is null then null else now() end,
         updated_at = now()
   where id = p_contact
     and organization_id = p_org;

  -- Os negócios ABERTOS sem dono do contato vão para o dono da carteira; os que
  -- já têm dono não mudam (ninguém perde carteira por causa de uma carteira).
  if p_dono is not null then
    update public.crm_leads
       set owner_user_id = p_dono,
           owner_kind = 'user',
           assigned_at = coalesce(assigned_at, now())
     where organization_id = p_org
       and contact_id = p_contact
       and status = 'open'
       and owner_user_id is null
       and owner_agent_id is null;
  end if;

  return p_dono;
end;
$$;

revoke execute on function public.fn_definir_carteira_do_cliente(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_definir_carteira_do_cliente(uuid, uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
