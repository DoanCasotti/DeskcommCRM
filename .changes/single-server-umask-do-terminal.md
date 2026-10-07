---
impacto: nada_mudou
secao: corrigido
titulo: Instalação com o banco na própria VPS não falha mais quando o terminal está com permissões restritas
---

Quem rodava o instalador com o banco na própria VPS logo depois de um backup, na
mesma janela do terminal, podia herdar uma configuração de permissões restritas
(`umask 077`). Nesse caso o banco não subia, e nenhuma mensagem apontava a causa.
O instalador agora fixa as permissões de que o banco precisa, venha o terminal
como vier. Quem já tem o sistema instalado não é afetado.
