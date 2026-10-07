---
impacto: nada_mudou
secao: adicionado
titulo: Base para o agente de IA chamar um servidor MCP externo (ainda sem tela de cadastro)
---
Um servidor MCP externo registrado pela instalação passa a ser enxergado e
chamado pelo agente: a descoberta fala o contrato MCP (`initialize`,
`tools/list`, `tools/call`) pelo cliente do próprio `@modelcontextprotocol/sdk`,
com o cabeçalho de autenticação em toda requisição. As ferramentas anunciadas
entram no turno AO LADO das compiladas e passam pelo MESMO `wrapMcpTool`, então
auditoria, papel e escopo valem para elas — a recusa do ERP (um `403`) sobe como
falha auditada e volta em texto para o modelo, porque a permissão continua
morando no servidor, onde o dado está.

O desenho da revisão do mantenedor, ponto a ponto:

- **Quem cadastra é o dono da instalação** (`platform admin`), pela mesma regra
  das extensões, e o gate de permissão vem ANTES da validação de forma. O
  registro continua POR ORGANIZAÇÃO: a linha gravada é a da organização da
  sessão e o runtime lê pelo `organization_id` do run, nunca por um id do corpo.
- **A chave sai do jsonb para colunas cifradas** (migration `0580`, apêndice
  idempotente no `baseline.sql`): `organizations.settings` era entregue pela RLS
  a todo membro, inclusive `viewer`. Agora é AES-256-GCM nas colunas
  `mcp_externo_chave_*`; o cadastro devolve só os últimos 4, e o endpoint segue no
  bolso de sempre (merge em dois níveis).
- **Anti-SSRF em três peças** no caminho de chamada (`assertSafeOutboundUrl`,
  `assertDestinoResolvidoSeguro` e `redirect: "manual"` dentro do
  `allowlistedFetch`, com allowlist nascida do host cadastrado) e já no
  cadastro do endereço.
- **Nada de segredo no endereço**: querystring, fragmento ou credencial embutida
  não é registrável, e a trilha de auditoria e o log levam SÓ o host.
- **Cada agente escolhe as próprias ferramentas**, pelo `tool_ids` da versão, no
  prefixo estável `mcp_externo:<leitura|escrita>:<nome>`; o editor do agente tem
  uma action de listagem pronta que devolve os ids, um por marca aceita (a tela do editor ainda não a usa).
- **Desligado por padrão**: sem registro, ou com registro mas sem escolha no
  agente, o catálogo é o de sempre e nenhuma rede é aberta (a descoberta só
  acontece quando o agente escolheu ao menos uma remota); a escolha nasce
  vazia.
- **Durante conversa só entra leitura de verdade**: a remota só conta como `read`
  quando o servidor anuncia `annotations.readOnlyHint === true` E quem administra
  marcou `leitura`; o resto sai `write` e cai na conferência de escopo do turno
  (`escrita_sem_escopo_do_turno`). Até existir identificação forçada do contato
  na chamada, turno com contato nenhum carrega servidor remoto — Conversador e
  Operador.

Sem registro nada muda: o catálogo compilado segue sendo a única fonte do turno
e nenhuma chamada de rede é aberta. Servidor registrado fora do ar também não
derruba o turno — ele volta sem as ferramentas remotas, com o motivo no log.
Esta fatia entrega a base REGISTRÁVEL + INVOCÁVEL, ainda sem porta na tela:
nenhuma tela chama a action de cadastro nem a de listagem, então nenhuma
instalação muda de comportamento com esta versão. A tela de cadastro, a
escolha das ferramentas no editor do agente e os limites ficam para depois.
Fora de conversa (turno sem contato), uma ferramenta marcada como escrita
executa no servidor remoto; durante conversa, não.

Contribuição de @webtecnica (PR #2204, Refs #2147).
