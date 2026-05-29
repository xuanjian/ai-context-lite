import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(testFile), "../..");
const cliPath = path.join(rootDir, "scripts/devflow-cli.mjs");

function runCli(args, env) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: env?.cwd || rootDir,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("devflow init installs selected AI tool targets without exposing internal setup commands", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cli-home-"));
  const result = runCli(["init", "--tools", "codex,claude-code,qoderwork", "--skip-openspec", "--yes"], {
    HOME: home
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Selected AI tools: Codex, Claude Code, QoderWork/);
  assert.doesNotMatch(result.stdout, /install-ai-context\.mjs setup/);
  assert.equal(fs.lstatSync(path.join(home, ".codex", "skills", "devflow")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(home, ".codex", "skills", "devflow-init")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(home, ".claude", "skills", "devflow")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(home, ".qoderwork", "skills", "devflow")).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(home, ".agents", "skills", "devflow")), false);
});

test("devflow init creates a local devflow directory when run outside a checkout", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cli-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cli-cwd-"));
  const result = runCli(["init", "--tools", "codex", "--skip-openspec", "--yes"], {
    HOME: home,
    cwd
  });

  const createdRoot = path.join(cwd, "devflow");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(createdRoot, "config", "entry.json")), true);
  assert.equal(fs.existsSync(path.join(createdRoot, "scripts", "install-ai-context.mjs")), true);
  assert.equal(fs.existsSync(path.join(createdRoot, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(createdRoot, "package-lock.json")), false);
  assert.match(fs.readFileSync(path.join(createdRoot, ".npmrc"), "utf8"), /registry=https:\/\/registry\.npmjs\.org\//);
  assert.match(result.stdout, new RegExp(`DevFlow root: ${fs.realpathSync(createdRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const skillLink = path.join(home, ".codex", "skills", "devflow");
  assert.equal(fs.lstatSync(skillLink).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(skillLink), fs.realpathSync(path.join(createdRoot, "bundles", "skills", "devflow")));
});
