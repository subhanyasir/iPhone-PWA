import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { addUniqueCandidates, getMasterInfo, MasterAccessError } from "./masterApi";

function createTestClient(body: unknown, status = 200) {
  return createClient("https://test.supabase.co", "test-publishable-key", {
    global: {
      fetch: async () => new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
      })
    }
  });
}

describe("private shared master API", () => {
  it("reads initialized status and returns only database-inserted candidates", async () => {
    const statusClient = createTestClient([{ total_numbers: "1200000", initialized: true }]);
    const candidateClient = createTestClient([{ inserted_number: "393331234567" }]);

    await expect(getMasterInfo(statusClient)).resolves.toEqual({ count: 1_200_000, initialized: true });
    await expect(addUniqueCandidates(candidateClient, ["393331234567", "393331234568"]))
      .resolves.toEqual(["393331234567"]);
  });

  it("surfaces denied master access as a distinct authorization error", async () => {
    const client = createTestClient({
      code: "42501",
      message: "Access to the private master is not enabled for this account.",
      details: null,
      hint: null
    }, 403);

    await expect(getMasterInfo(client)).rejects.toBeInstanceOf(MasterAccessError);
  });
});
