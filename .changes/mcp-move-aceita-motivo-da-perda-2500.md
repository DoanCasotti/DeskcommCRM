---
impacto: nada_mudou
secao: corrigido
titulo: O agente que opera o funil pelo MCP consegue marcar um negócio como perdido
---

Mover um negócio para uma etapa de perda pela ferramenta `crm_move_lead_stage` era recusado com "Informe o motivo da perda" quando o negócio ainda não tinha motivo gravado, mesmo quando o agente mandava o motivo: a ferramenta descartava o campo antes de chegar ao CRM. Agora ela aceita `lost_reason` e grava o motivo na mesma escrita que muda a etapa, como já acontecia com o motivo do ganho. O motivo passa pela mesma conferência do arrasto no Kanban: tem de estar na lista de motivos do funil. Mover para uma etapa comum continua igual.

Contribuição de @erikyudi (#2500, refs #917).
