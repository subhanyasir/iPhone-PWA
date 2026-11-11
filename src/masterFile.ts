export function parseMasterNumberLine(line: string): string | undefined {
  const value = line.replace(/^\uFEFF/, "").trim().replace(/^["']|["']$/g, "");
  if (!value || !/^\+?[\d\s().-]+$/.test(value)) return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : undefined;
}

export async function processMasterFile(
  file: File,
  onBatch: (numbers: string[]) => Promise<void>,
  onProgress: (bytesRead: number) => void,
  batchSize = 1000
): Promise<{ valid: number; invalid: number }> {
  if (!file.stream) throw new Error("This browser cannot stream file imports. Use a current version of Safari, Chrome, or Edge.");

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let batch: string[] = [];
  let valid = 0;
  let invalid = 0;
  let bytesRead = 0;

  const processLine = async (line: string) => {
    const number = parseMasterNumberLine(line);
    if (number) {
      batch.push(number);
      valid += 1;
    } else if (line.trim()) {
      invalid += 1;
    }
    if (batch.length >= batchSize) {
      await onBatch(batch);
      batch = [];
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      remainder += decoder.decode(value, { stream: true });
      const lines = remainder.split(/\r\n|\n|\r/);
      remainder = lines.pop() ?? "";
      for (const line of lines) await processLine(line);
      onProgress(bytesRead);
    }
    remainder += decoder.decode();
    if (remainder) await processLine(remainder);
    if (batch.length > 0) await onBatch(batch);
    onProgress(file.size);
  } finally {
    reader.releaseLock();
  }
  return { valid, invalid };
}
