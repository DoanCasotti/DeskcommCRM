import Link from "next/link";

import { requireAuth } from "@/lib/auth/server";
import { blocosVisiveis } from "@/lib/ajuda/hub";
import { traduzir } from "@/lib/i18n/dicionario";

/**
 * A AJUDA DENTRO DO PRODUTO — o índice que faltava (issue #3567, fatia F1).
 *
 * ─── O problema que ela resolve ────────────────────────────────────────────
 *
 * O conteúdo sempre existiu — curso, guias e changelog. Só não existia ONDE a
 * dúvida acontece. Quem trava em "Vocabulário e campos" tinha de abrir outra
 * aba, procurar um artigo genérico e traduzi-lo para a tela onde estava. Cada
 * passo desse é um ponto de desistência que não aparece em relatório nenhum,
 * porque acontece antes do suporte.
 *
 * ─── O que esta fatia NÃO faz, de propósito ────────────────────────────────
 *
 * Não tem busca própria (o ⌘K já indexa o catálogo de navegação), não tem
 * prosa longa e não tem link externo. O artigo completo, versionado e com
 * capturas é a fatia F3; aqui é o índice do que dá para fazer agora.
 *
 * ─── Server component, e o idioma vem do usuário ───────────────────────────
 *
 * Mesmo padrão de `settings/notifications`: em componente de servidor o idioma
 * já chega resolvido em `user.idioma` (a cadeia pessoa → organização → padrão
 * vive em `lib/auth/server.ts`), sem reler `locale` cru e sem estado
 * intermediário. Todo texto passa por `traduzir` — nada de português solto no
 * JSX, que é o que o guarda de i18n reprova.
 */
export const dynamic = "force-dynamic";

export default async function AjudaPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const blocos = blocosVisiveis(user.is_platform_admin);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Ajuda")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "O caminho para cada tarefa, e onde ir quando algo não sai como esperado.",
          )}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {blocos.map((bloco) => (
          <section key={bloco.titulo} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t(bloco.titulo)}
            </h2>
            <ul className="flex flex-col divide-y rounded-lg border">
              {bloco.itens.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    data-testid={`ajuda-${item.href.replace(/\//g, "-")}`}
                    className="flex min-h-11 flex-col gap-0.5 p-3 hover:bg-muted/50"
                  >
                    <span className="text-sm font-medium">{t(item.texto)}</span>
                    <span className="text-xs text-muted-foreground">{t(item.detalhe)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
