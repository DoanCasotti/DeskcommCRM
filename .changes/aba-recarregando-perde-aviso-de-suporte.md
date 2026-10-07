---
impacto: nada_mudou
secao: corrigido
titulo: Aba que estava carregando quando o acompanhamento de suporte começou ou terminou passa a mostrar a organização certa
---

Quem abre o acompanhamento de suporte com mais de uma aba do mesmo navegador aberta
via, às vezes, uma das abas continuar mostrando a organização anterior por até 15
segundos depois de entrar ou sair do acompanhamento. Isso acontecia quando a aba
estava no meio de um carregamento no instante da troca e perdia o aviso enviado
pela outra aba.

Agora a aba confere, ao terminar de carregar, se a troca aconteceu enquanto ela
carregava, e se atualiza na hora. Nenhum dado era gravado na organização errada,
porque o servidor já recusava essas gravações: o problema era só o que a tela
mostrava.
