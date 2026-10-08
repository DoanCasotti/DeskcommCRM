---
impacto: capacidade_nova
secao: corrigido
titulo: Ligar um recurso opcional passa a dizer onde ele aparece — e a porta aparece mesmo
---

Quem administra a instalação ligava um recurso opcional em **Recursos opcionais** e não achava nada no sistema. Três coisas diferentes causavam esse mesmo sintoma, e as três estão corrigidas:

- **A tela não dizia onde o recurso ia aparecer.** Agora cada linha diz, antes e depois de ligar, em que lugar do menu ele fica — por exemplo "CRM › Empresas" ou "Configurações › Dados externos". O caminho é lido do próprio menu, então ele nunca fica desatualizado em relação ao que está na tela. E os dois recursos que **não** criam entrada no menu (a cobrança dos seus clientes e o login do Codex por assinatura) passam a dizer isso com todas as letras, em vez de deixar quem ligou procurando o que não existe.
- **O menu demorava a mudar.** Ao ligar ou desligar, o menu era recalculado só na tela de administração; quem voltava ao sistema continuava vendo o menu de antes até recarregar a página inteira. Agora muda na hora, nos dois sentidos.
- **Empresa com o menu enxuto nunca via o recurso.** Quem escolheu a opção de menu simplificado não via entrada nenhuma de recurso opcional, mesmo com o recurso ligado — a lista do menu enxuto é do próprio produto e foi escrita antes de existirem recursos opcionais, então ela não podia ser lida como "esta empresa decidiu esconder". Quem escolheu as áreas **uma por uma** continua mandando: a área que essa pessoa desmarcou segue escondida.

Nada muda para quem não liga recurso opcional nenhum.
