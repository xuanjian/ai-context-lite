# DevFlow 存储、查询和面板整改方案

## 结论

DevFlow 后续不应该继续以 JSON 文件和 Web 面板为中心。更合适的主路径是：

```text
Markdown = agent 入口说明、项目正文、规则正文、任务交接正文
SQLite = 项目、任务、Workset、scene template、skill、rule、挂载关系、当前状态主库
Core API = 不启动 Web/HTTP server 也能查询和写入
CLI/TUI = 日常主入口
HTTP/Web = 可选可视化客户端
JSON = 退出主路径，只保留可选迁移、调试、兼容导出
```

核心变化不是“把 JSON 换成 SQLite”这么简单，而是把 DevFlow 的核心能力抽成稳定的 query/command service。CLI、TUI、HTTP API、Web 面板都调用同一套 core，不再各自读写 JSON。

## 背景

当前 DevFlow 已经有项目、场景、规则、技能、任务状态和面板图谱能力，但存在几个结构性问题：

- 项目、scene template、skill、rule、task、Workset 的关系靠多个 JSON 文件拼接，读写路径分散。
- `src/core/graph.mjs`、`src/core/checks.mjs`、`src/core/actions.mjs` 和旧 CLI 入口都曾直接依赖 JSON 文件结构。
- Web 面板和 API server 混在一起，React/Vite 依赖也混在根 `package.json`。
- 日常查询状态、任务、挂载关系时，不应该必须启动 Web 或 HTTP server。
- `runtime/current.json`、`runtime/tasks/*.json` 作为状态源会和任务正文、任务证据、active 状态发生漂移。

整改目标：

- agent 只读少量入口 Markdown，然后通过 `devflow query ...` 获取关系和读取路径。
- 新增项目、任务、scene template、skill、rule 挂载时，主写入 SQLite。
- 固定 scene 只保留少量可复用模板；每次任务的真实项目组合、规则和 skill 由动态 Workset 决定。
- 项目正文和规则正文继续放业务项目 `.ai-configs`。
- Web 面板退为可选客户端；CLI/TUI 和 agent query 成为主入口。

## Workspace、Workset 和 Scene 边界

这里需要纠正旧设计里的核心误区：真实开发里很少存在长期固定的 scene。一个“盘点/打印/WebView”方向可能经常出现，但每次任务最终是否涉及 H5、iOS、BFF、后台配置、发布脚本都不一样。

因此后续概念边界应调整为：

- `Scene Template`：少量稳定业务方向模板，只保存关键词、候选 capability、候选项目、推荐规则和常见验证方式。
- `Workset`：每个 task 实际命中的动态工作集，是本次任务真正需要加载的项目、规则、skill 和文档路径。
- `Workspace`：如果继续使用这个词，只表示当前会话或当前任务的工作空间，不作为固定业务场景模型。

也就是说，用户说需求时不应该先让他选固定 scene。DevFlow 应先通过 capability 和历史任务推断候选 Workset；只有置信度不足时，才问一个关键问题。scene template 只是推断辅助，不是任务范围。

## 当前目录审计结论

这份方案基于当前 `/Users/xj/devflow` 和主线业务仓库的实际文件结构。

| 目录 | 当前作用 | 整改判断 |
| --- | --- | --- |
| `config/` | 当前 JSON 入口、项目索引、scene 索引、skill/rule 索引、gate 定义 | 从主存储降级。后续不再新增项目/任务/scene JSON，必要时只保留迁移期文件或导出快照 |
| `runtime/` | 当前任务指针、任务 JSON、迁移备份、临时分类结果 | 从主状态层降级。active task、task gate、Workset、任务关系进入 SQLite；任务正文/证据保留 Markdown |
| `docs/` | DevFlow 产品文档、安装文档、场景说明、历史参考资料 | 保留。业务项目正文不放 DevFlow `docs/projects` |
| `bundles/skills/devflow*` | DevFlow 核心 skill | 保留。后续入口说明改成调用 `devflow query` |
| `bundles/skills/<business-skill>` | 本机业务 skill，例如 DHB 环境、Taro 模块、UI skill | 本机可保留，公共模板不保留。挂载关系进入 SQLite |
| `bundles/rules/` | 本机通用业务 rule，例如 frontend、bff、iOS 规则 | 本机可保留，公共模板不保留。挂载关系进入 SQLite |
| `src/core/` | DevFlow graph、checks、actions、JSON/Markdown 工具 | 保留并重构为 storage/query/command/service 分层 |
| `src/server.mjs`、`src/bootstrap/` | 当前 HTTP API server 和无构建兜底页 | 降级为 HTTP wrapper。不能承载核心业务逻辑 |
| `apps/panel/` | React/Vite Web 面板前端 | 可选客户端。不是 DevFlow 主入口，依赖和脚本不再混在根 `package.json` |
| `scripts/` | CLI、安装、入口同步 | 保留但瘦身。`devflow` CLI 只解析参数并调用 core commands |
| `tests/` | 核心逻辑、CLI、server、面板测试 | 保留，随存储层迁移更新 fixture |
| `dist/` | Web 面板构建产物 | 不作为源码保留，继续 ignore |
| `node_modules/` | 本机依赖 | 不保留，继续 ignore |
| `.ai-configs`、`.claude`、`.cursor` | 不同 agent 工具入口适配 | 保留。这是 agent 入口适配面，不是项目正文源 |

主线业务项目当前实际使用的是 `.ai-configs`。抽查和全量 `find /Users/xj/Documents -maxdepth 5 -name .ai-context` 没有发现 `.ai-context` 目录，而 `.ai-configs` 广泛存在。因此，若后续要改名为 `.ai-context`，需要单独迁移，不应写进当前整改主线。

## 目标架构

```text
/Users/xj/devflow
  package.json
  AGENTS.md
  CLAUDE.md
  .ai-configs/claude.md
  .claude/CLAUDE.md
  .cursor/rules/00-devflow.mdc
  bundles/
    skills/devflow/
    skills/devflow-init/
  docs/
    product/
    scenes/        # scene template 说明，不是固定任务范围
    install.md
    project-introduction.md
  data/
    devflow.db
  runtime/
    tasks/<task-id>/
      handoff.md
      G1/
      G2/
      ...
  src/
    core/
      storage/
      repositories/
      queries/
      commands/
      services/
    api/
      http-server.mjs
  scripts/
    devflow-cli.mjs
```

后续如果仍保留 Web：

```text
apps/panel/
  package.json
  index.html
  src/
```

但 Web 只是可选客户端，不是 DevFlow 主入口。

## Markdown 职责

Markdown 是人和 agent 阅读的正文层。

应放入 Markdown 的内容：

- agent 入口说明。
- 项目介绍、模块边界和运行方式。
- scene template 说明、跨项目链路和验证方式。
- 项目规则、业务规则和排障经验。
- 任务交接、证据、验收结论和恢复点说明。
- 用户画像和协作偏好正文。

推荐路径：

```text
AGENTS.md
CLAUDE.md
bundles/skills/devflow/SKILL.md
<business-repo>/.ai-configs/project.md
<business-repo>/.ai-configs/rules/*.md
<business-repo>/.ai-configs/skills/*/SKILL.md
docs/scenes/<scene-template-id>.md
docs/person/profile.md
runtime/tasks/<task-id>/handoff.md
runtime/tasks/<task-id>/<gate-id>/*.md
```

入口 Markdown 不应要求 agent 读取全量配置。它只说明：

```text
1. 不要自行遍历项目配置。
2. 遇到项目、任务、scene template、Workset、skill、继续、面板等请求，先运行 devflow query。
3. 只读取 query 返回的 readPaths 和 skill sourcePath。
4. 新增项目/任务/挂载只调用 devflow command，不手写 DB 或 JSON。
```

## SQLite 职责

SQLite 是结构化关系和状态主库。

适合放入 SQLite 的内容：

- 项目、scene template、skill、rule 的结构化索引。
- capability、关键词、项目候选关系和 scene template 候选关系。
- 项目与 skill/rule 的稳定挂载关系。
- scene template 与候选 capability、候选项目、候选 skill/rule 的提示关系。
- 每个 task 的动态 Workset，包括本次实际项目、能力、规则、技能、置信度和理由。
- task、task gate、task event、active task。
- Markdown 文档路径、摘要、hash、更新时间。
- graph nodes/edges。
- query route 的候选关系和最近使用状态。

不适合放入 SQLite 的内容：

- 项目正文全文。
- 规则正文全文。
- 用户画像长文。
- 任务交接正文。
- 验收证据全文。

建议表：

```text
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

关键字段示例：

```text
skills
  id
  name
  source_path
  description
  trigger
  source_type

project_skill_mounts
  project_id
  skill_id
  when_to_load
  priority

tasks
  id
  title
  status
  workset_id
  current_gate
  level
  created_at
  updated_at

worksets
  id
  task_id
  source_text
  confidence
  reason
  scene_template_id

runtime_state
  key
  value
```

`active_task_id` 应存在 SQLite 的 `runtime_state` 或 task 状态字段中，不再依赖 `runtime/current.json`。

## JSON 职责

JSON 不再是主路径。

不再新增：

```text
config/projects/<id>.json
config/scenes/<id>.json
runtime/tasks/<id>.json
```

不再要求新窗口读取：

```text
config/entry.json
runtime/current.json
config/projects/index.json
config/scenes/index.json
config/skills/skills.json
config/rules/rules.json
```

可选保留：

```text
devflow export json
```

用途仅限：

- 迁移期回滚。
- 调试 DB 内容。
- 老版本 DevFlow 或外部工具兼容。
- 离线快照。

如果没有明确兼容对象，JSON export 不是必做功能。

## Core API 和 CLI

核心能力必须能在不启动 Web、HTTP server、Vite、React 的情况下使用。

推荐命令：

```bash
devflow status
devflow query route "修盘点单打印预览数量"
devflow query current
devflow query skills --project dhbfront-manager-mobile
devflow query rules --template stock-inventory-cross-stack
devflow query workset --task <task-id>
devflow graph
devflow tasks
devflow task current
devflow task show <task-id>
devflow task start "<title>" --project <id> --template <scene-template-id>
devflow task update <task-id> --gate G4 --note "<progress>"
devflow add project /path/to/project
devflow add scene-template "<template name>"
```

CLI 调用链：

```text
devflow CLI
  -> src/core/commands/*
  -> src/core/queries/*
  -> src/core/repositories/*
  -> SQLite + Markdown metadata
```

不要变成：

```text
CLI -> HTTP API -> SQLite
```

HTTP API 只是可选 wrapper：

```text
src/api/http-server.mjs
  -> src/core/queries/*
  -> src/core/commands/*
```

## Query 返回形态

`devflow query route` 应返回足够小、足够明确的结果，让 agent 只读取必要文件。

示例：

```json
{
  "mode": "light",
  "sceneTemplate": {
    "id": "stock-inventory-cross-stack",
    "confidence": "medium",
    "reason": "Inventory print preview requires H5/native/BFF context."
  },
  "workset": {
    "capabilities": ["inventory", "print", "webview"],
    "projects": [
      {
        "id": "dhbfront-manager-mobile",
        "docPath": "/Users/xj/Documents/frontend/dhbfront-manager-mobile/.ai-configs/project.md",
        "reason": "H5 print preview entry."
      },
      {
        "id": "dhb-ios",
        "docPath": "/Users/xj/Documents/ios/DHB/.ai-configs/project.md",
        "reason": "Native print bridge candidate."
      },
      {
        "id": "bff-warehouse",
        "docPath": "/Users/xj/Documents/node/bff-warehouse/.ai-configs/project.md",
        "reason": "Inventory print data contract candidate."
      }
    ],
    "confidence": "high",
    "reason": "命中库存、打印预览、H5/native bridge 关键词"
  },
  "skills": [
    {
      "id": "devflow",
      "sourcePath": "/Users/xj/devflow/bundles/skills/devflow/SKILL.md",
      "reason": "DevFlow routing and task state are required."
    },
    {
      "id": "dhb-local-env",
      "sourcePath": "/Users/xj/devflow/bundles/skills/dhb-local-env/SKILL.md",
      "reason": "Selected projects use DHB local environment switching."
    }
  ],
  "rules": [
    {
      "id": "dhbfront-manager-mobile/project-rules",
      "sourcePath": "/Users/xj/Documents/frontend/dhbfront-manager-mobile/.ai-configs/rules/project-rules.md",
      "reason": "Selected project-specific rule."
    }
  ],
  "readPaths": [
    "/Users/xj/Documents/frontend/dhbfront-manager-mobile/.ai-configs/project.md",
    "/Users/xj/Documents/frontend/dhbfront-manager-mobile/.ai-configs/rules/project-rules.md"
  ],
  "nextAction": "Inspect bridge and print preview contract."
}
```

这里返回的 JSON 是命令输出，不是长期存储文件。

## Skill 加载保证

迁移后仍然必须能准确知道该加载哪些 skill。实现方式不是读 `config/skills/skills.json`，而是查询 SQLite 中的挂载关系。

需要保证：

- `devflow query route` 返回命中的 skills。
- `devflow query skills --project <id>` 返回项目挂载 skill。
- `devflow query skills --template <id>` 返回 scene template 推荐 skill。
- `devflow query skills --workset <id>` 返回本次任务实际应加载 skill。
- 每个 skill 都有 `source_path`、`when_to_load`、`priority`。
- agent 入口明确要求“不自行猜测 skill，先运行 query”。

功能完整性取决于 skill/rule/project/scene template/Workset 挂载关系是否完整进入 SQLite。

## Web 和 API 边界

Web 面板不是主入口。

推荐入口：

```text
CLI / TUI = 主面板
HTTP API = 可选集成层
Web = 可选可视化客户端
```

日常使用：

```bash
devflow status
devflow graph
devflow query route "..."
devflow task current
```

这些命令不需要启动项目。

只有需要网页可视化时才启动：

```bash
devflow web
```

`devflow web` 可以启动 HTTP API + 静态 Web 面板。Web 调用 API，API 调用 core。

## 关键改造点

当前四个关键 JSON 入口需要改造，但不要各自直接写 SQLite。

### `src/core/graph.mjs`

当前：直接读 JSON index 和 task JSON 建图。

目标：改成调用 `graph-service`。

```text
graph.mjs
  -> services/graph-service.mjs
  -> repositories/graph-repository.mjs
  -> SQLite
```

### `src/core/checks.mjs`

当前：检查 JSON 文件是否存在、是否能解析。

目标：检查 DB/schema/sourcePath/query/export 状态。

重点检查：

- DB 是否存在。
- schema version 是否正确。
- 必要表是否存在。
- skill/rule/project/scene template/Workset 挂载是否有断边。
- Markdown sourcePath 是否存在。
- CLI query 是否可用。

### `src/core/actions.mjs`

当前：面板 action 直接写 `config/projects/*.json`、`config/scenes/*.json`、catalog JSON。

目标：action 只调用 command service。

```text
actions.mjs
  -> commands/add-project.mjs
  -> repositories/projects.mjs
  -> SQLite transaction
```

### `scripts/devflow-cli.mjs`

当前：`devflow` CLI 是唯一主入口。旧 `contextctl` 兼容入口不再保留，避免第二套 JSON 写路径。

目标：CLI facade。

```text
devflow-cli
  -> parse args
  -> core commands / core queries
```

任务 start/update/finish 不再创建或修改 `runtime/tasks/<id>.json`，而是写 SQLite，并把正文/证据写到 Markdown artifact。

## 分阶段整改

### 阶段 1：抽 core query/command，仍兼容 JSON

目标：先建立统一接口，不立即切 DB。

范围：

- 新增 `src/core/queries/*`。
- 新增 `src/core/commands/*`。
- 新增 repository 接口，但实现暂时可读写现有 JSON。
- `graph.mjs`、`checks.mjs`、`actions.mjs`、`devflow-cli.mjs` 开始调用统一接口。

验收：

```bash
npm run test:core
devflow doctor
```

### 阶段 2：引入 SQLite schema 和 rebuild

目标：让 SQLite 能从当前 JSON 和 Markdown metadata 重建完整索引。

范围：

- 新增 `src/core/storage/schema.mjs`。
- 新增 `src/core/storage/db.mjs`。
- 新增 `devflow index rebuild`。
- 从当前项目 JSON、scene JSON、skill/rule catalog、task JSON 迁入 SQLite，并把旧 scene 迁成 scene template。

验收：

```bash
devflow index rebuild
devflow status
devflow query route "修盘点单打印预览"
```

### 阶段 3：graph/checks 切 SQLite

目标：面板、CLI graph、doctor/checks 先从 SQLite 读。

范围：

- `graph.mjs` 优先 SQLite。
- `checks.mjs` 检查 DB/schema/sourcePath。
- Web 如果保留，`/api/graph` 只调用 core graph service。

验收：

```bash
devflow graph
devflow doctor
npm run test:core
```

### 阶段 4：新增项目和任务写 SQLite

目标：停止新增 JSON。

范围：

- `devflow add project` 写 `projects/documents/mounts/graph_edges`。
- `devflow task start/update/finish` 写 `tasks/task_gates/task_events/runtime_state`。
- 任务交接正文写 Markdown artifact。
- skill/rule 挂载关系写 SQLite。

验收：

```bash
devflow add project /path/to/project
devflow query skills --project <project-id>
devflow task start "test task" --project <project-id>
devflow task current
```

确认不新增：

```text
config/projects/<id>.json
runtime/tasks/<id>.json
```

### 阶段 5：更新 agent 入口和 DevFlow skill

目标：新窗口不再读取 JSON 主路径。

范围：

- 更新 `AGENTS.md`。
- 更新 `CLAUDE.md`。
- 更新 `.ai-configs/claude.md`。
- 更新 `.claude/CLAUDE.md`。
- 更新 `.cursor/rules/00-devflow.mdc`。
- 更新 `bundles/skills/devflow/SKILL.md`。

新入口写法：

```text
不要读取全量配置。
当用户提到项目、任务、继续、scene template、Workset、skill、面板时，先运行：

devflow query route "<用户输入>"

只读取返回的 readPaths 和 skills.sourcePath。
新增项目/任务/挂载只调用 devflow 命令。
```

### 阶段 6：JSON 退场

目标：JSON 不再是主路径。

范围：

- 删除或忽略 `runtime/current.json` 主路径。
- 停止生成项目/scene/task JSON；如需保留 scene 概念，只生成或维护 scene template 元数据。
- `config/entry.json` 改为 Markdown 入口或移除。
- 可选实现 `devflow export json`，仅迁移/调试/兼容使用。

验收：

```bash
devflow query current
devflow query route "..."
devflow task current
devflow graph
```

这些命令不依赖 `config/entry.json`、`runtime/current.json`、`config/projects/index.json`。

## 预期收益

以下是基于当前结构的工程估算，最终数字需要实测。

| 维度 | 当前 | 改造后 | 预期收益 |
| --- | --- | --- | --- |
| agent 路由上下文 | 读 entry/current/index/project JSON，容易扩散 | 读入口 MD + `devflow query route` | 路由阶段上下文减少约 60%-90% |
| 查询项目关系 | 遍历 JSON index 和 detail | SQLite 查询 nodes/edges/mounts | 稳定性明显提升 |
| 新建 task/project | 新增或修改多个 JSON | 单事务写 SQLite + 必要 Markdown | 减少漂移和漏写 |
| skill 加载 | agent 从项目 JSON 间接判断 | query 返回明确 skill sourcePath | 更可控，更少误加载 |
| CLI 使用 | 依赖 JSON 文件状态 | 直接调用 core query/command | 不需要启动 Web/API |
| Web 面板 | 接近主入口 | 可选客户端 | 日常启动成本降低 |
| 维护成本 | 多处直接读写 JSON | 统一 storage/repository API | 重复读写逻辑减少约 50%-70% |

最大收益不是页面快多少，而是 DevFlow 从“JSON + Web 面板项目”变成“本地上下文查询和任务状态服务”。

## 风险和边界

- 不要让 agent 直接写 SQL。
- 不要让 CLI、HTTP API、Web 各写一套业务逻辑。
- SQLite schema migration 必须有版本管理。
- DB 需要 backup/doctor/rebuild 能力。
- 任务正文和证据不要塞进 SQLite。
- 业务项目正文不要复制进 DevFlow。
- JSON export 不是主能力，没有明确兼容对象时可以不做。
- Web 面板如保留，也不能支配 core 架构。

## 最终推荐执行顺序

1. 抽 core query/command 层，暂时兼容 JSON。
2. 引入 SQLite schema、repositories 和 `devflow index rebuild`。
3. `graph/checks` 切到 SQLite。
4. `add project`、`task start/update/finish` 写 SQLite。
5. 更新 agent 入口和 DevFlow skill，让 agent 走 `devflow query`。
6. JSON 退出主路径，Web 降级为可选客户端。

这个顺序能保证功能完整，又避免一次性从 JSON 跳到 SQLite 导致入口、面板、任务恢复同时失效。
