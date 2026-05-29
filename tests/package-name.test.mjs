import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(testFile), "..");

test("package publishes as DevFlow with the devflow CLI", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  assert.equal(pkg.name, "@xuanmimi/devflow");
  assert.deepEqual(pkg.bin, {
    devflow: "scripts/devflow-cli.mjs"
  });
});

test("published package does not include legacy config or runtime JSON seeds", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  assert.equal(pkg.files.some((file) => file === "runtime/current.json" || file === "runtime/tasks/.gitkeep"), false);
  assert.equal(pkg.files.some((file) => file.startsWith("config/")), false);
});
