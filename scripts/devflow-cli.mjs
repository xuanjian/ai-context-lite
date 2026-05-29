#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { setup as setupAiContext } from './install-ai-context.mjs';
import { openSpecMissingWarning } from '../src/core/openspec-probe.mjs';
import {
  normalizeCommandResult,
} from '../src/core/contracts/devflow-types.mjs';
import { createActionCommandService } from '../src/core/commands/action-store-commands.mjs';
import { createDefaultSqliteDatabase } from '../src/core/storage/sqlite-bootstrap.mjs';

const packageRoot = path.resolve(new URL('..', import.meta.url).pathname);
const serviceModulePath = path.join(packageRoot, 'src/core/services/devflow-service.mjs');

const toolProviders = [
  { id: 'codex', label: 'Codex', skillDir: '.codex/skills' },
  { id: 'claude-code', label: 'Claude Code', skillDir: '.claude/skills' },
  { id: 'cursor', label: 'Cursor', skillDir: '.cursor/skills' },
  { id: 'qoderwork', label: 'QoderWork', skillDir: '.qoderwork/skills' },
  { id: 'opencode', label: 'OpenCode', skillDir: '.opencode/skills' },
  { id: 'workbuddy', label: 'WorkBuddy', skillDir: '.workbuddy/skills' },
];

function usage() {
  console.log(`Usage:
  devflow init
  devflow init --tools codex,claude-code,cursor
  devflow init --dir ~/.local/share/devflow --tools codex
  devflow init --tools codex,qoderwork --skip-openspec
  devflow status
  devflow query route "<request>"
  devflow query current
  devflow query skills --project <id>
  devflow query skills --workset <task-or-workset-id>
  devflow query rules --template <id>
  devflow graph
  devflow migrate from-json [--dry-run] [--keep-json]
  devflow restore-from-git [--ref <ref>] [--dry-run]
  devflow import-tasks [--dry-run]
  devflow task current
  devflow task start "<title>" --project <id> --template <id> [--spec-change <id>] [--spec-path <path>] [--spec-status <status>] [--spec-handoff <summary>]
  devflow task update <task-id> --gate <G1-G7> --note "<progress>" [--spec-change <id>] [--spec-path <path>] [--spec-status <status>] [--spec-handoff <summary>]
  devflow set-products <projectId> <product...> [--dry-run]
  devflow set-domain <projectId> <domain...> [--dry-run]
  devflow set-role <projectId> <role> [--dry-run]
  devflow set-components <projectId> <name|purpose|path...> [--dry-run]
  devflow add-relation <fromId> <toId> --type <chain|depends-on|calls> [--remove] [--dry-run]
  devflow scan-relations [--dry-run]
  devflow add project <repo-path>
  devflow add scene-template "<name>"
  devflow add skill <skill-path> [--family <family>] [--scope <scope>]
  devflow doctor
  devflow index rebuild (deprecated noop)

Options:
  --tools <ids>       Comma-separated AI tools. Available: ${toolProviders.map(tool => tool.id).join(', ')}
  --yes               Non-interactive confirmation.
  --dir <path>        Local DevFlow directory to create or reuse. Defaults to ./devflow outside a checkout.
  --root <path>       Existing DevFlow checkout path. Alias for --dir during init.
  --skip-openspec     Do not install OpenSpec during init.
  --help              Show help.
`);
}

function parseArgs(rawArgs) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const equalIndex = token.indexOf('=');
    if (equalIndex !== -1) {
      flags[token.slice(2, equalIndex)] = token.slice(equalIndex + 1);
      continue;
    }
    const key = token.slice(2);
    const next = rawArgs[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positionals, flags };
}

function parseToolIds(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseComponentSpecs(values, jsonValue) {
  if (jsonValue && jsonValue !== true) {
    const parsed = JSON.parse(String(jsonValue));
    if (!Array.isArray(parsed)) throw new Error('--json must be a component array');
    return parsed.map(normalizeComponentSpec).filter(Boolean);
  }
  return values.map((value) => {
    const parts = String(value).split('|');
    if (parts.length < 3) {
      throw new Error('component spec must be name|purpose|path');
    }
    return normalizeComponentSpec({
      name: parts[0],
      purpose: parts[1],
      path: parts.slice(2).join('|')
    });
  }).filter(Boolean);
}

function normalizeComponentSpec(value) {
  const component = {
    name: String(value?.name ?? '').trim(),
    purpose: String(value?.purpose ?? '').trim(),
    path: String(value?.path ?? '').trim()
  };
  return component.name && component.path ? component : null;
}

function providerById(id) {
  return toolProviders.find(tool => tool.id === id);
}

function ensureKnownTools(toolIds) {
  const unknown = toolIds.filter(id => !providerById(id));
  if (unknown.length) throw new Error(`unknown AI tool(s): ${unknown.join(', ')}`);
}

function isDevFlowRoot(candidateRoot) {
  return (
    fs.existsSync(path.join(candidateRoot, 'config', 'entry.json'))
    || fs.existsSync(path.join(candidateRoot, 'data', 'devflow.db'))
  ) && fs.existsSync(path.join(candidateRoot, 'scripts', 'install-ai-context.mjs'));
}

function isDevFlowDataRoot(candidateRoot) {
  return fs.existsSync(path.join(candidateRoot, 'data', 'devflow.db'))
    || (
      fs.existsSync(path.join(candidateRoot, 'config', 'entry.json'))
      && fs.existsSync(path.join(candidateRoot, 'runtime', 'current.json'))
    );
}

function isDirectoryEmpty(directoryPath) {
  if (!fs.existsSync(directoryPath)) return true;
  return fs.statSync(directoryPath).isDirectory() && fs.readdirSync(directoryPath).length === 0;
}

function shouldSkipTemplateEntry(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (!normalized) return false;
  return [
    '.git',
    'node_modules',
    '.playwright-mcp',
    '.superpowers',
    'data',
    'dist',
    'package-lock.json',
    'runtime/current.json',
    'runtime/tasks',
  ].some(skipPath => normalized === skipPath || normalized.startsWith(`${skipPath}/`))
    || normalized.endsWith('.tgz')
    || normalized.endsWith('.tmp')
    || normalized.endsWith('.swp')
    || normalized.includes('/.DS_Store')
    || normalized === '.DS_Store';
}

function copyTemplateDirectory(sourceDir, targetDir, relativeBase = '') {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeBase, entry.name);
    if (shouldSkipTemplateEntry(relativePath)) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplateDirectory(sourcePath, targetPath, relativePath);
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
      fs.chmodSync(targetPath, fs.statSync(sourcePath).mode);
    }
  }
}

function ensureLocalRoot(targetRoot) {
  if (isDevFlowRoot(targetRoot)) return targetRoot;
  if (fs.existsSync(targetRoot) && !isDirectoryEmpty(targetRoot)) {
    throw new Error(`target directory is not empty and is not a DevFlow checkout: ${targetRoot}`);
  }
  copyTemplateDirectory(packageRoot, targetRoot);
  createDefaultSqliteDatabase({ rootDir: targetRoot });
  if (!isDevFlowRoot(targetRoot)) throw new Error(`failed to create DevFlow checkout: ${targetRoot}`);
  return targetRoot;
}

function ensurePublicNpmRegistryConfig(targetRoot) {
  const npmrcPath = path.join(targetRoot, '.npmrc');
  const publicRegistryLine = 'registry=https://registry.npmjs.org/';
  if (!fs.existsSync(npmrcPath)) {
    fs.writeFileSync(npmrcPath, `${publicRegistryLine}\n`);
    return;
  }

  const current = fs.readFileSync(npmrcPath, 'utf8');
  const next = /^registry\s*=.*$/m.test(current)
    ? current.replace(/^registry\s*=.*$/m, publicRegistryLine)
    : `${current.trimEnd()}\n${publicRegistryLine}\n`;
  if (next !== current) fs.writeFileSync(npmrcPath, next);
}

function resolveRoot(flags) {
  const explicitDir = flags.dir && flags.dir !== true ? path.resolve(String(flags.dir)) : undefined;
  const explicitRoot = flags.root && flags.root !== true ? path.resolve(String(flags.root)) : undefined;
  const explicitTarget = explicitDir || explicitRoot;
  if (explicitTarget) {
    const root = ensureLocalRoot(explicitTarget);
    ensurePublicNpmRegistryConfig(root);
    return root;
  }
  const cwd = process.cwd();
  if (isDevFlowRoot(cwd)) {
    ensurePublicNpmRegistryConfig(cwd);
    return cwd;
  }
  const root = ensureLocalRoot(path.join(cwd, 'devflow'));
  ensurePublicNpmRegistryConfig(root);
  return root;
}

function skillHomesForTools(toolIds, homeDir) {
  return toolIds.map(id => path.join(homeDir, providerById(id).skillDir));
}

function renderToolSelect(cursorIndex, selectedIds) {
  process.stdout.write('\x1Bc');
  console.log('Welcome to DevFlow!');
  console.log('');
  console.log('Which AI tools do you want to configure?');
  console.log('Use Up/Down to move, Space to toggle, Enter to continue.');
  console.log('');
  for (let index = 0; index < toolProviders.length; index += 1) {
    const tool = toolProviders[index];
    const cursor = index === cursorIndex ? '>' : ' ';
    const selected = selectedIds.has(tool.id) ? '●' : '○';
    console.log(`${cursor} ${selected} ${tool.label}`);
  }
}

function selectToolsInteractively() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('no interactive terminal detected; pass --tools <ids>');
  }

  return new Promise(resolve => {
    let cursorIndex = 0;
    const selectedIds = new Set();
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    renderToolSelect(cursorIndex, selectedIds);

    function finish() {
      process.stdin.setRawMode(false);
      process.stdin.off('keypress', onKeypress);
      process.stdout.write('\n');
      resolve([...selectedIds]);
    }

    function onKeypress(_str, key) {
      if (key.ctrl && key.name === 'c') {
        process.stdin.setRawMode(false);
        process.exit(130);
      }
      if (key.name === 'up' || key.name === 'k') {
        cursorIndex = (cursorIndex - 1 + toolProviders.length) % toolProviders.length;
      } else if (key.name === 'down' || key.name === 'j') {
        cursorIndex = (cursorIndex + 1) % toolProviders.length;
      } else if (key.name === 'space') {
        const id = toolProviders[cursorIndex].id;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
      } else if (key.name === 'return') {
        finish();
        return;
      }
      renderToolSelect(cursorIndex, selectedIds);
    }

    process.stdin.on('keypress', onKeypress);
  });
}

async function runInit(root, toolIds, flags) {
  ensureKnownTools(toolIds);
  if (!toolIds.length) throw new Error('select at least one AI tool');

  const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
  const skillHomes = skillHomesForTools(toolIds, homeDir);
  const selectedLabels = toolIds.map(id => providerById(id).label);
  const previousSkillsHomes = process.env.AI_CONTEXT_SKILLS_HOMES;
  process.env.AI_CONTEXT_SKILLS_HOMES = skillHomes.join(',');
  try {
    await setupAiContext({
      rootDir: root,
      installOpenSpec: !flags['skip-openspec'],
    });
  } finally {
    if (previousSkillsHomes === undefined) {
      delete process.env.AI_CONTEXT_SKILLS_HOMES;
    } else {
      process.env.AI_CONTEXT_SKILLS_HOMES = previousSkillsHomes;
    }
  }

  console.log(`Selected AI tools: ${selectedLabels.join(', ')}`);
  console.log(`Configured ${skillHomes.length} skill target(s).`);
  console.log(`DevFlow root: ${root}`);
  if (flags['skip-openspec']) {
    console.log('OpenSpec install skipped.');
  } else {
    console.log('OpenSpec checked or installed.');
  }
  console.log('Next: run devflow-init in your AI tool for local project/profile onboarding.');
}

function resolveExistingRoot(flags) {
  const explicitRoot = flags.root && flags.root !== true ? path.resolve(String(flags.root)) : undefined;
  const explicitDir = flags.dir && flags.dir !== true ? path.resolve(String(flags.dir)) : undefined;
  const root = explicitRoot || explicitDir || process.cwd();
  if (!isDevFlowRoot(root) && !isDevFlowDataRoot(root)) throw new Error(`not a DevFlow checkout: ${root}`);
  return root;
}

async function createService(rootDir) {
  if (fs.existsSync(serviceModulePath)) {
    const serviceModule = await import(serviceModulePath);
    if (typeof serviceModule.createDevFlowService === 'function') {
      return serviceModule.createDevFlowService({ rootDir });
    }
  }
  throw new Error('DevFlow service module is unavailable. SQLite-only runtime has no JSON compatibility service fallback.');
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function slugify(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function listFromFlag(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueStable(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstValue(...values) {
  return values.find(value => value && value !== true);
}

function specFromFlags(flags) {
  const entries = [
    ['changeId', firstValue(flags['spec-change'], flags.specChange)],
    ['path', firstValue(flags['spec-path'], flags.specPath)],
    ['status', firstValue(flags['spec-status'], flags.specStatus)],
    ['handoff', firstValue(flags['spec-handoff'], flags.specHandoff)]
  ].filter(([, value]) => value !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

async function runFacadeCommand(root, command, type, rest, flags) {
  const service = await createService(root);
  if (command === 'status') {
    printJson(await service.queryCurrent());
    return;
  }
  if (command === 'query' && type === 'route') {
    printJson(await service.queryRoute({ text: rest.join(' ') }));
    return;
  }
  if (command === 'query' && type === 'current') {
    printJson(await service.queryCurrent());
    return;
  }
  if (command === 'query' && type === 'skills') {
    printJson(await service.querySkills({
      projectId: firstValue(flags.project, flags.projects),
      templateId: firstValue(flags.template, flags.scene),
      worksetId: firstValue(flags.workset),
    }));
    return;
  }
  if (command === 'query' && type === 'rules') {
    printJson(await service.queryRules({
      projectId: firstValue(flags.project, flags.projects),
      templateId: firstValue(flags.template, flags.scene),
      worksetId: firstValue(flags.workset),
    }));
    return;
  }
  if (command === 'graph') {
    printJson(await service.buildGraph());
    return;
  }
  if (command === 'migrate' && type === 'from-json') {
    const module = await import('../src/core/storage/migrate-from-json.mjs');
    printJson(await module.migrateDevFlowFromJson({
      rootDir: root,
      dryRun: Boolean(flags['dry-run']),
      keepJson: Boolean(flags['keep-json']),
    }));
    return;
  }
  if (command === 'restore-from-git') {
    const module = await import('../src/core/storage/restore-from-git.mjs');
    printJson(await module.restoreDevFlowFromGit({
      rootDir: root,
      dbPath: firstValue(flags.db),
      ref: firstValue(flags.ref),
      dryRun: Boolean(flags['dry-run']),
    }));
    return;
  }
  if (command === 'import-tasks') {
    const module = await import('../src/core/storage/import-tasks.mjs');
    printJson(await module.importTaskDirectories({
      rootDir: root,
      dbPath: firstValue(flags.db),
      dryRun: Boolean(flags['dry-run']),
    }));
    return;
  }
  if (command === 'task' && type === 'current') {
    printJson(await service.queryCurrent());
    return;
  }
  if (command === 'task' && type === 'start') {
    const title = flags.title || rest.join(' ').trim();
    printJson(await service.startTask({
      title,
      taskId: firstValue(flags.id),
      projectIds: uniqueStable([...listFromFlag(flags.project), ...listFromFlag(flags.projects)]),
      templateId: firstValue(flags.template, flags.scene, flags.scenes),
      gate: firstValue(flags.gate),
      level: firstValue(flags.level),
      note: firstValue(flags.note),
      spec: specFromFlags(flags),
    }));
    return;
  }
  if (command === 'task' && type === 'update') {
    printJson(await service.updateTask({
      taskId: rest[0],
      gate: firstValue(flags.gate),
      note: firstValue(flags.note),
      recoveryPoint: firstValue(flags.recovery, flags.recoveryPoint),
      spec: specFromFlags(flags),
    }));
    return;
  }
  if (command === 'task' && type === 'finish') {
    printJson(await service.finishTask({ taskId: rest[0], note: firstValue(flags.note) }));
    return;
  }
  if (command === 'set-products') {
    const commands = await createActionCommandService({ rootDir: root });
    printJson(await commands.setProjectProducts({
      projectId: type,
      products: rest,
      dryRun: Boolean(flags['dry-run'])
    }));
    return;
  }
  if (command === 'set-domain') {
    const commands = await createActionCommandService({ rootDir: root });
    printJson(await commands.setProjectDomains({
      projectId: type,
      domains: rest,
      dryRun: Boolean(flags['dry-run'])
    }));
    return;
  }
  if (command === 'set-role') {
    const commands = await createActionCommandService({ rootDir: root });
    printJson(await commands.setProjectRole({
      projectId: type,
      role: rest.join(' '),
      dryRun: Boolean(flags['dry-run'])
    }));
    return;
  }
  if (command === 'set-components') {
    const commands = await createActionCommandService({ rootDir: root });
    printJson(await commands.setProjectComponents({
      projectId: type,
      components: parseComponentSpecs(rest, flags.json),
      dryRun: Boolean(flags['dry-run'])
    }));
    return;
  }
  if (command === 'add-relation') {
    const commands = await createActionCommandService({ rootDir: root });
    printJson(await commands.addRelation({
      fromId: type,
      toId: rest[0],
      type: firstValue(flags.type),
      remove: Boolean(flags.remove),
      dryRun: Boolean(flags['dry-run'])
    }));
    return;
  }
  if (command === 'scan-relations') {
    const commands = await createActionCommandService({ rootDir: root });
    printJson(await commands.scanRelations({
      dryRun: Boolean(flags['dry-run'])
    }));
    return;
  }
  if (command === 'add' && type === 'project') {
    printJson(await service.addProject({
      projectPath: flags.path || rest[0],
      projectId: firstValue(flags.id),
      name: firstValue(flags.name),
      technologyFamilyId: firstValue(flags.family, flags.technologyFamilyId),
      products: listFromFlag(flags.products),
      domains: listFromFlag(flags.domains, flags.domain),
      role: firstValue(flags.role),
      dryRun: Boolean(flags['dry-run'])
    }));
    return;
  }
  if (command === 'add' && type === 'scene-template') {
    const name = flags.name || rest.join(' ').trim();
    printJson(await service.addSceneTemplate({
      templateId: firstValue(flags.id, flags.template) || slugify(name),
      name,
      summary: firstValue(flags.summary),
      capabilityIds: listFromFlag(flags.capabilities),
      projectHints: listFromFlag(flags.project || flags.projects).map(id => ({ id })),
    }));
    return;
  }
  if (command === 'add' && type === 'skill') {
    const module = await import('../src/core/actions.mjs');
    printJson(await module.runAction({
      rootDir: root,
      actionId: 'add_skill_from_path',
      body: {
        skillPath: firstValue(flags.path) || rest[0],
        skillId: firstValue(flags.id, flags.skillId),
        name: firstValue(flags.name),
        description: firstValue(flags.description),
        projectIds: uniqueStable([...listFromFlag(flags.project), ...listFromFlag(flags.projects)]),
        family: firstValue(flags.family),
        scope: firstValue(flags.scope),
        tags: listFromFlag(flags.tags)
      }
    }));
    return;
  }
  if (command === 'doctor') {
    const dbPath = path.join(root, 'data/devflow.db');
    const module = await import('../src/core/storage/sqlite-bootstrap.mjs');
    const warnings = [openSpecMissingWarning({ cwd: root })].filter(Boolean);
    try {
      const ensured = await module.ensureSqliteDatabase({ rootDir: root, dbPath });
      const created = ensured.status === 'created';
      printJson(normalizeCommandResult({
        status: 'ok',
        action: 'doctor',
        entityType: undefined,
        message: created ? 'DevFlow SQLite database created from bundled defaults.' : 'DevFlow SQLite database is available.',
        paths: ['data/devflow.db'],
        warnings
      }));
    } catch (error) {
      printJson(normalizeCommandResult({
        status: 'noop',
        action: 'doctor',
        entityType: undefined,
        message: `${error.message} Run devflow migrate from-json, then retry.`,
        paths: fs.existsSync(dbPath) ? ['data/devflow.db'] : [],
        warnings: [{ code: 'missing_sqlite_database_json_sources', command: 'devflow migrate from-json' }, ...warnings]
      }));
    }
    return;
  }
  if (command === 'index' && type === 'rebuild') {
    printJson(normalizeCommandResult({
      status: 'noop',
      action: 'index rebuild',
      entityType: undefined,
      message: 'devflow index rebuild is deprecated. DevFlow no longer rebuilds SQLite from JSON automatically; run devflow migrate from-json explicitly for legacy checkouts.',
      paths: [],
      warnings: [{ code: 'deprecated_index_rebuild', command: 'devflow migrate from-json' }]
    }));
    return;
  }
  usage();
  process.exit(1);
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command || command === 'help' || flags.help || flags.h) {
    usage();
    return;
  }
  if (command === 'init') {
    const root = resolveRoot(flags);
    const selectedToolIds = parseToolIds(flags.tools);
    const toolIds = selectedToolIds.length ? selectedToolIds : await selectToolsInteractively();
    await runInit(root, toolIds, flags);
    return;
  }

  const root = resolveExistingRoot(flags);
  const [, type, ...rest] = positionals;
  await runFacadeCommand(root, command, type, rest, flags);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
