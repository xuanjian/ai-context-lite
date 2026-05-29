# DevFlow SQLite Workset Execution Matrix

This document explains which implementation tasks can run in parallel and which tasks must wait.

## Serial Gate

| Task | Must Run Alone | Why |
| --- | --- | --- |
| Task 1: Core Contracts and Fixture Shape | Yes | It fixes names and return shapes for `sceneTemplate`, `workset`, route modes, command results, and repository methods. If Tasks 2-4 start before this, they will duplicate incompatible models. |

## Parallel Batch A

Start these only after Task 1 is reviewed.

| Task | Can Run In Parallel With | Depends On | Output |
| --- | --- | --- | --- |
| Task 2: Repository Interface and JSON Compatibility Backend | Tasks 3 and 4 | Task 1 | A repository abstraction that still reads current JSON and normalizes scenes to scene templates. |
| Task 3: Query and Command Services on JSON Backend | Tasks 2 and 4 | Task 1 | Core service API, route query, current query, task commands, and command result shape. |
| Task 4: CLI Facade | Tasks 2 and 3 | Task 1 | `devflow status/query/task/add/doctor/index rebuild` CLI surface. |

Coordination rule for Batch A:

- Task 1 owns repository method signatures, service method signatures, route query output shape, and command result status names.
- Task 2 implements the repository methods locked by Task 1.
- Task 3 implements the service methods and query output shape locked by Task 1.
- Task 4 owns CLI flag names and stdout/stderr behavior.
- If a signature changes, stop the other two tasks and update Task 1 contracts first.

## Parallel Batch B

Start after Tasks 2 and 3 are accepted. Task 4 is useful but not a hard prerequisite unless the implementer needs CLI smoke tests.

| Task | Can Run In Parallel With | Depends On | Output |
| --- | --- | --- | --- |
| Task 5: SQLite Schema, Rebuild, and Repository Backend | Task 6 preparation only | Tasks 1 and 2 | `data/devflow.db`, schema, rebuild command, SQLite repository. |
| Task 6: Graph, Checks, Actions, and Task Commands Switch to Service | Task 7 | Tasks 3 and 5 | Existing core entry points delegate to service and stop owning storage logic. |
| Task 7: Agent Entries and DevFlow Skill Update | Task 6 | Tasks 3 and 4 | New windows use `devflow query` and do not load JSON indexes by default. |

Important wait condition:

- Task 6 cannot fully finish until Task 5 has SQLite repository tests passing.
- Task 7 can start after the command names from Tasks 3 and 4 are stable, but final wording should wait until Task 4 CLI tests pass.

## Final Batch

| Task | Can Run In Parallel With | Depends On | Output |
| --- | --- | --- | --- |
| Task 8: Retire JSON From Main Path | Task 9 optional panel work | Tasks 5, 6, and 7 | SQLite becomes default; new project/task/template commands stop creating JSON. |
| Task 9: Optional HTTP/Web Panel Split | Task 8 | Task 6 | HTTP/Web becomes optional client; root package can be cleaned if panel is moved. |

Task 8 should be treated as the functional finish line. Task 9 is useful cleanup, but it should not block the SQLite/Workset core if time is limited.

## Suggested Execution Order

1. Task 1.
2. In parallel: Tasks 2, 3, 4.
3. Task 5.
4. In parallel: Task 6 and Task 7, with Task 6 waiting for Task 5 before final test pass.
5. Task 8.
6. Task 9 if the Web panel is still worth keeping.

## What Not To Split

- Do not split schema tables away from repository tests. Schema without repository behavior will look complete but cannot prove query stability.
- Do not split `queryRoute` away from `Workset` output. Agent loading stability depends on both in one return shape.
- Do not split `actions.mjs` and command services into separate business implementations. `actions.mjs` must only delegate.
- Do not move `src/app` to `apps/panel` before core service migration. It creates dependency churn without improving the main path.
