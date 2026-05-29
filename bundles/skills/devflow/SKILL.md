---
name: devflow
description: Use when entering, installing, validating, or modifying DevFlow, or when a request needs DevFlow project/task/rule/skill state.
---

# DevFlow

DevFlow is the local context and task-state workbench. Use it on demand; do not treat it as the default full workflow for every new chat.

## First Decision

Before loading DevFlow data, classify the request:

- `none`: ordinary questions, explanations, or code snippets. Do not read DevFlow unless project context is explicitly needed.
- `resume`: user says continue/current/last task. Run `devflow query current` and read only the returned task, Workset, `nextAction`, and `recoveryPoint`.
- `light`: small bug or small change. Use minimal project/context lookup and light tracking only when the work should survive the chat.
- `full`: large, cross-project, high-risk, Jira/Notion/Figma/PRD-backed work. Use full task tracking, G1-G7, and OpenSpec when selected.

Do not start G1-G7 by default.
Do not load all projects, scene templates, skills, rules, or task history by default.

## Query-First Routing

For project/task/continue/scene template/Workset/skill/panel requests, run:

```bash
devflow query route "<user request>"
```

Read only returned readPaths and skills.sourcePath; use rules.sourcePath for selected rules.

For resume requests, run:

```bash
devflow query current
```

For explicit skill or rule inventory, run:

```bash
devflow query skills
devflow query rules
```

Load source Markdown, rules, or skills only from returned `readPaths`, `skills.sourcePath`, or `rules.sourcePath`.

If devflow query is unavailable, report that the SQLite/query migration is incomplete. Do not read legacy JSON indexes unless the user explicitly asks you to inspect or repair legacy files.

Do not read home-level compatibility files unless the user asks to inspect or repair those files.

## Chat Subcommands

These are sub-intent routes of one DevFlow skill.

- `@devflow:add`: add or update a project, scene-template, skill, or rule.
- `@devflow:del`: delete a project, scene-template, skill, or rule from DevFlow metadata.
- `@devflow:task`: create, resume, or update a tracked task.
- `@devflow:panel`: open, explain, or validate the local task/project panel.
- `@devflow:init`: first-time onboarding after installation.

Use specialist skills only when the selected route needs them. For example, when superpowers has been registered, authoring a new `SKILL.md` should also use `superpowers:writing-skills`.

## `@devflow:add`

Route by object:

- Project: user can provide only a project path. Scan `.ai-configs/project.md`, `AGENTS.md`, `CLAUDE.md`, `claude.md`, `README.md`, `.cursor/rules`, `.ai-configs/rules`, and project-local `SKILL.md` directories. If the project has no `.ai-configs`, explain that DevFlow will create `.ai-configs/project.md` and ask for confirmation before migrating project entry content. Then call `add_project_from_path`.
- Scene template (`@devflow:add scene-template`): ask for `projectIds` only when the mount target cannot be inferred, then call `add_scene`.
- Skill: ask which `projectIds` or family should mount it when not inferable, then call `add_skill_from_path`. If no `SKILL.md` exists, author it first.
- Rule: ask which `projectIds` and `sceneIds` should receive it when not inferable, then call `add_rule`.

Project docs, project-local skills, and project-local rules stay in the business repository. DevFlow records source paths and relationships.

## `@devflow:del`

Route by object:

- Project -> `delete_project`
- Scene template -> `delete_scene`
- Skill -> `delete_skill`
- Rule -> `delete_rule`

Deletion is scoped to DevFlow metadata and managed files. It must not delete the real business repository, external source docs, external skills, or external rule files.

## `@devflow:task`

Create or update a task only when work should survive the current chat.

For small tasks, prefer `light` tracking. For L3/L4, vague product ideas, PRD/Jira/Notion/Figma-backed work, cross-project work, or high-risk work, use `full` tracking and ask Socratic multiple-choice clarification during G1 Intake.

Good clarification prompts:

- "这个任务更像哪一种？1. 修现有流程 2. 新增模块 3. 先做方案验证。"
- "优先目标选哪个？1. 尽快可用 2. 体验完整 3. 后续可扩展。"
- "本轮边界建议选哪个？1. 只做核心闭环 2. 核心加管理配置 3. 先出 PRD/OpenSpec。"

Avoid asking only open-ended questions when the user has not formed the requirement. Provide 2-3 concrete options and let the user choose `1`, `2`, `3`, modify an option, or describe a new direction.

The task route owns:

- Task title and level
- Workset as task runtime scope, including selected projects and scene templates
- Current step or G1-G7 gate
- OpenSpec link fields when selected
- Recovery point, artifacts, blockers, verification notes, and archive notes

## `@devflow:panel`

Use this for dashboard requests. The panel is optional; CLI/TUI and query commands are primary. The panel is a read-only view over the same query/task state. Adding or maintaining projects, scene templates, skills, and rules stays in `@devflow:add` / `@devflow:del`.

## Commands

```bash
DevFlow init
DevFlow init --tools codex,claude-code,cursor
devflow query route "<request>"
devflow query current
devflow query skills
devflow query rules
devflow task start "<title>" --project <id> --template <scene-template-id> --gate G1 --level <L1-L4>
devflow task update <task-id> --gate <G1-G7> --note "<progress or decision>"
devflow task finish <task-id> --note "<verification and handoff>"
devflow add project <repo-path>
```
