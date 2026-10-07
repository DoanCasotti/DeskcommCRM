---
impacto: capacidade_nova
secao: adicionado
titulo: Ganhar um negócio pode abrir a comanda com o valor e o contato, opcional por funil
---

Fechar um negócio como ganho não dizia nada ao financeiro: quem vendia pelo Kanban tinha de lembrar de abrir a comanda à mão, em outra tela, sem vínculo entre as duas. Agora cada funil tem, em Configurações › Funis, a caixa "Abrir comanda ao ganhar um negócio neste funil". Ligada, ganhar um negócio abre **uma comanda** com o **valor** e o **contato** do negócio, na moeda da organização, e grava o vínculo dela com o negócio.

A caixa vem **desligada** em todo funil, novo ou existente: desligada, ganhar não toca no financeiro, como antes desta versão. A decisão é do funil porque em loja com checkout, infoproduto ou imobiliária o valor do negócio não é conta a receber.

Vale para qualquer caminho de ganho — o arrasto para a etapa de ganho, o botão Ganhar e os demais fechamentos — porque quem abre a comanda é o consumidor do evento `lead.won`, que o banco grava em toda transição para ganho. A comanda nasce alguns segundos depois do fecho, no processamento de eventos, e nasce **aberta**: o operador confere o valor e finaliza com a forma de pagamento pelo caminho de sempre. Fechar, reabrir e fechar de novo devolve a comanda que já existe em vez de abrir outra. O atendente da comanda é o responsável pelo negócio, e ela nasce sem atendente quando o negócio não tem responsável.

O valor e o status são sempre relidos do negócio no banco, nunca tirados do evento. O item da comanda leva o vocabulário e o nome do funil (por exemplo "Pedido · Vendas"), e não o título do negócio, que costuma ser o nome ou o telefone do contato: assim nada de pessoal fica fora do alcance da anonimização da LGPD.

Contribuição de @webtecnica (#2220, refs #1477).
