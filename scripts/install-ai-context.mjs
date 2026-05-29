#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeOpenSpecCli } from '../src/core/openspec-probe.mjs';
import { createSqliteRepository } from '../src/core/repositories/sqlite-repository.mjs';
import { defaultDbPath } from '../src/core/storage/schema.mjs';
import { ensureSqliteDatabase } from '../src/core/storage/sqlite-bootstrap.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(new URL('..', import.meta.url).pathname);
const managedEntryMarker = '<!-- devflow:managed-entry:start -->';
const managedEntryEndMarker = '<!-- devflow:managed-entry:end -->';
const legacyManagedEntryMarkers = [
  {
    start: '<!-- ai-context:managed-entry:start -->',
    end: '<!-- ai-context:managed-entry:end -->',
  },
];
const allowedRuleApplyModes = new Set(['global', 'project-on-demand', 'scene-on-demand', 'task-gate', 'manual']);
let root;
let managedSkillsRoot;
let coreSkills;
let userHome;
let superpowersDir;
let projectPathOverrides;
let projectSearchRoots;
let skillsHomes;
let skillLinks;

setInstallContext();

function setInstallContext(options = {}) {
  root = path.resolve(options.rootDir || defaultRoot);
  managedSkillsRoot = path.join(root, 'bundles', 'skills');
  coreSkills = [
    { id: 'devflow', sourcePath: path.join(managedSkillsRoot, 'devflow') },
    { id: 'devflow-init', sourcePath: path.join(managedSkillsRoot, 'devflow-init') },
  ];
  userHome = process.env.HOME || path.resolve(root, '..', '..');
  superpowersDir = process.env.AI_CONTEXT_SUPERPOWERS_DIR || path.join(userHome, '.codex', 'superpowers');
  projectPathOverrides = resolveProjectPathOverrides();
  projectSearchRoots = resolveProjectSearchRoots();
  skillsHomes = resolveSkillsHomes();
  skillLinks = skillsHomes.flatMap(skillsHome => coreSkills.map(skill => ({
    id: skill.id,
    linkPath: path.join(skillsHome, skill.id),
    sourcePath: skill.sourcePath,
  })));
}

function captureInstallContext() {
  return {
    root,
    managedSkillsRoot,
    coreSkills,
    userHome,
    superpowersDir,
    projectPathOverrides,
    projectSearchRoots,
    skillsHomes,
    skillLinks,
  };
}

function restoreInstallContext(context) {
  root = context.root;
  managedSkillsRoot = context.managedSkillsRoot;
  coreSkills = context.coreSkills;
  userHome = context.userHome;
  superpowersDir = context.superpowersDir;
  projectPathOverrides = context.projectPathOverrides;
  projectSearchRoots = context.projectSearchRoots;
  skillsHomes = context.skillsHomes;
  skillLinks = context.skillLinks;
}

async function withInstallContext(options = {}, callback) {
  const previousContext = captureInstallContext();
  setInstallContext(options);
  try {
    return await callback();
  } finally {
    restoreInstallContext(previousContext);
  }
}

function resolveSkillsHomes() {
  const explicitHomes = process.env.AI_CONTEXT_SKILLS_HOMES || process.env.AI_CONTEXT_SKILLS_HOME;
  if (explicitHomes) {
    return unique(
      explicitHomes
        .split(/[,;]/)
        .map(item => item.trim())
        .filter(Boolean)
    );
  }
  const home = userHome;
  return unique([
    path.join(home, '.agents', 'skills'),
    path.join(home, '.codex', 'skills'),
    path.join(home, '.claude', 'skills'),
  ]);
}

function unique(items) {
  return [...new Set(items)];
}

function resolveProjectPathOverrides() {
  const rawOverrides = process.env.AI_CONTEXT_PROJECT_PATH_OVERRIDES || '';
  const overrides = new Map();
  for (const item of rawOverrides.split(/[,;]/).map(value => value.trim()).filter(Boolean)) {
    const [id, ...pathParts] = item.split('=');
    const projectPath = pathParts.join('=').trim();
    if (id?.trim() && projectPath) overrides.set(id.trim(), projectPath);
  }
  return overrides;
}

function resolveProjectSearchRoots() {
  const rawRoots = process.env.AI_CONTEXT_PROJECT_ROOTS || process.env.AI_CONTEXT_PROJECT_ROOT || '';
  return unique(
    rawRoots
      .split(/[,;]/)
      .map(item => item.trim())
      .filter(Boolean)
  );
}

function projectPathSuffixes(projectPath) {
  const suffixes = [];
  for (const marker of ['/Documents/', '/documents/']) {
    const index = projectPath.indexOf(marker);
    if (index >= 0) suffixes.push(projectPath.slice(index + marker.length));
  }
  return unique(suffixes);
}

function resolveProjectPath(project) {
  const overridePath = projectPathOverrides.get(project.id);
  if (overridePath && fs.existsSync(overridePath)) return overridePath;
  if (project.path && fs.existsSync(project.path)) return project.path;

  const candidateNames = unique([
    project.path ? path.basename(project.path) : undefined,
    project.name,
    project.id,
    ...projectPathSuffixes(project.path || ''),
  ].filter(Boolean));
  for (const searchRoot of projectSearchRoots) {
    for (const candidateName of candidateNames) {
      const candidatePath = path.join(searchRoot, candidateName);
      if (fs.existsSync(candidatePath)) return candidatePath;
    }
  }
  return null;
}

function usage() {
  console.log(`Usage:
  node scripts/install-ai-context.mjs setup [--project-skills] [--install-openspec]
  node scripts/install-ai-context.mjs doctor
  node scripts/install-ai-context.mjs install [--project-skills]
  node scripts/install-ai-context.mjs check
  node scripts/install-ai-context.mjs uninstall
  node scripts/install-ai-context.mjs sync-projects [--project <project-id>] [--entries-only|--skills-only] [--write]
  node scripts/install-ai-context.mjs validate`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandExists(command) {
  try {
    execFileSync('sh', ['-lc', `command -v ${shellQuote(command)}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function exists(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) return false;
  const file = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(root, relativeOrAbsolutePath);
  return fs.existsSync(file);
}

async function openRepository() {
  const dbPath = defaultDbPath(root);
  await ensureSqliteDatabase({ rootDir: root, dbPath });
  return createSqliteRepository({ rootDir: root, dbPath });
}

async function loadDevFlowState() {
  const repository = await openRepository();
  const [
    entry,
    profile,
    gates,
    projects,
    sceneTemplates,
    skills,
    rules,
    tasks,
    activeTask,
  ] = await Promise.all([
    repository.getEntry(),
    repository.getProfile(),
    repository.getGates(),
    repository.listProjects(),
    repository.listSceneTemplates(),
    repository.listSkills(),
    repository.listRules(),
    repository.listTasks(),
    repository.getActiveTask(),
  ]);
  const current = synthesizeCurrentState(activeTask, tasks);
  return {
    repository,
    entry,
    profile,
    gates,
    projects,
    sceneTemplates,
    skillCatalog: { version: 1, skills },
    ruleCatalog: { version: 1, rules },
    tasks,
    activeTask,
    current,
  };
}

function synthesizeCurrentState(activeTask, tasks = []) {
  if (!activeTask) {
    return {
      version: 1,
      activeTaskId: "",
      activeTaskPath: "",
      activeProjectIds: [],
      activeSceneIds: [],
      activeWorksetId: "",
      currentGate: "",
      recentTaskIds: tasks.map(task => task.id).filter(Boolean).slice(0, 20),
      note: "",
    };
  }
  const sceneIds = activeTask.sceneIds?.length
    ? activeTask.sceneIds
    : (activeTask.workset?.sceneTemplateId ? [activeTask.workset.sceneTemplateId] : []);
  return {
    version: 1,
    activeTaskId: activeTask.id,
    activeTaskPath: `runtime/tasks/${activeTask.id}.json`,
    activeProjectIds: activeTask.projectIds || [],
    activeSceneIds: sceneIds,
    activeWorksetId: activeTask.workset?.id || "",
    currentGate: activeTask.currentGate || activeTask.gate || "",
    recentTaskIds: [activeTask.id, ...tasks.map(task => task.id).filter(id => id && id !== activeTask.id)].slice(0, 20),
    note: activeTask.recoveryPoint || "",
  };
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readTextIfExists(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) return undefined;
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInsidePath(candidatePath, parentPath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function hasExactDirEntry(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) return false;
  return fs.readdirSync(dirPath).includes(path.basename(filePath));
}

function ensureSymlink(linkPath, targetPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  let existingStat;
  try {
    existingStat = fs.lstatSync(linkPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existingStat) {
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) throw new Error(`refusing to replace non-symlink: ${linkPath}`);
    const currentTarget = fs.readlinkSync(linkPath);
    const resolvedTarget = path.resolve(path.dirname(linkPath), currentTarget);
    if (resolvedTarget === targetPath) return false;
    fs.unlinkSync(linkPath);
  }
  fs.symlinkSync(targetPath, linkPath);
  return true;
}

function projectSkillsSection(project) {
  const skills = project.skills || [];
  if (!skills.length) return '';

  const lines = skills.map(skill => `- ${skill.id}: ${skill.description || skill.whenToLoad || 'Mounted project skill.'}`);
  return `
Mounted skills:

${lines.join('\n')}
`;
}

function onDemandRoutingSection({ markdownTicks = false } = {}) {
  const code = value => markdownTicks ? `\`${value}\`` : value;
  return `
On-demand DevFlow routing:

- DevFlow is an on-demand capability set, not the default full workflow for every new chat.
- Do not load all projects, scene templates, skills, rules, or task history by default.
- For project/task/continue/scene template/Workset/skill/panel requests, run:
${code('devflow query route "<user request>"')}
- Read only returned readPaths and skills.sourcePath.
- For resume requests, run:
${code('devflow query current')}
- For explicit skill inventory, run:
${code('devflow query skills')}
- For explicit rule inventory, run:
${code('devflow query rules')}
- If devflow query is unavailable, report that the SQLite/query migration is incomplete.
- Classify the user's current request before loading extra DevFlow data:
  - ${code('none')}: ordinary questions, explanations, or code snippets. Do not read DevFlow unless project context is explicitly needed.
  - ${code('resume')}: continuing the current task or an existing task. Prefer ${code('devflow query current')} and read only the returned task, Workset, ${code('nextAction')}, and ${code('recoveryPoint')}.
  - ${code('light')}: small bug or small change. Use minimal project/context lookup and light task tracking only when the work should survive the chat.
  - ${code('full')}: large, cross-project, high-risk, Jira/Notion/Figma/PRD-backed work. Then use full task tracking, G1-G7, and OpenSpec when selected.
- Do not start G1-G7 by default.
- Use query results to choose the smallest useful context, then proceed with the active tool's normal execution workflow.
`;
}

function portableProjectOverrideSection() {
  return `Portable project override:

- This project entry is the DevFlow source of truth for this checkout.
- Do not read or require home-level compatibility files by default.
- If a parent/global instruction asks for those home files, treat this project entry and DevFlow query results as the stronger, portable entry.

`;
}

function projectEntry(project) {
  return `${managedEntryMarker}
# ${project.name || project.id} AI Entry

${portableProjectOverrideSection()}Query first:

Use DevFlow query commands before loading project, task, skill, or rule context. Only load source Markdown, rules, or skills from returned readPaths, skills.sourcePath, or rules.sourcePath.
${onDemandRoutingSection()}
${projectSkillsSection(project)}
${managedEntryEndMarker}
`;
}

function cursorRule(project) {
  return `---
alwaysApply: true
---
${managedEntryMarker}
# ${project.name || project.id} DevFlow entry

${portableProjectOverrideSection()}Query first:

Use DevFlow query commands before loading project, task, skill, or rule context. Only load source Markdown, rules, or skills from returned readPaths, skills.sourcePath, or rules.sourcePath.
${onDemandRoutingSection({ markdownTicks: true })}
${projectSkillsSection(project)}
${managedEntryEndMarker}
`;
}

function isManagedProjectEntryContent(content) {
  if (!content) return false;
  if (content.includes(managedEntryMarker)) return true;
  if (legacyManagedEntryMarkers.some(marker => content.includes(marker.start))) return true;
  const managedMarkers = [
    path.join(root, 'config', 'entry.json'),
    path.join(root, 'runtime', 'current.json'),
    'devflow/repos/',
    'registry/scenes.json',
  ];
  return managedMarkers.some(marker => content.includes(marker));
}

function removeManagedBlock(content, startMarker, endMarker) {
  let nextContent = content;
  while (true) {
    const startIndex = nextContent.indexOf(startMarker);
    if (startIndex < 0) return nextContent;

    const endIndex = nextContent.indexOf(endMarker, startIndex);
    if (endIndex < startIndex) return nextContent;

    const afterEndIndex = endIndex + endMarker.length;
    nextContent = `${nextContent.slice(0, startIndex)}${nextContent.slice(afterEndIndex)}`;
  }
}

function removeLegacyManagedEntryContent(content) {
  return legacyManagedEntryMarkers.reduce(
    (nextContent, marker) => removeManagedBlock(nextContent, marker.start, marker.end),
    content
  );
}

function upsertManagedProjectEntryContent(currentContent, managedContent) {
  if (currentContent === null || isManagedProjectEntryContent(currentContent) && !currentContent.includes(managedEntryEndMarker)) {
    return managedContent;
  }
  if (currentContent === undefined) return undefined;

  const contentWithoutLegacyEntries = removeLegacyManagedEntryContent(currentContent);
  const startIndex = contentWithoutLegacyEntries.indexOf(managedEntryMarker);
  const endIndex = contentWithoutLegacyEntries.indexOf(managedEntryEndMarker);
  if (startIndex >= 0 && endIndex >= startIndex) {
    if (managedContent.trimStart().startsWith('---')) return managedContent;
    const afterEndIndex = endIndex + managedEntryEndMarker.length;
    return `${contentWithoutLegacyEntries.slice(0, startIndex)}${managedContent.trimEnd()}${contentWithoutLegacyEntries.slice(afterEndIndex)}`;
  }
  return `${contentWithoutLegacyEntries.trimEnd()}\n\n${managedContent}`;
}

function projectEntryWriteAction(filePath, content) {
  const currentContent = readTextIfExists(filePath);
  const nextContent = upsertManagedProjectEntryContent(currentContent, content);
  if (nextContent === undefined) {
    return { action: 'skip-protected', filePath, reason: 'existing entry path is not a regular file' };
  }
  if (currentContent === null) return { action: 'create', filePath, content: nextContent };
  if (currentContent === nextContent) return { action: 'unchanged', filePath, content: nextContent };
  return { action: 'update', filePath, content: nextContent };
}

function projectEntryPruneTargets(project) {
  const targets = [];
  const legacyEntryPaths = [
    path.join(project.path, 'claude.md'),
  ];

  for (const filePath of legacyEntryPaths) {
    if (!hasExactDirEntry(filePath)) continue;
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) {
      targets.push({ filePath, action: 'manual-review', reason: 'legacy entry path is not a regular file' });
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (isManagedProjectEntryContent(content)) {
      targets.push({ filePath, action: 'delete', reason: 'managed legacy lowercase Claude entry' });
    } else {
      targets.push({ filePath, action: 'skip-protected', reason: 'lowercase Claude entry is not recognized as DevFlow managed content' });
    }
  }

  return targets;
}

function linkNameForSkill(skill) {
  return skill.name || String(skill.id || '').split('/').filter(Boolean).pop();
}

function aliasNamesForSkill(skill) {
  const aliasesById = {};
  return aliasesById[skill.id] || [];
}

function projectSkillTargets(project) {
  const targets = [];
  const skillHomes = ['.agents/skills', '.codex/skills', '.claude/skills'];
  for (const skill of project.skills || []) {
    if (!skill.sourcePath) continue;
    const rawSourcePath = path.join(root, skill.sourcePath);
    const sourcePath = rawSourcePath.endsWith('SKILL.md') ? path.dirname(rawSourcePath) : rawSourcePath;
    if (!fs.existsSync(path.join(sourcePath, 'SKILL.md'))) continue;
    const linkNames = unique([linkNameForSkill(skill), ...aliasNamesForSkill(skill)].filter(Boolean));
    for (const skillHome of skillHomes) {
      for (const linkName of linkNames) {
        targets.push([path.join(project.path, skillHome, linkName), sourcePath]);
      }
    }
  }
  return targets;
}

function existingManagedProjectSkillLinks(project) {
  const links = [];
  const skillHomes = ['.agents/skills', '.codex/skills', '.claude/skills'];
  for (const skillHome of skillHomes) {
    const dir = path.join(project.path, skillHome);
    if (!fs.existsSync(dir)) continue;
    for (const linkName of fs.readdirSync(dir)) {
      const linkPath = path.join(dir, linkName);
      let stat;
      try {
        stat = fs.lstatSync(linkPath);
      } catch {
        continue;
      }
      if (!stat.isSymbolicLink()) continue;
      const resolvedTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
      if (isInsidePath(resolvedTarget, managedSkillsRoot)) links.push([linkPath, resolvedTarget]);
    }
  }
  return links;
}

function projectSkillPruneTargets(project, desiredTargets) {
  const desiredLinkPaths = new Set(desiredTargets.map(([linkPath]) => linkPath));
  return existingManagedProjectSkillLinks(project).filter(([linkPath]) => !desiredLinkPaths.has(linkPath));
}

function ensureSkill(skill) {
  const skillFile = path.join(skill.sourcePath, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    throw new Error(`missing skill source: ${skillFile}`);
  }
}

function ensureSkillLink(skillLink) {
  ensureSymlink(skillLink.linkPath, skillLink.sourcePath);
}

export async function install(options = {}) {
  return withInstallContext(options, async () => {
    for (const skill of coreSkills) ensureSkill(skill);
    await validateCurrent();
    for (const skillLink of skillLinks) ensureSkillLink(skillLink);

    for (const skillLink of skillLinks) console.log(`installed skill: ${skillLink.linkPath} -> ${skillLink.sourcePath}`);
    console.log('next: ask your AI tool to run the devflow-init skill to initialize profile, projects, scenes, skills, and rules.');
    if (options.projectSkills) await syncProjectsCurrent({ write: true, skillsOnly: true });
  });
}

function workflowToolStatuses() {
  const nodeMajor = Number(process.versions.node.split('.')[0] || 0);
  const nodeMinor = Number(process.versions.node.split('.')[1] || 0);
  const nodeOk = nodeMajor > 20 || nodeMajor === 20 && nodeMinor >= 19;
  const openspec = probeOpenSpecCli({ cwd: root });
  const superpowers = superpowersSkillStatus();
  const installedLinks = skillLinks.filter(skillLink => fs.existsSync(skillLink.linkPath)
    && fs.lstatSync(skillLink.linkPath).isSymbolicLink()
    && (path.resolve(path.dirname(skillLink.linkPath), fs.readlinkSync(skillLink.linkPath)) === skillLink.sourcePath
      || path.resolve(fs.readlinkSync(skillLink.linkPath)) === skillLink.sourcePath));

  return [
    {
      id: 'node',
      ok: nodeOk,
      label: 'Node.js >= 20.19',
      detail: process.version,
      fix: 'Install Node.js 20.19.0 or newer before installing OpenSpec.',
    },
    {
      id: 'skills',
      ok: installedLinks.length === skillLinks.length,
      label: 'DevFlow core skill links',
      detail: `${installedLinks.length}/${skillLinks.length}`,
      fix: 'Run: devflow init',
    },
    {
      id: 'openspec',
      ok: openspec.ok,
      optional: true,
      label: 'OpenSpec CLI',
      detail: openspec.detail,
      fix: 'Run: npm install -g @fission-ai/openspec@latest',
    },
    {
      id: 'superpowers',
      ok: superpowers.ok,
      optional: true,
      label: 'superpowers skills',
      detail: superpowers.detail,
      fix: 'Place or link superpowers skill directories into the selected AI tool skill home, then run: devflow add skill <superpowers-root> --family superpowers --scope global',
    },
  ];
}

function superpowersSkillStatus() {
  const skillDirs = [];
  for (const skillsHome of skillsHomes) {
    if (!fs.existsSync(skillsHome)) continue;
    for (const entry of fs.readdirSync(skillsHome, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsHome, entry.name, 'SKILL.md');
      if (fs.existsSync(skillFile) && isLikelySuperpowersSkill(entry.name)) {
        skillDirs.push(skillFile);
      }
    }
  }
  if (skillDirs.length) {
    return { ok: true, detail: `${skillDirs.length} skill director${skillDirs.length === 1 ? 'y' : 'ies'} in selected skill homes` };
  }
  if (fs.existsSync(superpowersDir)) {
    return { ok: true, detail: `${superpowersDir} (legacy source directory)` };
  }
  return { ok: false, detail: 'missing' };
}

function isLikelySuperpowersSkill(name) {
  return new Set([
    'brainstorming',
    'dispatching-parallel-agents',
    'executing-plans',
    'finishing-a-development-branch',
    'receiving-code-review',
    'requesting-code-review',
    'subagent-driven-development',
    'systematic-debugging',
    'test-driven-development',
    'using-git-worktrees',
    'using-superpowers',
    'verification-before-completion',
    'writing-plans',
    'writing-skills'
  ]).has(name);
}

function ensureOpenSpecInstalled() {
  if (commandExists('openspec')) {
    console.log('OpenSpec already installed');
    return;
  }
  console.log('installing OpenSpec: npm install -g @fission-ai/openspec@latest');
  execFileSync('npm', ['install', '-g', '@fission-ai/openspec@latest'], { stdio: 'inherit' });
}

function printWorkflowToolReport(statuses, { strict = false } = {}) {
  for (const status of statuses) {
    const level = status.ok ? 'ok' : (status.optional || !strict) ? 'WARN' : 'ERROR';
    console.log(`${level} ${status.label}: ${status.detail}`);
    if (!status.ok) console.log(`  fix: ${status.fix}`);
  }
}

export async function setup(options = {}) {
  return withInstallContext(options, async () => {
    await install({ ...options, rootDir: root });
    if (options.installOpenSpec) ensureOpenSpecInstalled();
    const statuses = workflowToolStatuses();
    printWorkflowToolReport(statuses);
    console.log('setup complete');
    console.log('next: run node scripts/install-ai-context.mjs doctor after OpenSpec and superpowers are available.');
  });
}

export async function doctor(options = {}) {
  return withInstallContext(options, async () => {
    await validateCurrent();
    await checkCurrent();
    const statuses = workflowToolStatuses();
    printWorkflowToolReport(statuses, { strict: true });
    const failed = statuses.filter(status => !status.ok && !status.optional);
    if (failed.length) {
      throw new Error(`doctor failed: ${failed.map(status => status.id).join(', ')}`);
    }
    console.log('doctor passed');
  });
}

export async function uninstall(options = {}) {
  return withInstallContext(options, async () => {
    for (const skillLink of skillLinks) {
      if (!fs.existsSync(skillLink.linkPath)) {
        console.log(`skill link not installed: ${skillLink.linkPath}`);
        continue;
      }
      const stat = fs.lstatSync(skillLink.linkPath);
      if (!stat.isSymbolicLink()) throw new Error(`refusing to remove non-symlink: ${skillLink.linkPath}`);
      const target = fs.readlinkSync(skillLink.linkPath);
      if (path.resolve(path.dirname(skillLink.linkPath), target) !== skillLink.sourcePath && path.resolve(target) !== skillLink.sourcePath) {
        throw new Error(`refusing to remove symlink with unexpected target: ${skillLink.linkPath} -> ${target}`);
      }
      fs.unlinkSync(skillLink.linkPath);
      console.log(`removed skill link: ${skillLink.linkPath}`);
    }
  });
}

export async function check(options = {}) {
  return withInstallContext(options, checkCurrent);
}

async function checkCurrent() {
  const state = await loadDevFlowState();
  const installedLinks = skillLinks.filter(skillLink => fs.existsSync(skillLink.linkPath)
    && fs.lstatSync(skillLink.linkPath).isSymbolicLink()
    && (path.resolve(path.dirname(skillLink.linkPath), fs.readlinkSync(skillLink.linkPath)) === skillLink.sourcePath
      || path.resolve(fs.readlinkSync(skillLink.linkPath)) === skillLink.sourcePath));
  console.log(`entry: ${state.entry ? 'ok' : 'missing'}`);
  console.log(`profile: ${state.profile ? 'ok' : 'missing'}`);
  console.log(`current: ${state.current ? 'ok' : 'missing'}`);
  for (const skill of coreSkills) {
    console.log(`skill source ${skill.id}: ${fs.existsSync(path.join(skill.sourcePath, 'SKILL.md')) ? 'ok' : 'missing'}`);
  }
  console.log(`skill installed: ${installedLinks.length === skillLinks.length ? 'yes' : installedLinks.length ? 'partial' : 'no'}`);
  for (const skillLink of skillLinks) {
    const installed = fs.existsSync(skillLink.linkPath)
      && fs.lstatSync(skillLink.linkPath).isSymbolicLink()
      && (path.resolve(path.dirname(skillLink.linkPath), fs.readlinkSync(skillLink.linkPath)) === skillLink.sourcePath
        || path.resolve(fs.readlinkSync(skillLink.linkPath)) === skillLink.sourcePath);
    console.log(`skill link ${skillLink.linkPath}: ${installed ? 'ok' : 'missing'}`);
  }
  const openspec = probeOpenSpecCli({ cwd: root });
  console.log(`OpenSpec CLI: ${openspec.ok ? openspec.detail : 'missing (optional; full tasks skip spec layer)'}`);
}

export async function syncProjects(options = {}) {
  return withInstallContext(options, () => syncProjectsCurrent(options));
}

async function syncProjectsCurrent(options = {}) {
  const write = Boolean(options.write);
  const projectFilter = options.projectId;
  const syncEntries = !options.skillsOnly;
  const syncSkills = !options.entriesOnly;
  await validateCurrent();
  const { projects } = await loadDevFlowState();
  let count = 0;
  for (const project of projects) {
    if (projectFilter && project.id !== projectFilter) continue;
    const projectPath = resolveProjectPath(project);
    if (!projectPath) {
      if (!write) console.log(`dry-run would skip missing project path: ${project.id} -> ${project.path || '<missing>'}`);
      continue;
    }
    const localProject = { ...project, path: projectPath };
    const entryTargets = [
      [path.join(localProject.path, 'AGENTS.md'), projectEntry(project)],
      [path.join(localProject.path, 'CLAUDE.md'), projectEntry(project)],
      [path.join(localProject.path, '.ai-configs', 'claude.md'), projectEntry(project)],
      [path.join(localProject.path, '.claude', 'CLAUDE.md'), projectEntry(project)],
      [path.join(localProject.path, '.cursor', 'rules', '00-devflow.mdc'), cursorRule(project)],
    ];
    const entryWriteActions = syncEntries
      ? entryTargets.map(([filePath, content]) => projectEntryWriteAction(filePath, content))
      : [];
    const entryPruneTargets = syncEntries ? projectEntryPruneTargets(localProject) : [];
    const skillTargets = projectSkillTargets(localProject);
    const skillPruneTargets = syncSkills ? projectSkillPruneTargets(localProject, skillTargets) : [];
    if (write) {
      if (syncEntries) {
        for (const target of entryPruneTargets) {
          if (target.action === 'delete') {
            fs.unlinkSync(target.filePath);
          } else {
            console.warn(`manual review required: ${target.filePath} (${target.reason})`);
          }
        }
        for (const action of entryWriteActions) {
          if (['create', 'update'].includes(action.action)) {
            writeFile(action.filePath, action.content);
            console.log(`${action.action}d entry: ${action.filePath}`);
          } else if (action.action === 'unchanged') {
            console.log(`unchanged entry: ${action.filePath}`);
          } else {
            console.warn(`protected entry skipped: ${action.filePath} (${action.reason})`);
          }
        }
      }
      if (syncSkills) {
        for (const [linkPath, sourcePath] of skillTargets) ensureSymlink(linkPath, sourcePath);
        for (const [linkPath] of skillPruneTargets) fs.unlinkSync(linkPath);
      }
    } else {
      if (syncEntries) {
        for (const action of entryWriteActions) {
          if (action.action === 'create') {
            console.log(`dry-run would create: ${action.filePath}`);
          } else if (action.action === 'update') {
            console.log(`dry-run would update: ${action.filePath}`);
          } else if (action.action === 'unchanged') {
            console.log(`dry-run unchanged: ${action.filePath}`);
          } else {
            console.log(`dry-run would keep protected non-managed entry: ${action.filePath} (${action.reason})`);
          }
        }
        for (const target of entryPruneTargets) {
          if (target.action === 'delete') {
            console.log(`dry-run would remove managed legacy entry: ${target.filePath} (${target.reason})`);
          } else {
            console.log(`dry-run would keep protected non-managed entry: ${target.filePath} (${target.reason})`);
          }
        }
      }
      if (syncSkills) {
        for (const [linkPath, sourcePath] of skillTargets) console.log(`dry-run would link: ${linkPath} -> ${sourcePath}`);
        for (const [linkPath, targetPath] of skillPruneTargets) console.log(`dry-run would unlink: ${linkPath} -> ${targetPath}`);
      }
    }
    count += 1;
  }
  console.log(`${write ? 'synced' : 'dry-run'} ${count} project set(s)`);
  if (!write) console.log('pass --write to update selected project files or skill links');
}

function parseOptions(args) {
  const options = {
    write: false,
    projectId: undefined,
    entriesOnly: false,
    skillsOnly: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write') {
      options.write = true;
    } else if (arg === '--project') {
      options.projectId = args[index + 1];
      index += 1;
      if (!options.projectId) throw new Error('--project requires a project id');
    } else if (arg === '--entries-only') {
      options.entriesOnly = true;
    } else if (arg === '--skills-only') {
      options.skillsOnly = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (options.entriesOnly && options.skillsOnly) throw new Error('cannot combine --entries-only and --skills-only');
  return options;
}

function pushUniqueError(errors, message) {
  if (!errors.includes(message)) errors.push(message);
}

function pushUniqueWarning(warnings, message) {
  if (!warnings.includes(message)) warnings.push(message);
}

function validateRuleMetadata(rule, label, errors, warnings = []) {
  if (!rule.sourcePath) {
    pushUniqueError(errors, `${label} missing sourcePath`);
  } else {
    const isExternal = rule.sourceType === 'external-file' || path.isAbsolute(rule.sourcePath);
    if (!isExternal && !rule.sourcePath.startsWith('bundles/rules/')) {
      pushUniqueError(errors, `${label} sourcePath must stay under bundles/rules/: ${rule.sourcePath}`);
    }
    if (!isExternal && rule.sourcePath.endsWith('.mdc')) {
      pushUniqueError(errors, `${label} active rule source must be .md, not .mdc: ${rule.sourcePath}`);
    }
    if (isExternal && !/\.(md|mdc)$/i.test(rule.sourcePath)) {
      pushUniqueError(errors, `${label} external rule source must be .md or .mdc: ${rule.sourcePath}`);
    }
    if (!isExternal && !rule.sourcePath.endsWith('.md')) {
      pushUniqueError(errors, `${label} active rule source must be Markdown .md: ${rule.sourcePath}`);
    }
    if (!exists(rule.sourcePath)) {
      pushUniqueWarning(warnings, `${label} source missing: ${rule.sourcePath}`);
    }
  }
  if (!allowedRuleApplyModes.has(rule.applyMode)) {
    pushUniqueError(errors, `${label} invalid applyMode: ${rule.applyMode || '<missing>'}`);
  }
  if (!Array.isArray(rule.globs) || rule.globs.length === 0) {
    pushUniqueError(errors, `${label} must define non-empty globs`);
  }
  if (!rule.whenToRead) {
    pushUniqueError(errors, `${label} missing whenToRead`);
  }
}

function validateRuleMount(rule, catalogRule, label, errors, warnings = [], expectedApplyMode) {
  if (rule.sourcePath && rule.sourcePath !== catalogRule.sourcePath) {
    pushUniqueError(errors, `${label} sourcePath differs from catalog`);
  }
  if (rule.applyMode && rule.applyMode !== catalogRule.applyMode) {
    pushUniqueError(errors, `${label} applyMode differs from catalog`);
  }
  if (expectedApplyMode && catalogRule.applyMode !== expectedApplyMode) {
    pushUniqueError(errors, `${label} must use applyMode ${expectedApplyMode}, got ${catalogRule.applyMode}`);
  }
  if (rule.whenToRead && rule.whenToRead !== catalogRule.whenToRead) {
    pushUniqueError(errors, `${label} whenToRead differs from catalog`);
  }
  if (rule.sourcePath || rule.applyMode || rule.globs || rule.whenToRead) {
    validateRuleMetadata({ ...catalogRule, ...rule }, label, errors, warnings);
  }
}

const publicPrivacyLeakPatterns = [
  { label: 'absolute macOS home path', pattern: /\/Users\/[A-Za-z0-9._-]+\b/ },
  { label: 'absolute Windows home path', pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/ },
  { label: 'secret-like value', pattern: /\b(token|cookie|secret|password|passwd|api[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{8,}/i },
];

function privatePrivacyLeakPatterns() {
  return (process.env.AI_CONTEXT_PRIVATE_PRIVACY_PATTERNS || '')
    .split(/\n|;;/)
    .map(item => item.trim())
    .filter(Boolean)
    .map((pattern, index) => ({
      label: `private pattern ${index + 1}`,
      pattern: new RegExp(pattern, 'i'),
    }));
}

function resolvePrivacyScanPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function publicPrivacyScanFiles(projects, sceneTemplates) {
  const files = [
    'README.md',
    'docs/install.md',
    'docs/project-introduction.md',
    'docs/product/devflow-workset-redesign.md',
    'bundles/skills/devflow/SKILL.md',
    'bundles/skills/devflow-init/SKILL.md',
    ...(projects || []).flatMap(project => [
      project.doc?.path,
      project.sourcePath,
    ]).filter(Boolean),
    ...(sceneTemplates || []).flatMap(scene => [
      scene.source?.path,
      scene.sourcePath,
    ]).filter(Boolean),
  ];
  const extraFiles = (process.env.AI_CONTEXT_PUBLIC_PRIVACY_SCAN_EXTRA_FILES || '')
    .split(/[,;]/)
    .map(item => item.trim())
    .filter(Boolean);
  return unique([...files, ...extraFiles]);
}

function validatePublicPrivacyBoundary(projects, sceneTemplates, errors) {
  for (const file of publicPrivacyScanFiles(projects, sceneTemplates)) {
    const filePath = resolvePrivacyScanPath(file);
    if (!fs.existsSync(filePath)) continue;
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const leak of [...publicPrivacyLeakPatterns, ...privatePrivacyLeakPatterns()]) {
      if (leak.pattern.test(content)) {
        const label = isInsidePath(filePath, root) ? path.relative(root, filePath) : filePath;
        pushUniqueError(errors, `public template privacy leak (${leak.label}): ${label}`);
      }
    }
  }
}

export async function validate(options = {}) {
  return withInstallContext(options, validateCurrent);
}

async function validateCurrent() {
  const errors = [];
  const warnings = [];

  for (const file of [
    'bundles/skills/devflow/SKILL.md',
    'bundles/skills/devflow-init/SKILL.md',
  ]) {
    if (!exists(file)) pushUniqueError(errors, `missing required file: ${file}`);
  }
  let state;
  try {
    state = await loadDevFlowState();
  } catch (error) {
    pushUniqueError(errors, error.message);
  }
  if (errors.length) return finishValidation(errors, warnings);

  const {
    entry,
    projects,
    sceneTemplates,
    skillCatalog,
    ruleCatalog,
    gates,
    current,
    activeTask,
    profile,
  } = state;

  const skillIds = new Set((skillCatalog.skills || []).map(item => item.id));
  const ruleIds = new Set((ruleCatalog.rules || []).map(item => item.id));
  const ruleById = new Map((ruleCatalog.rules || []).map(item => [item.id, item]));
  const sceneIds = new Set((sceneTemplates || []).map(item => item.id));
  const projectIds = new Set((projects || []).map(item => item.id));

  for (const project of projects || []) {
    if (!project.id) pushUniqueError(errors, `project missing id: ${project.name || '<unnamed>'}`);
  }

  for (const scene of sceneTemplates || []) {
    if (!scene.id) pushUniqueError(errors, `scene missing id: ${scene.name || '<unnamed>'}`);
  }

  for (const project of projects || []) {
    if (project.doc?.path && !exists(project.doc.path)) {
      pushUniqueWarning(warnings, `project ${project.id} doc path missing: ${project.doc.path}`);
    }
    for (const scene of project.scenes || []) {
      if (!sceneIds.has(scene.id)) pushUniqueError(errors, `project ${project.id} references unknown scene ${scene.id}`);
      if (scene.sourcePath && !exists(scene.sourcePath)) pushUniqueWarning(warnings, `project ${project.id} scene source missing: ${scene.sourcePath}`);
    }
    for (const skill of project.skills || []) {
      if (!skillIds.has(skill.id)) pushUniqueError(errors, `project ${project.id} references unknown skill ${skill.id}`);
    }
    for (const rule of project.rules || []) {
      if (!ruleIds.has(rule.id)) {
        pushUniqueError(errors, `project ${project.id} references unknown rule ${rule.id}`);
      } else {
        const catalogRule = ruleById.get(rule.id);
        validateRuleMount(rule, catalogRule, `project ${project.id} rule ${rule.id}`, errors, warnings);
      }
    }
  }

  for (const scene of sceneTemplates || []) {
    if (scene.source?.path && !exists(scene.source.path)) {
      pushUniqueWarning(warnings, `scene ${scene.id} source path missing: ${scene.source.path}`);
    }
    for (const project of scene.projects || []) {
      if (!projectIds.has(project.id)) pushUniqueError(errors, `scene ${scene.id} references unknown project ${project.id}`);
    }
    for (const rule of scene.rules || []) {
      if (!ruleIds.has(rule.id)) {
        pushUniqueError(errors, `scene ${scene.id} references unknown rule ${rule.id}`);
      } else {
        const catalogRule = ruleById.get(rule.id);
        validateRuleMount(rule, catalogRule, `scene ${scene.id} rule ${rule.id}`, errors, warnings, 'scene-on-demand');
      }
    }
  }

  for (const skill of skillCatalog.skills || []) {
    for (const reverseMountKey of ['projects', 'projectIds', 'mountedProjects', 'scenes', 'sceneIds', 'mountedScenes']) {
      if (Object.prototype.hasOwnProperty.call(skill, reverseMountKey)) {
        pushUniqueError(errors, `skill catalog must not reverse-mount ${reverseMountKey}: ${skill.id}`);
      }
    }
    if (skill.sourcePath && !exists(skill.sourcePath)) warnings.push(`skill source not present yet: ${skill.id} -> ${skill.sourcePath}`);
  }

  for (const rule of ruleCatalog.rules || []) {
    validateRuleMetadata(rule, `rule catalog ${rule.id}`, errors, warnings);
  }

  for (const gate of gates.gates || []) {
    if (!/^G[1-7]$/.test(gate.id)) pushUniqueError(errors, `invalid gate id: ${gate.id}`);
  }

  if (current.activeTaskId) {
    for (const projectId of current.activeProjectIds || []) {
      if (!projectIds.has(projectId)) pushUniqueError(errors, `current references unknown project ${projectId}`);
    }
    for (const sceneId of current.activeSceneIds || []) {
      if (!sceneIds.has(sceneId)) pushUniqueWarning(warnings, `current references unknown scene ${sceneId}`);
    }
  }
  if (current.activeTaskId) {
    if (!activeTask) {
      pushUniqueError(errors, `current active task missing in SQLite: ${current.activeTaskId}`);
    } else {
      if (activeTask.id !== current.activeTaskId) pushUniqueError(errors, `current active task id mismatch: ${current.activeTaskId} -> ${current.activeTaskPath}`);
      for (const projectId of activeTask.projectIds || []) {
        if (!projectIds.has(projectId)) pushUniqueError(errors, `active task references unknown project ${projectId}`);
      }
      for (const sceneId of activeTask.sceneIds || []) {
        if (!sceneIds.has(sceneId)) pushUniqueWarning(warnings, `active task references unknown scene ${sceneId}`);
      }
    }
  }
  if (!entry.installation?.script || !exists(entry.installation.script)) {
    pushUniqueError(errors, 'entry installation script is missing or invalid');
  }
  if (profile.sourcePath && !exists(profile.sourcePath)) {
    pushUniqueError(errors, `profile source path missing: ${profile.sourcePath}`);
  }
  validatePublicPrivacyBoundary(projects, sceneTemplates, errors);

  finishValidation(errors, warnings);
}

function finishValidation(errors, warnings) {
  for (const warning of warnings) console.warn(`WARN ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    throw new Error('DevFlow validation failed');
  }
  console.log(`DevFlow validation passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`);
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '-h' || command === '--help') {
    usage();
  } else if (command === 'setup') {
    await setup({
      projectSkills: args.includes('--project-skills'),
      installOpenSpec: args.includes('--install-openspec'),
    });
  } else if (command === 'doctor') {
    await doctor();
  } else if (command === 'install') {
    await install({ projectSkills: args.includes('--project-skills') });
  } else if (command === 'check') {
    await check();
  } else if (command === 'uninstall') {
    await uninstall();
  } else if (command === 'sync-projects') {
    await syncProjects(parseOptions(args));
  } else if (command === 'validate') {
    await validate();
  } else {
    usage();
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
