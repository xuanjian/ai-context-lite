import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSqliteRepository } from "../../src/core/repositories/sqlite-repository.mjs";
import { seedSqliteFromJsonFixture } from "../helpers/sqlite-fixtures.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../..");
const cliPath = path.join(repoRoot, "scripts/devflow-cli.mjs");
const fixtureRoot = path.join(repoRoot, "tests/core/fixtures/basic-ai-context");

function copyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cli-scan-relations-"));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

function runCli(rootDir, args) {
  return spawnSync(process.execPath, [cliPath, "--root", rootDir, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8"
  });
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function writePackage(projectDir, pkg) {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

function writeDomainConfig(projectDir, source) {
  const localDir = path.join(projectDir, "local");
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(path.join(localDir, "domainConfig.js"), `${source.trim()}\n`);
}

test("scan-relations previews depends-on edges from package names without writing sqlite", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const repository = createSqliteRepository({ rootDir: root });
  const projectsDir = path.join(root, "package-fixtures");
  const appDir = path.join(projectsDir, "app");
  const commonDir = path.join(projectsDir, "common");
  const packagesDir = path.join(projectsDir, "packages");
  const domainConsumerDir = path.join(projectsDir, "domain-consumer");
  const missingPackageJsonDir = path.join(projectsDir, "ios-app");
  const missingPath = path.join(projectsDir, "missing");

  writePackage(appDir, {
    name: "cash-mini",
    dependencies: {
      "dhbfront-utils": "^1.0.0",
      "@dhbfront-utils/domain": "^1.0.0",
      "@egg-dhb-business/common-lib": "^1.0.0",
      "@dhbmini/goods": "^2.0.0",
      "egg-dhb-framework": "^1.0.0",
      "react": "^18.0.0"
    },
    devDependencies: {
      "egg-business": "^1.0.0"
    }
  });
  writePackage(commonDir, { name: "dhbfront-utils" });
  writePackage(packagesDir, { name: "internal-packages" });
  writePackage(domainConsumerDir, {
    name: "domain-consumer",
    dependencies: {
      "@dhbfront-domain-goods/taro-shared-ui": "^1.0.0"
    }
  });
  fs.mkdirSync(missingPackageJsonDir, { recursive: true });

  await repository.writeProject({ id: "cash-mini", path: appDir });
  await repository.writeProject({ id: "dhbfront-utils", path: commonDir });
  await repository.writeProject({ id: "dhb-packages", path: packagesDir });
  await repository.writeProject({ id: "domain-consumer", path: domainConsumerDir });
  await repository.writeProject({ id: "egg-business" });
  await repository.writeProject({ id: "egg-dhb-framework", path: missingPackageJsonDir });
  await repository.writeProject({ id: "ios-app", path: missingPackageJsonDir });
  await repository.writeProject({ id: "missing-path", path: missingPath });

  const preview = parseJson(runCli(root, ["scan-relations", "--dry-run"]));

  assert.equal(preview.status, "noop");
  assert.equal(preview.action, "scanRelations");
  assert.deepEqual(preview.edges, [
    { from: "project:cash-mini", to: "project:dhbfront-utils", relation: "depends-on", packageName: "dhbfront-utils" },
    { from: "project:cash-mini", to: "project:egg-business", relation: "depends-on", packageName: "@egg-dhb-business/common-lib" },
    { from: "project:cash-mini", to: "project:dhb-packages", relation: "depends-on", packageName: "@dhbmini/goods" },
    { from: "project:cash-mini", to: "project:egg-dhb-framework", relation: "depends-on", packageName: "egg-dhb-framework" },
    { from: "project:domain-consumer", to: "project:dhb-packages", relation: "depends-on", packageName: "@dhbfront-domain-goods/taro-shared-ui" }
  ]);
  assert.match(JSON.stringify(preview.warnings), /missing_path/);
  assert.match(JSON.stringify(preview.warnings), /missing_package_json/);
  assert.equal((await repository.listGraphEdges()).some((edge) => edge.relation === "depends-on"), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).dependencies.react, "^18.0.0");
});

test("scan-relations writes depends-on edges idempotently", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const repository = createSqliteRepository({ rootDir: root });
  const appDir = path.join(root, "package-fixtures", "bff-order");
  const commonDir = path.join(root, "package-fixtures", "egg-business");

  writePackage(appDir, {
    name: "bff-order",
    dependencies: {
      "egg-business": "^1.0.0"
    },
    devDependencies: {
      "egg": "^3.0.0"
    }
  });
  writePackage(commonDir, { name: "egg-business" });
  await repository.writeProject({ id: "bff-order", path: appDir });
  await repository.writeProject({ id: "egg-business", path: commonDir });

  const write = parseJson(runCli(root, ["scan-relations"]));
  const secondWrite = parseJson(runCli(root, ["scan-relations"]));
  const edges = await repository.listGraphEdges();

  assert.equal(write.status, "ok");
  assert.equal(secondWrite.status, "noop");
  assert.deepEqual(edges.filter((edge) => edge.relation === "depends-on"), [
    { from: "project:bff-order", to: "project:egg-business", relation: "depends-on" }
  ]);
});

test("scan-relations previews and writes calls edges from frontend domainConfig idempotently", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const repository = createSqliteRepository({ rootDir: root });
  const mobileDir = path.join(root, "domain-config-fixtures", "dhb-mobile-index");
  const containerDir = path.join(root, "domain-config-fixtures", "new-mobile-h5");
  const missingConfigDir = path.join(root, "domain-config-fixtures", "missing-config");

  writeDomainConfig(mobileDir, `
    export default {
      "bff-goods": "http://bff-goods.newdhb.com",
      "bff-order": "http://bff-order.newdhb.com",
      'bff-user': 'http://bff-user.newdhb.com',
      bffPayment: "ignored because key is not a project id",
      "bff-payment": "http://bff-payment.newdhb.com",
      "bff-warehouse": "http://bff-warehouse.newdhb.com",
      "bff-missing": "http://bff-missing.newdhb.com"
    };
  `);
  writeDomainConfig(containerDir, `
    module.exports = {
      "bff-order": "http://bff-order.newdhb.com",
      "bff-user": "http://bff-user.newdhb.com"
    };
  `);
  fs.mkdirSync(missingConfigDir, { recursive: true });

  await repository.writeProject({ id: "dhb-mobile-index", path: mobileDir, technologyFamilyId: "frontend", role: "h5" });
  await repository.writeProject({ id: "new-mobile-h5", path: containerDir, role: "container" });
  await repository.writeProject({ id: "missing-config-frontend", path: missingConfigDir, role: "mini-program" });
  for (const projectId of ["bff-goods", "bff-order", "bff-user", "bff-payment", "bff-warehouse"]) {
    await repository.writeProject({ id: projectId, role: "bff-service" });
  }

  const preview = parseJson(runCli(root, ["scan-relations", "--dry-run"]));
  const previewCalls = preview.edges
    .filter((edge) => edge.relation === "calls")
    .map(({ from, to, relation, domainConfigKey }) => ({ from, to, relation, domainConfigKey }))
    .sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`));

  assert.equal(preview.status, "noop");
  assert.deepEqual(previewCalls, [
    { from: "project:dhb-mobile-index", to: "project:bff-goods", relation: "calls", domainConfigKey: "bff-goods" },
    { from: "project:dhb-mobile-index", to: "project:bff-order", relation: "calls", domainConfigKey: "bff-order" },
    { from: "project:dhb-mobile-index", to: "project:bff-payment", relation: "calls", domainConfigKey: "bff-payment" },
    { from: "project:dhb-mobile-index", to: "project:bff-user", relation: "calls", domainConfigKey: "bff-user" },
    { from: "project:dhb-mobile-index", to: "project:bff-warehouse", relation: "calls", domainConfigKey: "bff-warehouse" },
    { from: "project:new-mobile-h5", to: "project:bff-order", relation: "calls", domainConfigKey: "bff-order" },
    { from: "project:new-mobile-h5", to: "project:bff-user", relation: "calls", domainConfigKey: "bff-user" }
  ]);
  assert.match(JSON.stringify(preview.warnings), /missing_domain_config/);
  assert.match(JSON.stringify(preview.warnings), /unmapped_bff_domain_config_key/);
  assert.equal((await repository.listGraphEdges()).some((edge) => edge.relation === "calls"), false);

  const write = parseJson(runCli(root, ["scan-relations"]));
  const secondWrite = parseJson(runCli(root, ["scan-relations"]));
  const calls = (await repository.listGraphEdges())
    .filter((edge) => edge.relation === "calls")
    .sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`));

  assert.equal(write.status, "ok");
  assert.equal(secondWrite.status, "noop");
  assert.deepEqual(calls, previewCalls.map(({ from, to, relation }) => ({ from, to, relation })));
});
