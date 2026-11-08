import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Upstream's tests truncate fixtures. Isolate every invocation in its own schema.
const schema = `snibbu_test_${randomUUID().replaceAll("-", "")}`;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/snibbu-upstream");
await pool.query(`CREATE SCHEMA "${schema}"`);
try {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "tests/logic.test.js", "tests/server.test.js"], {
      cwd: directory, stdio: "inherit",
      env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
    });
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
}
