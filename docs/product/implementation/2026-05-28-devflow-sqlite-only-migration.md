# DevFlow SQLite-only Migration — 实施方案

> 创建时间：2026-05-28
> 目标读者：执行此整改的 AI Agent（Codex）或开发者
> 前置文档：[devflow-workset-redesign.md](../devflow-workset-redesign.md)、[2026-05-22-devflow-sqlite-workset-implementation-plan.md](./2026-05-22-devflow-sqlite-workset-implementation-plan.md)

---

## 1. 背景

### 1.1 为什么要做这个整改

DevFlow 早期用 `config/**.json` 存项目、场景、skill、rule 关系。AI 工具（Claude Code / Codex / Cursor）启动时按 `config/entry.json` 的 `defaultReadOrder` 顺序，把 `projects/index.json`、各个 `projects/<id>.json`、`scenes/index.json`、各个 `scenes/<id>.json`、`skills.json`、`rules.json` 全部拉进上下文。任务变多、项目变多以后，**单是入口加载就占掉几千 token，AI 还没开始干活上下文就被吃掉一大半**。

为解决这个问题，引入了 SQLite（`data/devflow.db`）+ `devflow query route/current/skills/rules` CLI：AI 不再读 JSON，而是调 CLI 拿"按需的最小结果集"。

**当前状态**：迁移到一半，JSON 和 SQLite 双轨并行，存在以下结构性问题（详见 §2 现状审计）。本次整改的目标是**彻底完成迁移，让 SQLite 成为唯一数据源**。

### 1.2 用户已确认的 4 个决策

1. **静态配置 JSON 也进 SQLite**：包括 `config/entry.json`、`config/profile.json`、`config/tasks/gates.json`。三者的默认值用 JS 常量写死（写入代码、跟随版本走 PR 评审）。
2. **迁移触发方式**：显式命令 `devflow migrate from-json`，用户主动跑（不自动、不 postinstall）。命令必须支持 `--dry-run` 预览，并在删 JSON 前预检查 git 工作区是否干净。
3. **迁移完成后旧 JSON 直接删除**：不留 `.bak`、不移到 archive。命令跑完工作区里再无 `config/**.json` / `runtime/**.json`。
4. **handoff.md 保留**：作为人/AI 可读的 markdown artifact，写入磁盘（`runtime/tasks/<id>/handoff.md` 路径不变），路径登记到 SQLite 的 `task_documents` 表。

### 1.3 目标终态

- **唯一数据源**：`data/devflow.db`。
- **唯一写入路径**：`service.commands.* → sqlite-repository.writeXxx`。
- **唯一查询路径**：`service.queryRoute / queryCurrent / querySkills / queryRules`，内部用 SQL JOIN，不再反序列化 `raw_json` 再遍历。
- **磁盘上的 markdown artifact**：仅剩 `runtime/tasks/<id>/handoff.md`（按需）以及 `bundles/{skills,rules}/**`（这些本来就是源码型资产，AI 工具按 SKILL.md 协议读取）。
- **不再存在**：`config/projects/*.json`、`config/scenes/*.json`、`config/skills/skills.json`、`config/rules/rules.json`、`config/entry.json`、`config/profile.json`、`config/tasks/gates.json`、`runtime/current.json`、`runtime/tasks/<id>.json`。

---

## 2. 现状审计（这些是需要修的"坏味"，Codex 改的时候请对照）

### 2.1 双写路径，源真值不清晰

- **面板/UI 路径**：[src/core/actions.mjs](../../../src/core/actions.mjs) 209-466 行整片用 `writeRootJson` 改 `config/**.json` 和 `runtime/**.json`。
- **Service/CLI 路径**：[src/core/services/devflow-service.mjs](../../../src/core/services/devflow-service.mjs) 70-87 行 `backend === "auto"` 时只接 SQLite；`commands/*.mjs` 调 `repository.writeXxx` 只写 `data/devflow.db`。
- **同步路径**：[src/core/storage/rebuild-index.mjs](../../../src/core/storage/rebuild-index.mjs) 33-74 行从 JSON 读、向 SQLite 全量重建——方向反了，等于"JSON 才是真的"。

**后果**：用 `devflow add project` / `devflow task start` 写出的内容只进 SQLite；下一次 rebuild 会以 JSON 为基线把它清掉。`runtime/current.json` 也被面板和 sqlite-repository 各写各的（[sqlite-repository.mjs:226-230](../../../src/core/repositories/sqlite-repository.mjs)），漂移只是时间问题。

### 2.2 SQLite 关系表"写而不查"

[schema.mjs:53-213](../../../src/core/storage/schema.mjs) 定义了 23 张表（`project_skill_mounts`、`workset_projects`、`scene_template_capabilities` 等），但 [sqlite-repository.mjs:91-98](../../../src/core/repositories/sqlite-repository.mjs) 的 `listRaw / getRaw` 只读 `raw_json` 一个字段。等于关系表只在写入时被填，没有任何查询读它——SQLite 退化成了 KV JSON 仓库，关系查询能力没拿到。

### 2.3 schema_version 没有迁移路径

[schema.mjs:215-218](../../../src/core/storage/schema.mjs) 每次启动 `INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (DEVFLOW_SCHEMA_VERSION, now)`。一旦 schema 升级，没有迁移函数表跑增量 DDL；老用户的 `data/devflow.db` 永远停留在当前结构。

### 2.4 三套并行的"添加/任务"实现

- [actions.mjs:91-216](../../../src/core/actions.mjs) `addProjectFromPath`（面板）
- [commands/project-commands.mjs:1-21](../../../src/core/commands/project-commands.mjs) `addProject`（service）
- [devflow-cli.mjs:624-646](../../../scripts/devflow-cli.mjs) `createCompatibilityService.addProject`（CLI fallback）

`startTask` 同理（actions / task-commands / cli compatibility 各一份）。

### 2.5 超大单文件

| 文件 | 行数 | 待拆 |
|------|------|------|
| [src/core/actions.mjs](../../../src/core/actions.mjs) | 1216 | 阶段 3、5 拆 |
| [scripts/install-ai-context.mjs](../../../scripts/install-ai-context.mjs) | 962 | 阶段 3 拆 |
| [scripts/devflow-cli.mjs](../../../scripts/devflow-cli.mjs) | 807 | 删 230 行 compatibility 后正常 |
| [src/core/panel-graph.mjs](../../../src/core/panel-graph.mjs) | 635 | 阶段 5 拆 |

### 2.6 子进程调用开销

[actions.mjs:13-21](../../../src/core/actions.mjs) 把 install/validate/check 都 spawn 成 `node scripts/install-ai-context.mjs`，每次冷启 Node ≈ 5-15s。

---

## 3. 分阶段实施总览

| 阶段 | 内容 | 是否独立可提交 |
|------|------|----------------|
| **R1** | SQLite 基建（migration runner + 新表 + 默认值常量） | 是 |
| **R2** | `devflow migrate from-json` 命令 + 端到端迁移测试 | 是 |
| **R3** | 写入路径统一：actions / install-ai-context / commands 全部切到 sqlite-repository；删 json-repository、compatibility service、rebuild-index | 是（建议拆 2-3 个 commit） |
| **R4** | AI 入口/项目模板对齐：去掉对 `config/**.json` 的引导，全部指向 `devflow query` CLI | 是 |
| **R5** | 关系表查询化（SQL JOIN）、tests 整理、文件拆分、`.gitignore` 等清理 | 是 |

各阶段的 commit message 建议：

- R1：`feat(sqlite): add migration runner + config/task_documents tables + default constants`
- R2：`feat(cli): add devflow migrate from-json with --dry-run`
- R3：`refactor: route all writes through sqlite-repository; remove json-repository`
- R4：`docs(install): point project entries to devflow query instead of config json`
- R5：`refactor(sqlite): use SQL joins in queries; remove dead tables; split large files`

---

## 4. Round 1：SQLite 基建（**Codex 第一批任务，本文档重点**）

### 4.1 目标

搭好并行的基础设施，**不动任何业务代码**。Round 1 完成后：

- SQLite 启动经过 migration runner（fresh DB + 老 DB 都能正确升级）
- 新增 `config` 表（存 entry/profile/gates）和 `task_documents` 表（存 handoff.md 路径）
- entry/profile/gates 的默认值已经在代码里以 JS 常量形式存在
- `sqlite-repository` 暴露 `getConfig / setConfig / getEntry / getProfile / getGates / writeTaskDocument / listTaskDocuments` 等新方法
- 现有所有测试不挂；新增测试覆盖 migration runner、默认值、config 表读写
- **JSON 文件原封不动**，业务路径完全不变

### 4.2 任务清单（按顺序做）

#### Task R1-T1：拆出 migration runner

**新增文件**：

```
src/core/storage/migrations/
├── index.mjs          # 静态 import 所有 migration 文件并按 version 排序
├── 001-init.mjs       # version=1，包含当前 schema.mjs 里所有 CREATE TABLE
└── 002-config-tables.mjs   # version=2，新增 config + task_documents 表
```

`index.mjs` 模板：

```js
import * as m001 from "./001-init.mjs";
import * as m002 from "./002-config-tables.mjs";

export const migrations = [m001, m002].sort((a, b) => a.version - b.version);
```

每个 migration 文件结构：

```js
export const version = 1;
export const description = "Initial DevFlow schema";

export function up(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS projects (...); ...`);
}
```

`001-init.mjs` 的 `up(db)` 内容 = 当前 [schema.mjs:46-213](../../../src/core/storage/schema.mjs) 里 `initializeSchema(db)` 的 `db.exec` 块原样搬过去（注意去掉末尾的 `INSERT OR REPLACE INTO schema_version`，那个由 runner 统一管理）。

**修改 [src/core/storage/schema.mjs](../../../src/core/storage/schema.mjs)**：

把 `initializeSchema(db)` 改成 migration runner：

```js
import { migrations } from "./migrations/index.mjs";

export function initializeSchema(db) {
  ensureMigrationTable(db);
  const applied = new Set(
    db.prepare("SELECT version FROM schema_version").all().map(row => row.version)
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        m.version,
        new Date().toISOString()
      );
    });
    tx();
  }
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}
```

把 [src/core/contracts/devflow-types.mjs:1](../../../src/core/contracts/devflow-types.mjs) 的 `DEVFLOW_SCHEMA_VERSION` 从 `1` 升到 `2`。

**兼容性保证**：

- 老用户的 DB 里 `schema_version` 表只有一行 `(1, applied_at)`。runner 看到 v1 已 applied → 跳过 → 跑 v2 → 插入 `(2, applied_at)`。
- 新用户从零跑 → v1 全建表 + v2 加 config/task_documents。
- 现有测试 [tests/core/storage/schema.test.mjs](../../../tests/core/storage/schema.test.mjs) 不需要改逻辑（schema 结果一致），但建议更新断言里的 `DEVFLOW_SCHEMA_VERSION` 期望值。

#### Task R1-T2：新增 config 表 + task_documents 表

`002-config-tables.mjs` 的 `up(db)`：

```sql
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  raw_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_documents (
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,        -- 'handoff' | 'note' | 'artifact' | ...
  path TEXT NOT NULL,        -- 相对 rootDir，如 'runtime/tasks/<id>/handoff.md'
  raw_json TEXT NOT NULL,    -- { kind, path, summary?, generatedAt }
  PRIMARY KEY (task_id, kind, path)
);

CREATE INDEX IF NOT EXISTS idx_task_documents_task_id ON task_documents(task_id);
```

**同步更新** [src/core/storage/schema.mjs:9-33](../../../src/core/storage/schema.mjs) 的 `REQUIRED_TABLES` 数组，加上 `"config"` 和 `"task_documents"`。

#### Task R1-T3：默认值 JS 常量化

**新增文件**：

```
src/core/defaults/
├── entry.mjs        # export const DEFAULT_ENTRY = { ... }
├── profile.mjs      # export const DEFAULT_PROFILE = { ... }
├── gates.mjs        # export const DEFAULT_GATES = { ... }
└── current.mjs      # export const DEFAULT_CURRENT = { version: 1, activeTaskId: "", ... }
```

每个文件的内容：

- `entry.mjs`：把当前 [config/entry.json](../../../config/entry.json) 整个 JSON 转成 JS object 常量，外加 `export const ENTRY_CONFIG_KEY = "entry";`
- `profile.mjs`：把当前 [config/profile.json](../../../config/profile.json) 转成常量，外加 `export const PROFILE_CONFIG_KEY = "profile";`
- `gates.mjs`：把当前 [config/tasks/gates.json](../../../config/tasks/gates.json) 转成常量，外加 `export const GATES_CONFIG_KEY = "gates";`
- `current.mjs`：把"fresh 安装的空 current"做成常量，外加 `export const CURRENT_RUNTIME_KEY = "current";`（这个用 `runtime_state` 表存，不放 config 表）

**约束**：

- JSON 字面量原封不动转 JS object，不要"顺手优化"。任何字段含义的改动都属于业务变更，不在 R1 范围。
- 文件头加注释：`// Mirrored from config/entry.json. JSON file will be removed after devflow migrate from-json (Round 2).`

#### Task R1-T4：sqlite-repository 增加 config / task_documents 方法

修改 [src/core/repositories/sqlite-repository.mjs](../../../src/core/repositories/sqlite-repository.mjs)：

```js
import { DEFAULT_ENTRY, ENTRY_CONFIG_KEY } from "../defaults/entry.mjs";
import { DEFAULT_PROFILE, PROFILE_CONFIG_KEY } from "../defaults/profile.mjs";
import { DEFAULT_GATES, GATES_CONFIG_KEY } from "../defaults/gates.mjs";

// 在 repository 对象里加：

async getConfig(key) {
  const row = db.prepare("SELECT raw_json FROM config WHERE key = ?").get(key);
  return row ? JSON.parse(row.raw_json) : null;
},

async setConfig(key, value) {
  db.prepare(`
    INSERT OR REPLACE INTO config (key, raw_json, updated_at)
    VALUES (?, ?, ?)
  `).run(key, JSON.stringify(value ?? null), new Date().toISOString());
  return value;
},

async getEntry() {
  return repository.getConfig(ENTRY_CONFIG_KEY) ?? DEFAULT_ENTRY;
},

async getProfile() {
  return repository.getConfig(PROFILE_CONFIG_KEY) ?? DEFAULT_PROFILE;
},

async getGates() {
  return repository.getConfig(GATES_CONFIG_KEY) ?? DEFAULT_GATES;
},

async listTaskDocuments(taskId) {
  return db.prepare(
    "SELECT raw_json FROM task_documents WHERE task_id = ? ORDER BY rowid"
  ).all(taskId).map(row => JSON.parse(row.raw_json));
},

async writeTaskDocument(taskId, doc) {
  if (!taskId || !doc?.kind || !doc?.path) {
    throw new TypeError("writeTaskDocument requires taskId, kind, path");
  }
  db.prepare(`
    INSERT OR REPLACE INTO task_documents (task_id, kind, path, raw_json)
    VALUES (?, ?, ?, ?)
  `).run(taskId, doc.kind, doc.path, JSON.stringify(doc));
  return doc;
}
```

**关键设计**：

- `getEntry/getProfile/getGates` 用"找不到就回默认常量"的兜底，**不自动写入**。写入由 R2 的 migrate 命令负责。这样 R1 完成后业务路径完全不需要感知 config 表的存在。
- 新增方法不进入 [repository-contract.mjs](../../../src/core/repositories/repository-contract.mjs) 的 `REPOSITORY_METHODS`（contract 还由 json-repo / sqlite-repo 共同满足，R3 删 json-repo 之前不改 contract）。

#### Task R1-T5：测试

**修改** [tests/core/storage/schema.test.mjs](../../../tests/core/storage/schema.test.mjs)：

- 把 `DEVFLOW_SCHEMA_VERSION` 期望从 1 改成 2。
- 给 `REQUIRED_TABLES` 断言加上 `config` 和 `task_documents`。

**新增** [tests/core/storage/migrations.test.mjs](../../../tests/core/storage/migrations.test.mjs)：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initializeSchema } from "../../../src/core/storage/schema.mjs";

test("fresh DB applies all migrations in order", () => {
  const db = new Database(":memory:");
  initializeSchema(db);

  const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
  assert.deepEqual(versions.map(r => r.version), [1, 2]);

  // tables exist
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes("projects"));
  assert.ok(tables.includes("config"));
  assert.ok(tables.includes("task_documents"));
});

test("legacy DB at v1 incrementally applies v2", () => {
  const db = new Database(":memory:");
  // 模拟老 DB：只跑了 v1
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_version VALUES (1, '2026-05-01T00:00:00.000Z');
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, technology_family_id TEXT, source_path TEXT, doc_path TEXT, raw_json TEXT NOT NULL);
  `);

  initializeSchema(db);

  const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
  assert.deepEqual(versions.map(r => r.version), [1, 2]);
});

test("migrations are idempotent", () => {
  const db = new Database(":memory:");
  initializeSchema(db);
  initializeSchema(db);   // 二次调用不应报错也不应重复 insert
  const count = db.prepare("SELECT COUNT(*) AS n FROM schema_version").get().n;
  assert.equal(count, 2);
});
```

**新增** [tests/core/defaults.test.mjs](../../../tests/core/defaults.test.mjs)：

- 断言 `DEFAULT_ENTRY` / `DEFAULT_PROFILE` / `DEFAULT_GATES` 与磁盘上 `config/entry.json` / `config/profile.json` / `config/tasks/gates.json` 内容完全相等（防止常量化时漏字段）。

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_ENTRY } from "../src/core/defaults/entry.mjs";
import { DEFAULT_PROFILE } from "../src/core/defaults/profile.mjs";
import { DEFAULT_GATES } from "../src/core/defaults/gates.mjs";

const rootDir = path.resolve(new URL("../", import.meta.url).pathname);

test("DEFAULT_ENTRY matches config/entry.json", () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(rootDir, "config/entry.json"), "utf8"));
  assert.deepEqual(DEFAULT_ENTRY, onDisk);
});

test("DEFAULT_PROFILE matches config/profile.json", () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(rootDir, "config/profile.json"), "utf8"));
  assert.deepEqual(DEFAULT_PROFILE, onDisk);
});

test("DEFAULT_GATES matches config/tasks/gates.json", () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(rootDir, "config/tasks/gates.json"), "utf8"));
  assert.deepEqual(DEFAULT_GATES, onDisk);
});
```

> 注意：R2 跑 `migrate from-json` 删了 JSON 后，这三条 fixture 比对就会失败。届时这三个 test 改成"DEFAULT_X 是合法对象、必备字段齐全"的结构断言即可。这个改动属于 R2 的范围，不在 R1。

**新增** [tests/core/repositories/sqlite-repository-config.test.mjs](../../../tests/core/repositories/sqlite-repository-config.test.mjs)：

覆盖：

- `getConfig(unknownKey)` → `null`
- `setConfig + getConfig` 往返
- `getEntry / getProfile / getGates` 在 config 表为空时返回默认常量
- `getEntry / getProfile / getGates` 在 config 表有值时返回存的值
- `writeTaskDocument + listTaskDocuments` 往返
- `writeTaskDocument` 必填字段缺失时 throw

### 4.3 Round 1 验收清单（Codex 自检）

- [ ] `npm test` 全部通过
- [ ] `git status` 只显示新增/修改的文件，**没有任何 `config/**.json` 或 `runtime/**.json` 被改**
- [ ] 删掉本机 `data/devflow.db` 后跑 `npm start`（或 `devflow doctor`），不报错；新 DB 里 `schema_version` 有 `(1, ...) (2, ...)` 两行
- [ ] 用 sqlite3 CLI 看 `.schema config` 和 `.schema task_documents`，结构与本文档一致
- [ ] 直接 require `src/core/defaults/{entry,profile,gates}.mjs`，对象结构与磁盘 JSON 完全一致
- [ ] 没有引入新依赖（package.json 的 dependencies 没变）

---

## 5. Round 2：`devflow migrate from-json`

> 这部分等 Round 1 合并后再启动。这里给出**思路与边界**，详细任务清单由 Codex 在 Round 1 完成后基于实际代码再列。

### 5.1 命令形态

```
devflow migrate from-json [--dry-run] [--keep-json]
```

- `--dry-run`：只输出"将要写入什么、将要删什么"，不动 DB 不动文件。
- `--keep-json`（兜底开关，默认 false）：迁移成功后保留 JSON 文件不删（用户最终决定是直接删，但留个开关方便他自己 debug）。

### 5.2 迁移内容

| 来源 | 目标 |
|------|------|
| `config/entry.json` | `config` 表 key=`entry` |
| `config/profile.json` | `config` 表 key=`profile` |
| `config/tasks/gates.json` | `config` 表 key=`gates` |
| `config/projects/index.json` + `config/projects/<id>.json` | `projects` 表 + 各关系表 |
| `config/scenes/index.json` + `config/scenes/<id>.json` | `scene_templates` 表 + 关系表 |
| `config/skills/skills.json` | `skills` 表 |
| `config/rules/rules.json` | `rules` 表 |
| `runtime/current.json` | `runtime_state` 表 key=`current` |
| `runtime/tasks/<id>.json` | `tasks` 表 + `worksets` 表 + 关系表 |
| `runtime/tasks/<id>/handoff.md` | 保留文件原位；在 `task_documents` 表登记 `(task_id, kind='handoff', path=...)` |

### 5.3 安全网

1. **预检查**：`git status --porcelain` 必须为空，否则拒绝运行（避免迁移和别的改动混在一起难回滚）。`--dry-run` 跳过此检查。
2. **事务**：所有 SQLite 写在一个 `db.transaction()` 里，要么全成要么全回。
3. **删 JSON 在写 SQLite 之后**：先把所有数据写进 SQLite 并提交事务，再开始删 JSON。删之前再 `SELECT COUNT(*)` 验证关键表（projects、tasks）行数与 JSON 来源一致。
4. **handoff.md 不删**：只删 JSON。

### 5.4 复用已有代码

[scripts/migrate-git-json-relations.mjs](../../../scripts/migrate-git-json-relations.mjs)（286 行）已经实现了"从 JSON 读 → 写 SQLite"的核心循环，但它是从 git 历史 ref 读，并且只覆盖 projects / scene_templates / skills / rules / graph_edges。R2 可以拿这个文件作为参考样板，但**最终成品**是 `scripts/devflow-cli.mjs` 里新增的 `migrate from-json` 子命令 +（按需）`src/core/storage/migrate-from-json.mjs` 模块。

**修订（2026-05-28）**：`migrate-git-json-relations.mjs` **不删**。它的默认 ref 是 `8b67fdd^`——正是用户真实数据（35 项目 + 13 场景）被 reset 清空前的最后快照。它是 §12 W1（恢复历史配置）的现成工具，保留并在 W1 阶段改造成正式恢复命令。

---

## 6. Round 3：写入路径统一

> 本节在 R1/R2 落地后修订过。R1/R2 实现暴露了原计划没料到的依赖关系，**§6.0 的依赖陷阱必须先读**，不要照 §6.2 的表格字面删文件。

### 6.0 依赖陷阱（R1/R2 落地后才暴露，务必先处理）

R2 的 `migrate-from-json.mjs` 直接复用了 `createJsonRepository` 作为"从 JSON 读一次"的读取器。所以本节原稿里"删除 json-repository.mjs / rebuild-index.mjs"的字面指令会破坏迁移命令和 db 缺失时的初始化。动手前先 `grep -rln "json-repository\|rebuild-index" src/ scripts/ tests/` 确认所有引用，再按下面的方式处理：

| 文件 | 当前被谁依赖 | R3 正确处理 |
|------|--------------|-------------|
| `src/core/repositories/json-repository.mjs` | `migrate-from-json.mjs`（必须保留）、`rebuild-index.mjs`、`devflow-service.mjs`、若干测试 | **降级**为"仅 `migrate-from-json` 使用的只读 JSON 导入器"。从 service / checks / cli 的**运行时**路径移除引用，文件保留。**不要裸删**。 |
| `src/core/storage/rebuild-index.mjs` | `devflow-service.mjs`、`checks.mjs`、`devflow-cli.mjs`（`index rebuild`）、测试 | 删除前，先把这些消费方"db 不存在 → 从 JSON rebuild"的逻辑替换成 §6.1 的新初始化策略，再删。 |
| `scripts/migrate-git-json-relations.mjs` | 无运行时引用 | **保留**（见 §5.4 修订）——它是 §12 W1 恢复用户真实历史数据的工具，不删。 |
| `createCompatibilityService`（`devflow-cli.mjs` 内 ~230 行） | CLI fallback（service 模块存在时跑不到） | 可删。 |

### 6.1 backend resolver 三态初始化策略（替换"db 不存在就 rebuild"的旧逻辑）

`devflow-service.mjs` / `checks.mjs` 现在的逻辑是"db 不存在 → `rebuildDevFlowIndex` 从 JSON 重建"。R3 删 rebuild-index 后，统一改成下面三态：

1. **db 存在** → 直接用 sqlite-repository。
2. **db 不存在 + `config/**.json` 还在**（老 checkout 没迁移）→ 抛清晰错误，提示用户先跑 `devflow migrate from-json`。**不要自动迁移**（迁移会删 JSON，必须用户显式触发）。
3. **db 不存在 + 没有 JSON**（全新安装，npm 包已不含 config/runtime）→ 用 `src/core/defaults/*` 常量建一个最小可用 db：跑 schema migration + 插入默认 entry/profile/gates/current + 插入 `DEFAULT_DEVFLOW_PROJECT`（见 §6.2）。

### 6.2 全新安装的 devflow 自身 project 种子

原来 `config/projects/devflow.json` 是 npm 包模板里的种子项目记录。JSON 退役后，全新安装的 db 里需要这条记录，否则 `devflow query` 在新装环境下没有任何项目。

- 新增 `src/core/defaults/devflow-project.mjs`，导出 `DEFAULT_DEVFLOW_PROJECT`（内容 = 当前 `config/projects/devflow.json`）。
- 在 §6.1 第 3 态（全新安装初始化）里 `writeProject(DEFAULT_DEVFLOW_PROJECT)`。

### 6.3 改动总图

```
当前：
  Panel UI ──→ actions.mjs (writeRootJson) ──→ config/**.json
  CLI/Service ──→ commands/*.mjs ──→ sqlite-repo.writeXxx ──→ data/devflow.db
  rebuild-index.mjs ──→ json-repo.listXxx ──→ sqlite-repo.upsertXxx (反方向!)

目标：
  Panel UI ──→ actions.mjs (thin shell) ──┐
                                          ├──→ service.commands.* ──→ sqlite-repo ──→ data/devflow.db
  CLI ──→ devflow-cli.mjs ─────────────────┘
  migrate-from-json ──→ json-repo (只读导入器，唯一保留的 JSON 消费方)
```

### 6.4 建议拆成 3 个可独立测试、可回滚的子提交

| 子轮 | 内容 |
|------|------|
| **R3a** | 读路径统一：抽 `applyMigrationSnapshot`（§6.4.1）；实现 §6.1 三态 resolver + §6.2 种子；**`devflow-service.mjs` 和 `checks.mjs` 两个 rebuild 消费方一起改**；删 `backend === "json"` 分支；json-repository 降级为 migrate-only；删 `rebuild-index.mjs`（消费方改完后） |
| **R3b** | 写路径统一：`actions.mjs` 所有 `writeRootJson` → `service.commands.*`，目标 ≤ 400 行 |
| **R3c** | 收尾：`install-ai-context.mjs` 模块化 + actions 去 spawn 改 in-process；删 `createCompatibilityService`（**保留 `migrate-git-json-relations.mjs`**，见 §5.4 修订）；`index rebuild` 改 noop+引导 migrate（exit 0）、更新 doctor 提示（[devflow-cli.mjs:784-792](../../../scripts/devflow-cli.mjs)）；`repository-contract.mjs` 的 `REPOSITORY_METHODS` 加 `getConfig/setConfig/getEntry/getProfile/getGates/listTaskDocuments/writeTaskDocument`；`package.json` `files` 砍 `config/*`、`runtime/*` |

### 6.4.1 复用 migrate 写入逻辑，测试不得依赖 git 检查

`migrateDevFlowFromJson` 非 dry-run 第一步是 `assertCleanGitWorktree`（[migrate-from-json.mjs:53](../../../src/core/storage/migrate-from-json.mjs)）。测试 fixture 经 `copyFixture` 拷到 `os.tmpdir()`，那里**不是 git 仓库**，`git status` 会报 "not a git repository" → migrate throw。所以**测试不能直接调 `migrateDevFlowFromJson`**（`keepJson` 也救不了，它不绕过 git 检查）。

正确做法：把 migrate-from-json 的写入核心抽成导出函数 `applyMigrationSnapshot(db, snapshot)`（读取侧 `collectJsonMigrationSnapshot` 已经是导出的），让三方共享：

- **migrate 命令**：`collect → assertCleanGitWorktree → openDb → initSchema → applyMigrationSnapshot → sanity check → 删 JSON`
- **bootstrap（§6.1 第 3 态全新安装）**：不走 JSON，只 `initSchema + 写 defaults + DEFAULT_DEVFLOW_PROJECT`
- **测试**：`collectJsonMigrationSnapshot + openDb + initSchema + applyMigrationSnapshot`，不碰 git（可包 helper `seedSqliteFromJsonFixture(root)`）

这样写入逻辑单一来源（DRY），测试与生产共用同一条写入路径。

`sqlite-repository.test.mjs:23` 的 "sqlite repository matches JSON repository" parity 测试**保留语义、换实现**：用 `collect + applyMigrationSnapshot` 建库后断言 sqlite repo 与 json repo 数据一致——它能防 migrate 写入逻辑回归，别删。

### 6.5 R3 约束（红线）

- **本仓库开发期间不要真跑 `migrate from-json`，不要删本仓库的 `config/**.json` / `runtime/**.json`**。R3 开发期需要这些 JSON 作为测试 fixture 和参照。真删 JSON 是用户后续显式做的事，不是 R3 提交的验收条件。
- 因此原稿"提交前 config/runtime JSON 应为空"这条**作废**——那是用户跑完迁移后的终态，不是 R3 提交状态。
- **删除 `data/devflow.db` 后**，全新初始化（§6.1 第 3 态）应能建出可用 db，`devflow query current` / `devflow query route` 正常返回。
- `actions.mjs` 改完后无法在 CI 验证 `apps/panel` 的 UI 行为。汇报里必须明确写"panel UI 未经人工验证，需用户自测新增项目/场景/任务"。
- handoff.md 不能丢。每个子提交 `npm test` 全绿。不引入新依赖。
- 遇到测试 fixture 依赖被删的 `rebuild-index` 等情况，先输出现状 + 建议，等用户确认，不要自行删测试或改契约语义。

---

## 7. Round 4：AI 入口/项目模板对齐

### 7.1 修改的文件

| 文件 | 改动 |
|------|------|
| [bundles/skills/devflow/SKILL.md](../../../bundles/skills/devflow/SKILL.md) | 任何"先读 config/entry.json / config/projects/index.json"的引导 → "调 `devflow query route/current/skills/rules`" |
| [bundles/skills/devflow-init/SKILL.md](../../../bundles/skills/devflow-init/SKILL.md) | 同上 |
| [scripts/install-ai-context.mjs](../../../scripts/install-ai-context.mjs) | 生成的项目 `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/00-devflow.mdc` 模板里的入口提示同上 |
| 项目模板 `.ai-configs/project.md` 生成器（`actions.mjs` 内的 `buildDistributedProjectDoc`） | 同上 |

### 7.2 验收

- 在一个全新空目录跑 `devflow init`，生成的项目入口文件里没有任何 `config/projects/index.json` 等 JSON 路径出现。

---

## 8. Round 5：查询关系表化 + 清理

### 8.1 SQL JOIN 改写

把以下查询从"读 raw_json 反序列化遍历"改成"SQL JOIN 关系表"：

| 查询 | 当前实现 | 目标实现 |
|------|----------|----------|
| `queryRoute` 里"项目 → 挂载 skills/rules" | 读 project.raw_json.skills | `SELECT s.raw_json FROM skills s JOIN project_skill_mounts m ON s.id = m.skill_id WHERE m.project_id = ?` |
| `queryRoute` 里"scene → 项目/skill/rule hints" | 读 sceneTemplate.raw_json | `... JOIN scene_template_*_hints ...` |
| `panel-graph` 里"workset → projects/skills/rules" | 读 workset.raw_json | `... JOIN workset_* ...` |
| `currentQuery` 里"task → workset 推断" | 多次 getProject、getSceneTemplate | 单条 JOIN 查询 |

### 8.2 文件拆分

| 现状 | 目标 |
|------|------|
| `src/core/actions.mjs` 仍偏大（即使 R3 瘦身后 ~400 行） | 按动作类型拆 `actions/{install,project,scene,skill,rule,run-command}.mjs`；入口 `actions.mjs` 只做分派 |
| `src/core/panel-graph.mjs` 635 行 | 拆 `panel-graph/{node-builder,edge-builder,grouping,artifact-resolver}.mjs` |
| `apps/panel/styles.css` 20KB | 拆按视图模块化 |
| `tests/` 顶层 | `install-script.test.mjs` / `server.test.mjs` / `cli-*.test.mjs` 归位到 `tests/scripts/` / `tests/server/` |

### 8.3 其他清理

- `.gitignore` 加 `.playwright-mcp/`
- `AGENTS.md` 和 `CLAUDE.md` 合并：`CLAUDE.md` 改成单行 `@AGENTS.md`
- `package.json` `npm test` 改 `node --test "tests/**/*.test.mjs"`

---

## 9. 全局约束（贯穿所有 Round）

### 9.1 绝对不可破坏

1. **不要在 Round 1/2/3 任何时候手改 `config/**.json` 或 `runtime/**.json` 内容**。这些文件要么原样保留（R1/R2 早期），要么由 `migrate from-json` 一次性读取后删除（R2 末尾）。
2. **不要丢失 handoff.md**。R2 迁移时只删 JSON，不碰任何 `.md`。
3. **每个 Round 单独可回滚**：每个 Round 应该是一个原子提交（或一组紧密关联的提交），revert 后系统能跑回上一个 Round 的状态。

### 9.2 风格

- 沿用现有代码风格（ESM、async/await、无 TypeScript、`node:test` 单元测试）。
- 不引入新依赖。SQLite 用现有的 `better-sqlite3`。
- 不写注释除非"为什么"非显然。
- 错误用 throw（`throw new TypeError / new Error`），不要返回 `{ ok: false, error: ... }`，除非接口已经是这样（如 actions.mjs 现有约定）。

### 9.3 提交规约

- 每个 Round 一个原子提交（R3 可拆 2-3 个）。
- Commit message 用英文，遵循 `<type>(<scope>): <subject>` 格式（参考现有 `feat: register project docs as distributed sources`）。
- 不 squash 已有历史。

---

## 10. 给 Codex 的工作流建议

1. **先读这份文档全文，再读 §2 现状审计里引用的所有源文件**。
2. **从 Round 1 开始**。完成 §4.2 的所有任务和 §4.3 的验收清单。
3. **每完成一个 Task（如 R1-T1）跑一次 `npm test`**，确保未引入回归。
4. **Round 1 跑完后停下来**，输出一份执行报告（做了哪些文件、测试通过情况、git diff 行数），等用户确认再进 Round 2。
5. **遇到本文档没覆盖的判断点**（例如某个测试 fixture 路径冲突），先输出当前情况+建议方案，等用户回复，不要自行决定。
6. **不要试图一次 PR 干完所有 Round**。这是个系统性整改，分阶段是为了控制 blast radius。

---

## 11. 附录：当前 SQLite schema 速查

R1 完成后的 schema 表清单：

```
schema_version         (version, applied_at)                 - 由 migration runner 管理
projects               (id, name, technology_family_id, ...)
capabilities           (id, raw_json)
scene_templates        (id, name, summary, ...)
skills                 (id, name, source_path, raw_json)
rules                  (id, name, source_path, raw_json)
documents              (id, owner_type, owner_id, path, ...)
project_skill_mounts   (project_id, skill_id, raw_json)
project_rule_mounts    (project_id, rule_id, raw_json)
scene_template_capabilities      (scene_template_id, capability_id, raw_json)
scene_template_project_hints     (scene_template_id, project_id, raw_json)
scene_template_skill_hints       (scene_template_id, skill_id, raw_json)
scene_template_rule_hints        (scene_template_id, rule_id, raw_json)
worksets               (id, task_id, scene_template_id, ...)
workset_projects       (workset_id, project_id, raw_json)
workset_capabilities   (workset_id, capability_id, raw_json)
workset_skills         (workset_id, skill_id, raw_json)
workset_rules          (workset_id, rule_id, raw_json)
tasks                  (id, title, status, current_gate, workset_id, raw_json)
task_gates             (task_id, gate_id, status, raw_json)
task_events            (id, task_id, event_type, raw_json)
runtime_state          (key, raw_json)
graph_edges            (from_id, to_id, relation, raw_json)
config                 (key, raw_json, updated_at)           ← R1 新增
task_documents         (task_id, kind, path, raw_json)       ← R1 新增
```

R5 完成后可能会删除：`documents`（被 `task_documents` 取代后剩下的 project/skill/rule 的 doc 元数据用各自表的 `source_path` 字段就够了，无需独立表）。这个决定留给 R5 评估。

---

## 12. 用户真实数据恢复（整改主线完成后再做）

> 背景：R3b 面板验证暴露出 `/Users/xj/devflow` 这个仓库混了两个角色——既是 DevFlow 工具的开发仓库（公开模板要干净），又堆了用户真实工作的 task。诊断详见下面的事实，落地顺序见决定。

### 12.1 诊断事实（2026-05-28）

- 用户的 task 是**目录结构**（`runtime/tasks/<id>/handoff.md` + gate 子目录 G1/G2/... + codex-tasks/），**没有 `<id>.json`**。`json-repository.listTasks()` 实测返回 0，所以这些 task 从来读不进 SQLite，与 R3 无关。内容未丢，全在磁盘 markdown。
- 用户真实的项目/场景配置（35 项目 + 13 场景）曾被 git 追踪，在 `8b67fdd "Reset lite branch to fresh install state"` 被清空，完整快照在父提交 **`8b67fdd^`**，可恢复。
- task 引用的 `dhb-hxb-business-suite` scene **从未进 git**（gitignore 后本地创建），git 无法恢复，需重建或从 task handoff 反推。
- `config/projects/*`、`config/scenes/*`、`runtime/tasks/`、`data/*.db` 均按 [.gitignore](../../../.gitignore) 设计为本地私有，不进公开 master。

### 12.2 工作分解

| 工作 | 内容 | 工具 |
|------|------|------|
| **W1 恢复配置** | 从 `8b67fdd^` 找回 35 项目 + 13 场景 → SQLite | 现成 `scripts/migrate-git-json-relations.mjs`（默认 ref 已是 `8b67fdd^`），改造成正式 `devflow restore-from-git` 命令 |
| **W2 task 导入器** | 10 个目录形式 task（解析 `handoff.md` 的 Task/Workset/Scene Template/gate + 登记 gate 子目录与证据为 `task_documents`）→ SQLite | 新建，扩展 migrate 或独立命令 |
| **W3 缺失 scene** | `dhb-hxb-business-suite` 等 git 没有的，重建或从 task handoff 反推 | 手工 / 半自动 |
| **W4 分目录** | 工具仓库保持干净；真实数据迁到独立 `devflow init --dir` 数据目录 | 环境归置，非代码 |

### 12.3 决定（2026-05-28）

- **顺序**：先走完整改主线 R3c → R4 → R5，SQLite schema 最终稳定后再统一做 W1/W2/W3/W4。理由：W1/W2 导数据依赖最终 schema，R5 还要改关系表查询，提前导会返工。
- **R3b 已提交**：commit `8d973a8`，面板空 task 已确认与 R3b 无关（数据模型 gap）。
- W1-W4 由 Codex 执行；Claude 负责方案/计划/提示词。详细方案见 §12.4，提示词在主线完成、schema 定稿后据此细化。

### 12.4 各工作详细方案（调研于 2026-05-28）

**W1 — 恢复历史配置**

- 源快照：`8b67fdd^`，含 **27 项目 + 10 场景**。
- 关键结论：旧配置字段结构与当前 `config/projects/devflow.json` **完全一致**（version/id/name/technologyFamilyId/repoType/summary/path/tags/doc/scenes/skills/rules/readPolicy），**无需格式转换**。
- 工具：`scripts/migrate-git-json-relations.mjs`（默认 ref 已是 `8b67fdd^`）。改造为正式命令 `devflow restore-from-git [--ref <ref>] [--dry-run]`，把 27 项目 + 10 场景 + 关系 + 图边写入 SQLite（projects / scene_templates / 各关系表）。
- 边界：只写 SQLite，不还原 JSON 文件；幂等（可重复跑）；`--dry-run` 预览。

**W2 — task 目录导入器**

- 源：`runtime/tasks/<id>/`，10 个目录。每个有 `handoff.md`（统一头：`# 标题` / `Task:` / `Workset:` / `Scene Template:` / `Recovery:` / `Updated:`），部分有 gate 子目录（G1/G2/...）和 `codex-tasks/`、证据 md。
- 解析：正则提取 handoff 头部字段 → 重建 `tasks` 行（id/title/status/currentGate/recoveryPoint）+ `worksets` 行（id/sceneTemplateId）。`Updated` → updatedAt。
- 文档登记：`handoff.md` 以 `kind='handoff'` 写入 `task_documents`；gate 子目录与证据 md 以 `kind='gate'`/`kind='artifact'` 登记 path（不搬动文件）。
- 命令：`devflow import-tasks [--dry-run]`，或并入 restore。幂等。
- 鲁棒性：handoff 缺字段时用合理默认 + 收集 warning，不中断。

**W3 — 重建缺失 scene**

- 缺失清单（git 无、需重建）：`dhb-hxb-business-suite`（被 `dhb-ios-0`、`dhb-17828` 引用）。其余 task 引用的 scene（如 `frontend-bff-debug`）W1 已恢复。
- 方式：W1/W2 跑完后，扫描 SQLite 里 task/workset 引用但 `scene_templates` 缺失的 id，列成清单；由用户提供定义或从引用它的 task handoff 反推 projectHints，再 `devflow add scene-template` 写入。
- 这步偏人工，Codex 产出"缺失 scene 清单 + 反推的 projectHints 建议"，用户确认后写入。

**W4 — 分目录**

- 目标：`/Users/xj/devflow` 回归干净的工具开发仓库 + 公开模板；用户真实数据迁到独立数据目录（`devflow init --dir ~/<data-dir>`）。
- 步骤：在新数据目录初始化 → 在该目录跑 W1/W2/W3 把真实数据灌进它的 SQLite → 工具仓库清掉本地真实 task 目录与残留 → AI 工具入口指向数据目录。
- 这是环境归置（非代码）；Codex 产出操作步骤脚本/清单，用户执行。

### 12.5 W1-W4 执行顺序

R5 完成后：W1（恢复配置）→ W2（导入 task）→ W3（补缺失 scene）→ W4（分目录，把灌好的数据迁到独立目录）。W1/W2 可同一命令族（restore），W3 依赖 W1/W2 的引用扫描，W4 最后做。
