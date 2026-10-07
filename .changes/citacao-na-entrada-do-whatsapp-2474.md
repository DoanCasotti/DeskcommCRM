---
impacto: nada_mudou
secao: corrigido
titulo: Resposta do cliente "em cima" de uma mensagem agora aparece no fio da conversa
---

Quando o cliente usava o "Responder" do WhatsApp em cima de uma mensagem que a IA ou o atendente tinham mandado, a resposta chegava ao CRM solta: a bolha não mostrava o fio, e o agente não tinha como saber a qual mensagem ela se referia — num caso real, a IA tinha mandado o programa A, o programa B e uma pergunta, o cliente respondeu "explica melhor isso aqui" em cima de uma das bolhas, e a IA explicou as duas.

Agora o CRM guarda, na mensagem que chega, o ponteiro para a mensagem respondida, e o fio passa a aparecer na conversa. Quando a mensagem respondida é anterior à instalação (não existe no CRM), nada se perde nem quebra: a resposta entra como sempre, e o texto citado fica guardado junto dela. Mensagem sem citação continua entrando igual.

Vale também para quando o dono responde "em cima" pelo celular. Nenhum dado era gravado errado antes: era só o fio que não aparecia.

O agente de IA ainda não lê a citação para responder só sobre a bolha certa — essa é a segunda metade da #2474, que vem num passo seguinte.

Contribuição de @Tong-bit-art (#2485, refs #2474, relatado por @marcelovolei15).
