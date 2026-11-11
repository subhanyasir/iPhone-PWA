export function normalizeLine(line) {
  const value = line.replace(/^\uFEFF/, "").trim().replace(/^["']|["']$/g, "");
  if (!value || !/^\+?[\d\s().-]+$/.test(value)) return undefined;
  const number = value.replace(/\D/g, "");
  return number.length >= 7 && number.length <= 15 ? number : undefined;
}
