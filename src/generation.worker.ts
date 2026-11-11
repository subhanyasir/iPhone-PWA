/// <reference lib="webworker" />

import type { WorkerMessage } from "./types";

const LIMIT = 1_000_000_000;
let remaining = 0;
let current = 0;
let step = 1;
let batchSize = 500;
let countryCode = "39";
let paused = false;
let cancelled = false;
let inFlight = false;
let attempts = 0;

const gcd = (a: number, b: number): number => {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
};

const generateBatch = () => {
  if (cancelled || paused || inFlight) return;
  if (remaining === 0) {
    self.postMessage({ type: "done" });
    return;
  }

  const count = Math.min(batchSize, remaining);
  const numbers = new Array<string>(count);
  for (let index = 0; index < count; index += 1) {
    numbers[index] = `${countryCode}${current + 3_000_000_000}`;
    current = (current + step) % LIMIT;
    attempts += 1;
  }
  inFlight = true;
  self.postMessage({ type: "batch", numbers, attempts } satisfies { type: "batch"; numbers: string[]; attempts: number });
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "start": {
      remaining = message.quantity;
      batchSize = message.batchSize;
      countryCode = message.countryCode;
      current = Math.floor(Math.random() * LIMIT);
      step = Math.floor(Math.random() * (LIMIT - 1)) + 1;
      while (gcd(step, LIMIT) !== 1) step = step === LIMIT - 1 ? 1 : step + 1;
      paused = false;
      cancelled = false;
      attempts = 0;
      generateBatch();
      break;
    }
    case "ack":
      inFlight = false;
      remaining -= message.inserted;
      if (remaining < 0) remaining = 0;
      generateBatch();
      break;
    case "pause":
      paused = true;
      break;
    case "resume":
      paused = false;
      generateBatch();
      break;
    case "cancel":
      cancelled = true;
      self.postMessage({ type: "cancelled" });
      break;
  }
};
