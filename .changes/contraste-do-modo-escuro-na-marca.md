---
impacto: nada_mudou
secao: corrigido
titulo: Na tela de marca, o contraste do modo escuro passa a medir a cor do tema escuro
---

Com a cor da marca no tema escuro preenchida, o cartão "O texto em cima dos botões" em Administração › Marca mostrava, na linha "No modo escuro", o contraste da cor principal, e não o do botão que o tema escuro de fato pinta. Com `#1C261D` + `#D9AC62`, por exemplo, a tela dizia 6,7:1 e o botão pintado tem 11,4:1. Agora o número é o do botão que aparece na tela. As cores pintadas não mudam.

Achado na conferência pela tela do #2682 (@webtecnica).
