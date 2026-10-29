import { describe, expect, it } from "vitest";

import { porExtenso, textoFalavel, TETO_DE_CARACTERES_FALADOS } from "@/lib/ai/voz/texto-falavel";

describe("porExtenso", () => {
  it.each([
    [0, "zero"],
    [1, "um"],
    [9, "nove"],
    [10, "dez"],
    [15, "quinze"],
    [19, "dezenove"],
    [20, "vinte"],
    [21, "vinte e um"],
    [30, "trinta"],
    [99, "noventa e nove"],
    [100, "cem"],
    [101, "cento e um"],
    [120, "cento e vinte"],
    [200, "duzentos"],
    [215, "duzentos e quinze"],
    [999, "novecentos e noventa e nove"],
    [1000, "mil"],
    [1001, "mil e um"],
    [1100, "mil e cem"],
    [1200, "mil e duzentos"],
    [1234, "mil duzentos e trinta e quatro"],
    [2000, "dois mil"],
    [21000, "vinte e um mil"],
    [100000, "cem mil"],
    [999999, "novecentos e noventa e nove mil novecentos e noventa e nove"],
    [1000000, "um milhão"],
    [2000000, "dois milhões"],
  ])("%i → %s", (n, esperado) => {
    expect(porExtenso(n)).toBe(esperado);
  });
});

describe("textoFalavel — moeda", () => {
  it("valor redondo em reais, sem centavos ditos", () => {
    expect(textoFalavel("Custa R$100 no pix.")).toBe("Custa cem reais no pix.");
  });

  it("um real, no singular", () => {
    expect(textoFalavel("É só R$1,00.")).toBe("É só um real.");
  });

  it("reais e centavos", () => {
    expect(textoFalavel("Fica R$ 1.234,56 à vista.")).toBe(
      "Fica mil duzentos e trinta e quatro reais e cinquenta e seis centavos à vista.",
    );
  });

  it("um centavo, no singular", () => {
    expect(textoFalavel("Custa R$0,01.")).toBe("Custa zero reais e um centavo.");
  });

  it("centavos sem reais inteiros não some o 'reais'", () => {
    expect(textoFalavel("R$0,50 de diferença.")).toBe("zero reais e cinquenta centavos de diferença.");
  });
});

describe("textoFalavel — markdown e emoji", () => {
  it("negrito, itálico, tachado e código inline perdem a marcação, não o texto", () => {
    expect(textoFalavel("**Promoção** de _hoje_: ~~R$50~~ por `R$30`.")).toBe(
      "Promoção de hoje: cinquenta reais por trinta reais.",
    );
  });

  it("link markdown mantém o rótulo e descarta a URL", () => {
    expect(textoFalavel("Veja o [catálogo](https://example.com/catalogo).")).toBe("Veja o catálogo.");
  });

  it("URL solta é removida, não lida caractere por caractere", () => {
    expect(textoFalavel("Olha aqui: https://example.com/produto?x=1 e me chama.")).toBe(
      "Olha aqui: e me chama.",
    );
  });

  it("emoji desaparece sem deixar resíduo (seletor de variação incluso)", () => {
    expect(textoFalavel("Chegou! 🎉✨ Aproveita 😍❤️")).toBe("Chegou! Aproveita");
  });
});

describe("textoFalavel — teto de caracteres", () => {
  it("corta no limite de PALAVRA, nunca no meio de uma palavra", () => {
    const longo = "palavra ".repeat(100).trim(); // 8 chars por palavra + espaço
    const falado = textoFalavel(longo, 50);
    expect(falado.length).toBeLessThanOrEqual(50);
    expect(longo.startsWith(falado)).toBe(true);
    expect(falado.endsWith(" ")).toBe(false);
  });

  it("usa o teto default quando nenhum é passado", () => {
    const longo = "a".repeat(TETO_DE_CARACTERES_FALADOS + 500);
    expect(textoFalavel(longo).length).toBeLessThanOrEqual(TETO_DE_CARACTERES_FALADOS);
  });

  it("texto dentro do teto não é tocado", () => {
    expect(textoFalavel("oi")).toBe("oi");
  });
});
