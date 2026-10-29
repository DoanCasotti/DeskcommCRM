/**
 * SÍNTESE DE VOZ, IDEMPOTENTE POR (job_id, seq) — Fase 6a do plano de voz
 * (`docs/superpowers/plans/2026-10-29-voz-elevenlabs.md`).
 *
 * Síntese custa por caractere e tem a MESMA forma de risco que o envio em si
 * (ver o cabeçalho de `send-ledger.ts`): um crash entre chamar o ElevenLabs e
 * subir o MP3 não pode fazer o retry pagar a síntese de novo pela mesma
 * mensagem lógica. Este módulo resolve a identidade da linha do ledger
 * reusando `resolverChaveDoLedger` — a MESMA função que `sendWithLedger`
 * ainda vai chamar depois, para o envio propriamente dito — então as duas
 * chamadas convergem para a MESMA linha sem duplicar a lógica de
 * create/find/rotate em dois lugares que pudessem divergir.
 *
 * ⚠️ QUEM CHAMA `resolverCaminhoDeVoz` PRECISA PASSAR O MESMO `body` (o texto
 * FALADO) que depois vira `Intent.body` da chamada a `sendWithLedger` — os
 * dois hashes (aqui e lá) precisam bater, senão `sendWithLedger` veria um
 * `body_hash` diferente do que esta função gravou e trataria como uma
 * tentativa lógica NOVA (rotacionando a linha, que limpa `media_storage_path`
 * — ver o comentário em `rotate()`), re-sintetizando à toa.
 *
 * Este módulo NÃO decide se o agente deve falar, não registra custo em
 * `llm_calls`, e `sintese_de_voz` NÃO está em `lib/ai/pontos/registro.ts` —
 * essa decisão (Fase 6b) ainda não tem um chamador de produção. Ver a seção
 * "Progresso" do plano.
 */
import { bodyHash, resolverChaveDoLedger, type Intent, type LedgerStore } from "./send-ledger";
import { sintetizarVoz, type SintetizarVozInput } from "@/lib/ai/voz/sintetizar";

export interface ResolverCaminhoDeVozInput {
  store: LedgerStore;
  /** Identidade do ledger — mesma de `sendWithLedger`. */
  identidade: Omit<Intent, "body">;
  /** O texto FALADO (já passou por `textoFalavel`) — é o que o hash do ledger cobre. */
  textoFalado: string;
  voz: Omit<SintetizarVozInput, "texto">;
  /**
   * Quem sabe gravar no Storage e devolver o path — injetado para este módulo
   * não conhecer Supabase Storage nem a convenção de nome de arquivo além do
   * contrato (recebe os bytes, devolve o path onde ficaram).
   */
  upload: (audio: Buffer, mimeType: string) => Promise<string>;
}

export interface ResolverCaminhoDeVozResultado {
  mediaStoragePath: string;
  mimeType: string;
  /** Caracteres de `textoFalado` — a unidade que `custoDeVozCents` cobra. */
  caracteres: number;
  /** false quando a síntese já tinha acontecido numa tentativa anterior (retry). */
  sintetizouAgora: boolean;
}

export async function resolverCaminhoDeVoz(
  input: ResolverCaminhoDeVozInput,
): Promise<ResolverCaminhoDeVozResultado> {
  const intent: Intent = { ...input.identidade, body: input.textoFalado };
  const hash = bodyHash(input.textoFalado);
  const resolucao = await resolverChaveDoLedger(input.store, intent, hash);

  if (resolucao.kind === "already_sent" || resolucao.kind === "blocked") {
    // O chamador (sendTurnMessage) decide o que fazer com isto — aqui só se
    // recusa a pagar uma síntese para um envio que já terminou ou foi vetado.
    throw new VozLedgerTerminalError(
      resolucao.kind,
      resolucao.key,
      resolucao.kind === "already_sent" ? resolucao.crmMessageId : null,
    );
  }

  const pathExistente = resolucao.row?.media_storage_path ?? null;
  if (pathExistente) {
    return {
      mediaStoragePath: pathExistente,
      mimeType: "audio/mpeg",
      caracteres: input.textoFalado.length,
      sintetizouAgora: false,
    };
  }

  const { audio, mimeType, caracteres } = await sintetizarVoz({
    ...input.voz,
    texto: input.textoFalado,
  });
  const path = await input.upload(audio, mimeType);
  const pathGravado = await input.store.setMediaPath(input.identidade.tenantId, resolucao.key, path);
  return {
    // `setMediaPath` devolve o que FICOU gravado — se uma corrida (improvável:
    // ver o comentário no store) resolveu antes, é o path DELA que volta, não
    // o nosso, e é o path dela que o envio precisa usar.
    mediaStoragePath: pathGravado,
    mimeType,
    caracteres,
    sintetizouAgora: pathGravado === path,
  };
}

/**
 * A linha do ledger já tem um desfecho TERMINAL (aceita ou vetada) para esta
 * identidade — sintetizar seria pagar por um áudio que não vai a lugar
 * nenhum. O chamador decide: para `already_sent`, não há nada a fazer (a
 * mensagem já saiu); para `blocked`, idem (opt-out).
 */
export class VozLedgerTerminalError extends Error {
  constructor(
    public readonly kind: "already_sent" | "blocked",
    public readonly key: string,
    public readonly crmMessageId: string | null,
  ) {
    super(`síntese de voz recusada: a linha do ledger já está '${kind}'`);
    this.name = "VozLedgerTerminalError";
  }
}
