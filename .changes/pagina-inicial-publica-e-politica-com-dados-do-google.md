---
impacto: capacidade_nova
secao: adicionado
titulo: Página inicial pública e política de privacidade com a seção de dados do Google, para a verificação do app no Google
---

O endereço principal da instalação agora abre, sem pedir login, uma página com o nome do produto (o da marca da sua instalação), o que ele faz e os links da Política de Privacidade e dos Termos de Uso, com um botão "Entrar". Quem já está logado continua indo direto para o painel.

A Política de Privacidade ganhou a seção "Dados do Google (Agenda e Google Ads)": diz o que é lido de cada conta Google conectada e para quê, que os dados não são vendidos, usados para publicidade nem para treinar modelos de inteligência artificial, que o uso segue a Política de Dados de Usuário dos Serviços de API do Google (incluindo Uso Limitado) e como desfazer a conexão. Sem isso, o Google recusa a verificação do app e bloqueia a conexão de quem não é testador.

Quem confere o endereço no deploy: o domínio passa a responder 200 para quem não tem sessão (antes era 307); `/app` segue respondendo 307 para o login, e é ele o sinal de que quem responde é o app; 404 continua significando rotas perdidas. Os guias de deploy foram atualizados. Nada precisa ser feito na VPS. Crédito: @paulolimajr77.
