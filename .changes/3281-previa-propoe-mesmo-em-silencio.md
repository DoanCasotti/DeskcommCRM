---
impacto: capacidade_nova
secao: alterado
titulo: "Sugerir resposta" propõe um texto mesmo quando o agente automático ficaria em silêncio
---

O botão **Sugerir resposta** rodava o mesmo turno do agente automático e parava na primeira resposta aceita. Se o prompt do agente mandasse calar — não responder a mensagem automática, à saudação sem pedido, à conversa que ele julgou sem o que responder —, o rascunho herdava o silêncio: ficava como falha e a tela dizia que o agente tinha decidido não responder. O operador clicava exatamente no momento em que sabia mais que a regra e saía de mãos vazias.

Agora, quando o turno termina sem texto por uma razão do envio automático, a prévia do rascunho dá um passo a mais com o pedido humano na conversa: uma pessoa da equipe pediu o texto, e quem revisa e aprova é ela. O resultado é uma proposta de mensagem para revisar, como qualquer outra.

O turno automático não muda: ele continua obedecendo o silêncio do prompt. Nada é enviado sem o clique de aprovação, e a cadeia de envio continua valendo por cima — tanto na proposta quanto de novo na aprovação, incluindo opt-out, janela de 24 horas, ritmo, promessa e as regras de conteúdo. Quando o impedimento é de conteúdo (preço e negociação, promessa fora de tabela, alegação clínica, LGPD, mídia que não preparou), a prévia continua vazia e mostra o motivo: ali o problema é o texto, não a hora de mandar. Falha de geração (resposta cortada no limite de tamanho ou teto de ações esgotado) também continua aparecendo como falha, com o código próprio.
