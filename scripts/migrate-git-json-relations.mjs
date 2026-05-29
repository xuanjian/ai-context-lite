#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDbPath } from "../src/core/storage/schema.mjs";
import { DEFAULT_RESTORE_REF, restoreDevFlowFromGit } from "../src/core/storage/restore-from-git.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, "..");

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(args.root || defaultRoot);
  const result = await restoreDevFlowFromGit({
    rootDir,
    dbPath: args.db ? path.resolve(args.db) : defaultDbPath(rootDir),
    ref: args.ref || DEFAULT_RESTORE_REF,
    dryRun: Boolean(args["dry-run"])
  });
  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
