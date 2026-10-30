/**
 * RESPOSTA A MENSAGEM AUTOMÁTICA NÃO É LEAD FRIO — issue #3720.
 *
 * ─── O defeito, medido na instalação do relato (v1.94.0) ────────────────────
 *
 * 28/10 09h07: a automação de aniversário manda "parabéns" para um cliente
 * antigo, com compras. 09h11: ele responde só com um coração. 09h11: o CRM cria
 * o lead na primeira etapa de Vendas e a IA responde. 10h16, 15h18 e 29/10
 * 09h21: o fluxo "Lead novo sem retorno" (gatilho de SILÊNCIO, 60–180 min)
 * manda follow-ups puxando assunto de venda. A sequência só parou porque
 * alguém a cancelou à mão na Fila.
 *
 * O gatilho de silêncio mede uma coisa só: há quanto tempo o CLIENTE não
 * escreve. Ele não pergunta POR QUE a última mensagem do cliente existe — e a
 * resposta muda tudo. Quem escreveu "❤️" ao parabéns não é um lead que sumiu:
 * é alguém que respondeu à única coisa que NÓS dissemos. Insistir com venda em
 * cima disso é prospecção em cima de relacionamento, e nenhuma configuração de
 * fluxo resolve hoje (as condições do fluxo testam etapa, etiqueta, passos,
 * desfecho e data de campo — nenhuma olha a origem da conversa).
 *
 * ─── A regra ───────────────────────────────────────────────────────────────
 *
 * A ÚLTIMA mensagem recebida do contato é RESPOSTA a uma mensagem automática
 * nossa quando, na mesma conversa, a última mensagem que saiu ANTES dela foi
 * enviada pela automação (`messages.sent_via = 'automation'`). Nesse caso a
 * varredura não o inscreve: o fluxo de silêncio não é a resposta certa para
 * quem acabou de ser parabenizado.
 *
 * Três precisões, e cada uma tem um caso que a justifica:
 *
 *  1. "A última que saiu antes dela", não "alguma automática na janela". Se
 *     entre a automação e a resposta saiu uma mensagem de gente ou da IA, o
 *     cliente respondeu a ESSA — não à automação. Comparar por ordem (e não por
 *     "existe automação perto") é o que evita poupar o fluxo de quem está no
 *     meio de um atendimento de verdade.
 *  2. a resposta vale por 48 h (`JANELA_DA_RESPOSTA_A_AUTOMACAO_MS`). A
 *     automação de 09h07 e a resposta de 09h11 são o mesmo acontecimento; um
 *     "obrigado" seis dias depois do parabéns já é outra conversa. É também o
 *     número que a própria issue sugere para a janela de resposta, e o teto que
 *     impede o efeito colateral de excluir para sempre quem respondeu uma vez.
 *  3. a conversa é a do INBOUND VENCEDOR — a mesma que o silêncio mediu.
 *     Responder em outro número não faz da última mensagem dele uma resposta à
 *     automação (mesma leitura de `respondido` em `silence-sweep.ts`).
 *
 * ─── Por que a porta é `messages.sent_via`, e não a campanha ───────────────
 *
 * A marca de que um lead nasceu de campanha JÁ existe (`origemDeCampanhaDaConversa`
 * + `marcaDaOrigem` em `lib/campanhas/origem-do-lead.ts`, gravadas no card por
 * `lib/leads/nascimento-do-lead.ts`), e é ela que responde "de onde veio este
 * card". Mas campanha é só UMA das remetentes automáticas: aniversário
 * (`app/api/v1/cron/contact-birthdays`), lembrete de agenda, pesquisa
 * pós-atendimento e aviso de automação saem pelo motor de regras e não têm
 * linha em `campaign_recipients` — foi justamente o aniversário do relato.
 *
 * As duas famílias se encontram num lugar só: `sendMessageHandler`, que
 * classifica a autoria (`origemDaMensagem`, `app/api/v1/messages/_handler.ts:187`,
 * a decisão da #652). Campanha (`lib/campanhas/rodada.ts:640`) e automação
 * (`lib/automation/actions/send-whatsapp.ts`) entram as duas com
 * `actor: { type: "webhook_source" }` e saem gravadas como `automation`. Ler
 * essa marca cobre as duas famílias com UMA consulta, em vez de duas leituras
 * (a de campanha por conversa + a de automação) que divergiriam no primeiro
 * remetente novo. `ai` e `system` ficam de fora de propósito: `ai` é a própria
 * perseguição que o fluxo faz, e `system` é aviso de serviço (handoff), não
 * campanha nem automação.
 *
 * ─── Por que só o gatilho de silêncio ──────────────────────────────────────
 *
 * É o único que fala pelo RELÓGIO, e é o único que trata "não falou" como
 * desinteresse. Fluxo por etapa, por caso ou por retorno responde a um fato que
 * a equipe escolheu (o card mudou de etapa, o caso abriu, o retorno venceu) e
 * continua valendo — o corte é na INSCRIÇÃO da varredura, não no motor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Quanto tempo depois da mensagem automática a resposta ainda conta como
 * resposta a ELA. 48 h: o bastante para quem lê no dia seguinte, curto o
 * bastante para não transformar um parabéns de semana passada em passe livre
 * permanente para o contato.
 */
export const JANELA_DA_RESPOSTA_A_AUTOMACAO_MS = 48 * 3_600_000;

/** O silencioso candidato: o inbound que o gatilho leu como silêncio e onde ele chegou. */
export interface CandidatoDoSilencio {
  contactId: string;
  conversationId: string;
  /** `sent_at` do inbound mais recente do contato — o mesmo instante que o silêncio mediu. */
  inboundAt: string;
}

/** Membro do `in(...)`: a lista viaja na URL do PostgREST, que tem fim. */
const LOTE_DE_CONVERSAS = 100;
/** Teto de linhas por resposta do PostgREST (`max-rows`); páginas maiores voltam cortadas em silêncio. */
const PAGINA_DE_MENSAGENS = 1000;
const DIA_MS = 86_400_000;

interface FatoDaConversa {
  contactId: string;
  inboundMs: number;
  /** `sent_at` do último outbound ANTERIOR à resposta; ausente = não houve outbound antes dela. */
  ultimoOutboundMs?: number;
  ultimoOutboundVia?: string | null;
}

/**
 * Os contatos que só responderam a uma mensagem automática nossa.
 *
 * Nunca decide sozinho sobre a conversa: recebe os candidatos que o silêncio já
 * qualificou (o sweep chama isto DEPOIS de `loadSilentContactIds`), e devolve o
 * subconjunto que não deveria entrar no fluxo. Falha de leitura LANÇA — o
 * chamador trata como falha do pointer, e a varredura seguinte tenta de novo;
 * engolir o erro aqui inscreveria a pessoa que o conserto existe para poupar.
 */
export async function contatosQueSoResponderamAAutomacao(
  admin: SupabaseClient,
  orgId: string,
  candidatos: CandidatoDoSilencio[],
): Promise<Set<string>> {
  const porConversa = new Map<string, FatoDaConversa>();
  for (const candidato of candidatos) {
    const inboundMs = Date.parse(candidato.inboundAt);
    if (!Number.isFinite(inboundMs)) continue;
    const anterior = porConversa.get(candidato.conversationId);
    if (!anterior || inboundMs > anterior.inboundMs) {
      porConversa.set(candidato.conversationId, { contactId: candidato.contactId, inboundMs });
    }
  }
  if (porConversa.size === 0) return new Set();

  // Baldes de UM dia: cada consulta cobre no máximo 72 h (o dia do inbound mais
  // as 48 h anteriores), por mais espalhados que os candidatos estejam. Sem
  // isso, um contato calado há meses esticaria a janela de todos os outros no
  // mesmo lote.
  const baldes = new Map<number, string[]>();
  for (const [conversationId, fato] of porConversa) {
    const balde = Math.floor(fato.inboundMs / DIA_MS);
    const lista = baldes.get(balde) ?? [];
    lista.push(conversationId);
    baldes.set(balde, lista);
  }

  const excluidos = new Set<string>();
  for (const [balde, conversas] of baldes) {
    const desdeIso = new Date(balde * DIA_MS - JANELA_DA_RESPOSTA_A_AUTOMACAO_MS).toISOString();
    const ateIso = new Date(balde * DIA_MS + DIA_MS).toISOString();
    for (let i = 0; i < conversas.length; i += LOTE_DE_CONVERSAS) {
      const lote = conversas.slice(i, i + LOTE_DE_CONVERSAS);
      for (let de = 0; ; de += PAGINA_DE_MENSAGENS) {
        const { data, error } = await admin
          .from("messages")
          .select("conversation_id, sent_via, sent_at")
          .eq("organization_id", orgId)
          .eq("direction", "outbound")
          .in("conversation_id", lote)
          .gte("sent_at", desdeIso)
          .lte("sent_at", ateIso)
          // DESC: a PRIMEIRA linha de cada conversa que não seja posterior à
          // resposta é, por construção, a mensagem imediatamente respondida.
          .order("sent_at", { ascending: false })
          .range(de, de + PAGINA_DE_MENSAGENS - 1);
        if (error) throw new Error(`resposta_a_automacao_query_failed: ${error.message}`);

        const linhas = (data ?? []) as Array<{
          conversation_id: string;
          sent_via: string | null;
          sent_at: string;
        }>;
        for (const linha of linhas) {
          const fato = porConversa.get(linha.conversation_id);
          if (!fato) continue;
          const sentMs = Date.parse(linha.sent_at);
          if (!Number.isFinite(sentMs) || sentMs > fato.inboundMs) continue; // saiu DEPOIS da resposta
          // O MAIOR `sent_at` anterior à resposta, não o da primeira linha da
          // página: a regra é de ordem, e não pode depender da ordem em que o
          // banco devolve as linhas.
          if (fato.ultimoOutboundMs !== undefined && sentMs <= fato.ultimoOutboundMs) continue;
          fato.ultimoOutboundMs = sentMs;
          fato.ultimoOutboundVia = linha.sent_via;
        }
        if (linhas.length < PAGINA_DE_MENSAGENS) break;
      }
    }
  }

  for (const fato of porConversa.values()) {
    if (fato.ultimoOutboundMs === undefined) continue;
    if (fato.ultimoOutboundVia !== "automation") continue;
    if (fato.inboundMs - fato.ultimoOutboundMs > JANELA_DA_RESPOSTA_A_AUTOMACAO_MS) continue;
    excluidos.add(fato.contactId);
  }
  return excluidos;
}
