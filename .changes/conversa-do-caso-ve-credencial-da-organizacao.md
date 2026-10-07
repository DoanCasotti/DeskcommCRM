---
impacto: capacidade_nova
secao: corrigido
titulo: "Conversar sobre o caso" volta a aparecer quando a IA é configurada só por Credenciais, sem chave no ambiente
---

O assistente interno "Conversar sobre o caso" mostrava "Nenhum provedor de IA está configurado" e escondia o campo em instalações que configuram a IA por IA › Credenciais e não têm chave de IA no `.env`. O sinal que decide se o painel aparece olhava só as variáveis de ambiente, enquanto a conversa usa a credencial da organização.

Agora o painel pergunta ao mesmo resolvedor que a conversa usa para escolher a credencial: aparece quando a conversa acharia credencial (a do agente do caso, a padrão da organização ou a chave do ambiente) e some quando a conversa também não acharia. Quem já tinha chave no `.env` não vê diferença.

Contribuição de @Aleshan-dev (#2495).
