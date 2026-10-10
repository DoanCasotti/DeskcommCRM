---
impacto: nada_mudou
secao: corrigido
titulo: Worker de IA parado deixa de responder "saudável" em silêncio
---

O processamento que transforma as mensagens recebidas em respostas da IA roda num laço dentro do serviço do worker. Se uma consulta ao banco travasse no meio de uma volta, o laço parava — as mensagens continuavam chegando, mas nenhuma resposta era enfileirada — e o healthz do serviço continuava respondendo "ok": foi assim que uma instalação real ficou dois dias sem a IA responder, com o aviso verde. Agora o worker carimba cada volta concluída, o healthz responde não saudável quando esse carimbo passa de cinco minutos, e a Central da equipe abre um aviso quando o laço fica parado. O aviso se resolve sozinho quando o processamento volta.

Contribuição de @Tong-bit-art, a partir da issue #2505.
