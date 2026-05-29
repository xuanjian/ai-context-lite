import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest, startServer } from "../../src/server.mjs";
import { seedSqliteFromJsonFixture } from "../helpers/sqlite-fixtures.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(testDir, "../core/fixtures/basic-ai-context");

async function copyFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devflow-server-"));
  await fs.cp(fixtureRoot, root, { recursive: true });
  await seedSqliteFromJsonFixture(root);
  return root;
}

test("server serves bootstrap HTML without frontend build", async () => {
  const rootDir = await copyFixture();
  const server = await startServer({ rootDir, port: 0 });
  try {
    const response = await fetch(`${server.url}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Context Studio/);
    assert.match(html, /Initialization/);
  } finally {
    await server.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("server exposes graph and checks APIs", async () => {
  const rootDir = await copyFixture();
  const server = await startServer({ rootDir, port: 0 });
  try {
    const graph = await fetch(`${server.url}/api/graph`).then((res) => res.json());
    const checks = await fetch(`${server.url}/api/checks`).then((res) => res.json());

    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.nodes.some((node) => node.id === "task:demo-task"));
    assert.ok(graph.nodes.some((node) => node.id === "sceneTemplate:demo-scene"));
    assert.ok(checks.checks.length > 0);
  } finally {
    await server.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("server API delegates graph, checks, node details, and actions to DevFlow service", async () => {
  const calls = [];
  const service = {
    async buildContextGraph() {
      calls.push("buildContextGraph");
      return { nodes: [{ id: "project:demo", type: "project", title: "Demo" }], edges: [], warnings: [] };
    },
    async getNodeDetails(nodeId) {
      calls.push(`getNodeDetails:${nodeId}`);
      return { node: { id: nodeId, type: "project", title: "Demo" } };
    },
    async runChecks(input) {
      calls.push(`runChecks:${input.runCommands}`);
      return { checks: [{ id: "demo_check", status: "pass" }] };
    },
    async runAction(input) {
      calls.push(`runAction:${input.actionId}:${input.body.value}`);
      return { ok: true, actionId: input.actionId };
    }
  };
  const server = await startServer({
    rootDir: fixtureRoot,
    port: 0,
    service
  });
  try {
    const graph = await fetch(`${server.url}/api/graph`).then((res) => res.json());
    const nodeDetails = await fetch(`${server.url}/api/nodes/project%3Ademo`).then((res) => res.json());
    const checks = await fetch(`${server.url}/api/checks`).then((res) => res.json());
    const action = await fetch(`${server.url}/api/actions/demo_action`, {
      method: "POST",
      body: JSON.stringify({ value: "payload" })
    }).then((res) => res.json());

    assert.equal(graph.nodes[0].id, "project:demo");
    assert.equal(nodeDetails.node.id, "project:demo");
    assert.equal(checks.checks[0].id, "demo_check");
    assert.equal(action.ok, true);
    assert.deepEqual(calls, [
      "buildContextGraph",
      "getNodeDetails:project:demo",
      "runChecks:false",
      "runAction:demo_action:payload"
    ]);
  } finally {
    await server.close();
  }
});

test("server exposes the configured profile markdown document", async () => {
  const rootDir = await copyFixture();
  const server = await startServer({ rootDir, port: 0 });
  try {
    const profileDocument = await fetch(`${server.url}/api/profile-document`).then((res) => res.json());

    assert.equal(profileDocument.sourcePath, "docs/person/profile.md");
    assert.match(profileDocument.markdown, /fixture collaboration preferences/i);
  } finally {
    await server.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("server opens registered artifact documents in the browser", async () => {
  const rootDir = await copyFixture();
  const server = await startServer({ rootDir, port: 0 });
  const artifactId = `artifact:${encodeURIComponent("docs/demo-technical-design.md")}`;
  try {
    const response = await fetch(`${server.url}/api/artifacts/${encodeURIComponent(artifactId)}`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(html, /Demo Technical Design/);
    assert.match(html, /docs\/demo-technical-design\.md/);
  } finally {
    await server.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("server serves registered HTML artifacts as rendered HTML", async () => {
  const rootDir = await copyFixture();
  const server = await startServer({ rootDir, port: 0 });
  const artifactId = `artifact:${encodeURIComponent("docs/demo-technical-design.html")}`;
  try {
    const response = await fetch(`${server.url}/api/artifacts/${encodeURIComponent(artifactId)}`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(html, /<main data-testid="html-artifact">/);
    assert.doesNotMatch(html, /&lt;main data-testid=/);
  } finally {
    await server.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("server rejects unregistered artifact documents", async () => {
  const rootDir = await copyFixture();
  const server = await startServer({ rootDir, port: 0 });
  try {
    const response = await fetch(`${server.url}/api/artifacts/${encodeURIComponent("artifact:/etc/passwd")}`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "unknown_artifact");
  } finally {
    await server.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("server returns an empty profile document when fresh install has no source path", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-context-fresh-profile-"));
  await fs.mkdir(path.join(rootDir, "config"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "config/profile.json"), JSON.stringify({ version: 1 }, null, 2));
  const server = await startServer({ rootDir, port: 0 });
  try {
    const profileDocument = await fetch(`${server.url}/api/profile-document`).then((res) => res.json());

    assert.equal(profileDocument.sourcePath, "");
    assert.equal(profileDocument.markdown, "");
    assert.equal(profileDocument.empty, true);
    assert.match(profileDocument.message, /devflow-init/);
  } finally {
    await server.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("server rejects unknown actions", async () => {
  const server = await startServer({ rootDir: new URL("./core/fixtures/basic-ai-context/", import.meta.url), port: 0 });
  try {
    const response = await fetch(`${server.url}/api/actions/not_allowed`, { method: "POST", body: "{}" });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, "unsupported_action");
  } finally {
    await server.close();
  }
});

test("server rejects malformed JSON action bodies", async () => {
  const server = await startServer({ rootDir: new URL("./core/fixtures/basic-ai-context/", import.meta.url), port: 0 });
  try {
    const response = await fetch(`${server.url}/api/actions/check_ai_context`, { method: "POST", body: "{" });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, "invalid_json");
  } finally {
    await server.close();
  }
});

test("handleApiRequest handles API routes for Vite middleware", async () => {
  const rootDir = await copyFixture();
  let statusCode = 200;
  let body = "";
  const headers = {};
  const request = {
    method: "GET",
    url: "/api/graph",
    headers: { host: "127.0.0.1:5173" },
    [Symbol.asyncIterator]: async function* noop() {}
  };
  const response = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    writeHead(status, nextHeaders) {
      statusCode = status;
      Object.assign(headers, nextHeaders);
    },
    end(chunk = "") {
      body += chunk;
    }
  };

  try {
    const handled = await handleApiRequest({
      request,
      response,
      rootDir
    });
    const payload = JSON.parse(body);

    assert.equal(handled, true);
    assert.equal(statusCode, 200);
    assert.ok(headers["content-type"].includes("application/json"));
    assert.ok(payload.nodes.length > 0);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
