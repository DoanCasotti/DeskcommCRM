---
impacto: nada_mudou
secao: corrigido
titulo: "Agenda: o painel de marcação não fica mais num mês que acabou enquanto a tela está aberta"
---

Em **Novo agendamento**, o calendário já pulava para o mês seguinte quando o mês de hoje não tinha horário livre. Mas a decisão era tomada uma vez, com a pergunta "existe vaga neste mês?" sobre os dados já carregados — e a resposta era "sim" enquanto sobrasse um horário publicado, mesmo já vencido. Numa sexta-feira qualquer, às 16h28 o painel ainda enxergava o 17h30 de hoje e ficava no mês; vinte minutos depois esse horário entrava no aviso mínimo de 60 minutos, o mês inteiro ficava sem um dia clicável, e a tela não revia a decisão: "outubro de 2026", todo apagado, com o próximo horário escondido atrás da seta.

Agora a abertura pergunta pelo **resto da janela**: um horário que o relógio já passou não conta como vaga, e se o mês em tela não tem nenhum horário agendável o painel abre no próximo mês que tiver — no máximo três saltos seguidos, e sem nenhum mês adiante com vaga ele fica onde está, com o aviso de "nenhum horário livre". A mesma regra reabre a decisão quando o mês acaba **com a tela aberta**. Quem foi para o mês seguinte à mão continua nele, e quem voltou à mão para o mês de hoje fica nele até ele realmente esgotar.
