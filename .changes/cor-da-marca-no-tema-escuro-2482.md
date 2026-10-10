---
impacto: capacidade_nova
secao: adicionado
titulo: A marca própria ganha uma cor opcional para o tema escuro, ao lado da cor principal, como o logo já tinha
---

Em Marca (instalação) e em Configurações › Marca (organização) há um campo novo, opcional: "Cor da marca no tema escuro". Vazio, nada muda: os dois temas continuam derivando da cor principal, exatamente como antes. Preenchido, o tema escuro deriva dessa segunda cor pelos mesmos pisos de contraste, e o tema claro, os e-mails e o logo seguem na cor principal. Uma cor escura inválida nunca derruba a principal: o tema escuro volta a derivar dela. Uma cor escura neutra (cinza, preto ou branco) deixa o tema escuro com a cor padrão do sistema, e a tela avisa. A lista "O que o sistema ajustou" fala de cada cor só no tema que ela pinta. Nada precisa ser feito ao atualizar: o `update.sh` cria a coluna nova.

Contribuição de @webtecnica (#2682), a partir da issue #2482 de @TOSTES-LAB.
