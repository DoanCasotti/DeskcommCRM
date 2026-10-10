---
impacto: nada_mudou
secao: corrigido
titulo: A anonimização por seção de módulo não grava mais o rótulo onde o campo estava vazio
---

O modo `colunas_rotulo` da anonimização por seção de módulo passa a preservar o nulo, como `colunas_redigidas` já fazia: um campo que nunca foi preenchido continua vazio depois da anonimização, em vez de passar a dizer `Cliente Anonimizado #N`. Nenhum módulo oficial usa `colunas_rotulo` hoje, então nenhum dado existente muda.

Contribuição de @webtecnica (#2683, issue #2656).
