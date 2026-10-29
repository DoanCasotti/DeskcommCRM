# Voz no CRM — ElevenLabs para ouvir e falar

**Data:** 2026-10-29
**Estado:** em execução — ver "Progresso" abaixo
**Escopo aprovado:** o agente RESPONDE em áudio (TTS) e OUVE o áudio do cliente (STT/Scribe).
**Fora de escopo:** ligação telefônica em tempo real (Conversational AI) — exige telefonia
(SIP/Twilio) e um caminho de áudio ao vivo que não existe no produto. Projeto separado.

---

## 0. O que já existe (e não deve ser reconstruído)

A integração é menor do que parece, porque três encaixes já estão prontos:

| Encaixe | Onde | O que dá de graça |
|---|---|---|
| Interface de transcrição plugável | `lib/messaging/media/transcription.ts:7` | `TranscriptionProvider` tem um método só. Um provedor novo é um arquivo, não uma refatoração. |
| Caminho de saída de áudio | `app/api/v1/messages/_handler.ts:750` → `lib/channels/adapters/waha.ts:220` → `lib/waha/media-send.ts:31` | Mensagem com `type='audio'` + `media_storage_path` já vira signed URL de 600s e sai como `sendVoice` com `convert: true`. **O MP3 do ElevenLabs serve** — a exigência de OGG/OPUS do WhatsApp é resolvida pelo WAHA, não por nós. |
| Provedor como vocabulário aberto no banco | migration `0127` + apêndice do baseline (`supabase/baseline.sql:11106`) | `ai_provider_credentials.provider = 'elevenlabs'` entra **sem migration nova**. O CHECK que travava em `anthropic\|openai\|google` já foi derrubado nos dois caminhos (banco novo e clone atualizado). |

E um quarto, que decide o desenho da Frente A: `ai_purpose_bindings`
(`supabase/baseline.sql:11025`) já guarda `purpose + provider + credential_id + model_id + base_url`
por organização, e `workers/media-derive-worker.ts` já sabe lê-la (`lerBindingDoPonto`). A escolha
"quem ouve o áudio" não precisa de tabela nem de mecanismo novo — precisa de uma linha ali.

---

## 1. Decisão 1 — onde a chave do ElevenLabs é cadastrada

**O problema.** `app/api/v1/ai/credentials/route.ts:36` valida com `z.enum(IDS_DE_PROVEDOR)`,
derivado de `lib/ai/pontos/provedores.ts`. Aquela lista é casada com o registry de execução por
`tests/unit/provedores-x-registry.test.ts`, que reprova nos dois sentidos — e o sentido que nos
pega é o primeiro: *"a tela ofereceria um provedor que toda chamada recusaria com
`llm_provider_unknown`"*. ElevenLabs não executa turno de conversa. Ele **não pode** entrar
naquela lista.

**Opções consideradas:**

- **(a) Pôr `elevenlabs` em `PROVEDORES` + uma entrada no registry de chat.** Rejeitada: seria
  uma entrada que mente. O segundo assert daquele teste existe exatamente para impedir "provedor
  que o sistema sabe usar e ninguém consegue escolher"; o primeiro, para impedir o inverso.
  Satisfazer os dois com um ElevenLabs falso de chat é desativar a garantia, não cumpri-la.
- **(b) Vocabulário de SERVIÇO, irmão do de chat.** → **escolhida.**
- **(c) Tabela `voice_provider_credentials` própria.** Rejeitada por DIRC (`CLAUDE.md:133`):
  duplicaria AES-256-GCM (`lib/crypto/aes_gcm`), RLS, o trigger de auditoria
  (`trg_ai_provider_credentials_audit`) e a view `ai_provider_credentials_safe`. Quatro cópias de
  coisa sensível para evitar uma lista nova.

**O desenho de (b):**

1. Novo `lib/ai/pontos/provedores-de-servico.ts` — mesma forma de `ProvedorSuportado`, mesmo
   `as const satisfies` (o comentário em `provedores.ts:107` explica por que a anotação de tipo
   apagaria a garantia). Primeira entrada: `elevenlabs`, com `ondePegarAChave`,
   `prefixoDaChave: "sk_…"` e `quandoUsar` escrito para quem não acompanha o mercado.
2. Novo `tests/unit/provedores-de-servico-x-registry.test.ts` — espelho do teste de chat, casando
   a lista com o registry de serviços de voz. Sem ele a garantia só muda de lugar; o cabeçalho do
   teste existente já diz que *"garantia transferida sem guarda é garantia perdida"*.
3. `app/api/v1/ai/credentials/route.ts:36` — `z.enum([...IDS_DE_PROVEDOR, ...IDS_DE_SERVICO])`.
   Mesma mudança em `app/actions/onboarding/chaveDaIa.ts:44` **se** a voz entrar no onboarding
   (recomendo que não entre — ver §5).
4. `app/app/ai/credentials/_components/AddCredentialDialog.tsx` — segundo grupo no select
   ("Serviços de voz"), não um item solto no meio dos modelos de conversa.
5. `lib/ai/provider-validators.ts` — `validateElevenLabsKey`: `GET https://api.elevenlabs.io/v1/voices`
   com header `xi-api-key`, timeout 5s, sem retry, 401/403 → `auth_failed_401`. Devolve as **vozes**
   no campo `models` — reusa `models_available` sem coluna nova, e é o que a tela precisa listar
   para o operador escolher a voz.

**Dois lugares que NÃO mudam, e é decisão, não esquecimento:**

- `lib/ai/agents/validation.ts:21` (`PROVIDERS = IDS_DE_PROVEDOR`) — o provider da versão
  publicada do agente é o de **conversa**. ElevenLabs ali seria um agente que não responde.
- `lib/instalacao/ambiente.ts:70` e `lib/instalacao/prova-de-credito.test.ts` — iteram
  `IDS_DE_PROVEDOR` para exigir prova de crédito no instalador. Voz é opt-in pós-instalação; exigir
  chave de voz para instalar o CRM seria cobrar por algo que a maioria não vai ligar.

---

## 2. Decisão 2 — "ponto fixo" precisa virar "ponto com opções"

`lib/ai/pontos/registro.ts:400` declara `transcricao_de_audio` como `fixo`, com
`usa: { provider: "openai", modelId: "whisper-1" }`. O comentário logo acima conta por que o `usa`
existe: sem ele a tela anunciava `claude-sonnet-5` naquele ponto, contradizendo o próprio texto ao
lado. `fixo` hoje significa duas coisas ao mesmo tempo: *"não é um modelo de conversa"* e
*"não há o que escolher"*.

Com ElevenLabs, a segunda deixa de ser verdade: passam a existir **dois serviços de transcrição**,
e o operador precisa poder escolher — sem que a tela volte a oferecer modelo de chat ali.

**Mudança:** `fixo` ganha `opcoes?: readonly { provider: string; modelId: string; rotulo: string }[]`.
Ausente = travado como hoje. Presente = a tela mostra um select curto entre serviços, e a escolha
grava em `ai_purpose_bindings` (`purpose='transcricao_de_audio'`). Nenhum mecanismo novo: o
`lerBindingDoPonto` do worker já lê aquela tabela, e o `base_url` da linha cobre quem aponta para
um serviço compatível próprio.

Isso vale para os dois pontos da frente — transcrição e síntese.

---

## 3. Frente A — Ouvir (ElevenLabs Scribe)

A menor das duas. Nenhuma migration.

1. **`lib/messaging/media/transcription-elevenlabs.ts` (novo).** Implementa
   `TranscriptionProvider`. **Não é OpenAI-compatível** — por isso arquivo novo e não `baseUrl`
   diferente no `apiTranscriptionProvider`: `POST https://api.elevenlabs.io/v1/speech-to-text`,
   header `xi-api-key` (não `Authorization: Bearer`), multipart com `file` + `model_id=scribe_v1`,
   resposta `{ text }`. O `extFor(mime)` de `transcription.ts:22` é reusável e deve ser exportado em
   vez de copiado.
2. **`workers/media-derive-worker.ts`** — o bloco `let openaiKey` (a resolução que hoje é
   hardcoded em OpenAI, com o comentário sobre o 401 medido nesta VPS) passa a consultar o binding
   de `transcricao_de_audio` antes de cair no padrão OpenAI. Uma branch, no padrão que o binding da
   visão já usa logo acima — inclusive o `catch` que avisa e cai no padrão em vez de derrubar a
   derivação inteira.
3. **O aviso da Central precisa virar provider-aware.** Hoje
   `avisarMidiaNaoLida(orgId, "áudio", "falta uma chave da OpenAI para transcrever")` é texto fixo.
   Numa org que escolheu ElevenLabs, esse aviso manda o operador buscar a chave errada — que é a
   mesma classe de defeito que o comentário do próprio arquivo descreve ("mandá-lo caçar um
   problema que não existe").
4. **Vídeo vem de graça.** `lib/messaging/media/video-derive.ts:60` usa o mesmo `transcriber`.

**Ganho esperado:** precisão melhor em português e diarização (quem falou o quê) em áudio de mais
de uma pessoa. A diarização é informação nova no derivado — vale decidir se entra no texto ou é
descartada; sugiro descartar no MVP, porque o derivado alimenta prompt e falante rotulado infla
token sem o agente ter o que fazer com ele.

---

## 4. Frente B — Falar (TTS)

Aqui estão as decisões que separam a feature boa da embaraçosa.

### 4.1 O ponto e o módulo

- Novo ponto em `lib/ai/pontos/registro.ts`: `id: "sintese_de_voz"`, `rotulo: "Falar com o
  cliente em áudio"`, `papel: "atender"`, `fixo` com `opcoes`,
  `emissor: "lib/ai/voz/sintetizar.ts"`, `sintomaDeFalha` escrito em consequência de negócio.
  **Guardado por `tests/unit/pontos-de-ia-completude.test.ts`**, que varre o AST procurando
  propriedades `purpose:` literais — então o emissor precisa passar `purpose: "sintese_de_voz"`
  de verdade, e o ponto entra **no mesmo commit** da chamada.
- Novo `lib/ai/voz/sintetizar.ts`: `POST /v1/text-to-speech/{voice_id}` → Buffer MP3.
- Config por org em `organizations.settings->'voz'` (`voice_id`, `model_id`, `stability`,
  `similarity_boost`), lida a cada chamada — mesmo padrão de `settings->'llm'` descrito em
  `lib/agent-engine/edge/llm/credentials.ts:17`: trocar voz é UPDATE, sem restart nem deploy.
  Sem migration: é jsonb que já existe.

### 4.2 Decisão 3 — quando o agente fala em vez de escrever

- (a) **Sempre áudio.** Rejeitada: mata a busca no histórico, obriga o vendedor a ouvir a conversa
  inteira para assumir o atendimento, e irrita o cliente que está em reunião.
- (b) **Espelhar o cliente** — fala se a última mensagem recebida foi áudio. O dado já existe
  (`messages.type='audio'`). Zero config.
- (c) **O modelo decide por tool.** Rejeitada no MVP: dá ao modelo uma decisão que gasta dinheiro.
- (d) **Regra do operador, por versão publicada do agente.** → **escolhida**, com (b) como default.

Colunas em `ai_agent_versions`: `voz_enabled boolean not null default false` e
`voz_quando text` (`'nunca' | 'espelhar' | 'sempre'`, default `'espelhar'`). O precedente é
`video_frames_enabled` (migration 0058), já usado em `workers/media-derive-worker.ts` para
exatamente isto: feature que custa dinheiro nasce desligada e por versão publicada.

CHECK nessa coluna **é seguro aqui** e vai entrar, contra a regra geral de vocabulário aberto
(`CLAUDE.md:139`): a coluna é nova, então nenhum clone pode ter linha que a viole, e o `update.sh`
sem `ON_ERROR_STOP` não tem como quebrar nela. A razão fica escrita no cabeçalho da migration,
como a doutrina exige.

### 4.3 O texto falado não é o texto enviado

A resposta do agente tem emoji, markdown, link e preço. Lido em voz alta, isso é lixo:
"asterisco asterisco promoção", "agá tê tê pê dois pontos barra barra".

Novo `lib/ai/voz/texto-falavel.ts`, puro e testável: remove emoji e marcação, troca
`R$ 1.234,56` por "mil duzentos e trinta e quatro reais e cinquenta e seis centavos", tira URL
(áudio não tem link clicável — o link fica na mensagem de texto), e aplica um **teto de
caracteres** (custo é por caractere, e nota de voz de três minutos ninguém ouve).

### 4.4 A conversa não pode ficar sem texto

Se o agente manda só áudio, a thread perde o `body` — e com ele a busca, o export LGPD, o
classificador de follow-up e todo ponto downstream que lê texto. Ficam cegos sem erro nenhum.

**Desenho:** a linha outbound é `type='audio'` com `media_storage_path`, **e** carrega o texto
falado em `media_derived_text`, preenchido no insert. A thread continua legível, a busca continua
achando, e nada downstream precisa saber que aquilo nasceu como voz. *A conferir na
implementação:* hoje `media_derived_text` só é escrito pelo worker de inbound; preencher no
outbound é uso novo da mesma coluna, não coluna nova.

### 4.5 Idempotência — o crash não pode pagar duas vezes

`send_ledger` dá intenção exactly-once e entrega at-least-once
(`lib/agent-engine/edge/crm/send-message.ts:19`). Se a síntese rodar **antes** do ledger, um crash
entre síntese e envio re-sintetiza no retry e paga de novo.

**Regra:** sintetizar e subir para o Storage **dentro** do estado `requested`, gravando o
`media_storage_path` no ledger; o retry que encontra o path **reusa o arquivo** e nunca rechama o
ElevenLabs. Teste dedicado — é o tipo de furo que só aparece na fatura.

### 4.6 O teto de gastos não vê voz hoje — e isso é o defeito de origem do repo

`ai_budgets` é em centavos e o gate soma `llm_calls.cost_cents`.
`lib/agent-engine/edge/llm/pricing.ts:15` só conhece prefixos `claude-*` e devolve `null` para
desconhecido — e `null` **não consome teto** (está escrito no cabeçalho do arquivo). Ou seja: se a
voz entrar sem preço, ela gasta **fora do teto**, e a tela de orçamento segue dizendo que a
organização está protegida.

Isso é textualmente o defeito que o cabeçalho de `credentials.ts:11` chama de *"defeito de
origem"* — a tela editando um lugar e o enforcement lendo outro. Repeti-lo numa feature nova, com
o diagnóstico já escrito no repo, não é opção.

**Então:** `pricing.ts` ganha um caminho de preço **por caractere** (USD por 1k chars) e a chamada
de voz é registrada em `llm_calls` com `cost_cents` preenchido. Mais um teste:
`tests/unit/voz-nao-gasta-fora-do-teto.test.ts`.

### 4.7 Chave de plataforma: declarar nos DOIS envs

`ELEVENLABS_API_KEY` entra em `.env.example` como fallback de plataforma (espelho de
`openaiApiKey` em `LlmEdgeConfig`). **E precisa ser declarada em `lib/env.ts` e em
`lib/agent-engine/env.ts`** — `loadEnv` do worker *remove* o que o schema dele não declara, e o
cabeçalho de `credentials.ts:60` registra que esse exato esquecimento fez a chave "funcionar no app
e sumir no worker", que é onde a IA gasta. `lib/agent-engine/env.ts:26-42` tem os três precedentes,
cada um com o comentário do bug que o originou.

### 4.8 Clonagem de voz: fora do MVP

Só vozes de catálogo do ElevenLabs. Clonar a voz de um vendedor exige consentimento escrito dele e
cria um ativo biométrico dentro do CRM — decisão de produto e de LGPD, não de implementação, e não
vai de carona nesta frente.

---

## Progresso (atualizado 2026-10-29)

| Fase | Status | Onde |
|---|---|---|
| 1 — vocabulário de serviço + credencial + validador | ✅ feito | commit `396778807`→`31d1a5f28`, branch `feature/voz-elevenlabs-fase1` |
| 2 — `fixo.opcoes` (mecanismo de menu) | ✅ feito | commit `d684a1f9f`, junto com a 3 |
| 3 — Scribe plugado no worker | ✅ feito | commit `d684a1f9f` |
| 4 — preço por caractere (`custoDeVozCents`) | ✅ feito (sem migration) | `lib/agent-engine/edge/llm/pricing.ts` — **ainda não commitado** |
| 5 — `texto-falavel.ts` + `sintetizar.ts` | ✅ feito, **deliberadamente ÓRFÃOS** | `lib/ai/voz/` — **ainda não commitado** |
| 6 — colunas `voz_enabled`/`voz_quando` + regra de quando falar + envio idempotente | ⬜ não iniciado | — |
| 7 — tela de configuração | ⬜ não iniciado | — |

**Por que a Fase 5 está "órfã" de propósito.** `sintetizarVoz()` e `custoDeVozCents()` são reais,
testados e chamáveis — mas **nada no runtime do agente os chama ainda**, e o ponto `sintese_de_voz`
**não foi registrado** em `lib/ai/pontos/registro.ts`. Registrar o ponto ou gravar custo em
`llm_calls` sem um chamador de produção seria o defeito que
`tests/unit/pontos-de-ia-completude.test.ts` existe para pegar (ponto/gasto que nenhuma rota, cron
ou tool aciona). A Fase 6 é quem dá o chamador real — e é também a fase mais arriscada que falta:
migration nova, e a mudança entra bem no meio do caminho de ENVIO (`sendTurnMessage` →
`sendMessageHandler` → WAHA), que hoje só sabe mandar `type: 'text'`/`'template'` no turno do
agente — nunca mídia. Avaliado nesta sessão e **deliberadamente deixado para uma rodada própria**,
em vez de emendado às pressas no mesmo commit das Fases 4/5.

**O que a Fase 6 precisa, concretamente** (para quem continuar):
1. Migration: `ai_agent_versions.voz_enabled boolean not null default false`,
   `voz_quando text not null default 'espelhar' check (voz_quando in ('nunca','espelhar','sempre'))`
   — precedente: `video_frames_enabled` (migration 0058).
2. `SendMessageInput` (ou o chamador da tool `send_message`) precisa saber decidir "falar em vez de
   escrever" ANTES de montar o payload, e `sendMessageHandler`/o adapter precisam aceitar
   `type: 'audio'` + `media_storage_path` vindo do AGENTE (hoje esse branch só existe para mídia
   subida pelo OPERADOR em `app/api/v1/messages/_handler.ts`).
3. Idempotência (plano §4.5): sintetizar + subir pro Storage **dentro** do estado `requested` do
   `send_ledger`, gravando `media_storage_path` ali — um crash entre síntese e envio não pode
   resintetizar (e pagar) de novo no replay.
4. O texto FALADO (`textoFalavel(body)`) não é o `body` da mensagem — a thread precisa manter o
   texto original em `media_derived_text` (plano §4.4), senão busca/LGPD/classificador de
   follow-up ficam cegos.
5. SÓ NESSE COMMIT o ponto `sintese_de_voz` entra em `registro.ts`, com `emissor` apontando pro
   código que de fato chama — nunca antes.

---

## 5. Ordem de execução

| Fase | Entrega | Migration? |
|---|---|---|
| **1** | Vocabulário de serviço + validador + tela de credenciais + teste de pareamento (§1) | não |
| **2** | `fixo.opcoes` + a tela do ponto escolher serviço (§2) | não |
| **3** | **Frente A completa** — Scribe plugado, aviso provider-aware (§3) | não |
| **4** | Preço por caractere em `pricing.ts` + log em `llm_calls` (§4.6) | não |
| **5** | `texto-falavel.ts` + `sintetizar.ts` + ponto `sintese_de_voz` (§4.1, §4.3) | não |
| **6** | Colunas `voz_enabled`/`voz_quando` + regra de quando falar + envio idempotente (§4.2, §4.5) | **sim** |
| **7** | Tela: ligar a voz na versão do agente, escolher voz, ouvir prévia | não |

Fase 1→3 entrega valor sozinha (ouvir melhor) e pode ir para produção antes de qualquer linha de
TTS. **Fase 4 vem antes da 5 de propósito:** medir o gasto antes de habilitar o gasto.

Onboarding (`app/onboarding/setup-ai/_form.tsx`) **não** muda: voz é configuração pós-instalação.

---

## 6. Gates (Definition of Done — `CLAUDE.md:481`)

- `pnpm gov:verify` verde (typecheck, lint, `lint:channels`, `lint:role-rank`, `test:unit`).
  `lint:channels` **não** reclama de "elevenlabs": o padrão proibido
  (`scripts/lint-channels.pattern.ts`) cobre provedor de **canal** (`waha`, `meta_cloud`,
  `zernio`), e serviço de IA é nomeado livremente em `lib/ai/` — como `openai` e `anthropic` já
  são. Conferido, não suposto.
- Migration da Fase 6 versionada **+ linha no `supabase/migrations/MANIFEST.md` + apêndice
  idempotente no `supabase/baseline.sql`**. Sem o apêndice a mudança **não chega aos
  self-hosters** (`CLAUDE.md:440`).
- Testes novos: pareamento de serviços, `texto-falavel`, voz-dentro-do-teto, voz-idempotente.
- Spec e2e registrada em `SPECS_PARTE_*` ou em `FORA_DO_CI` **com motivo escrito** —
  `tests/unit/e2e-cobertura-completa.test.ts` reprova spec órfã.
- Evidência visual em `.superpowers/evidence/` (doutrina de QA visual, `CLAUDE.md:384`): áudio
  recebido virando texto, e nota de voz saindo no WhatsApp real.

---

## 7. Riscos

1. **Custo por caractere surpreende.** Mitigado pela Fase 4 vir antes da 5, e pelo default
   `voz_enabled=false`.
2. **`convert: true` do WAHA faz ffmpeg no contêiner do WAHA.** Volume alto de voz mexe na carga
   de lá, não na nossa — medir antes de prometer campanha em áudio.
3. **Latência.** TTS soma ~1-3s ao turno. Com `voz_quando='espelhar'` só paga quem já mandou
   áudio, e esse cliente tolera mais.
4. **Diarização do Scribe inflando o derivado** (§3) — descartar no MVP.
