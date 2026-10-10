---
impacto: capacidade_nova
secao: adicionado
titulo: Automações de tempo agora deixam escolher o funil e a etapa pela tela
---

As automações "N dias sem mensagem" e "N dias na mesma etapa" aceitam, desde que nasceram, um recorte de funil (e a segunda, também de etapa) — mas a tela de automações não desenhava nenhum dos dois: quem precisava do recorte só conseguia configurá-lo pela API, e a tela salvava por cima. Agora o bloco QUANDO desses gatilhos tem os seletores de funil (nos dois) e de etapa (no de etapa parada), com "Todos os funis" e "Qualquer etapa" para voltar a valer para tudo. Abrir uma regra com recorte mostra o recorte que está gravado. Nada muda para quem não usa esse recorte.

Contribuição de @Tong-bit-art (#2685), a partir da issue #2483.
