import fs from "node:fs";
import path from "node:path";
import { normalizeCommandResult } from "../contracts/devflow-types.mjs";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies"];
const DOMAIN_CONFIG_RELATIVE_PATH = path.join("local", "domainConfig.js");
const FRONTEND_DOMAIN_CONFIG_ROLES = new Set(["h5", "container", "main-package", "subpackage", "mini-program"]);
const SPECIAL_PACKAGE_PROJECTS = [
  { prefix: "@dhbmini/", projectId: "dhb-packages", warningCode: "unmapped_dhbmini_package" },
  { prefix: "@dhbfront-domain-", projectId: "dhb-packages", warningCode: "unmapped_dhbfront_domain_package" },
  { prefix: "@dhbfront-utils/", projectId: "dhbfront-utils", warningCode: "unmapped_dhbfront_utils_package" },
  { prefix: "@egg-dhb-business/", projectId: "egg-business", warningCode: "unmapped_egg_dhb_business_package" }
];

export async function scanRelations(repository, { rootDir = process.cwd(), dryRun = false } = {}) {
  const projects = await repository.listProjects();
  const projectIds = new Set(projects.map((project) => project.id).filter(Boolean));
  const warnings = [];
  const packageInfos = collectPackageInfos(projects, { rootDir, warnings });
  const packageNameToProjectId = buildPackageNameMap(packageInfos, warnings);
  const existingEdges = new Set((await repository.listGraphEdges())
    .map((edge) => edgeKey(edge.from, edge.to, edge.relation)));
  const plannedEdges = [];
  const plannedEdgeKeys = new Set();

  for (const info of packageInfos) {
    for (const packageName of dependencyNames(info.packageJson)) {
      const targetProjectId = resolveDependencyProjectId(packageName, {
        packageNameToProjectId,
        projectIds,
        warnings,
        sourceProjectId: info.project.id
      });
      if (!targetProjectId || targetProjectId === info.project.id) continue;

      const edge = {
        from: `project:${info.project.id}`,
        to: `project:${targetProjectId}`,
        relation: "depends-on",
        packageName
      };
      const key = edgeKey(edge.from, edge.to, edge.relation);
      if (plannedEdgeKeys.has(key) || existingEdges.has(key)) continue;
      plannedEdgeKeys.add(key);
      plannedEdges.push(edge);
    }
  }

  for (const edge of collectDomainConfigCalls(projects, { rootDir, projectIds, warnings })) {
    const key = edgeKey(edge.from, edge.to, edge.relation);
    if (plannedEdgeKeys.has(key) || existingEdges.has(key)) continue;
    plannedEdgeKeys.add(key);
    plannedEdges.push(edge);
  }

  if (dryRun) {
    return scanResult({
      status: "noop",
      message: "Dry run only. SQLite was not changed.",
      edges: plannedEdges,
      warnings,
      willWrite: plannedEdges.length
    });
  }

  for (const edge of plannedEdges) {
    await repository.upsertGraphEdge(edge);
  }

  return scanResult({
    status: plannedEdges.length ? "ok" : "noop",
    message: plannedEdges.length ? `Inserted ${plannedEdges.length} relation(s).` : "No relation changes.",
    edges: plannedEdges,
    warnings,
    willWrite: plannedEdges.length
  });
}

function collectPackageInfos(projects, { rootDir, warnings }) {
  const packageInfos = [];
  for (const project of projects) {
    const rawPath = typeof project.path === "string" ? project.path.trim() : "";
    if (!rawPath) {
      warnings.push({ code: "missing_project_path", projectId: project.id });
      continue;
    }

    const projectPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rootDir, rawPath);
    if (!fs.existsSync(projectPath)) {
      warnings.push({ code: "missing_path", projectId: project.id, path: projectPath });
      continue;
    }

    const packageJsonPath = path.join(projectPath, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      warnings.push({ code: "missing_package_json", projectId: project.id, path: packageJsonPath });
      continue;
    }

    try {
      packageInfos.push({
        project,
        packageJsonPath,
        packageJson: JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
      });
    } catch (error) {
      warnings.push({
        code: "invalid_package_json",
        projectId: project.id,
        path: packageJsonPath,
        message: error.message
      });
    }
  }
  return packageInfos;
}

function collectDomainConfigCalls(projects, { rootDir, projectIds, warnings }) {
  const edges = [];
  for (const project of projects) {
    if (!isFrontendDomainConfigProject(project)) continue;

    const rawPath = typeof project.path === "string" ? project.path.trim() : "";
    if (!rawPath) {
      warnings.push({ code: "missing_project_path", projectId: project.id, relation: "calls" });
      continue;
    }

    const projectPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rootDir, rawPath);
    if (!fs.existsSync(projectPath)) {
      warnings.push({ code: "missing_path", projectId: project.id, path: projectPath, relation: "calls" });
      continue;
    }

    const domainConfigPath = path.join(projectPath, DOMAIN_CONFIG_RELATIVE_PATH);
    if (!fs.existsSync(domainConfigPath)) {
      warnings.push({ code: "missing_domain_config", projectId: project.id, path: domainConfigPath });
      continue;
    }

    let bffProjectIds = [];
    try {
      bffProjectIds = extractBffDomainConfigKeys(fs.readFileSync(domainConfigPath, "utf8"));
    } catch (error) {
      warnings.push({
        code: "unreadable_domain_config",
        projectId: project.id,
        path: domainConfigPath,
        message: error.message
      });
      continue;
    }

    for (const bffProjectId of bffProjectIds) {
      if (!projectIds.has(bffProjectId)) {
        warnings.push({
          code: "unmapped_bff_domain_config_key",
          projectId: project.id,
          path: domainConfigPath,
          key: bffProjectId
        });
        continue;
      }
      if (bffProjectId === project.id) continue;
      edges.push({
        from: `project:${project.id}`,
        to: `project:${bffProjectId}`,
        relation: "calls",
        domainConfigKey: bffProjectId
      });
    }
  }
  return edges;
}

function buildPackageNameMap(packageInfos, warnings) {
  const packageNameToProjectId = new Map();
  for (const info of packageInfos) {
    const packageName = typeof info.packageJson.name === "string" ? info.packageJson.name.trim() : "";
    if (!packageName) {
      warnings.push({ code: "missing_package_name", projectId: info.project.id, path: info.packageJsonPath });
      continue;
    }
    if (packageNameToProjectId.has(packageName)) {
      warnings.push({
        code: "duplicate_package_name",
        packageName,
        keptProjectId: packageNameToProjectId.get(packageName),
        skippedProjectId: info.project.id
      });
      continue;
    }
    packageNameToProjectId.set(packageName, info.project.id);
  }
  return packageNameToProjectId;
}

function dependencyNames(packageJson) {
  const names = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    names.push(...Object.keys(dependencies));
  }
  return [...new Set(names)];
}

function resolveDependencyProjectId(packageName, { packageNameToProjectId, projectIds, warnings, sourceProjectId }) {
  const specialPackage = SPECIAL_PACKAGE_PROJECTS.find((item) => packageName.startsWith(item.prefix));
  if (specialPackage) {
    if (projectIds.has(specialPackage.projectId)) return specialPackage.projectId;
    warnings.push({
      code: specialPackage.warningCode,
      projectId: sourceProjectId,
      packageName,
      expectedProjectId: specialPackage.projectId
    });
    return null;
  }
  return packageNameToProjectId.get(packageName) || (projectIds.has(packageName) ? packageName : null);
}

function isFrontendDomainConfigProject(project) {
  const technologyFamilyId = String(project.technologyFamilyId || "").trim().toLowerCase();
  const role = String(project.role || "").trim().toLowerCase();
  return technologyFamilyId === "frontend" || FRONTEND_DOMAIN_CONFIG_ROLES.has(role);
}

function extractBffDomainConfigKeys(source) {
  const cleanSource = stripJavaScriptComments(source);
  const keys = [];
  const seen = new Set();
  const propertyKeyPattern = /(?:^|[,{]\s*)(["'])(bff-[A-Za-z0-9_-]+)\1\s*:/g;
  let match;
  while ((match = propertyKeyPattern.exec(cleanSource)) !== null) {
    const key = match[2];
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function stripJavaScriptComments(source) {
  let result = "";
  let quote = "";
  let escaping = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        result += char;
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      result += char;
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
    }
    result += char;
  }

  return result;
}

function edgeKey(from, to, relation) {
  return `${from}\0${to}\0${relation}`;
}

function scanResult({ status, message, edges, warnings, willWrite }) {
  return {
    ...normalizeCommandResult({
      status,
      action: "scanRelations",
      message,
      paths: ["data/devflow.db"],
      warnings
    }),
    edges,
    willWrite
  };
}
