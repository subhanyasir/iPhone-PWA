export type Section = "Dashboard" | "Generate" | "History" | "Export" | "Settings";
export type ExportFormat = "TXT" | "CSV";
export type SessionStatus = "running" | "complete" | "cancelled" | "interrupted" | "error";

export interface GeneratorSettings {
  countryCode: string;
  quantity: number;
  batchSize: number;
  avoidDuplicates: boolean;
  exportFormat: ExportFormat;
}

export interface GenerationSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  requested: number;
  generated: number;
  countryCode: string;
  batchSize: number;
  avoidDuplicates: boolean;
  exportFormat: ExportFormat;
  status: SessionStatus;
  exportedAt?: number;
}

export interface NumberEntry {
  id?: number;
  sessionId: string;
  number: string;
  createdAt: number;
}

export interface GenerationBatchMessage {
  type: "batch";
  numbers: string[];
  attempts: number;
}

export type WorkerMessage =
  | { type: "start"; quantity: number; batchSize: number; countryCode: string }
  | { type: "ack"; inserted: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" };
