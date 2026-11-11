import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { normalizeLine } from "./master-parser.mjs";

const filePath = process.argv[2] ?? "data\\TUTTI_NUMERI_GENERATI_UNICI_AGGIORNATO.txt";
const databaseUrl = process.env.DATABASE_URL;

if (process.argv.includes("--help")) {
  console.log("Usage: npm run import:master -- [path-to-master.txt]");
  console.log("Set DATABASE_URL in PowerShell to a private Supabase Postgres connection string.");
  process.exit(0);
}

if (!databaseUrl) {
  throw new Error("Set DATABASE_URL in this PowerShell session to your private Supabase database connection string.");
}

const fileSize = statSync(filePath).size;
console.log(`Source: ${filePath} (${(fileSize / 1024 ** 3).toFixed(2)} GB)`);
console.log("This sends the selected file to your private Supabase database. The source file is not changed.");
console.log("Type IMPORT to continue:");

let answer = "";
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  answer = line.trim();
  break;
}
if (answer !== "IMPORT") {
  console.log("Import cancelled.");
  process.exit(0);
}

const client = new Client({ connectionString: databaseUrl });
let valid = 0;
let invalid = 0;
let inserted = 0;

try {
  await client.connect();
  await client.query("begin");
  await client.query("set local statement_timeout = 0");
  await client.query("create temporary table master_import_stage (number text) on commit drop");

  const copyStream = client.query(copyFrom("copy master_import_stage (number) from stdin"));
  const output = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  const rows = Readable.from((async function* () {
    for await (const line of output) {
      const number = normalizeLine(line);
      if (number) {
        valid += 1;
        yield `${number}\n`;
      } else if (line.trim()) {
        invalid += 1;
      }
      if ((valid + invalid) % 1_000_000 === 0) {
        console.log(`Read ${valid.toLocaleString()} valid numbers; ${invalid.toLocaleString()} invalid lines.`);
      }
    }
  })());
  await pipeline(rows, copyStream);

  if (valid === 0) throw new Error("No valid phone numbers were found in the selected file.");
  const mergeResult = await client.query(`
    insert into public.master_numbers (number)
    select number from master_import_stage
    on conflict (number) do nothing
  `);
  inserted = mergeResult.rowCount ?? 0;
  await client.query(
    "update public.master_state set total_numbers = total_numbers + $1, initialized_at = now() where singleton = true",
    [inserted]
  );
  await client.query("commit");

  const countResult = await client.query("select total_numbers::text as count from public.master_state where singleton = true");
  console.log(`Import complete. ${inserted.toLocaleString()} new unique numbers added.`);
  console.log(`${(valid - inserted).toLocaleString()} duplicates skipped; ${invalid.toLocaleString()} invalid lines skipped.`);
  console.log(`Shared master now contains ${Number(countResult.rows[0].count).toLocaleString()} numbers.`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
