---
impacto: nada_mudou
secao: corrigido
titulo: CPF errado avisa no próprio campo e impede criar o contato até ser corrigido
---

No cadastro de contato, quem digitava um CPF com dígito verificador errado só descobria no clique de "Criar contato" — e a frase aparecia no rodapé do diálogo, longe do campo que causou o erro. Agora o aviso nasce embaixo do próprio campo ao sair dele, e o botão de criar fica impedido enquanto o documento estiver inválido; corrigir o número apaga o aviso na hora. O campo continua opcional: vazio cria o contato como antes. O servidor não mudou — ele já recusava o CPF errado. Nada muda na VPS.
