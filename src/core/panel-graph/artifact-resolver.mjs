import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside, toPath } from "../paths.mjs";
import { summarizeMarkdown } from "../markdown.mjs";
import { DEFAULT_GATES } from "./grouping.mjs";
import { addEdge, addNode, ensureTaskGateNode } from "./node-builder.mjs";

export async function addArtifactNodes(graph, rootPath, gateCatalog) {
  const taskNodes = graph.nodes.filter((node) => node.type === "task");
  for (const task of taskNodes) {
    const taskId = task.raw?.id || task.id.slice("task:".length);
    const taskDir = `runtime/tasks/${taskId}`;
    const handoffPath = task.raw?.paths?.handoff || `${taskDir}/handoff.md`;
    await addArtifactPath(graph, rootPath, task, null, handoffPath, { kind: "handoff" });
    await addReferencedArtifactsFromMarkdown(graph, rootPath, task, null, handoffPath, gateCatalog);

    const gateArtifactPaths = await discoverGateArtifactPaths(rootPath, taskDir);
    for (const artifactPath of gateArtifactPaths) {
      const gateId = gateIdFromArtifactPath(artifactPath);
      const gateNode = graph.nodes.find((node) => node.id === `gate:${taskId}:${gateId}`) || null;
      await addArtifactPath(graph, rootPath, task, gateNode, artifactPath, { kind: "gate-artifacts" });
      await addReferencedArtifactsFromMarkdown(graph, rootPath, task, gateNode, artifactPath, gateCatalog);
    }
  }
}

export async function addArtifactPath(graph, rootPath, task, gate, artifactPath, raw = {}) {
  if (!artifactPath) return null;
  const normalizedPath = normalizeArtifactPath(artifactPath);
  if (!normalizedPath) return null;
  const exists = await pathExists(rootPath, normalizedPath);
  const summary = await readArtifactSummary(rootPath, normalizedPath, exists);
  const nodeId = artifactNodeId(normalizedPath);
  const node = addNode(graph, {
    id: nodeId,
    type: "artifact",
    title: artifactTitle(normalizedPath, raw.label),
    summary,
    sourcePath: normalizedPath,
    docPath: normalizedPath.endsWith(".md") ? normalizedPath : "",
    status: exists ? "ok" : "warning",
    raw: {
      id: normalizedPath,
      path: normalizedPath,
      sourceExists: exists,
      taskId: task.raw?.id || task.id.slice("task:".length),
      gateId: gate?.raw?.id || "",
      ...raw
    }
  });
  addEdge(graph, task.id, node.id, "has-artifact", task.sourcePath || "task");
  if (gate) {
    addEdge(graph, gate.id, node.id, "produced-artifact", gate.sourcePath || "gate");
  }
  return node;
}

export async function addReferencedArtifactsFromMarkdown(graph, rootPath, task, gate, artifactPath, gateCatalog) {
  const markdown = await readText(rootPath, artifactPath);
  if (!markdown) return;
  for (const artifact of extractArtifactReferences(markdown, rootPath)) {
    const artifactGate = artifact.gateId
      ? ensureTaskGateNode(graph, task, artifact.gateId, gateCatalog) || gate
      : gate;
    await addArtifactPath(graph, rootPath, task, artifactGate, artifact.path, {
      kind: "referenced-artifact",
      label: artifact.label,
      inferredGateId: artifact.gateId || artifactGate?.raw?.id || "",
      sourceArtifactPath: artifactPath
    });
  }
}


export async function discoverGateArtifactPaths(rootPath, taskDir) {
  const absoluteTaskDir = resolveInside(rootPath, taskDir);
  let entries;
  try {
    entries = await fs.readdir(absoluteTaskDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const paths = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^G\d+$/i.test(entry.name)) continue;
    const relativePath = `${taskDir}/${entry.name}/artifacts.md`;
    if (await pathExists(rootPath, relativePath)) {
      paths.push(relativePath);
    }
  }
  return paths.sort();
}

export function gateIdFromArtifactPath(artifactPath) {
  return String(artifactPath).split("/").find((segment) => /^G\d+$/i.test(segment)) || "";
}

export function extractArtifactReferences(markdown, rootPath) {
  const refs = new Map();
  let inFence = false;
  let inArtifactSection = false;
  let currentHeading = "";
  for (const line of String(markdown || "").split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*#+\s+/.test(line)) {
      currentHeading = line.replace(/^\s*#+\s+/, "").trim();
      inArtifactSection = /artifact|产物/i.test(currentHeading);
    }

    const candidates = [];
    if (/^\s*\|/.test(line)) {
      for (const cell of line.split("|").slice(1, -1)) {
        candidates.push(cell);
      }
    } else if (inArtifactSection && /^\s*[-*]\s+/.test(line)) {
      candidates.push(line.replace(/^\s*[-*]\s+/, ""));
    }

    for (const candidate of candidates) {
      for (const artifactPath of extractPathCandidates(candidate, rootPath)) {
        const label = artifactTitle(artifactPath);
        refs.set(artifactPath, {
          path: artifactPath,
          label,
          gateId: inferArtifactGateId({ path: artifactPath, label, context: `${currentHeading} ${candidate}` })
        });
      }
    }
  }
  return [...refs.values()];
}

export function inferArtifactGateId({ path: artifactPath, label, context }) {
  const text = `${artifactPath || ""} ${label || ""} ${context || ""}`.toLowerCase();
  if (/product[-_ ]?plan|technical[-_ ]?design|design|方案|技术方案|产品方案|实现计划|plan/.test(text)) {
    return "G3";
  }
  if (/discovery|research|evidence|investigation|调研|证据|接口响应|curl|样例|验证/.test(text)) {
    return "G2";
  }
  if (/acceptance|验收|测试结果|test-result|verification/.test(text)) {
    return "G6";
  }
  if (/runbook|deploy|package|archive|发布|部署|归档|打包/.test(text)) {
    return "G7";
  }
  return "";
}

export function extractPathCandidates(value, rootPath) {
  const normalized = stripMarkdown(value);
  const candidates = [];
  const absoluteMatches = [...normalized.matchAll(/\/Users\/[^|]+/g)];
  for (const match of absoluteMatches) {
    const candidate = normalizeArtifactPath(match[0], rootPath);
    if (candidate && !candidate.includes("<task-id>")) candidates.push(candidate);
  }
  let withoutAbsolutePaths = normalized;
  for (const match of absoluteMatches) {
    withoutAbsolutePaths = withoutAbsolutePaths.replace(match[0], " ");
  }
  for (const match of withoutAbsolutePaths.matchAll(/\b(?:runtime\/tasks|docs|src|apps|tests|config|scripts)\/[^\s|，,]+/g)) {
    const candidate = normalizeArtifactPath(match[0], rootPath);
    if (candidate && !candidate.includes("<task-id>")) candidates.push(candidate);
  }
  return candidates;
}

export function normalizeArtifactPath(value, rootPath = "") {
  const raw = stripMarkdown(value);
  const startIndex = firstPathIndex(raw);
  if (startIndex === -1) return "";
  const normalized = raw
    .slice(startIndex)
    .replace(/[。；;，,）)\]]+$/g, "")
    .trim();
  const rootPrefix = rootPath ? `${toPath(rootPath)}/` : "";
  return rootPrefix && normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized;
}

export function firstPathIndex(value) {
  const indexes = [
    value.indexOf("/Users/"),
    value.indexOf("runtime/tasks/"),
    value.indexOf("docs/"),
    value.indexOf("src/"),
    value.indexOf("apps/"),
    value.indexOf("tests/"),
    value.indexOf("config/"),
    value.indexOf("scripts/")
  ].filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

export function stripMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/^.*?→\s*/, "")
    .trim();
}

export function artifactNodeId(artifactPath) {
  return `artifact:${encodeURIComponent(artifactPath)}`;
}

export function artifactTitle(artifactPath, fallback = "") {
  if (fallback) return fallback;
  const normalized = String(artifactPath || "").replace(/\/$/, "");
  return path.basename(normalized) || normalized || "artifact";
}

export async function readArtifactSummary(rootPath, artifactPath, exists) {
  if (!exists || !artifactPath.endsWith(".md")) {
    return artifactPath;
  }
  const raw = await readText(rootPath, artifactPath);
  return raw ? summarizeMarkdown(raw) : artifactPath;
}

export async function readText(rootPath, artifactPath) {
  if (!artifactPath) return "";
  try {
    return await fs.readFile(absoluteArtifactPath(rootPath, artifactPath), "utf8");
  } catch {
    return "";
  }
}

export async function pathExists(rootPath, artifactPath) {
  try {
    await fs.access(absoluteArtifactPath(rootPath, artifactPath));
    return true;
  } catch {
    return false;
  }
}

export function absoluteArtifactPath(rootPath, artifactPath) {
  return path.isAbsolute(artifactPath) ? artifactPath : resolveInside(rootPath, artifactPath);
}


export async function readProfileNode(rootPath) {
  let profile;
  try {
    profile = JSON.parse(await fs.readFile(resolveInside(rootPath, "config/profile.json"), "utf8"));
  } catch {
    return null;
  }
  const sourcePath = profile.sourcePath || "docs/person/profile.md";
  const document = await readOptionalMarkdown(rootPath, sourcePath);
  return {
    id: "profile:main",
    type: "profile",
    title: "Persona Profile",
    summary: profile.role || "Persona and collaboration profile",
    sourcePath: "config/profile.json",
    docPath: sourcePath,
    documentationSummary: document.summary,
    status: document.exists ? "ok" : "warning",
    raw: profile
  };
}

export async function readGateCatalog(rootPath) {
  try {
    const catalog = JSON.parse(await fs.readFile(resolveInside(rootPath, "config/tasks/gates.json"), "utf8"));
    return catalog.gates?.length ? catalog.gates : DEFAULT_GATES;
  } catch {
    return DEFAULT_GATES;
  }
}

export async function readOptionalMarkdown(rootPath, relativePath) {
  if (!relativePath) {
    return { exists: false, summary: "" };
  }
  try {
    const raw = await fs.readFile(resolveInside(rootPath, relativePath), "utf8");
    return { exists: true, summary: summarizeMarkdown(raw) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, summary: "" };
    }
    return { exists: false, summary: error.message };
  }
}

