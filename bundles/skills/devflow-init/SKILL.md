---
name: devflow-init
description: Use after installing DevFlow when the user needs first-time onboarding, personal AI preferences, project inventory, scene creation, skill/rule mounting, or migration from scattered notes into DevFlow state.
---

# devflow-init

## Purpose

Use this skill immediately after DevFlow is installed, normally through the
chat entry `@devflow:init`, or whenever a user wants to initialize their own
DevFlow setup from rough notes.

The user should not need to design storage files. You interview them, normalize messy
information, write DevFlow state/docs through the existing actions, and verify the existing
DevFlow panel can display the result. Keep guiding until local profile,
projects, scenes, skills, and rules are configured enough for routing and panel
checks to work.

## Privacy Boundary

- Do not write secrets, credentials, tokens, private ticket URLs, private account identifiers, or personal identity details into public files.
- Local machine paths are allowed only in the user's private/local DevFlow checkout.
- If the user is preparing a public template, replace private project names and paths with generic placeholders.
- Assistant memory or home-level context may be used as temporary onboarding
  context, but do not write inferred private company, client, repository,
  product, or project names into public template files. Only write a concrete
  private name into the user's local DevFlow config after the user confirms it.
- When offering examples, use generic labels such as "frontend app", "BFF/API",
  "iOS app", "backend service", "release scripts", or "AI workflow project".

## Query First

1. Run `devflow query current` to see whether onboarding or task state already exists.
2. Run `devflow query route "@devflow:init <user request>"` before choosing project, scene, Workset, or task context.
3. Run `devflow query skills` only when the user asks to inspect or mount skills.
4. Run `devflow query rules` only when the user asks to inspect or mount rules.

Do not bulk-read distributed project docs, `bundles/rules/**`, or `bundles/skills/**` until a query result selects the project, scene, skill, or rule source path.

## Interview Flow

Ask in small batches. Stop after each batch if the answer is unclear.

1. Personal profile:
   - If `config/profile.json` or `docs/person/profile.md` is missing or still
     a placeholder, create the minimal files first, then help the user complete
     them.
   - Use Socratic multiple-choice questions instead of asking the user to invent
     a full profile from scratch. Offer 2-3 concrete choices per question, with
     a recommended default, and let the user pick `1`, `2`, `3`, modify an
     option, or describe their own preference.
   - Clarify what AI should remember about the user's work style.
   - Clarify which context should stay private or local-only.
   - Clarify how tasks should be tracked: lightweight, G1-G7, or only for
     larger work.
   - Write the selected answers into `config/profile.json` and
     `docs/person/profile.md` in a concise, reusable form.

   Example profile questions:
   - "你希望 AI 默认怎么推进？1. 直接执行 2. 先给方案 3. 先问清楚再做。推荐：1，除非任务高风险。"
   - "哪些内容默认只留本机？1. 私有项目和任务 2. 账号/链接/截图 3. 全部个人画像。推荐：1+2。"
   - "任务记录默认选哪种？1. 小任务不记，大任务记 2. 所有开发任务都记 3. 只在你明确要求时记。推荐：1。"

2. Projects:
   - Which projects should be registered first?
   - Ask for local paths when available.
   - Public templates and examples must stay generic. If memory suggests likely
     private projects, label them as memory-derived candidates and ask for
     confirmation before writing local project config.
   - Offer generic choices such as:
     - "先只注册 DevFlow 自己，保持最小配置。"
     - "添加你常用的业务项目，请提供本机路径。"
     - "暂时不添加项目，后续用 `@devflow:add /path/to/project`。"
   - For each path, inspect project guide files such as `.ai-configs/project.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `.ai-configs/rules/`, `.cursor/rules/*.mdc`, `.ai-configs/skills/`, and project-local skills.

3. Scenes:
   - Ask whether common cross-project scenes are needed.
   - Examples: single repo change, frontend plus API debugging, iOS WebView plus BFF, release/package, documentation cleanup, AI workflow maintenance.
   - For each scene, identify mounted projects and scene-level rules.

4. Skills:
   - Ask whether there are existing `SKILL.md` folders to import.
   - Ask which projects or scenes should load each skill.

5. Rules:
   - Ask whether there are existing rule files.
   - If no file exists, ask for the rule's purpose and generate a concise `.md` rule file.
   - Decide `applyMode`: `project-on-demand` for project rules, `scene-on-demand` for scene behavior, `manual` only for reference rules.

## Normalized Draft Shape

Before writing files, normalize the conversation into this shape:

```json
{
  "profile": {
    "role": "",
    "preferences": [],
    "privacy": []
  },
  "projects": [
    {
      "id": "",
      "name": "",
      "path": "",
      "technologyFamilyId": "",
      "summary": "",
      "sceneIds": [],
      "skillIds": [],
      "ruleIds": []
    }
  ],
  "scenes": [
    {
      "id": "",
      "name": "",
      "summary": "",
      "purpose": "",
      "projectIds": [],
      "skillIds": [],
      "ruleIds": []
    }
  ],
  "skills": [
    {
      "id": "",
      "name": "",
      "description": "",
      "skillPath": "",
      "projectIds": [],
      "sceneIds": []
    }
  ],
  "rules": [
    {
      "id": "",
      "name": "",
      "purpose": "",
      "sourcePath": "",
      "applyMode": "project-on-demand",
      "projectIds": [],
      "sceneIds": []
    }
  ]
}
```

## Write Path

Prefer the existing maintenance actions and scripts over hand-editing multiple files:

- Add project: use the panel action `add_project_from_path` or the equivalent backend action. It scans `.ai-configs/project.md`, lightweight AI entries, Cursor rules, and project-local skills/rules; registers project-local skills/rules as distributed sources; updates DevFlow project state; and adds lightweight managed entries in the project. If `.ai-configs` is missing, tell the user first and only create `.ai-configs/project.md` after confirmation.
- Add scene: use `add_scene` with scene id/name, purpose, and mounted project ids.
- Add skill: use `add_skill_from_path` when a `SKILL.md` path exists; otherwise register only after the user confirms the generated skill content.
- Add rule: use `add_rule`; if no source file exists, provide `purpose` so the action can generate a rule template.

When manual edits are unavoidable, keep DevFlow repository state and distributed project files aligned:

- the selected project's `.ai-configs/project.md`
- the selected project's `.ai-configs/rules/` when adding project-local rules
- the selected project's `.ai-configs/skills/` when adding project-local skills
- DevFlow project, scene, skill, and rule state exposed through `devflow query route/current/skills/rules`
- `bundles/skills/<skill-id>/SKILL.md` when adding a bundled skill
- `bundles/rules/<rule-id>.md` when adding a bundled rule

## Panel Safety

The panel reads the same DevFlow state exposed by query commands. Before completion, verify:

- `devflow query route "<representative request>"` returns the expected project or scene.
- `devflow query current` returns coherent task and Workset state when a task is active.
- Project `skills`, `rules`, and `scenes` reference ids that exist.
- Scene `projects` and `rules` reference existing project/rule ids.
- Rule entries have `sourcePath`, `applyMode`, non-empty `globs`, and `whenToRead`.

## Verification

Do not say initialization is complete until these pass:

```bash
node scripts/install-ai-context.mjs doctor
node scripts/install-ai-context.mjs validate
npm test
```

Then start or refresh the existing DevFlow panel and confirm the new projects, scenes, skills, and rules appear without a JSON or graph reference error.
