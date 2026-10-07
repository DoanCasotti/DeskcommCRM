---
impacto: capacidade_nova
secao: adicionado
titulo: Planos de tarefa — a sequência de tarefas salva uma vez e aplicada a cada negócio por uma regra
---

Em **Tarefas › Planos** (pelo hub do CRM e pelo ⌘K) quem é gerente ou administrador monta uma sequência de tarefas uma vez: título, prazo em dias contado a partir da aplicação, prioridade e responsável de cada passo (o dono do negócio ou uma pessoa da equipe). No editor de regras, a ação nova **Aplicar um plano de tarefas ao negócio** escolhe um dos planos cadastrados e cria as tarefas na ordem, todas de uma vez. Um plano que já foi aplicado ao negócio não é aplicado de novo: a aplicação fica registrada na linha do tempo do negócio. Se algum passo não pode virar tarefa (o negócio não tem dono, ou o título fica vazio sem o nome do contato), o plano não cria tarefa nenhuma e a regra mostra o motivo no histórico. Os planos ficam nas configurações da empresa; não há nada a configurar na atualização.

Contribuição de @webtecnica (#2213), a partir da issue #1752 de @franceschini-lucas.
