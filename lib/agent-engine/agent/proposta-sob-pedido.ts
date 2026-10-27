/**
 * PROPOSTA SOB PEDIDO — a prévia assistida continua até propor um texto (#3281).
 *
 * ## O defeito
 *
 * "Sugerir resposta" rodava o MESMO turno do agente automático, com o mesmo
 * prompt e as mesmas regras, e parava na primeira resposta ACEITA
 * (`pararQuando`, `inbound-turn.ts`, ramo `preview?.kind === 'assisted'`). Nada
 * no turno dizia ao modelo que uma PESSOA pediu o texto. Quando o prompt manda
 * ficar em silêncio — não responder a mensagem automática, a saudação sem
 * pedido, a rajada que ele julgou sem o que responder — o rascunho herdava o
 * silêncio: `failed` / `no_candidate` e a tela dizendo que o agente decidiu não
 * responder. Medido numa instalação real (issue #3281): o operador clicou, viu
 * o mesmo silêncio do turno automático e teve de escrever à mão — justamente no
 * momento em que ele sabia mais que a regra.
 *
 * ## A distinção que conserta
 *
 * No turno AUTOMÁTICO, o silêncio é uma decisão do agente: ele fala sozinho, e
 * calar é uma saída legítima. No CLIQUE de uma pessoa, a decisão já foi tomada
 * por ela — ela quer um texto. **Propor ≠ enviar.**
 *
 * Por isso o turno assistido ganha UM passo a mais, com a instrução abaixo, e
 * só quando a parada foi do ENVIO automático (silêncio de regra, opt-out,
 * janela, ritmo) — nunca quando foi da GERAÇÃO (saída truncada, teto de
 * passos), que é falha e continua aparecendo como falha.
 *
 * ## O que NÃO afrouxa
 *
 * - O turno automático não muda: ele continua obedecendo o silêncio do prompt, e
 *   é isso que o controle deste módulo prende.
 * - A cadeia `before_send` continua valendo na proposta (o `send_message` da
 *   prévia passa pelos mesmos gates) e **de novo** no envio aprovado
 *   (`approved-reply.ts` → `runBeforeSend`). Nada sai sem clique.
 * - Guardrail de CONTEÚDO (preço/negociação, promessa fora de tabela, alegação
 *   clínica, vocabulário interno, LGPD, mídia que não preparou) NÃO é razão de
 *   envio: com um desses no caminho a prévia segue vazia, porque ali o texto é
 *   o problema, e não a hora de mandar. O conjunto é ALLOWLIST: código
 *   desconhecido conta como conteúdo — o padrão é calar, nunca propor.
 *
 * Vive fora do `inbound-turn.ts` pelo mesmo motivo de `desfecho-da-previa.ts`:
 * decisão PURA (entram sinais, sai sim/não) tem como ser testada sozinha, e uma
 * regra que só existe no closure de um turno de 6.400 linhas não tem.
 */

/**
 * A instrução do PEDIDO HUMANO — vai como mensagem do turno, ao lado da
 * abertura, só no passo extra da prévia assistida.
 *
 * Três coisas de propósito:
 * 1. diz que quem pediu foi uma PESSOA (é a informação que faltava no turno);
 * 2. nomeia as regras de silêncio como sendo do turno automático, sem pedir que
 *    o modelo as ignore para decidir CONTEÚDO;
 * 3. deixa escrito que a cadeia de envio continua valendo por cima — o modelo
 *    não pode ler isto como autorização para furar guardrail.
 */
export const INSTRUCAO_DO_PEDIDO_HUMANO =
  'Uma pessoa da equipe clicou em "Sugerir resposta" e pediu um texto para esta conversa. ' +
  'Ela já decidiu que quer propor algo ao cliente, e quem revisa, aprova e envia é ela. ' +
  'Escreva o texto que ela poderia enviar, mesmo que uma regra do seu prompt mande ficar em silêncio ' +
  'num turno automático (por exemplo: não responder a mensagem automática, à saudação sem pedido, ou ' +
  'à conversa que você julgou sem o que responder). ' +
  'Chame send_message agora, no idioma da conversa, com o texto final — uma mensagem só. ' +
  'Se o melhor for mesmo não responder, escreva ainda assim o texto que você enviaria e diga em uma ' +
  'frase o motivo, para quem vai revisar. ' +
  'As regras de conteúdo e a cadeia de envio continuam valendo por cima: nada chega ao cliente sem a ' +
  'aprovação de quem pediu.';

/**
 * Os impedimentos que são do MOMENTO DO ENVIO, não do texto.
 *
 * Allowlist, e curta de propósito. Cada código aqui responde "esta mensagem pode
 * sair AGORA?" — e nenhum deles diz que o texto está errado:
 *
 * - `contato_bloqueado` — o contato pediu para não receber (stop/opt-out);
 * - `messaging_window_closed` — a janela de 24 h do canal fechou;
 * - `outside_window`, `warmup_cap`, `daily_cap` — janela anti-ban, aquecimento e
 *   tetos do número (`pacing/engine.ts`).
 *
 * Ficam FORA (e por isso a proposta não nasce quando um deles está no caminho):
 * `commercial_requires_human`, `promise_out_of_table`, `promise_semantic`,
 * `case_promise_without_case`, `clinical_claim`, `internal_vocabulary_leak`,
 * `lgpd_anonymized`, `lgpd_missing_legal_basis`, `contato_interno`,
 * `disclosure_required`, `agenda_stall_sem_ferramenta`, `midia_sem_fotos` e
 * qualquer código de mídia — nesses o problema é o que se diria (ou a quem), e
 * propor o texto seria contornar o guardrail pela porta dos fundos.
 */
export const IMPEDIMENTOS_SO_DO_ENVIO: readonly string[] = [
  'contato_bloqueado',
  'messaging_window_closed',
  'outside_window',
  'warmup_cap',
  'daily_cap',
];

/** Este impedimento é do envio (e não do conteúdo)? Desconhecido ⇒ NÃO. */
export function impedimentoEhSoDoEnvio(codigo: string): boolean {
  return IMPEDIMENTOS_SO_DO_ENVIO.includes(codigo);
}

/** Os sinais que a prévia assistida já mediu quando o turno termina. */
export interface SinaisDoPedidoHumano {
  /** Respostas ACEITAS pela cadeia neste turno (candidatos da prévia). */
  readonly candidatos: number;
  /** Códigos dos impedimentos que a cadeia registrou. */
  readonly impedimentos: readonly string[];
  /** Mensagens do cliente ainda sem resposta — sem isto não há o que propor. */
  readonly inboundsSemResposta: number;
  /** `finish_reason = 'length'` na primeira chamada ou na correção: FALHA. */
  readonly saidaTruncada: boolean;
  /** `max_steps` esgotado na primeira chamada ou na correção: FALHA. */
  readonly tetoDePassosAtingido: boolean;
}

/**
 * A prévia assistida pede o passo da proposta?
 *
 * Só quando o turno terminou SEM texto por uma razão do envio automático:
 *
 * - já há candidato → nada a pedir (o caminho feliz não paga chamada extra);
 * - não há inbound sem resposta → não há o que propor. A prévia fica vazia como
 *   hoje, e é o CONTROLE de "nada a responder";
 * - a geração parou no teto de tokens ou no teto de passos → é falha, e falha
 *   continua sendo falha (`output_truncated` / `max_steps_exhausted`);
 * - algum impedimento é de CONTEÚDO → o texto é o problema, não a hora de
 *   mandar: a prévia fica vazia e o motivo aparece na tela.
 */
export function previaContinuaAtePropor(p: SinaisDoPedidoHumano): boolean {
  if (p.candidatos > 0) return false;
  if (p.inboundsSemResposta <= 0) return false;
  if (p.saidaTruncada || p.tetoDePassosAtingido) return false;
  return p.impedimentos.every(impedimentoEhSoDoEnvio);
}
