---
impacto: capacidade_nova
secao: adicionado
titulo: Prospecção aceita lista própria (CSV/XLSX) com prévia do que entra e do que fica de fora
---

Em CRM › Prospecção, ao lado de "Buscar empresas", a aba "Usar minha planilha" cria uma campanha
em rascunho a partir de uma lista do próprio operador: .csv (UTF-8 ou o Latin-1 que o Excel grava,
separado por vírgula ou ponto e vírgula) ou .xlsx (primeira aba). O layout é fixo e o modelo para
baixar já vem no cabeçalho empresa;telefone;site;segmento;cidade;email;instagram — só nome e
telefone são obrigatórios, e o telefone vira E.164 (BR sem DDI recebe +55).

O botão "Conferir a lista antes de importar" mostra o que entra e o que fica de fora com o motivo
de cada linha: sem nome, sem telefone, telefone inválido, repetido na própria planilha, já é
contato do CRM e excluído a pedido do titular (LGPD). A conferência não cria campanha e não gasta
crédito. A supressão da LGPD não depende de o operador importar: quem pediu para sair é barrado
antes de qualquer escrita e de novo pelo gatilho do banco.

Importada a lista, a campanha nasce como rascunho concluído, com origem de importação (sem busca
no Google Maps e sem custo de provedor) e daí em diante é a prospecção de sempre: seleção,
auditoria de site, prévia da abordagem, agente, ritmo, pedido de parar e funil. Até 500 linhas por
importação; reenviar o mesmo arquivo não duplica nem cria uma segunda campanha.

Nada muda para quem só usa a busca: nenhuma migração de banco, nenhuma dependência nova e o
provedor de busca continua o mesmo. Crédito: @webtecnica.
