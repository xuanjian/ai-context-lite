# DevFlow Project Introduction

DevFlow is a local context and task-state workbench for AI coding tools. It stores project metadata, scene templates, rules, skills, task state, and recovery points so agents can load the smallest useful context.

DevFlow is not the execution engine. Codex, Claude Code, Cursor, OpenSpec, and superpowers still decide and execute their own workflows. DevFlow provides durable state and context selection.

## Core Model

- `Project Registry`: project id, path, summary, entry docs, rules, skills, and future capability metadata.
- `Capability Map`: business or technical capabilities used to infer which projects may be relevant.
- `Scene Template`: reusable workflow direction or relationship hint. It is not the final project scope.
- `Task Workset`: the actual project/rule/skill set selected for one task.
- `Task State`: current step, gate when needed, blockers, evidence, next action, and recovery point.
- `Agent Adapter`: generated AGENTS/CLAUDE/Cursor entries that tell each tool when and how to use DevFlow.
- `Task Board`: read-only visibility over the same JSON state that agents read.

## On-Demand Modes

Agent entries should classify each new request before reading DevFlow data:

- `none`: ordinary questions, explanations, or code snippets. Do not read DevFlow unless project context is clearly needed.
- `resume`: continuing current work. Read `runtime/current.json`, the active task, Workset, `nextAction`, and `recoveryPoint`.
- `light`: small bug or small change. Use minimal context and light tracking only when the work should survive the chat.
- `full`: large, cross-project, high-risk, Jira/Notion/Figma/PRD-backed work. Use full tracking, G1-G7, and OpenSpec when selected.

Do not start G1-G7 by default.

## Distributed Project Context

Project-specific context should live with the business project:

- `.ai-configs/project.md`
- `.ai-configs/rules/`
- `.ai-configs/skills/`
- `AGENTS.md` / `CLAUDE.md`
- `.cursor/rules/`

DevFlow stores the relationship layer: project ids, source paths, scene templates, mounted skills/rules, and task state. It should not duplicate full project documents into the public template.

## Chat Entries

```text
@devflow:add /path/to/project
@devflow:add scene 前后端联调
@devflow:add skill /path/to/skill
@devflow:add rule bff/error-handling
@devflow:del project old-project
@devflow:del scene old-scene
@devflow:del skill old-skill
@devflow:del rule old/rule
@devflow:task 新增订单导出功能
@devflow:panel
@devflow:init
```

`@devflow:init` handles local onboarding. `@devflow:add` and `@devflow:del` maintain registry entries. `@devflow:task` creates, resumes, or updates tracked work. `@devflow:panel` opens or explains the board.

## Task Tracking

Use task tracking only when work should survive the current chat.

Light tracking records:

- goal
- selected projects or Workset
- current step
- next action
- evidence
- recovery point

Full tracking may additionally use G1-G7:

- G1 Intent / Intake
- G2 Discovery
- G3 Plan / Product UI
- G4 Development
- G5 Integration
- G6 Acceptance
- G7 Run / Package Archive

OpenSpec is optional and should be used for L3/L4, formal PRD/ticket/design input, cross-project/cross-device behavior, or high-risk changes. It should not be used for every small edit.

## Task Board

The board answers:

- What task is active?
- Which step or gate is it in?
- Which projects or Workset are selected?
- What is blocked?
- What was verified?
- Where should a future session resume?

Run it locally:

```bash
npm run dev
```

Then open the URL printed by Vite, usually `http://127.0.0.1:5173/`.

## Public Skeleton Boundary

The public template should include generic scripts, docs, schemas, bundled core skills, tests, and empty example configuration. It should not include local task data, private project docs, personal profile data, company names, internal paths, tickets, tokens, screenshots, or account details.
