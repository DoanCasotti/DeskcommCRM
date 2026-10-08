/**
 * ONDE UM MÓDULO OPCIONAL APARECE depois de ligado.
 *
 * ─── O defeito que isto fecha ───────────────────────────────────────────────
 *
 * Quem administra a instalação liga um módulo em Recursos opcionais
 * (`/admin/sistema`) e a tela não diz o que mudou. O operador vai ao CRM, não
 * acha nada e conclui que o interruptor não funcionou — às vezes com razão
 * (dois módulos não criam porta nenhuma), às vezes sem (a porta existe e está
 * dentro de Configurações, onde ele não procurou).
 *
 * A informação já existia no produto, com UM consumidor só: a tela da EMPRESA
 * (`/app/settings/recursos`) mostra a porta via `portaDoModuloNaEmpresa()`. A
 * tela de quem LIGA não a tinha.
 *
 * ─── Por que aqui, e lido do menu ───────────────────────────────────────────
 *
 * Módulo puro, sem dependência de servidor: a tela do interruptor é um
 * componente de cliente, e qualquer coisa que arraste `logger`/Supabase para
 * dentro dela não compilaria. `ModuloOpcional` entra como importação de TIPO,
 * que é apagada na transpilação.
 *
 * As portas saem de `NAV_CATALOG` e o nome do grupo de `NAV_GROUPS` — nunca de
 * uma segunda lista escrita à mão, que divergiria na primeira tela que mudasse
 * de grupo. Vigiado em `tests/unit/porta-do-modulo-ligado.test.tsx`.
 */
import type { ModuloOpcional } from "@/lib/instalacao/modulos";

import { GRUPO_NO_RODAPE, NAV_CATALOG, NAV_GROUPS, type NavMetadata } from "./catalogo";

export interface PortaDoModulo {
  href: string;
  /** Rótulo da porta, como o menu a escreve. */
  label: string;
  /** Rótulo do GRUPO do menu ("CRM", "Configurações"…) — onde procurar. */
  grupo: string;
}

/**
 * O nome do grupo COMO O OPERADOR O LÊ no menu — e isso não é sempre
 * `group.label`.
 *
 * `GRUPO_NO_RODAPE` (`organizacao`) é a exceção medida: o `Sidebar` o desenha no
 * rodapé fixo mostrando só o `hub` dele, então na tela está escrito
 * "Configurações" e o rótulo "Organização" não aparece em lugar nenhum. Mandar
 * procurar em "Organização" seria o mesmo defeito que este arquivo conserta, um
 * nível acima: instrução tirada do modelo de dados em vez do que está na tela —
 * e uma instrução errada com ar de certeza gasta mais tempo que o silêncio.
 */
const GRUPO: ReadonlyMap<string, string> = new Map(
  NAV_GROUPS.map((g) => [g.id, (g.id === GRUPO_NO_RODAPE && g.hub?.label) || g.label]),
);

/**
 * Todas as portas do menu que este módulo acende, na ordem do menu. Vazio = o
 * módulo não cria porta — e vazio é a resposta honesta, não um palpite: mandar
 * o operador procurar no lugar errado é pior que dizer que não há lugar.
 */
export function ondeOModuloAparece(modulo: ModuloOpcional): PortaDoModulo[] {
  return (NAV_CATALOG as readonly NavMetadata[])
    .filter((d) => d.modulo === modulo)
    .map((d) => ({ href: d.href, label: d.label, grupo: GRUPO.get(d.group) ?? d.group }));
}
