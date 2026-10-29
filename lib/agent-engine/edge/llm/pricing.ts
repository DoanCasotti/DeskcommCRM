/**
 * Tabela de preços versionada (stack.md §2: usage × pricing.ts → llm_calls.cost_cents).
 * ÚNICO lugar com preço de modelo no repo.
 *
 * Fonte: https://docs.claude.com/en/docs/about-claude/pricing (conferida 2026-07);
 * cache write cotado no TTL 1h (2× input) — o TTL adotado pela doutrina de caching
 * (CLAUDE.md regra 15); cache read = 0.1× input.
 *
 * Modelo fora da tabela → custo NULL (desconhecido): mais honesto que inventar 0 —
 * o budget soma coalesce(cost_cents, 0), então modelo sem preço não consome teto;
 * quem habilitar um modelo novo para uma org adiciona a linha de preço aqui.
 */

/** USD por MILHÃO de tokens; match por prefixo do id (cobre sufixo de data do vendor). */
const USD_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheWrite1h: number }> = {
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite1h: 6 },
  'claude-haiku-4': { input: 1, output: 5, cacheRead: 0.1, cacheWrite1h: 2 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite1h: 30 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Custo em CENTS (fracionário; coluna numeric) ou null se o modelo não tem preço
 * conhecido. `inputTokens` aqui é o TOTAL do usage do SDK — a parcela cacheada é
 * descontada e cobrada pela tarifa de cache.
 */
export function costCents(model: string, usage: TokenUsage): number | null {
  const priceKey = Object.keys(USD_PER_MTOK).find((prefix) => model.startsWith(prefix));
  if (priceKey === undefined) {
    return null;
  }
  const p = USD_PER_MTOK[priceKey];
  if (p === undefined) {
    return null; // inalcançável (key veio de Object.keys); satisfaz noUncheckedIndexedAccess
  }
  const noCacheInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const usd =
    (noCacheInput * p.input +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite1h +
      usage.outputTokens * p.output) /
    1_000_000;
  return usd * 100;
}

/**
 * Síntese de voz (ElevenLabs) é cobrada por CARACTERE, não por token — unidade
 * diferente de tudo acima, por isso uma função própria em vez de forçar
 * `TokenUsage`.
 *
 * Fonte: https://elevenlabs.io/pricing (conferida 2026-10-29). A página pública
 * não divulga USD/crédito direto — só plano em USD + créditos/mês — e os
 * planos NÃO convergem para uma taxa única: Creator (US$11 / 121k créditos)
 * destoa dos demais, provavelmente por desconto de lançamento/anual, enquanto
 * Starter, Pro, Scale e Business concordam entre si em ≈US$0,000165/crédito.
 * É ESSA taxa — a que bate entre quatro planos independentes, não a que destoa
 * de um — que esta tabela usa. 1 caractere = 1 crédito no modelo padrão
 * (`eleven_multilingual_v2`); modelos "Flash/Turbo" custam metade do crédito
 * por caractere, mas este produto não expõe escolha de modelo de voz ainda —
 * quando expuser, este arquivo precisa de uma linha por modelo, não uma
 * constante só.
 *
 * ⚠️ Preço de API de terceiro muda sem aviso e esta tabela não se atualiza
 * sozinha — quem revisar a cobrança real de uma instalação deve CONFERIR a
 * página antes de confiar neste número, não só confiar no código.
 */
const USD_POR_CREDITO_ELEVENLABS = 0.000165;

/** Custo em CENTS de sintetizar `caracteres` de texto em voz — nunca null: é a única tarifa que este arquivo conhece para voz hoje. */
export function custoDeVozCents(caracteres: number): number {
  return Math.max(0, caracteres) * USD_POR_CREDITO_ELEVENLABS * 100;
}
