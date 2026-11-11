import type { SupabaseClient } from "@supabase/supabase-js";

export interface MasterInfo {
  count: number;
  initialized: boolean;
}

export class MasterAccessError extends Error {
  constructor() {
    super("This account is not authorized to access the private master.");
    this.name = "MasterAccessError";
  }
}

function throwRpcError(prefix: string, error: { code?: string; message: string }): never {
  if (error.code === "42501") throw new MasterAccessError();
  throw new Error(`${prefix}: ${error.message}`);
}

export async function getMasterInfo(client: SupabaseClient): Promise<MasterInfo> {
  const { data, error } = await client.rpc("get_master_info");
  if (error) throwRpcError("Could not read the shared master", error);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.total_numbers !== "number" && typeof result.total_numbers !== "string") {
    throw new Error("The shared master returned an invalid status response.");
  }
  const count = Number(result.total_numbers);
  if (!Number.isSafeInteger(count) || count < 0 || typeof result.initialized !== "boolean") {
    throw new Error("The shared master returned an invalid status response.");
  }
  return {
    count,
    initialized: result.initialized
  };
}

export async function addUniqueCandidates(client: SupabaseClient, candidates: string[]): Promise<string[]> {
  const { data, error } = await client.rpc("add_master_candidates", { p_candidates: candidates });
  if (error) throwRpcError("Could not check the shared master", error);
  if (!Array.isArray(data) || data.some((row) => !row || typeof row.inserted_number !== "string")) {
    throw new Error("The shared master returned an invalid generation response.");
  }
  return data.map((row) => row.inserted_number);
}
