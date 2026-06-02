import {
  normalizeQueryRouteResult,
  normalizeSceneTemplate,
  normalizeWorkset
} from "../contracts/devflow-types.mjs";
import { queryRules, querySkills } from "./current-query.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function queryRoute(repository, { text = "" } = {}) {
  const sourceText = String(text || "");
  const [projects, sceneTemplates, projectEdges, tasks] = await Promise.all([
    repository.listProjects(),
    repository.listSceneTemplates(),
    listProjectRoutingEdges(repository),
    safeListTasks(repository)
  ]);
  const inference = inferProjectCandidates({ projects, projectEdges, tasks, sourceText });
  const sceneTemplate = findBestSceneTemplate(sceneTemplates, projects, sourceText);
  const selectedProjects = inference.projects.length
    ? inference.projects
    : await resolveProjects(repository, projects, sceneTemplate, sourceText);
  const templateId = sceneTemplate?.id;
  const projectIds = selectedProjects.map((project) => project.id).filter(Boolean);
  const skills = filterRouteSkills((await querySkills(repository, { projectId: projectIds[0], templateId })).skills, sourceText);
  const rules = (await queryRules(repository, { projectId: projectIds[0], templateId })).rules;
  const workset = sceneTemplate || selectedProjects.length > 0 ? normalizeWorkset({
    id: sceneTemplate?.id ? `workset-route-${sceneTemplate.id}` : "workset-route-ad-hoc",
    sourceText,
    confidence: sceneTemplate || inference.candidates.length ? "medium" : "low",
    reason: inference.candidates.length
      ? "Matched task text to project domains and graph relations."
      : sceneTemplate ? "Matched template keywords or project hints." : "Matched project metadata.",
    sceneTemplateId: sceneTemplate?.id,
    capabilities: (sceneTemplate?.capabilityIds || []).map((id) => ({ id })),
    projects: selectedProjects.map((project) => ({ id: project.id, role: project.role || "primary" })),
    skills: skills.map((skill) => ({ id: skill.id })),
    rules: rules.map((rule) => ({ id: rule.id }))
  }) : null;

  return normalizeQueryRouteResult({
    mode: inferRouteMode(sourceText, Boolean(sceneTemplate || selectedProjects.length)),
    sceneTemplate: sceneTemplate ? {
      ...normalizeSceneTemplate(sceneTemplate),
      confidence: "medium",
      reason: "Matched template keywords or project hints."
    } : null,
    workset,
    skills,
    rules,
    readPaths: collectReadPaths({ sceneTemplate, projects: selectedProjects, skills, rules }),
    nextAction: inference.candidates.length
      ? "Inspect rule candidates, relation evidence, and clarification prompts before narrowing context."
      : workset ? "Inspect selected project context." : "No DevFlow context selected.",
    candidates: inference.candidates,
    historyHints: inference.historyHints,
    clarify: inference.clarify,
    refinementHint: inference.refinementHint,
    inference: {
      product: inference.product,
      domains: inference.domains,
      scope: inference.scope
    }
  });
}

async function listProjectRoutingEdges(repository) {
  if (typeof repository.listProjectGraphEdges === "function") {
    return repository.listProjectGraphEdges(["chain", "depends-on", "calls"]);
  }
  return (await repository.listGraphEdges())
    .filter((edge) => edge.from?.startsWith("project:") && edge.to?.startsWith("project:"))
    .filter((edge) => ["chain", "depends-on", "calls"].includes(edge.relation));
}

async function safeListTasks(repository) {
  if (typeof repository.listTasks !== "function") return [];
  try {
    return await repository.listTasks();
  } catch {
    return [];
  }
}

function inferRouteMode(text, hasMatch) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "none";
  }
  if (/\b(resume|continue|current|last)\b|继续|恢复/.test(normalized)) {
    return "resume";
  }
  if (/\b(jira|notion|figma|prd|openspec|cross-project|high-risk)\b|高风险|跨项目/.test(normalized)) {
    return "full";
  }
  return hasMatch ? "light" : "none";
}

function findBestSceneTemplate(sceneTemplates, projects, text) {
  const scored = sceneTemplates
    .map((template) => ({ template, score: scoreTemplate(template, projects, text) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.template || null;
}

function scoreTemplate(template, projects, text) {
  const haystack = normalizeText([
    template.id,
    template.name,
    template.summary,
    template.capabilityIds,
    template.projectHints?.map((hint) => hint.id),
    template.skillHints?.map((hint) => hint.id),
    template.ruleHints?.map((hint) => hint.id),
    template.projectHints?.map((hint) => {
      const project = projects.find((candidate) => candidate.id === hint.id);
      return [project?.name, project?.summary, project?.tags];
    })
  ].flat(Infinity).filter(Boolean).join(" "));

  return scoreText(text, haystack);
}

async function resolveProjects(repository, projects, sceneTemplate, text) {
  if (sceneTemplate?.projectHints?.length) {
    if (typeof repository.listProjectsForSceneTemplate === "function") {
      return repository.listProjectsForSceneTemplate(sceneTemplate.id);
    }
    const resolved = await Promise.all(sceneTemplate.projectHints.map(async (hint) => {
      const project = await repository.getProject(hint.id);
      return project ? { ...project, role: hint.role } : null;
    }));
    return resolved.filter(Boolean);
  }

  const scored = projects
    .map((project) => ({ project, score: scoreText(text, normalizeText([project.id, project.name, project.summary, project.tags].flat().filter(Boolean).join(" "))) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.project);
}

function collectReadPaths({ sceneTemplate, projects, skills, rules }) {
  const paths = [];
  addPath(paths, sceneTemplate?.sourcePath);
  for (const project of projects) {
    addPath(paths, project.sourcePath || (project.id ? `config/projects/${project.id}.json` : ""));
    addPath(paths, project.doc?.path);
    addPath(paths, resolveProjectParadigmPath(project));
  }
  for (const skill of skills) {
    addPath(paths, skill.sourcePath);
  }
  for (const rule of rules) {
    addPath(paths, rule.sourcePath);
  }
  return paths;
}

// 项目仓库内的开发范式报告(<repo>/.ai-configs/paradigm.md)：存在即随路由带出，
// 让"改这个项目代码前先读范式报告"自动闭环，不必每次重新勘探。
function resolveProjectParadigmPath(project) {
  const base = project?.path;
  if (!base) return "";
  const candidate = join(base, ".ai-configs", "paradigm.md");
  return existsSync(candidate) ? candidate : "";
}

function filterRouteSkills(skills, sourceText) {
  return skills.filter((skill) => skill.scope !== "global" || matchesGlobalSkillIntent(skill, sourceText));
}

function matchesGlobalSkillIntent(skill, sourceText) {
  const requestTokens = routeSkillTokens(sourceText);
  if (!requestTokens.length) return false;
  const skillTokens = new Set(routeSkillTokens([
    skill.id,
    skill.name,
    skill.description,
    skill.trigger,
    skill.whenToLoad,
    skill.tags
  ].flat(Infinity).filter(Boolean).join(" ")));
  return requestTokens.some((token) => skillTokens.has(token));
}

function routeSkillTokens(value) {
  const stopWords = new Set([
    "and",
    "for",
    "from",
    "into",
    "the",
    "this",
    "that",
    "use",
    "when",
    "with"
  ]);
  return normalizeText(value)
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token))
    .map(stemRouteSkillToken)
    .filter(Boolean);
}

function stemRouteSkillToken(token) {
  if (token.length > 5 && token.endsWith("ing")) {
    const stem = token.slice(0, -3);
    return stem.length > 2 && stem.at(-1) === stem.at(-2) ? stem.slice(0, -1) : stem;
  }
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function inferProjectCandidates({ projects, projectEdges, tasks, sourceText }) {
  const text = normalizeText(sourceText);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const product = inferProduct(text);
  const domains = inferDomains(text);
  const scope = inferScope(text);
  const evidence = new Map();
  const order = [];

  function addCandidate(projectId, reason, path = []) {
    const project = projectById.get(projectId);
    if (!project || !matchesProduct(project, product)) return;
    if (!evidence.has(projectId)) {
      evidence.set(projectId, { project, reasons: [], paths: [] });
      order.push(projectId);
    }
    const entry = evidence.get(projectId);
    if (reason && !entry.reasons.includes(reason)) entry.reasons.push(reason);
    if (path.length) entry.paths.push(path);
  }

  if (scope.onlyIos) {
    for (const project of projects) {
      if (project.role === "native" && matchesProduct(project, product)) {
        addCandidate(project.id, "scope:iOS-native");
      }
    }
    return finalizeInference({ evidence, order, product, domains, scope, tasks, sourceText });
  }

  for (const project of projects) {
    const matchedDomains = (project.domains || []).filter((domain) => domains.includes(domain));
    if (!matchedDomains.length || isCommonRole(project.role) || shouldSkipDomainSeed(project, text)) continue;
    if (isFrontendRole(project.role) && !scope.frontendHint) continue;
    addCandidate(project.id, `domain:${matchedDomains.join(",")}`, [`domain:${matchedDomains.join(",")}`, `project:${project.id}`]);
  }

  if (scope.frontendHint) {
    for (const projectId of frontendEntryProjectIds(product)) {
      addCandidate(projectId, "frontend-entry", ["frontend-entry", `project:${projectId}`]);
    }
  }

  if (scope.iosHint && !scope.onlyBackend) {
    for (const project of projects) {
      if (project.role === "native" && matchesProduct(project, product)) {
        addCandidate(project.id, "scope:iOS-native");
      }
    }
  }

  if (shouldAddDhbNativeAmbiguity({ product, domains, scope, text })) {
    addCandidate("dhb", "ambiguous-surface:native-host", ["clarify:ordering-or-manager", "project:dhb"]);
  }

  expandChain({ projectEdges, addCandidate, evidence });
  expandCalls({ projectEdges, addCandidate, evidence });
  expandDependsOn({ projectEdges, addCandidate, evidence });
  applyScopePruning({ evidence, order, scope });

  return finalizeInference({ evidence, order, product, domains, scope, tasks, sourceText });
}

function expandChain({ projectEdges, addCandidate, evidence }) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of projectEdges) {
      if (edge.relation !== "chain") continue;
      const fromId = projectIdFromNode(edge.from);
      const toId = projectIdFromNode(edge.to);
      if (!fromId || !toId || !evidence.has(fromId) || evidence.has(toId)) continue;
      addCandidate(toId, `chain:${fromId}->${toId}`, [`project:${fromId}`, "chain", `project:${toId}`]);
      changed = true;
    }
  }
}

function expandCalls({ projectEdges, addCandidate, evidence }) {
  const sourceIds = [...evidence.keys()];
  for (const edge of projectEdges) {
    if (edge.relation !== "calls") continue;
    const fromId = projectIdFromNode(edge.from);
    const toId = projectIdFromNode(edge.to);
    if (!fromId || !toId || !sourceIds.includes(fromId)) continue;
    addCandidate(toId, `calls:${fromId}->${toId}`, [`project:${fromId}`, "calls", `project:${toId}`]);
  }
}

function expandDependsOn({ projectEdges, addCandidate, evidence }) {
  const sourceIds = [...evidence.keys()];
  for (const edge of projectEdges) {
    if (edge.relation !== "depends-on") continue;
    const fromId = projectIdFromNode(edge.from);
    const toId = projectIdFromNode(edge.to);
    if (!fromId || !toId || !sourceIds.includes(fromId)) continue;
    addCandidate(toId, `depends-on:${fromId}->${toId}`, [`project:${fromId}`, "depends-on", `project:${toId}`]);
  }
}

function finalizeInference({ evidence, order, product, domains, scope, tasks, sourceText }) {
  const candidates = order
    .filter((projectId) => evidence.has(projectId))
    .map((projectId) => {
      const entry = evidence.get(projectId);
      return {
        id: projectId,
        role: entry.project.role || "primary",
        components: entry.project.components || [],
        reason: entry.reasons.join("; "),
        paths: entry.paths
      };
    });

  return {
    projects: candidates.map((candidate) => evidence.get(candidate.id).project),
    candidates,
    historyHints: collectHistoryHints({ tasks, candidates, domains, sourceText }),
    clarify: buildClarifications({ product, domains, scope, candidates }),
    refinementHint: candidates.length
      ? "以下是规则候选+证据,请结合 task 语义精排;遇 clarify 先问用户,不要把规则候选当最终决策。"
      : "",
    product,
    domains,
    scope: summarizeScope(scope)
  };
}

function applyScopePruning({ evidence, order, scope }) {
  for (const projectId of [...order]) {
    const project = evidence.get(projectId)?.project;
    if (!project) continue;
    if (scope.onlyBackend && !["bff-service", "bff-common"].includes(project.role)) {
      evidence.delete(projectId);
    }
    if (scope.onlyFrontend && !isFrontendRole(project.role)) {
      evidence.delete(projectId);
    }
  }
}

function collectHistoryHints({ tasks, candidates, domains, sourceText }) {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  if (!candidateIds.size) return [];
  const hints = [];
  for (const task of tasks || []) {
    const projectIds = taskProjectIds(task).filter((projectId) => candidateIds.has(projectId));
    if (!projectIds.length) continue;
    const taskText = normalizeText([task.id, task.title, task.sourceText, task.summary].filter(Boolean).join(" "));
    const domainMatch = domains.some((domain) => taskText.includes(domain) || keywordPatternsForDomain(domain).some((pattern) => pattern.test(taskText)));
    const textMatch = scoreText(sourceText, taskText) > 0;
    if (!domainMatch && !textMatch) continue;
    hints.push({
      taskId: task.id,
      title: task.title || task.id,
      projectIds,
      reason: domainMatch ? "matched domain history" : "matched task text history"
    });
    if (hints.length >= 5) break;
  }
  for (const candidate of candidates) {
    const components = candidate.components || [];
    if (!components.length) continue;
    hints.push({
      type: "components",
      projectId: candidate.id,
      title: `${candidate.id} reusable components`,
      projectIds: [candidate.id],
      components,
      reason: "candidate reusable components"
    });
  }
  return hints;
}

function taskProjectIds(task) {
  const worksetProjects = task?.workset?.projects || [];
  const directProjects = task?.projectIds || task?.projects || [];
  return [...new Set([...worksetProjects, ...directProjects]
    .map((item) => typeof item === "string" ? item : item?.id)
    .filter(Boolean))];
}

function buildClarifications({ product, domains, scope, candidates = [] }) {
  const clarify = [];
  const backendOptions = backendBffOptions({
    domains,
    candidateBffIds: candidates
      .filter((candidate) => candidate.role === "bff-service" || candidate.id.startsWith("bff-"))
      .map((candidate) => candidate.id)
  });
  if (!product && domains.length) {
    clarify.push({
      code: "product-line-unknown",
      message: "未明确产品线(dhb/hxb/yxt),请先确认目标产品线。",
      options: ["dhb", "hxb", "yxt"]
    });
  }
  if (isDhbDomainSurface({ product, domains }) && !scope.explicitClientRole) {
    clarify.push({
      code: "client-role",
      message: "DHB 商品/订单相关需求可能属于订货端、管理端或两端,请确认端角色。",
      options: ["订货端", "管理端"]
    });
  }
  if (isDhbDomainSurface({ product, domains }) && !scope.explicitCoverageTargets) {
    clarify.push({
      code: "coverage-targets",
      message: "请确认本次覆盖哪些端,可多选或只选子集。",
      options: ["小程序", "h5", "原生", "管理端 web 模块"]
    });
  }
  if (backendOptions.length && !scope.explicitBackendBff) {
    clarify.push({
      code: "backend-bff",
      message: "请确认本次需要哪些 BFF;inner/老 API 属于 BFF 内部细节,DevFlow 不追问。",
      options: backendOptions
    });
  }
  return clarify;
}

function backendBffOptions({ domains, candidateBffIds }) {
  const options = [...domains.map((domain) => `bff-${domain}`), ...candidateBffIds];
  const order = new Map(["goods", "order", "user", "payment", "warehouse", "manager", "im", "print"]
    .map((domain, index) => [`bff-${domain}`, index]));
  return [...new Set(options)]
    .sort((a, b) => {
      const aOrder = order.has(a) ? order.get(a) : Number.MAX_SAFE_INTEGER;
      const bOrder = order.has(b) ? order.get(b) : Number.MAX_SAFE_INTEGER;
      return aOrder === bOrder ? a.localeCompare(b) : aOrder - bOrder;
    });
}

function isDhbDomainSurface({ product, domains }) {
  return (!product || product === "dhb") && domains.some((domain) => ["goods", "order", "user", "payment", "warehouse", "manager"].includes(domain));
}

function inferProduct(text) {
  if (/\b(yorder|dhb)\b|订货宝|订货端/.test(text)) return "dhb";
  if (/\b(hxb)\b|货销宝/.test(text)) return "hxb";
  if (/\b(yxt)\b/.test(text)) return "yxt";
  return null;
}

function inferDomains(text) {
  const domains = [];
  for (const domain of ["goods", "order", "user", "payment", "warehouse", "manager", "im", "print"]) {
    if (keywordPatternsForDomain(domain).some((pattern) => pattern.test(text))) {
      domains.push(domain);
    }
  }
  return domains;
}

function keywordPatternsForDomain(domain) {
  return {
    goods: [/\bgoods?\b/, /商品/, /货品/, /限价/],
    order: [/\border\b/, /\byorder\b/, /订单/, /建议订单/],
    user: [/\buser\b/, /用户/, /客户/, /会员/, /账号/],
    payment: [/\bpayment\b/, /\bpay\b/, /支付/, /收款/, /付款/],
    warehouse: [/\bwarehouse\b/, /\bstock\b/, /仓库/, /库存/],
    manager: [/\bmanager\b/, /管理端/, /管理后台/, /后台/],
    im: [/\bim\b/, /消息/, /聊天/],
    print: [/\bprint\b/, /打印/, /蓝牙/]
  }[domain] || [];
}

function inferScope(text) {
  const onlyIos = /(?:只改|仅|纯).{0,8}\bios\b|\bios\b.{0,8}(?:only|仅|只改)|只改.{0,8}原生/.test(text);
  const onlyBackend = /(?:只改|仅).{0,8}(后端|服务端|bff|node)|(?:后端|服务端|bff|node).{0,8}(only|仅|只改)/.test(text);
  const onlyFrontend = /(?:只改|仅).{0,8}(前端|h5|小程序)|(?:前端|h5|小程序).{0,8}(only|仅|只改)/.test(text);
  const iosHint = /\bios\b|\bnative\b|\bapp\b|原生/.test(text);
  const frontendHint = /\b(yorder|frontend|h5|taro|cash-mini)\b|前端|页面|列表|小程序|商品列表|建议订单|海报/.test(text);
  const backendHint = /\b(bff|backend|node|server)\b|后端|服务端|接口/.test(text);
  const explicitClientRole = /订货端|管理端|管理后台|后台/.test(text);
  const explicitCoverageTargets = /\bios\b|原生|\bh5\b|小程序|管理端 web|管理端web/.test(text);
  const explicitBackendBff = /\bbff-[a-z-]+\b|\bbff\b|后端|服务端/.test(text);
  return {
    onlyIos,
    onlyBackend,
    onlyFrontend,
    iosHint,
    frontendHint,
    backendHint,
    explicitClientRole,
    explicitCoverageTargets,
    explicitBackendBff,
    explicitLayer: onlyIos || onlyBackend || onlyFrontend || iosHint || frontendHint || backendHint
  };
}

function summarizeScope(scope) {
  return {
    onlyIos: scope.onlyIos,
    onlyBackend: scope.onlyBackend,
    onlyFrontend: scope.onlyFrontend,
    iosHint: scope.iosHint,
    frontendHint: scope.frontendHint,
    backendHint: scope.backendHint
  };
}

function frontendEntryProjectIds(product) {
  if (product === "hxb") return ["hxb-mobile"];
  if (product === "yxt") return ["yxt-mobile"];
  return ["dhb-packages"];
}

function shouldAddDhbNativeAmbiguity({ product, domains, scope, text }) {
  if (product !== "dhb") return false;
  if (!domains.some((domain) => ["goods", "order"].includes(domain))) return false;
  if (scope.frontendHint || scope.onlyFrontend || scope.onlyBackend || scope.onlyIos) return false;
  return /代客下单|限价|商品|订单/.test(text);
}

function shouldSkipDomainSeed(project, text) {
  if (project.role !== "tool") return false;
  return !normalizeText([project.id, project.name].filter(Boolean).join(" ")).split(/\s+/).some((token) => token && text.includes(token));
}

function matchesProduct(project, product) {
  if (!product) return true;
  return (project.products || []).includes(product);
}

function isCommonRole(role) {
  return String(role || "").endsWith("-common");
}

function isFrontendRole(role) {
  return ["subpackage", "main-package", "h5", "container", "mini-program", "pc", "mobile", "frontend-common"].includes(role);
}

function projectIdFromNode(nodeId) {
  return String(nodeId || "").startsWith("project:") ? String(nodeId).slice("project:".length) : "";
}

function addPath(paths, candidate) {
  if (candidate && !paths.includes(candidate)) {
    paths.push(candidate);
  }
}

function scoreText(needle, haystack) {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle || !haystack) {
    return 0;
  }
  return normalizedNeedle
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function normalizeText(input) {
  return String(input || "").toLowerCase();
}
