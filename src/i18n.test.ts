import { describe, expect, it } from "vitest";
import { formatLocale, translateText } from "./i18n";

describe("Italian and English interface language", () => {
  it("uses Italian as the primary language and supports English", () => {
    expect(translateText("Dashboard", "it")).toBe("Panoramica");
    expect(translateText("Dashboard", "en")).toBe("Dashboard");
    expect(translateText("Italiano", "it")).toBe("Italiano");
    expect(formatLocale("it")).toBe("it-IT");
    expect(formatLocale("en")).toBe("en-US");
  });

  it("translates generation, export, and accessibility messages", () => {
    expect(translateText("10.000 numbers generated successfully.", "it")).toBe("Generati 10.000 numeri con successo.");
    expect(translateText("Exported 2.000 entries as CSV.", "it")).toBe("Esportate 2.000 voci in formato CSV.");
    expect(translateText("Switch to light mode", "it")).toBe("Attiva la modalità chiara");
    expect(translateText("TXT — one number per line", "it")).toBe("TXT — un numero per riga");
    expect(translateText("CSV — spreadsheet ready", "it")).toBe("CSV — pronto per i fogli di calcolo");
    expect(translateText("Always on", "it")).toBe("Sempre attivo");
  });
});
