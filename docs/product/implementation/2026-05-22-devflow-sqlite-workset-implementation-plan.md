# DevFlow SQLite Workset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move DevFlow from JSON-centered scene/task storage to a core query/command service backed by SQLite, dynamic Workset routing, and optional Web/API clients.

**Architecture:** Introduce stable core contracts first, then add JSON-compatible repositories and SQLite repositories behind the same query/command interfaces. `Scene` becomes `scene template`; `Workset` becomes the task runtime unit; CLI/TUI, HTTP API, and Web panel call core instead of reading or writing JSON directly.

**Tech Stack:** Node.js ESM, node:test, existing React/Vite panel, SQLite via a small local adapter chosen during Task 1, Markdown artifacts for task handoff and evidence.

---

## Source Documents

- `docs/product/devflow-workset-redesign.md`
- `docs/product/devflow-storage-panel-remediation.md`
- `src/core/graph.mjs`
- `src/core/checks.mjs`
- `src/core/actions.mjs`
- `scripts/devflow-cli.mjs`

## Dependency Rule

Task 1 is the only hard serial prerequisite. Do not start Tasks 2, 3, or 4 until Task 1 is merged or at least reviewed, because those tasks share public names for `sceneTemplate`, `workset`, command result shape, and repository interfaces.

After Task 1, Tasks 2, 3, and 4 can run in parallel. Tasks 5 and 6 wait for the storage/query contracts from Tasks 2 and 3. Task 7 waits for the final CLI/query command names from Task 4. Task 8 waits for Tasks 5 and 6. Task 9 is optional and should only start after the core service shape is stable.

## File Structure Target

- Create `src/core/contracts/devflow-types.mjs`: shared JSDoc typedefs and constants for projects, scene templates, worksets, tasks, skills, rules, query results, and command results.
- Create `src/core/storage/db.mjs`: opens the SQLite database and exposes transaction helpers.
- Create `src/core/storage/schema.mjs`: schema SQL, schema version, and migration bootstrap.
- Create `src/core/repositories/json-repository.mjs`: compatibility repository over current JSON files.
- Create `src/core/repositories/sqlite-repository.mjs`: SQLite repository with the same public methods.
- Create `src/core/queries/route-query.mjs`: infer route mode, scene template hint, Workset, read paths, skills, and rules.
- Create `src/core/queries/current-query.mjs`: read active task, Workset, next action, and recovery point.
- Create `src/core/queries/graph-query.mjs`: build graph from repository data.
- Create `src/core/commands/project-commands.mjs`: add/update/delete project metadata and mounts.
- Create `src/core/commands/task-commands.mjs`: start/update/finish task with Workset and Markdown handoff artifacts.
- Create `src/core/commands/template-commands.mjs`: add/update/delete scene template metadata and hints.
- Create `src/core/services/devflow-service.mjs`: selects repository backend and exposes stable query/command functions.
- Modify `src/core/graph.mjs`: delegate to `graph-query`.
- Modify `src/core/checks.mjs`: check schema, source paths, query availability, and compatibility export state.
- Modify `src/core/actions.mjs`: delegate actions to command modules.
- Modify `scripts/devflow-cli.mjs`: add `status`, `query`, `graph`, `task`, `add`, `doctor`, and `index rebuild` routes.
- Modify `src/server.mjs`: HTTP wrapper over `devflow-service`.
- Move panel source from `src/app` to `apps/panel` after core and API are stable.

## Task 1: Core Contracts and Fixture Shape

**Purpose:** Lock public names and data shape before any parallel implementation starts.

**Files:**
- Create: `src/core/contracts/devflow-types.mjs`
- Create: `tests/core/contracts.test.mjs`
- Modify: `tests/core/fixtures/basic-ai-context/runtime/tasks/demo-task.json`
- Modify: `tests/core/fixtures/basic-ai-context/runtime/current.json`
- Modify: `tests/core/fixtures/basic-ai-context/config/scenes/demo-scene.json`

- [x] Step 1: Add shared constants, public method names, and shape helpers.

Expected exports:

```js
export const DEVFLOW_SCHEMA_VERSION = 1;
export const ROUTE_MODES = ["none", "resume", "light", "full"];
export const ENTITY_TYPES = ["project", "sceneTemplate", "capability", "skill", "rule", "task", "workset"];
export const QUERY_RESULT_TYPES = ["route", "current", "skills", "rules", "graph"];
export const COMMAND_RESULT_STATUSES = ["ok", "noop", "error"];
export const REPOSITORY_METHODS = [
  "listProjects",
  "getProject",
  "listSceneTemplates",
  "getSceneTemplate",
  "listSkills",
  "listRules",
  "listTasks",
  "getTask",
  "getActiveTask",
  "getWorkset",
  "listGraphEdges",
  "writeProject",
  "writeSceneTemplate",
  "writeTask",
  "setRuntimeState"
];
export const SERVICE_METHODS = [
  "queryRoute",
  "queryCurrent",
  "querySkills",
  "queryRules",
  "buildGraph",
  "startTask",
  "updateTask",
  "finishTask",
  "addProject",
  "addSceneTemplate"
];

export function normalizeSceneTemplate(input) {
  return {
    id: input.id,
    templateType: "scene-template",
    name: input.name || input.id,
    summary: input.summary || "",
    capabilityIds: input.capabilityIds || [],
    projectHints: input.projectHints || [],
    skillHints: input.skillHints || [],
    ruleHints: input.ruleHints || [],
    sourcePath: input.sourcePath || input.source?.path
  };
}

export function normalizeWorkset(input) {
  return {
    id: input.id,
    taskId: input.taskId,
    sourceText: input.sourceText || "",
    confidence: input.confidence || "unknown",
    reason: input.reason || "",
    sceneTemplateId: input.sceneTemplateId,
    capabilities: input.capabilities || [],
    projects: input.projects || [],
    skills: input.skills || [],
    rules: input.rules || []
  };
}

export function normalizeQueryRouteResult(input) {
  return {
    type: "route",
    mode: ROUTE_MODES.includes(input.mode) ? input.mode : "none",
    sceneTemplate: input.sceneTemplate ? normalizeSceneTemplate(input.sceneTemplate) : null,
    workset: input.workset ? normalizeWorkset(input.workset) : null,
    skills: input.skills || [],
    rules: input.rules || [],
    readPaths: input.readPaths || [],
    nextAction: input.nextAction || ""
  };
}
```

- [x] Step 2: Write contract tests.

Run: `node --test tests/core/contracts.test.mjs`

Expected: tests prove `sceneTemplate`, `Workset`, `queryRoute` output, repository method names, service method names, command result statuses, and route modes are stable.

- [x] Step 3: Update existing fixture data to include `templateType: "scene-template"` and a task `workset`.

Expected fixture behavior:

- `demo-scene.json` remains readable by old code and also has `templateType: "scene-template"`.
- `demo-task.json` includes `workset.capabilities`, `workset.projects`, `workset.skills`, `workset.rules`, `workset.confidence`, and `workset.reason`.
- `current.json` can keep `activeProjectIds` and `activeSceneIds` for compatibility, but also points to the active task Workset through task data.

- [x] Step 4: Run existing core tests.

Run: `npm run test:core`

Expected: existing tests still pass, with new contract tests included.

## Task 2: Repository Interface and JSON Compatibility Backend

**Purpose:** Stop higher layers from depending on raw JSON paths before adding SQLite.

**Files:**
- Create: `src/core/repositories/json-repository.mjs`
- Create: `src/core/repositories/repository-contract.mjs`
- Create: `tests/core/repositories/json-repository.test.mjs`
- Modify: `src/core/json-loader.mjs` only if a small helper is needed.

- [x] Step 1: Implement repository contract facade from the Task 1 method list.

Required methods are locked in `REPOSITORY_METHODS` from `src/core/contracts/devflow-types.mjs`. `repository-contract.mjs` may re-export that list and add validation helpers, but it must not invent or rename public methods.

```js
import { REPOSITORY_METHODS } from "../contracts/devflow-types.mjs";
```

- [x] Step 2: Implement `createJsonRepository({ rootDir })`.

Expected behavior:

- Reads current `config/projects/index.json`, `config/scenes/index.json`, `config/skills/skills.json`, `config/rules/rules.json`, and `runtime/current.json`.
- Normalizes scene records to `sceneTemplate`.
- Normalizes task records to include a Workset, using old `projectIds` and `sceneIds` as compatibility input when `workset` is missing.
- Writes only current JSON files during this compatibility phase.

- [x] Step 3: Add tests with the existing fixture.

Run: `node --test tests/core/repositories/json-repository.test.mjs`

Expected:

- `listSceneTemplates()` returns `demo-scene` with `templateType: "scene-template"`.
- `getActiveTask()` returns `demo-task`.
- `getWorkset("demo-task")` returns project `demo-project` even if the task still has old `projectIds`.

- [x] Step 4: Run core tests.

Run: `npm run test:core`

Expected: pass.

## Task 3: Query and Command Services on JSON Backend

**Purpose:** Add the public `devflow query` and command layer while still using JSON-compatible storage.

**Files:**
- Create: `src/core/services/devflow-service.mjs`
- Create: `src/core/queries/route-query.mjs`
- Create: `src/core/queries/current-query.mjs`
- Create: `src/core/queries/graph-query.mjs`
- Create: `src/core/commands/task-commands.mjs`
- Create: `src/core/commands/project-commands.mjs`
- Create: `src/core/commands/template-commands.mjs`
- Create: `tests/core/queries.test.mjs`
- Create: `tests/core/commands.test.mjs`

- [x] Step 1: Implement `createDevFlowService({ rootDir, backend = "json" })`.

Required public methods:

```js
service.queryRoute({ text });
service.queryCurrent();
service.querySkills({ projectId, templateId, worksetId });
service.queryRules({ projectId, templateId, worksetId });
service.buildGraph();
service.startTask({ title, projectIds, templateId, gate, level, note });
service.updateTask({ taskId, gate, note, recoveryPoint });
service.finishTask({ taskId, note });
service.addProject({ projectPath, projectId, name, technologyFamilyId });
service.addSceneTemplate({ templateId, name, summary, capabilityIds, projectHints });
```

- [x] Step 2: Implement `queryRoute`.

Expected return shape:

```json
{
  "mode": "light",
  "sceneTemplate": {
    "id": "demo-scene",
    "confidence": "medium",
    "reason": "Matched template keywords or project hints."
  },
  "workset": {
    "capabilities": [],
    "projects": [],
    "skills": [],
    "rules": [],
    "confidence": "medium",
    "reason": "Matched project/template metadata."
  },
  "skills": [],
  "rules": [],
  "readPaths": [],
  "nextAction": "Inspect selected project context."
}
```

- [x] Step 3: Implement task commands.

Expected behavior:

- `startTask` writes task state through repository.
- It creates or updates `runtime/tasks/<task-id>/handoff.md` for task handoff text.
- It does not require Web or HTTP.
- During JSON compatibility it may still write `runtime/tasks/<task-id>.json`, but the command result must also report the Markdown artifact path.

- [x] Step 4: Add tests for route and task commands.

Run: `node --test tests/core/queries.test.mjs tests/core/commands.test.mjs`

Expected:

- `queryRoute({ text: "修 demo project" })` returns a Workset and `readPaths`.
- `startTask` writes a task and handoff artifact.
- `queryCurrent` can recover active task and Workset.

Integration note: Task 3 tests use fake repositories for the service contract and the integrated CLI path now verifies the JSON repository returns project-mounted skills and scene-template rules.

## Task 4: CLI Facade

**Purpose:** Make daily usage possible without Web/API startup.

**Files:**
- Modify: `scripts/devflow-cli.mjs`
- Create: `tests/cli-query.test.mjs`
- Create: `tests/cli-task.test.mjs`

- [x] Step 1: Add CLI routes to `scripts/devflow-cli.mjs`.

Required commands:

```bash
devflow status
devflow query route "修盘点单打印预览数量"
devflow query current
devflow query skills --project demo-project
devflow query skills --workset demo-task
devflow query rules --template demo-scene
devflow graph
devflow task current
devflow task start "demo task" --project demo-project --template demo-scene
devflow task update demo-task --gate G4 --note "progress"
devflow add project /path/to/project
devflow add scene-template "Payment Debug"
devflow doctor
devflow index rebuild
```

- [x] Step 2: Remove `contextctl.mjs` compatibility.

Expected behavior:

- `scripts/contextctl.mjs` is not shipped and contains no JSON write path.
- `devflow task start/update/finish` is the only task CLI surface.
- Tests verify `devflow` task commands write SQLite state and handoff Markdown, not task JSON.

- [x] Step 3: Add CLI tests.

Run: `node --test tests/cli-query.test.mjs tests/cli-task.test.mjs`

Expected:

- CLI prints JSON for query commands.
- CLI starts and updates task without starting HTTP server.
- Compatibility command path still passes.

## Task 5: SQLite Schema, Rebuild, and Repository Backend

**Depends on:** Task 1 and Task 2.

**Purpose:** Add SQLite as the main relationship/state store without changing public service calls.

**Files:**
- Create: `src/core/storage/db.mjs`
- Create: `src/core/storage/schema.mjs`
- Create: `src/core/storage/rebuild-index.mjs`
- Create: `src/core/repositories/sqlite-repository.mjs`
- Create: `tests/core/storage/schema.test.mjs`
- Create: `tests/core/repositories/sqlite-repository.test.mjs`
- Modify: `package.json` if a SQLite dependency is selected.

- [x] Step 1: Choose SQLite adapter in Task 1 review before implementation.

Allowed choices:

- `better-sqlite3` if native install is acceptable for this package.
- `sqlite` + `sqlite3` if async API is preferred.
- A local file-backed adapter is not acceptable as the final storage backend because the product document explicitly chooses SQLite.

Selected adapter: `better-sqlite3@12.10.0`.

- [x] Step 2: Implement schema version table and tables.

Required tables:

```text
schema_version
projects
capabilities
scene_templates
skills
rules
documents
project_skill_mounts
project_rule_mounts
scene_template_capabilities
scene_template_project_hints
scene_template_skill_hints
scene_template_rule_hints
worksets
workset_projects
workset_capabilities
workset_skills
workset_rules
tasks
task_gates
task_events
runtime_state
graph_edges
```

- [x] Step 3: Implement `devflow index rebuild`.

Expected behavior:

- Reads existing JSON and Markdown metadata.
- Rebuilds `data/devflow.db`.
- Converts old scenes to scene templates.
- Converts old task `projectIds` and `sceneIds` to Workset records.
- Does not copy project/rule/skill Markdown bodies into SQLite.

- [x] Step 4: Add SQLite repository tests.

Run: `node --test tests/core/storage/schema.test.mjs tests/core/repositories/sqlite-repository.test.mjs`

Expected:

- Rebuild creates all required tables.
- Querying SQLite repository returns the same normalized records as JSON repository for the basic fixture.
- Missing source paths are represented as warnings, not silent drops.

## Task 6: Graph, Checks, Actions, and Task Commands Switch to Service

**Depends on:** Task 3 and Task 5.

**Purpose:** Remove direct JSON reads/writes from the existing core entry points.

**Files:**
- Modify: `src/core/graph.mjs`
- Modify: `src/core/checks.mjs`
- Modify: `src/core/actions.mjs`
- Modify: `tests/core/graph.test.mjs`
- Modify: `tests/core/checks.test.mjs`
- Modify: `tests/core/actions.test.mjs`

- [ ] Step 1: Make `buildContextGraph` call `service.buildGraph()`.

Expected behavior:

- Existing graph node ids stay stable where possible.
- Scene nodes become type `sceneTemplate`.
- Task nodes link to `workset`, then workset links to projects, skills, rules, and capabilities.

- [ ] Step 2: Make `runChecks` check DB and query health.

Required checks:

- DB exists or rebuild is available.
- schema version matches `DEVFLOW_SCHEMA_VERSION`.
- required source paths exist.
- Workset references resolve.
- `query route`, `query current`, and `graph` can run.
- JSON export is optional and reported as optional.

- [ ] Step 3: Make `runAction` call command service.

Expected behavior:

- Existing action ids remain accepted for panel compatibility.
- `add_scene` maps to `addSceneTemplate` and returns a compatibility message.
- Actions never implement separate JSON or SQL logic.

- [ ] Step 4: Run tests.

Run: `npm run test:core`

Expected: pass.

## Task 7: Agent Entries and DevFlow Skill Update

**Depends on:** Task 3 and Task 4.

**Purpose:** New windows stop loading JSON config directly and ask DevFlow query commands for the smallest context.

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `.ai-configs/claude.md`
- Modify: `.claude/CLAUDE.md`
- Modify: `.cursor/rules/00-devflow.mdc`
- Modify: `bundles/skills/devflow/SKILL.md`
- Modify: `tests/ai-context-skill.test.mjs`
- Modify: `tests/install-script.test.mjs`

- [x] Step 1: Replace JSON-first read order with query-first routing.

Required entry wording:

```text
Do not load all projects, scene templates, skills, rules, or task history by default.
For project/task/continue/scene template/Workset/skill/panel requests, run:
devflow query route "<user request>"
Read only returned readPaths and skills.sourcePath.
For resume requests, run:
devflow query current
```

- [x] Step 2: Keep compatibility note during migration.

Required entry wording:

```text
If devflow query is unavailable, fall back to the current DevFlow skill read order and report that the SQLite/query migration is incomplete.
```

- [x] Step 3: Update skill subcommands.

Expected changes:

- `@devflow:add scene` becomes `@devflow:add scene-template`.
- `@devflow:panel` states that panel is optional; CLI/TUI and query commands are primary.
- `@devflow:task` stores Workset as task runtime scope.

- [x] Step 4: Run entry tests.

Run: `node --test tests/ai-context-skill.test.mjs tests/install-script.test.mjs`

Expected: pass.

## Task 8: Retire JSON From Main Path

**Depends on:** Tasks 5, 6, and 7.

**Purpose:** Stop creating new project, scene, and task JSON as the normal path.

**Files:**
- Modify: `src/core/repositories/json-repository.mjs`
- Modify: `src/core/repositories/sqlite-repository.mjs`
- Modify: `src/core/commands/project-commands.mjs`
- Modify: `src/core/commands/task-commands.mjs`
- Create: `src/core/export/json-export.mjs` only if compatibility export is needed.
- Create: `tests/core/json-retirement.test.mjs`

- [ ] Step 1: Make SQLite the default backend.

Expected behavior:

- `createDevFlowService({ rootDir })` uses SQLite if `data/devflow.db` exists.
- If DB is missing, `doctor` suggests `devflow index rebuild`.
- JSON backend is used only for migration, explicit fallback, or tests.

- [ ] Step 2: Stop normal commands from creating JSON files.

Expected behavior:

- `devflow add project` does not create `config/projects/<id>.json`.
- `devflow add scene-template` does not create `config/scenes/<id>.json`.
- `devflow task start` does not create `runtime/tasks/<id>.json`.
- Task handoff Markdown is still created under `runtime/tasks/<task-id>/handoff.md`.

- [ ] Step 3: Add optional export command if there is a real compatibility target.

If implemented, command shape:

```bash
devflow export json --out runtime/export/devflow-json-snapshot
```

Expected behavior:

- Export creates a snapshot directory.
- Export is never used by default query/task/add commands.

- [ ] Step 4: Run tests.

Run: `npm run test:core`

Expected: pass and no normal command test creates new config/task JSON files.

## Task 9: Optional HTTP/Web Panel Split

**Depends on:** Task 6.

**Purpose:** Make panel a client of core/API instead of the reason DevFlow starts.

**Files:**
- Modify: `src/server.mjs`
- Move: `src/app/*` to `apps/panel/*`
- Create: `apps/panel/package.json`
- Modify: `apps/panel/api.js`
- Modify: `apps/panel/components/TaskBoardView.jsx`
- Modify: `apps/panel/components/GraphView.jsx`
- Modify: `package.json`
- Modify: `tests/server.test.mjs`
- Modify: `apps/panel/*.test.jsx`

- [ ] Step 1: Keep HTTP server as a wrapper over core.

Expected behavior:

- `/api/graph` calls `service.buildGraph()`.
- `/api/checks` calls `runChecks()`.
- `/api/actions` calls `runAction()`.
- No endpoint reads JSON directly.

- [x] Step 2: Move panel to `apps/panel`.

Moved because the core service is now stable and the root package should not own React/Vite dependencies.

- Root `package.json` keeps CLI/core dependencies.
- `apps/panel/package.json` owns React/Vite dependencies.
- Root scripts call panel scripts explicitly.

- [ ] Step 3: Run UI/server tests.

Run: `npm run test:ui && node --test tests/server.test.mjs`

Expected: pass.

## Final Verification

Run these commands after Task 8, and after Task 9 if panel work is included:

```bash
npm run test:core
npm run test:ui
npm test
devflow index rebuild
devflow doctor
devflow query route "修盘点单打印预览数量"
devflow query current
devflow graph
```

Expected final state:

- Query commands work without starting Web/API.
- Task start/update/finish persist active state and Workset in SQLite.
- Task handoff/evidence remains Markdown.
- New project/scene-template/task commands do not create normal-path JSON files.
- Agent entries tell new windows to run query commands instead of loading JSON indexes.
- Web panel, if kept, is an optional client.
