---
impacto: nada_mudou
secao: corrigido
titulo: O segredo usado pelo agendador deixa de aparecer na lista de processos do servidor
---

O agendador das rotinas automáticas passa a ler o segredo de autorização de um
arquivo interno do próprio contêiner, acessível só por ele, em vez de levá-lo na
linha de comando de cada rotina. Assim o valor deixa de aparecer na lista de
processos do servidor enquanto uma rotina está em execução.

Nada muda na configuração: o segredo continua vindo do mesmo `INTERNAL_SECRET`
do `.env`, e a atualização normal já traz a imagem nova do agendador.

Quem preferir trocar o segredo por precaução pode fazê-lo como sempre, editando
`INTERNAL_SECRET` no `.env` e recriando os serviços. Vale saber que, quando
`INVITE_TOKEN_SECRET` não está definido, esse mesmo valor assina os links de
convite: trocá-lo invalida os convites ainda não aceitos, que precisariam ser
reenviados.
