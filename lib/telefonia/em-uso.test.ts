/**
 * `telefoniaEmUso` — o sinal que o item de menu da #1290 usa.
 *
 * O que este arquivo vigia, e por quê:
 *
 *  - falha FECHADA (erro, exceção, ausência de linha = desligada), porque a
 *    consequência de errar para o lado do "ligado" é o defeito original: menu
 *    oferecendo uma porta que não funciona;
 *  - a leitura é da ORGANIZAÇÃO, por `organization_id` — nunca a tabela inteira
 *    (vazaria telefonia de outra empresa para o menu desta);
 *  - nunca lança: roda no layout de `/app`, e um throw ali derruba todas as telas.
 */
import { describe, expect, it, vi } from "vitest";

import { telefoniaEmUso } from "./em-uso";

function dbQueDevolve(resultado: { data: unknown; error: unknown } | Error) {
  const maybeSingle = vi.fn(async () => {
    if (resultado instanceof Error) throw resultado;
    return resultado;
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { db: { from } as never, from, select, eq };
}

describe("telefoniaEmUso", () => {
  it("tronco salvo para a organização = ligada", async () => {
    const { db, from, eq } = dbQueDevolve({ data: { organization_id: "org-1" }, error: null });
    await expect(telefoniaEmUso(db, "org-1")).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("voip_trunk_settings");
    expect(eq).toHaveBeenCalledWith("organization_id", "org-1");
  });

  it("sem linha: desligada (nenhuma chamada é possível sem tronco)", async () => {
    const { db } = dbQueDevolve({ data: null, error: null });
    await expect(telefoniaEmUso(db, "org-1")).resolves.toBe(false);
  });

  it("erro do banco: desligada, sem lançar", async () => {
    const { db } = dbQueDevolve({ data: null, error: { message: "boom" } });
    await expect(telefoniaEmUso(db, "org-1")).resolves.toBe(false);
  });

  it("exceção: desligada, sem lançar", async () => {
    const { db } = dbQueDevolve(new Error("rede"));
    await expect(telefoniaEmUso(db, "org-1")).resolves.toBe(false);
  });
});
