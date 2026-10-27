---
impacto: capacidade_nova
secao: alterado
titulo: Sugerir resposta faz um pedido explícito quando o agente fica em silêncio
---

Quando uma pessoa clica em **Sugerir resposta** e o primeiro turno termina em silêncio sem impedimento, a recuperação limitada informa ao agente que uma pessoa pediu uma proposta de texto. A sugestão continua destinada à revisão antes da aprovação.

Essa recuperação é única: texto solto mantém sua correção existente, sem uma terceira tentativa. Uma resposta ou proposta de ação já oferecida, veto de janela, ritmo ou conteúdo, falha de geração e conversa sem mensagem pendente não autorizam o pedido adicional. O turno automático e a cadeia de aprovação permanecem os mesmos. O pedido ao agente solicita somente a mensagem destinada ao cliente, sem justificativa privada no corpo.

Contribuição de @webtecnica a partir do PR #3557, adaptada pela manutenção.
