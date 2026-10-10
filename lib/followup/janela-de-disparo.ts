import type { SupabaseClient } from "@supabase/supabase-js";

import { proximaAberturaDoFollowup } from "@/lib/agent-engine/agent/janela-de-followup";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

/**
 * As DUAS réguas de horário do follow-up, agora também no atalho INLINE
 * (`enviarTextoFixoPendente` — o "sem cron e sem agent-worker").
 *
 * Esse atalho chama `sendMessageHandler` direto e por isso bypassava
 * `executarTurnoDoAgente` — e junto com ele as duas réguas que o turno aplica
 * antes de falar com o cliente:
 *
 *  1. a janela de DISPARO do canal (`channel_knobs.window_start_hour/end_hour`,
 *     a tela de Proteção de envio). Aqui ela vem de
 *     `lib/automation/janela-do-canal.ts` — a MESMA leitura e a MESMA régua que
 *     `send_whatsapp_message` / `send_ai_message` já usam, no fuso que o
 *     próprio canal declara.
 *  2. a faixa PRÓPRIA do follow-up (`ai_agent_versions.followup.send_window`,
 *     seg–sex 8h–18h no caso medido), de
 *     `lib/agent-engine/agent/janela-de-followup.ts` — a MESMA que
 *     `followup-turn.ts` aplica no turno do agent-worker, no fuso da
 *     ORGANIZAÇÃO (o fuso da faixa não mora na faixa: é o da org, sempre).
 *
 * Sem estas duas, o texto fixo saía de madrugada (medido na issue: 8 envios de
 * um mesmo fluxo entre 01h18 e 05h31 de Brasília, com a janela 8h–18h, nenhum
 * `action_deferred` gravado). Mensagem automática para cliente novo à noite é
 * sinal de robô no número sem API oficial.
 *
 * Os motivos são os MESMOS códigos do caminho do worker — `outside_window`
 * (cadeia anti-ban) e `followup_send_window` (faixa do agente) — para que o
 * dossiê e qualquer medição de produção tenham um vocabulário só.
 *
 * Falha ABERTA na faixa: sem agente/versão publicada no enrollment (dado
 * legado) a regra não existe e o envio segue, como
 * `followupPublicadoDoEnrollment` já faz no worker. Falha FECHADA na leitura:
 * erro de banco SOBE (o job volta pra `pending`) — follow-up é contato
 * proativo, e se não dá para saber se o operador autorizou este horário é mais
 * seguro tentar de novo do que mandar fora da faixa.
 */
export interface AdiamentoPorJanela {
  /** Instante da próxima abertura — vira `run_after` do job e `until` do enrollment. */
  until: Date;
  /** `outside_window` (canal) ou `followup_send_window` (faixa do agente). */
  reason: string;
}

export interface EntradaDaJanela {
  organizationId: string;
  contactId: string;
  conversationId: string;
  enrollmentId: string;
  /** Injetável para teste — o default é o relógio real. */
  agora?: Date;
}

/** `null` = a conversa não tem canal associado (não há janela do canal a consultar). */
async function canalDaConversa(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  contactId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("conversations")
    .select("channel_session_id")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const sessao = (data as { channel_session_id?: string | null } | null)?.channel_session_id;
  return typeof sessao === "string" && sessao !== "" ? sessao : null;
}

/**
 * A configuração PUBLICADA do follow-up do agente pinado no enrollment — o
 * espelho em Supabase de `followupPublicadoDoEnrollment`
 * (`lib/agent-engine/agent/janela-de-followup.ts`, que fala `pg`): as MESMAS
 * três leituras, com o mesmo desfecho `null` quando agent/version não existe.
 */
async function followupPublicado(
  admin: SupabaseClient,
  organizationId: string,
  enrollmentId: string,
): Promise<unknown | null> {
  const { data: inscricao, error: falhaInscricao } = await admin
    .from("followup_enrollments")
    .select("agent_id")
    .eq("organization_id", organizationId)
    .eq("id", enrollmentId)
    .maybeSingle();
  if (falhaInscricao) throw new Error(falhaInscricao.message);
  const agentId = (inscricao as { agent_id?: string | null } | null)?.agent_id;
  if (typeof agentId !== "string" || agentId === "") return null;

  const { data: agente, error: falhaAgente } = await admin
    .from("ai_agents")
    .select("published_version_id")
    .eq("organization_id", organizationId)
    .eq("id", agentId)
    .maybeSingle();
  if (falhaAgente) throw new Error(falhaAgente.message);
  const versionId = (agente as { published_version_id?: string | null } | null)?.published_version_id;
  if (typeof versionId !== "string" || versionId === "") return null;

  const { data: versao, error: falhaVersao } = await admin
    .from("ai_agent_versions")
    .select("followup")
    .eq("organization_id", organizationId)
    .eq("id", versionId)
    .maybeSingle();
  if (falhaVersao) throw new Error(falhaVersao.message);
  return (versao as { followup?: unknown } | null)?.followup ?? null;
}

/**
 * `null` = pode enviar AGORA. Caso contrário, o instante da próxima abertura e
 * qual das duas réguas mandou adiar — nesse caso o envio NÃO pode sair.
 *
 * A ordem importa para o motivo registrado: o canal é a régua que o operador
 * vê na tela de Proteção de envio e que vale para QUALQUER disparo; a faixa do
 * agente é a permissão MAIS ESTREITA por enrollment. Cada uma é avaliada com a
 * sua própria abertura, então o que volta é a abertura da régua que fechou.
 */
export async function decidirAdiamentoPorJanela(
  admin: SupabaseClient,
  entrada: EntradaDaJanela,
): Promise<AdiamentoPorJanela | null> {
  const agora = entrada.agora ?? new Date();

  const sessionId = await canalDaConversa(
    admin,
    entrada.organizationId,
    entrada.conversationId,
    entrada.contactId,
  );
  if (sessionId !== null) {
    // `adiarAteAJanelaAbrir` devolve a ISO da próxima abertura (com o jitter
    // anti-ban embutido) ou `null` quando a janela está aberta.
    const abertura = await adiarAteAJanelaAbrir(admin, entrada.organizationId, sessionId, agora);
    if (abertura !== null) return { until: new Date(abertura), reason: "outside_window" };
  }

  const followup = await followupPublicado(admin, entrada.organizationId, entrada.enrollmentId);
  if (followup === null) return null;

  const { data: org } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", entrada.organizationId)
    .maybeSingle();
  const fuso = fusoUtilizavel((org as { timezone?: string | null } | null)?.timezone);

  const proximaAbertura = proximaAberturaDoFollowup(followup, fuso, agora);
  if (proximaAbertura === null) return null;
  return { until: proximaAbertura, reason: "followup_send_window" };
}
