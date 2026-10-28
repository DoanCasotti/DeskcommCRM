/**
 * A TELEFONIA ESTÁ EM USO NESTA ORGANIZAÇÃO? — o sinal que o item de menu precisa
 * (issue #1290).
 *
 * ─── Por que a pergunta é esta, e não "o módulo está ligado?" ─────────────────
 *
 * "Telefonia ligada" na INSTALAÇÃO é o profile `telefonia` do `COMPOSE_PROFILES`,
 * lido pelo Docker quando os contêineres sobem. O aplicativo NÃO enxerga isso
 * (`lib/recursos-opcionais/catalogo.ts`, `telefonia_sip`: `ler: () => "nao_verificado"`),
 * e inventar uma variável de ambiente aqui acertaria na máquina de
 * desenvolvimento e erraria no self-host — o defeito que a issue pede para não
 * reproduzir.
 *
 * O que o app enxerga é o que a ORGANIZAÇÃO fez: a linha de `voip_trunk_settings`.
 * Ela só existe depois que alguém abriu `/app/settings/voip-trunk` e salvou o
 * tronco — ou seja, depois de decidir usar telefonia de verdade. Sem tronco não
 * há chamada possível: a tela de Chamadas não teria o que mostrar, e o menu
 * estaria oferecendo uma porta que não funciona — exatamente o relato da issue.
 *
 * ─── O custo, declarado ──────────────────────────────────────────────────────
 *
 * É UMA leitura por chave primária (`organization_id` é a PK da tabela), dentro
 * do `Promise.all` que o shell de `/app` já dispara — não é uma consulta em
 * série no caminho quente. É o preço que a issue aceita ao pedir o filtro.
 *
 * ─── A regra de leitura ──────────────────────────────────────────────────────
 *
 * Falha fechada, como `modulosLigados()` e `capacidadesLigadas()`: erro de banco,
 * exceção ou ausência de linha = DESLIGADA. Nunca lança — roda no layout de
 * `/app`, e um throw ali derruba todas as telas.
 *
 * Sem cache de processo de propósito: o tronco muda quando o cliente salva a
 * tela, e um menu que só acorda no próximo deploy repetiria o defeito que este
 * arquivo fecha. Se aparecer medido num perfil, memoiza-se aqui e em mais
 * nenhum lugar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export async function telefoniaEmUso(
  db: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("voip_trunk_settings")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      logger.warn("telefonia em uso: leitura recusada — tratando como desligada", {
        organization_id: organizationId,
        detalhe: (error as { message?: string }).message,
      });
      return false;
    }
    return !!data;
  } catch (erro) {
    logger.warn("telefonia em uso: leitura falhou — tratando como desligada", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return false;
  }
}
