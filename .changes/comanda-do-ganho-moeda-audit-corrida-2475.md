---
impacto: nada_mudou
secao: corrigido
titulo: Comanda do ganho: moeda certa, audit da abertura e corrida fechada
---

A comanda aberta ao arrastar um negócio para **Ganho** recebe quatro
consertos, sobre as pendências anotadas na issue #2475 (a numeração abaixo
é deste texto, não a da issue).

**1. A moeda do negócio decide se a comanda nasce.** Antes, o valor era copiado
do lead para a comanda sem ninguém perguntar em que moeda ele estava — dois
centavos de moedas diferentes no mesmo relatório, sem aviso. Agora o handler
compara a moeda do negócio com a da organização (`moedaDaOrganizacao`) e, quando
as duas estão DECLARADAS e diferentes, a comanda não abre: o desfecho é
`skipped` com `moeda_divergente:<a>!=<b>` no `detail`, que é o registro do
porquê. **A pegadinha do `DEFAULT 'BRL'`**: `crm_leads.currency` nasce `'BRL'`
por conta do banco, então uma organização em EUR cujo lead nunca escolheu moeda
carrega `'BRL'` sem ser escolha nenhuma — a guarda trata esse default como
"não declarado" e **não pula**. Uma comparação ingênua (`lead.currency !==
org.currency`) derrubaria o financeiro inteiro dessa organização. Nenhuma
decisão aqui é de auditoria: quem pula, pula, e o `detail` diz.

**2. A abertura da comanda ganha rastro no audit.** O handler emite
`comanda.aberta` (ação que já existia em `lib/audit/actions.ts`) com
`resourceType: sale`, o id da comanda e `origem: ganho_no_kanban` no metadata —
com a abertura antes invisível no painel de auditoria, não havia como saber
quando e por qual caminho uma conta a receber nasceu. Quando a comanda é
pulada, o audit não registra nada (não abriu). O evento não carrega ator: o
`event_log` não guarda quem arrastou.

**3. A corrida entre o worker e o `drain-loop` fecha com índice.** Duas linhas
`lead.won` do mesmo negócio — fechar, reabrir, fechar — em instâncias
diferentes passavam as duas pela trava de leitura do vínculo (a primeira ainda
não gravou) e abriam duas comandas para o mesmo negócio. A migration **0582**
cria o índice único parcial `uniq_comanda_do_ganho_por_negocio` em
`crm_lead_links (organization_id, lead_id) WHERE link_kind = 'comanda_no_ganho'`
— o índice anterior trazia `target_id` na chave, e por isso não segurava duas
comandas. A limpeza de duplicatas pré-existente mantém a mais antiga e só toca
`crm_lead_links`, nenhum dinheiro é apagado. No código, o vínculo agora é
gravado **antes** do item: a perdedora da corrida (23505) cancela a comanda
vazia que acabou de abrir (`cancel_reason = 'corrida_do_ganho'`; `sales`
cancela, nunca apaga) e devolve `ja_existia` com a comanda da vencedora, em vez de virar um
`falhou` que o dreno reagendaria para sempre — a ordem é o que decide o tamanho
do estrago.

**4. O retry agora completa o que faltava.** O vínculo é gravado mesmo quando o
insert do item falha (duplicar dinheiro é pior que um item faltando), mas o
desfecho seguinte era `ja_existia` → `ok` → a comanda ficava com total 0 para
sempre e ninguém avisado. A repetição agora lê a comanda: aberta e sem item, reinsere o
valor (sem abrir segunda comanda e sem consultar a numeração); com item, ou já
finalizada ou cancelada, não mexe em nada. Limitação conhecida: o gatilho é
"comanda vinculada, aberta e sem item", e isso inclui o item que o operador
removeu à mão de uma comanda ainda aberta — a repetição seguinte do mesmo
evento o devolveria.

Dois arquivos de teste (`comanda-do-ganho.test.ts` e
`comanda-do-ganho.handler.test.ts`) cobrem os quatro itens. Os testes que
vigiam a mudança foram sabotados (código antigo no lugar) e ficaram vermelhos;
os de controle de não-regressão seguem verdes nos dois sentidos.

Refs #2475

Contribuição de @webtecnica.
