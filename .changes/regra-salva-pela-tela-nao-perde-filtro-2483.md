---
impacto: nada_mudou
secao: corrigido
titulo: Regra de automação salva pela tela não perde mais o filtro de funil e de etapa
---

A regra de "card parado N dias na mesma etapa" criada pela API com filtro de funil e de etapa perdia os dois filtros quando alguém a abria e salvava pela tela, mesmo sem mudar nada: o editor reconstruía a configuração só com o que ele próprio desenha (os dias e a proteção da agenda). Sem o filtro, a regra passa a valer para todos os funis em silêncio — ela dispara onde ninguém pediu, e a tela não mostra diferença nenhuma. Agora o que a tela não edita sobrevive ao salvar, e a herança só vale dentro do mesmo gatilho: trocar o gatilho na tela não herda a configuração do anterior. Vale também para o filtro de funil do gatilho de silêncio. Nenhum dado era gravado errado antes: era a configuração da regra que se perdia.

Contribuição de @Tong-bit-art (#2487), a partir da issue #2483 de @aleflores35.
