---
impacto: nada_mudou
secao: corrigido
titulo: "Os crons da prospecção, das campanhas, do histórico e da agenda Google param de consultar o banco quando não há nada para fazer"
---

Instalação parada consumia cota do banco sem ninguém usando: cinco rotas de cron iam ao banco a cada minuto só para descobrir que a fila estava vazia — prospecção sem campanha, campanhas sem campanha, importação de histórico sem importação e agenda Google sem conexão. No plano grátis do Supabase isso é o que enche o projeto e derruba a instalação em `PGRST002`.

Agora essas rotas saem antes de qualquer consulta quando o recurso está desligado. Quem responde é um retrato em memória de quatro perguntas ("tem campanha de prospecção? campanha? importação? conexão Google?"), refeito por UMA consulta a cada cinco minutos para a instalação inteira.

Nada muda para quem usa: com o recurso ligado o cron roda exatamente como antes, e se a leitura do retrato falhar as rotas seguem o caminho normal em vez de parar. Ligar uma campanha ou conectar a agenda vale para o cron em até cinco minutos.

Crédito: @webtecnica.
