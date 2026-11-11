import type { ExportFormat } from "./types";

export function exportHeader(format: ExportFormat): string {
  return format === "CSV" ? "phone_number\r\n" : "";
}

export function formatExportChunk(numbers: string[], format: ExportFormat): string {
  if (format === "CSV") return `${numbers.map((number) => `"${number}"`).join("\r\n")}\r\n`;
  return `${numbers.join("\n")}\n`;
}
