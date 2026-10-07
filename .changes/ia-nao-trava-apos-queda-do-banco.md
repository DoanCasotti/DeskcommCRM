---
impacto: nada_mudou
secao: corrigido
titulo: A IA volta a responder sozinha quando a conexão com o banco morre sem aviso
---

Quando o servidor do banco sumia sem responder nem fechar a conexão (o que
suspeitamos ter acontecido num reinício do Supabase), o agente de IA podia parar
de responder no WhatsApp e só voltar depois de alguém reiniciar o `worker` na
VPS. Nada indicava o problema: a checagem de saúde seguia dizendo que estava tudo
bem, e os pedidos de resposta ficavam acumulando sem ninguém pegar.

Agora são duas proteções. Se a conexão morreu sem aviso, o sistema percebe em
cerca de 20 segundos; se o banco travou e não responde, a consulta desiste em um
minuto. Nos dois casos a consulta presa termina com erro em vez de esperar para
sempre, e a IA tenta de novo e retoma sozinha. Crédito: @rafaelbatistazz.
