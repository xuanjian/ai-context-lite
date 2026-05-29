import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { check, syncProjects, validate } from "../../scripts/install-ai-context.mjs";
import { createSqliteRepository } from "../../src/core/repositories/sqlite-repository.mjs";
import { seedSqliteFromJsonFixture } from "../helpers/sqlite-fixtures.mjs";

const testFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(testFile), "../..");
const scriptPath = path.join(rootDir, "scripts/install-ai-context.mjs");
const basicFixtureRoot = path.join(rootDir, "tests/core/fixtures/basic-ai-context");
const legacyJsonEntryGuidancePattern = /config\/(?:entry\.json|projects\/index\.json|projects\/<project-id>\.json|scenes\/index\.json|scenes\/<scene-id>\.json|skills\/skills\.json|rules\/rules\.json|tasks\/gates\.json)|runtime\/current\.json/;

function runInstallScript(args, env) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("install links routing and initialization skills, then tells the user what to run next", () => {
  const skillsHome = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-skills-"));
  const env = {
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), "devflow-home-")),
    AI_CONTEXT_SKILLS_HOMES: skillsHome
  };

  const install = runInstallScript(["install"], env);
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /installed skill: .*devflow/);
  assert.match(install.stdout, /installed skill: .*devflow-init/);
  assert.match(install.stdout, /devflow-init/);
  assert.equal(fs.lstatSync(path.join(skillsHome, "devflow")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(skillsHome, "devflow-init")).isSymbolicLink(), true);

  const check = runInstallScript(["check"], env);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /skill source devflow: ok/);
  assert.match(check.stdout, /skill source devflow-init: ok/);
  assert.match(check.stdout, /skill installed: yes/);

  const uninstall = runInstallScript(["uninstall"], env);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(fs.existsSync(path.join(skillsHome, "devflow")), false);
  assert.equal(fs.existsSync(path.join(skillsHome, "devflow-init")), false);
});

test("validate reads DevFlow state from SQLite when legacy config and runtime JSON are absent", async () => {
  const fixtureRoot = await copySqliteOnlyFixture();
  try {
    await assert.doesNotReject(() => validate({ rootDir: fixtureRoot }));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("check reports SQLite-backed entry, profile, and current state", async () => {
  const fixtureRoot = await copySqliteOnlyFixture();
  try {
    const output = await captureConsole(() => check({ rootDir: fixtureRoot }));

    assert.match(output.stdout, /entry: ok/);
    assert.match(output.stdout, /profile: ok/);
    assert.match(output.stdout, /current: ok/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("sync-projects reads projects from SQLite when config project indexes are absent", async () => {
  const fixtureRoot = await copySqliteOnlyFixture({ keepRuntimeDir: false });
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-sqlite-sync-project-"));
  try {
    const repository = createSqliteRepository({ rootDir: fixtureRoot });
    const project = await repository.getProject("demo-project");
    await repository.writeProject({ ...project, path: projectDir });

    await syncProjects({
      rootDir: fixtureRoot,
      projectId: "demo-project",
      entriesOnly: true,
      write: true
    });

    const agentsEntry = fs.readFileSync(path.join(projectDir, "AGENTS.md"), "utf8");
    assert.match(agentsEntry, /devflow query route "<user request>"/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("setup installs core skills and reports required workflow tools", () => {
  const skillsHome = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-setup-skills-"));
  const env = {
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), "devflow-setup-home-")),
    AI_CONTEXT_SKILLS_HOMES: skillsHome
  };

  const setup = runInstallScript(["setup"], env);
  assert.equal(setup.status, 0, setup.stderr);
  assert.match(setup.stdout, /setup complete/);
  assert.match(setup.stdout, /OpenSpec/);
  assert.match(setup.stdout, /superpowers/);
  assert.equal(fs.lstatSync(path.join(skillsHome, "devflow")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(skillsHome, "devflow-init")).isSymbolicLink(), true);
});

test("doctor passes when core links, OpenSpec, and superpowers are available", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-doctor-home-"));
  const skillsHome = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-doctor-skills-"));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-doctor-bin-"));
  const openspecPath = path.join(binDir, "openspec");
  fs.mkdirSync(path.join(home, ".codex", "superpowers"), { recursive: true });
  fs.writeFileSync(openspecPath, "#!/bin/sh\nprintf 'openspec-test\\n'\n");
  fs.chmodSync(openspecPath, 0o755);
  const env = {
    HOME: home,
    AI_CONTEXT_SKILLS_HOMES: skillsHome,
    PATH: `${binDir}${path.delimiter}/bin${path.delimiter}/usr/bin`
  };

  const setup = runInstallScript(["setup"], env);
  assert.equal(setup.status, 0, setup.stderr);

  const doctor = runInstallScript(["doctor"], env);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /ok OpenSpec CLI: openspec-test/);
  assert.match(doctor.stdout, /ok superpowers skills:/);
  assert.match(doctor.stdout, /doctor passed/);
});

test("doctor treats missing OpenSpec as an optional warning", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-doctor-no-openspec-home-"));
  const skillsHome = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-doctor-no-openspec-skills-"));
  fs.mkdirSync(path.join(home, ".codex", "superpowers"), { recursive: true });
  const env = {
    HOME: home,
    AI_CONTEXT_SKILLS_HOMES: skillsHome,
    PATH: `/bin${path.delimiter}/usr/bin`
  };

  const setup = runInstallScript(["setup"], env);
  assert.equal(setup.status, 0, setup.stderr);

  const doctor = runInstallScript(["doctor"], env);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /WARN OpenSpec CLI: missing/);
  assert.match(doctor.stdout, /doctor passed/);
});

test("setup can install OpenSpec when explicitly requested", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-openspec-home-"));
  const skillsHome = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-openspec-skills-"));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-openspec-bin-"));
  const npmLog = path.join(home, "npm.log");
  const npmPath = path.join(binDir, "npm");
  fs.writeFileSync(npmPath, `#!/bin/sh
printf "%s\\n" "$*" > "${npmLog}"
cat > "${path.join(binDir, "openspec")}" <<'EOF'
#!/bin/sh
printf 'openspec-installed\\n'
EOF
chmod +x "${path.join(binDir, "openspec")}"
`);
  fs.chmodSync(npmPath, 0o755);
  const env = {
    HOME: home,
    AI_CONTEXT_SKILLS_HOMES: skillsHome,
    PATH: `${binDir}${path.delimiter}/bin${path.delimiter}/usr/bin`
  };

  const setup = runInstallScript(["setup", "--install-openspec"], env);
  assert.equal(setup.status, 0, setup.stderr);
  assert.match(fs.readFileSync(npmLog, "utf8"), /install -g @fission-ai\/openspec@latest/);
  assert.match(setup.stdout, /ok OpenSpec CLI: openspec-installed/);
});

test("sync-projects removes legacy ai-context managed entry blocks", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-sync-home-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-sync-project-"));
  const claudeEntry = path.join(projectDir, ".claude", "CLAUDE.md");
  fs.mkdirSync(path.dirname(claudeEntry), { recursive: true });
  fs.writeFileSync(claudeEntry, `# Existing notes

<!-- ai-context:managed-entry:start -->
# ai-context AI Entry

Read first:

1. config/projects/ai-context.json

<!-- ai-context:managed-entry:end -->

<!-- devflow:managed-entry:start -->
# Old DevFlow Entry
<!-- devflow:managed-entry:end -->
`);

  const sync = runInstallScript(["sync-projects", "--project", "devflow", "--entries-only", "--write"], {
    HOME: home,
    AI_CONTEXT_PROJECT_PATH_OVERRIDES: `devflow=${projectDir}`
  });

  assert.equal(sync.status, 0, sync.stderr);
  const content = fs.readFileSync(claudeEntry, "utf8");
  assert.doesNotMatch(content, /ai-context:managed-entry/);
  assert.doesNotMatch(content, /config\/projects\/ai-context\.json/);
  assert.match(content, /devflow:managed-entry:start/);
  assert.match(content, /devflow query route "<user request>"/);
  assert.match(content, /SQLite\/query migration is incomplete/);
  assert.match(content, /# Existing notes/);
});

test("sync-projects writes on-demand DevFlow routing policy into agent entries", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-routing-home-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-routing-project-"));

  const sync = runInstallScript(["sync-projects", "--project", "devflow", "--entries-only", "--write"], {
    HOME: home,
    AI_CONTEXT_PROJECT_PATH_OVERRIDES: `devflow=${projectDir}`
  });

  assert.equal(sync.status, 0, sync.stderr);

  const agentsEntry = fs.readFileSync(path.join(projectDir, "AGENTS.md"), "utf8");
  const claudeEntry = fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf8");
  const cursorEntry = fs.readFileSync(path.join(projectDir, ".cursor", "rules", "00-devflow.mdc"), "utf8");

  for (const content of [agentsEntry, claudeEntry, cursorEntry]) {
    assert.match(content, /DevFlow is an on-demand capability set/i);
    assert.match(content, /Do not load all projects, scene templates, skills, rules, or task history by default/);
    assert.match(content, /devflow query route "<user request>"/);
    assert.match(content, /devflow query skills/);
    assert.match(content, /devflow query rules/);
    assert.match(content, /Read only returned readPaths and skills\.sourcePath/);
    assert.match(content, /devflow query current/);
    assert.match(content, /If devflow query is unavailable[\s\S]+SQLite\/query migration is incomplete/);
    assert.doesNotMatch(content, legacyJsonEntryGuidancePattern);
    assert.doesNotMatch(content, /before reading JSON indexes/i);
    assert.match(content, /none.*ordinary questions/i);
    assert.match(content, /resume.*current task/i);
    assert.match(content, /light.*small bug/i);
    assert.match(content, /full.*high-risk/i);
    assert.match(content, /Do not start G1-G7 by default/i);
  }
});

test("validate rejects obvious private data in public template files", () => {
  const leakFile = path.join(os.tmpdir(), `devflow-private-leak-${process.pid}.md`);
  fs.writeFileSync(leakFile, "private local path: /Users/example/Documents/private-project\n");

  let result;
  try {
    result = runInstallScript(["validate"], {
      AI_CONTEXT_PUBLIC_PRIVACY_SCAN_EXTRA_FILES: leakFile
    });
  } finally {
    fs.rmSync(leakFile, { force: true });
  }

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /public template privacy leak/i);
  assert.match(result.stderr, /absolute macOS home path/i);
});

test("validate can use caller-provided private privacy patterns", () => {
  const leakFile = path.join(os.tmpdir(), `devflow-private-pattern-${process.pid}.md`);
  fs.writeFileSync(leakFile, "private project codename: internal-order-system\n");

  let result;
  try {
    result = runInstallScript(["validate"], {
      AI_CONTEXT_PUBLIC_PRIVACY_SCAN_EXTRA_FILES: leakFile,
      AI_CONTEXT_PRIVATE_PRIVACY_PATTERNS: "internal-order-system"
    });
  } finally {
    fs.rmSync(leakFile, { force: true });
  }

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /public template privacy leak/i);
  assert.match(result.stderr, /private pattern 1/i);
});

async function copySqliteOnlyFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-sqlite-install-"));
  fs.cpSync(basicFixtureRoot, fixtureRoot, { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "bundles", "skills"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
  fs.cpSync(path.join(rootDir, "bundles/skills/devflow"), path.join(fixtureRoot, "bundles/skills/devflow"), { recursive: true });
  fs.cpSync(path.join(rootDir, "bundles/skills/devflow-init"), path.join(fixtureRoot, "bundles/skills/devflow-init"), { recursive: true });
  fs.cpSync(path.join(rootDir, "scripts/install-ai-context.mjs"), path.join(fixtureRoot, "scripts/install-ai-context.mjs"));
  await seedSqliteFromJsonFixture(fixtureRoot);
  await prepareValidationState(fixtureRoot);
  fs.rmSync(path.join(fixtureRoot, "config"), { recursive: true, force: true });
  fs.rmSync(path.join(fixtureRoot, "runtime"), { recursive: true, force: true });
  return fixtureRoot;
}

async function prepareValidationState(fixtureRoot) {
  const repository = createSqliteRepository({ rootDir: fixtureRoot });
  const entry = await repository.getEntry();
  await repository.setConfig("entry", {
    ...entry,
    installation: {
      ...(entry.installation || {}),
      script: "scripts/install-ai-context.mjs"
    }
  });
  const [rule] = await repository.listRules();
  const validRule = {
    ...rule,
    applyMode: "scene-on-demand",
    globs: ["**/*"],
    whenToRead: "Read this demo rule for validation fixtures."
  };
  await repository.writeRule(validRule);
}

async function captureConsole(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const lines = { stdout: [], stderr: [] };
  console.log = (...args) => lines.stdout.push(args.join(" "));
  console.warn = (...args) => lines.stderr.push(args.join(" "));
  console.error = (...args) => lines.stderr.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  return {
    stdout: lines.stdout.join("\n"),
    stderr: lines.stderr.join("\n")
  };
}
