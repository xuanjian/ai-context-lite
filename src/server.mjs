import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBootstrapPage } from "./bootstrap/page.mjs";
import { readJsonFile } from "./core/json-loader.mjs";
import { resolveInside, toPath } from "./core/paths.mjs";
import { createDevFlowService } from "./core/services/devflow-service.mjs";

const DEFAULT_HOST = "127.0.0.1";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

export async function startServer({ rootDir = process.cwd(), port = 0, host = DEFAULT_HOST, service } = {}) {
  const rootPath = toPath(rootDir);
  const devflowService = service || createDevFlowService({ rootDir: rootPath });
  const server = http.createServer((request, response) => {
    handleRequest({ request, response, rootPath, service: devflowService }).catch((error) => {
      sendJson(response, 500, { error: { code: "server_error", message: error.message } });
    });
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  return {
    url,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

export async function handleApiRequest({ request, response, rootDir = process.cwd(), service } = {}) {
  const rootPath = toPath(rootDir);
  const devflowService = service || createDevFlowService({ rootDir: rootPath });
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }
  await handleApiRoute({ request, response, rootPath, url, service: devflowService });
  return true;
}

async function handleRequest({ request, response, rootPath, service }) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    return handleApiRoute({ request, response, rootPath, url, service });
  }

  if (request.method !== "GET") {
    return sendJson(response, 405, { error: { code: "method_not_allowed", message: "Only GET is supported." } });
  }

  return serveAppOrBootstrap(response, rootPath, url.pathname, service);
}

async function handleApiRoute({ request, response, rootPath, url, service }) {
  if (url.pathname === "/api/graph" && request.method === "GET") {
    return sendJson(response, 200, await service.buildContextGraph());
  }

  if (url.pathname.startsWith("/api/nodes/") && request.method === "GET") {
    const nodeId = decodeURIComponent(url.pathname.slice("/api/nodes/".length));
    const details = await service.getNodeDetails(nodeId);
    return details
      ? sendJson(response, 200, details)
      : sendJson(response, 404, { error: { code: "unknown_node", message: `Unknown node: ${nodeId}` } });
  }

  if (url.pathname.startsWith("/api/artifacts/") && request.method === "GET") {
    const nodeId = decodeURIComponent(url.pathname.slice("/api/artifacts/".length));
    const details = await service.getNodeDetails(nodeId);
    return details?.node?.type === "artifact"
      ? serveArtifactDocument(response, rootPath, details.node)
      : sendJson(response, 404, { error: { code: "unknown_artifact", message: `Unknown artifact: ${nodeId}` } });
  }

  if (url.pathname === "/api/checks" && request.method === "GET") {
    return sendJson(response, 200, await service.runChecks({ runCommands: false }));
  }

  if (url.pathname === "/api/profile-document" && request.method === "GET") {
    return sendJson(response, 200, await readProfileDocument(rootPath));
  }

  if (url.pathname.startsWith("/api/actions/")) {
    if (request.method !== "POST") {
      return sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use POST for actions." } });
    }
    const actionId = decodeURIComponent(url.pathname.slice("/api/actions/".length));
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) {
      return sendJson(response, 400, { error: bodyResult.error });
    }
    const body = bodyResult.data;
    const result = await service.runAction({ actionId, body });
    return sendJson(response, result.ok ? 200 : 400, result);
  }

  return sendJson(response, 404, { error: { code: "unknown_api_route", message: `Unknown API route: ${url.pathname}` } });
}

async function serveArtifactDocument(response, rootPath, artifactNode) {
  const artifactPath = artifactNode.raw?.path || artifactNode.sourcePath || "";
  if (!artifactPath) {
    return sendJson(response, 404, { error: { code: "artifact_path_missing", message: "Artifact path is missing." } });
  }
  const absolutePath = path.isAbsolute(artifactPath) ? artifactPath : resolveInside(rootPath, artifactPath);
  try {
    const content = await fs.readFile(absolutePath, "utf8");
    const title = artifactNode.title || path.basename(artifactPath);
    if (isHtmlArtifact(artifactPath)) {
      response.writeHead(200, { "content-type": MIME_TYPES[".html"] });
      response.end(content);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderArtifactPage({ title, artifactPath, content }));
  } catch (error) {
    return sendJson(response, 404, {
      error: {
        code: error?.code || "read_artifact_failed",
        message: error.message,
        path: artifactPath
      }
    });
  }
}

function isHtmlArtifact(artifactPath) {
  return [".html", ".htm"].includes(path.extname(artifactPath).toLowerCase());
}

function renderArtifactPage({ title, artifactPath, content }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #171717; color: #e6edf3; }
    header { position: sticky; top: 0; padding: 16px 22px; background: #202020; border-bottom: 1px solid #333; }
    h1 { margin: 0 0 6px; font-size: 18px; }
    p { margin: 0; color: #9aa4ad; font-size: 13px; word-break: break-all; }
    pre { margin: 0; padding: 22px; white-space: pre-wrap; word-break: break-word; line-height: 1.55; font-size: 14px; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(artifactPath)}</p>
  </header>
  <pre>${escapeHtml(content)}</pre>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readProfileDocument(rootPath) {
  const profile = await readJsonFile(resolveInside(rootPath, "config/profile.json"));
  const sourcePath = profile.data?.sourcePath || "";
  if (!sourcePath) {
    return {
      sourcePath: "",
      markdown: "",
      empty: true,
      message: "No profile document is configured yet. Run devflow-init to create one."
    };
  }
  try {
    return {
      sourcePath,
      markdown: await fs.readFile(resolveInside(rootPath, sourcePath), "utf8")
    };
  } catch (error) {
    return {
      sourcePath,
      markdown: "",
      error: { code: error?.code || "read_profile_document_failed", message: error.message }
    };
  }
}

async function serveAppOrBootstrap(response, rootPath, requestPath, service) {
  const distPath = path.join(rootPath, "dist/app");
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const candidate = path.normalize(normalized).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(distPath, candidate);

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      const ext = path.extname(filePath);
      response.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
      response.end(await fs.readFile(filePath));
      return;
    }
  } catch {
    // Fall through to bootstrap or SPA fallback.
  }

  try {
    const indexPath = path.join(distPath, "index.html");
    const index = await fs.readFile(indexPath);
    response.writeHead(200, { "content-type": MIME_TYPES[".html"] });
    response.end(index);
  } catch {
    const checks = await service.runChecks({ runCommands: false });
    response.writeHead(200, { "content-type": MIME_TYPES[".html"] });
    response.end(renderBootstrapPage(checks));
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": MIME_TYPES[".json"] });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return { ok: true, data: {} };
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false, error: { code: "invalid_json", message: "Action body must be valid JSON." } };
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const portArg = process.env.PORT ? Number(process.env.PORT) : 49321;
  const server = await startServer({ port: portArg, host: DEFAULT_HOST });
  console.log(`Context Studio: ${server.url}`);
}
