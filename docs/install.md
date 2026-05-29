# DevFlow Installation

This document is the clean-machine install path for the public DevFlow framework. It must stay free of local projects, private paths, tickets, accounts, tasks, and personal profile data.

## Prerequisites

- Git.
- npm.
- Node.js 20.19.0 or newer.
- Codex or another AI coding tool that can read local skills.

## Optional Dependencies

OpenSpec and superpowers are optional workflow layers. DevFlow should still
initialize, route, and track tasks when either one is missing:

- OpenSpec is only for L3/L4, PRD/Jira/Notion/Figma-backed, cross-project,
  cross-device, or high-risk work that has selected a spec layer.
- superpowers is only a registered skill family for optional execution
  discipline. Registering superpowers makes individual skills discoverable; it
  does not load them unless route text matches the skill's loading intent.

`devflow init` checks or installs OpenSpec automatically unless
`--skip-openspec` is passed. To avoid mutating global npm packages, run:

```bash
devflow init --skip-openspec
```

[OpenSpec's official installation guide](https://github.com/Fission-AI/OpenSpec/blob/main/docs/installation.md)
uses `npm install -g @fission-ai/openspec@latest` and verifies with
`openspec --version`. If `openspec --version` is missing, DevFlow reports a
warning and full tasks skip the spec layer unless OpenSpec is later installed
and selected.

For superpowers, use the skill-directory shape that matches DevFlow skill
links: place or link the superpowers skill directories under the selected AI
tool's skill home, then register them from the local source path:

```bash
devflow add skill /path/to/superpowers/skills --family superpowers --scope global
```

If superpowers is not registered, DevFlow reports availability as missing where
checked, but ordinary task routing continues and no superpowers skills are
loaded.

## Fresh Install

```bash
npm install -g @xuanmimi/devflow --registry=https://registry.npmjs.org/
devflow init
```

`git clone` is not required for normal installation. When `devflow init` runs outside an existing devflow checkout, it creates `./devflow` from the npm package template and installs selected AI tool links to that local directory.

Use a custom location when needed:

```bash
devflow init --dir ~/.local/share/devflow
```

Install local app dependencies only when you want to run the board:

```bash
cd devflow
npm install
npm run dev
```

`devflow init` opens a terminal selector for AI tool targets:

- Codex
- Claude Code
- Cursor
- QoderWork
- OpenCode
- WorkBuddy

Use Up/Down to move, Space to toggle, and Enter to install.

For automated setup:

```bash
devflow init --tools codex,claude-code,cursor
```

`devflow init` does four things:

- Validates the DevFlow skeleton.
- Links the `DevFlow` and `devflow-init` skills into selected AI tool skill directories.
- Checks or installs OpenSpec with `npm install -g @fission-ai/openspec@latest` when it is missing, unless `--skip-openspec` is passed.
- Reports whether optional OpenSpec and superpowers layers are available without blocking the core DevFlow setup.

If you do not want the init command to mutate global npm packages:

```bash
devflow init --skip-openspec
```

`scripts/install-ai-context.mjs setup` and `doctor` still exist for tests, CI, and low-level troubleshooting, but they are not the normal user install flow.

## First Local Initialization

After `devflow init` completes, ask the AI tool:

```text
@devflow:init
```

The init route should guide the user through first-time setup until local
profile, projects, scenes, skills, and rules are configured enough for routing
and the panel to work. It should collect local-only data and write it into the
user's own checkout:

- `config/profile.json`
- `config/projects/*.json`
- `config/scenes/*.json`
- `config/skills/skills.json`
- `config/rules/rules.json`
- project-local `.ai-configs/project.md`
- project-local `.ai-configs/rules/`
- project-local `.ai-configs/skills/`
- `docs/scenes/*.md`
- `docs/person/profile.md`

Do not commit private output back to the public skeleton.

## Add A Project

For a local project, use the chat entry instead of asking the user to hand-edit
indexes or remember maintenance scripts:

```text
@devflow:add /path/to/project
```

The `devflow` skill should scan `.ai-configs/project.md`, `AGENTS.md`,
`CLAUDE.md`, `README.md`, Cursor rules, `.ai-configs/rules`, and project-local
`SKILL.md` directories, then call the underlying action/script that writes
project config and updates indexes together. Project docs, project-local rules,
and project-local skills stay in the business repository; DevFlow records their
paths and relationships. If the project has no `.ai-configs`, DevFlow should
tell the user it will create `.ai-configs/project.md` and only do so after
confirmation.

For scenes, skills, and rules, use the same chat entry:

```text
@devflow:add scene 前后端联调
@devflow:add skill /path/to/skill
@devflow:add rule bff/error-handling
```

When the association cannot be inferred, the AI should ask which `projectIds`
or `sceneIds` to mount. Under the hood this maps to actions such as
`add_project_from_path`, `add_scene`, `add_skill_from_path`, and `add_rule`.

To remove DevFlow metadata, use:

```text
@devflow:del project old-project
@devflow:del scene old-scene
@devflow:del skill old-skill
@devflow:del rule old/rule
```

Deletion removes indexes, mounts, generated docs, managed bundled skill/rule
files, and runtime references inside DevFlow. It must not delete the real
business repository path or external source files.

## OpenSpec Per Project

OpenSpec is not the default for every edit. Use it when the task is L3/L4, backed by Jira/Notion/Figma/PRD, crosses projects/devices, or needs durable acceptance criteria.

Initialize OpenSpec inside the business project that owns the spec:

```bash
cd /path/to/project
openspec init
```

For small L1/L2 edits, skip OpenSpec and track only the DevFlow task state
when needed. If a newly added project should be spec-managed, DevFlow can run
or recommend `openspec init` for that project and record the OpenSpec status in
task/project state.

## Shared Standards

Use DevFlow rules and skills for long-lived standards:

- BFF conventions.
- Frontend conventions.
- iOS conventions.
- Release and packaging conventions.
- Cross-project debugging scenes.

Use OpenSpec for per-change requirements, proposals, design notes, task lists, acceptance criteria, and archive history.

## Common Commands

```bash
# Install core skill links and print workflow dependency status
devflow init

# Install selected tools non-interactively
devflow init --tools codex,claude-code,qoderwork

# Skip OpenSpec global install
devflow init --skip-openspec

# Validate JSON indexes and references
node scripts/install-ai-context.mjs validate

# Show skill link status without failing on optional tools
node scripts/install-ai-context.mjs check

# Install project-mounted skills into local project folders
node scripts/install-ai-context.mjs install --project-skills

# Preview project entry sync
node scripts/install-ai-context.mjs sync-projects

# Write project entries
node scripts/install-ai-context.mjs sync-projects --write
```

Common chat entries:

```text
@devflow:add /path/to/project
@devflow:task 新增一个需求
@devflow:panel
@devflow:del project old-project
```

## Privacy Checklist Before Publishing

Before merging to the public master skeleton:

- `runtime/tasks/*.json` should not contain local task data.
- Project-local `.ai-configs/project.md`, `.ai-configs/rules/`, `.ai-configs/skills/`, `docs/scenes/*.md`, and `docs/person/*.md` should not be committed to the public skeleton with private project details.
- `config/projects/*.json`, `config/scenes/*.json`, `config/rules/rules.json`, and `config/skills/skills.json` should not contain private project paths or company terms.
- No token, cookie, account, ticket URL, internal repository URL, screenshot path, or personal profile detail should be committed.
