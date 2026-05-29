# DevFlow × OpenSpec × superpowers 集成方案

> 状态：方案待评审（2026-05-28）
> 关联：[devflow-workset-redesign.md](devflow-workset-redesign.md)、`src/core/defaults/entry.mjs`、`src/core/defaults/gates.mjs`

## 1. 背景与现状：设计已引用，代码未接线

DevFlow 的入口、gate 定义和文档里到处引用了 OpenSpec 和 superpowers，但都只是**占位引用**，没有任何真实绑定机制。

| 引用点 | 现状 | 缺口 |
|--------|------|------|
| `README.md:5` | 定位「不替代 OpenSpec/superpowers，只做状态层」 | 定位清晰，但没有「状态层如何指向它们」的实现 |
| `gates.mjs` G2/G3/G4/G6/G7 | gate 描述里写了「superpowers 调研」「OpenSpec proposal/design/spec delta」「archive 回 openspec/specs/」 | 纯文字描述，task 里没有对应字段，没有状态流转 |
| `entry.mjs:64-75` | `workflowDependencies` 列了 openspec（`npm i -g @fission-ai/openspec`）和 superpowers（verify `~/.codex/superpowers exists`） | install/verify 没有被任何命令真正调用 |
| `entry.mjs:125-143` | `specLayer` 已定义 `spec.tool/changeId/path/status/handoff` 与 6 个 status 值 | task 数据模型、CLI、query 都没有 `spec` 字段 |
| `SKILL.md:61` | 「authoring SKILL.md 应该用 `superpowers:writing-skills`」 | superpowers 根本没安装，引用悬空 |
| `route-query.mjs:55` | `openspec` 关键词 → `full` 模式 | 路由能识别，但识别之后没有任何 spec 动作 |

本机核实：
- **openspec CLI 已装**（`/opt/homebrew/bin/openspec` v1.3.1），仓库内无 `openspec/` 工作区。
- **superpowers 未安装**（`~/.claude/plugins` 下没有）。
- DevFlow 的 **skill 路由是真的**（`route-query.mjs` → `querySkills` 走 SQLite），这是接 superpowers 的天然挂点。

结论：本方案不是「新增功能」，而是**把已经写在设计里的协作关系真正接上线**。

## 2. 第一原则：按需加载，随任务大小伸缩

这是 DevFlow 的立身之本，集成绝不能破坏它。三条硬约束：

### 2.1 按需 / 随任务分级伸缩

OpenSpec 和 superpowers 都跟随 G1 的任务分级（`none` / `light` / `full`，`L1`–`L4`）伸缩：

- `none` / `light` / `L1`–`L2`：**永不**引入 OpenSpec，**不**默认拉起任何 superpowers 纪律。
- `full` / `L3`–`L4` / 有 PRD·Jira·Notion·Figma 输入 / 跨项目 / 高风险：**才可选**引入，且 G1 仍要 Socratic 问一句「这次要不要走 OpenSpec」。

### 2.2 注册 ≠ 加载，命中 ≠ 读正文

- 把 superpowers 的 skills 登记进 DevFlow 索引，只是让它**可被检索**，不等于加载。
- `devflow query route` 命中某条 skill 只返回它的 `sourcePath` 和 `whenToLoad`；Agent 只有在该纪律确实相关时才去读 `SKILL.md` 正文。
- OpenSpec 同理：task 里存的是 change 的**指针**（id/path/status），不是把 spec 正文塞进上下文。

### 2.3 工具无关 + 可选 + 缺省安全

参照 Codex 本身不强制 OpenSpec：不管驱动的是 Codex、Claude Code 还是 Cursor，两者都是**可选能力**，不是硬依赖。

- openspec CLI 缺失、或 superpowers 未注册时，DevFlow 任务必须**照常跑通**，只是自动跳过那一层，不报错、不阻塞。
- 不进 `package.json` 依赖；安装是显式 opt-in（`setup --install-openspec`，以及已存在的 `devflow init --skip-openspec`）。
- 所有 verify 都是**软探测**：探测不到就降级，不抛错。

## 3. 集成定位

| 层 | 角色 | 接入方式 | 是否硬依赖 |
|----|------|----------|-----------|
| **DevFlow** | 状态层：任务、Workset、gate、恢复点 | 本体 | — |
| **OpenSpec** | 可选的规格真相源（L3/L4 才用） | 轻绑定 / 引用式：task 存 change 指针 + 状态 | 否，缺省安全 |
| **superpowers** | 可选的执行纪律技能（按需拉单条） | 注册进 skill 索引，懒加载 | 否，缺省安全 |

一句话：

> DevFlow 不跑 OpenSpec、不执行 superpowers 的纪律；它只在任务足够大时，**记录指向 OpenSpec change 的指针**，并**让 superpowers 的某条纪律可被路由检索到**。

## 4. OpenSpec 轻绑定方案

### 4.1 触发条件（按需）

只有 G1 判定 `full`（L3/L4 或显式规格输入 / 跨项目 / 高风险）且用户确认时，才进入 spec 流程。否则 `spec.status` 恒为 `none`，不创建 `openspec/`、不跑 CLI。

### 4.2 数据模型（已在 entry.mjs 定义，落 raw_json，无需迁移）

`entry.mjs:125-143` 已经定好字段，直接落到 task 对象里：

```
task.spec = {
  tool:     "openspec",
  changeId: "<openspec change id>",
  path:     "openspec/changes/<id>/",
  status:   "none|proposed|approved|applied|verified|archived",
  handoff:  "<一句话交接摘要>"
}
```

关键点：`tasks` 表（`001-init.mjs:121`）是 `id/title/status/current_gate/workset_id/raw_json`，完整 task 对象本来就序列化进 `raw_json`。所以**加 `spec` 字段不需要 schema 迁移**，只要 `startTask`/`updateTask` 透传即可。

### 4.3 CLI 变更（`task-commands.mjs` + CLI 解析）

- `devflow task start ... --spec-change <id> --spec-path <path> --spec-status proposed`
- `devflow task update <id> --spec-status approved|applied|verified|archived [--spec-handoff "..."]`
- 不传任何 `--spec-*` 时，`spec.status` 默认 `none`，行为与现在完全一致（缺省安全）。

`startTask`（`task-commands.mjs:19`）和 `updateTask`（:69）的 task 对象组装处增加 `spec` 透传。

### 4.4 query / handoff 输出

- `queryCurrent`（`current-query.mjs:15`）在返回里带上 `task.spec`，让 resume 时能看到「spec 在哪、到哪个状态」。
- `writeHandoff`（`task-commands.mjs:192`）在 handoff.md 里追加一行 `Spec: <changeId> (<status>) <path>`，仅当 `spec.status !== none`。

### 4.5 Gate 映射（已在 gates.mjs，仅需对齐文字 → 状态）

| Gate | spec 动作 | status |
|------|-----------|--------|
| G1 | 判定要不要 OpenSpec | `none` 或准备 `proposed` |
| G3 | 写 proposal/design/tasks/spec delta | `proposed` → `approved` |
| G4 | 按 spec 实现 | `applied` |
| G6 | 对照 spec 验收 | `verified` |
| G7 | archive：delta 合并回 `openspec/specs/`，change 移到 `openspec/changes/archive/` | `archived` |

DevFlow 只记录这些状态流转；真正的 `openspec validate/archive` 命令由 Agent 手动执行（轻绑定边界）。

### 4.6 安装 / 校验（软探测）

- `devflow init` 默认不装 openspec；`setup --install-openspec` 才跑 `npm i -g @fission-ai/openspec@latest`。
- `doctor` / `check` 里加软探测 `openspec --version`，探测不到只提示「未安装，full 任务将跳过 spec 层」，不报错。

### 4.7 边界（本期不做）

- 不做**编排式**：DevFlow 不代跑 `openspec` 命令、不解析 spec 文件。留作后续可选升级。

## 5. superpowers 注册方案

### 5.1 安装形态（待对齐）

`entry.mjs:74` 现在假设 superpowers 是技能目录（verify `~/.codex/superpowers exists`），而 superpowers 上游实际是 Claude Code 插件市场分发。两种落地：

- **A. 技能目录式**：把 superpowers 的 skills 落到工具技能目录（`~/.claude/skills/`、`~/.codex/skills/` 等，见 `entry.mjs:77-83`），再注册。与现有 `add_skill_from_path` 直接兼容。
- **B. 插件式**：装 CC 插件，找到插件内 SKILL.md 路径再注册。

> 注册机制依赖**磁盘上真实的 SKILL.md 路径**，所以无论 A/B 都要先确定 skills 文件落点。建议先用 A（技能目录式），与 DevFlow 现有模型一致。

### 5.2 注册机制（复用现有 action）

`addSkillFromPath`（`skill.mjs:22`）→ `importSkillDirectory` 已经能：解析 SKILL.md、写入 `skills` 表、可选挂载 projectIds。superpowers 有多条 skill，建议加**批量注册**：

- `devflow add skill <superpowers-root> --family superpowers`：遍历子目录的 SKILL.md，逐条注册，统一打 `family=superpowers` 和 `tags=[superpowers, tdd|planning|...]`。

### 5.3 关键缺口：全局 process skill 会被项目过滤掉

`current-query.mjs:96` 的 `filterContextItems`：当 route 传了 `projectId`（`route-query.mjs:18` 总是传），**只返回挂在该项目/模板/workset 上的 skill**。superpowers 是跨项目的纪律技能，不挂任何具体项目 → 当前逻辑下**永远不会在 `query route` 里被 surface**，只在无过滤的 `query skills` 全量清单里出现。

**解决（保持按需，不 eager）**：引入 `scope: "global"`（或复用 `family`）原语——

- `filterContextItems` 在项目过滤之外，额外放行 `scope === "global"` 的 skill；
- 但**仍按 `whenToLoad` / 关键字 / gate 相关性**决定是否真正命中，不是无条件加载。

即「**可跨项目被匹配**」≠「**总是加载**」。这正好落实第 2.2 条原则。

### 5.4 悬空引用清理

- `gates.mjs` 里 G2「superpowers 调研」、G3「superpowers 输出」等改为「**若已注册 superpowers**，可在此 gate 检索对应纪律」的可选措辞。
- `SKILL.md:61` 的 `superpowers:writing-skills` 加前置条件「当 superpowers 已注册时」。

## 6. 触发矩阵（任务大小 × 引入什么）

| 任务分级 | OpenSpec | superpowers |
|----------|----------|-------------|
| `none`（问答/片段） | 不碰 | 不碰 |
| `light` / L1–L2（小改/小 bug） | 不碰（`spec.status=none`） | 一般不拉；显式需要某纪律时才单条检索 |
| `full` / L3–L4 / 有规格输入 / 跨项目 / 高风险 | G1 询问 → 可选启用，走 4.5 状态流转 | 按 gate/关键字检索相关纪律（如 G2 brainstorm、G3 writing-plans、G4 TDD），单条懒加载 |

缺省安全：任一外部能力缺失，对应列自动变「跳过」，其余流程不受影响。

## 7. 影响文件清单

| 文件 | 改动 |
|------|------|
| `src/core/commands/task-commands.mjs` | `startTask`/`updateTask` 透传 `spec`；`writeHandoff` 输出 spec 行 |
| `src/core/queries/current-query.mjs` | `queryCurrent` 返回 `spec`；`filterContextItems` 放行 `scope:"global"` skill |
| `scripts/devflow-cli.mjs` | 新增 `--spec-change/--spec-path/--spec-status/--spec-handoff` 解析；`add skill --family/--scope` |
| `src/core/actions/skill.mjs` | `addSkillFromPath` 支持 `family`/`scope`/批量目录 |
| `src/core/defaults/gates.mjs` | G2–G7 文字改为「可选/若已注册」措辞 |
| `src/core/defaults/entry.mjs` | superpowers verify 与安装形态对齐（A 方案）；spec 软探测说明 |
| `bundles/skills/devflow/SKILL.md` | `superpowers:writing-skills` 加前置条件 |
| `docs/install.md` | 补「可选依赖」「缺省安全」「`--skip-openspec`」说明 |

## 8. 不做（留后续）

- OpenSpec **编排式**集成（DevFlow 代跑 openspec 命令、解析/校验 spec 文件）。
- **gate ↔ superpower 自动映射**（每个 gate 自动建议固定纪律）——本期只做「注册 + 可检索」，映射作为下一步。
- 把 superpowers 技能内容 vendor 进 `bundles/`（它们不属于本仓库，保持外部源）。

## 9. 验证方式

- 单测：`task start --spec-*` 后 `query current` 能读回 `spec`；不传时 `spec.status=none` 且与旧行为一致。
- 单测：注册 `scope:global` skill 后，带 `projectId` 的 `query route` 能在相关关键字下 surface 该 skill；无关时不 surface。
- 缺省安全测：openspec 未装 / superpowers 未注册时，full 任务全流程不报错。
- 回归：现有 `tests/scripts/cli-task.test.mjs`、`route-query` 相关测试保持通过。

## 10. 里程碑

1. **M1 OpenSpec 轻绑定**：4.2–4.6（数据模型透传 + CLI + query/handoff + 软探测）。
2. **M2 superpowers 注册**：5.2–5.3（批量注册 + `scope:global` 路由放行）。
3. **M3 文字对齐与文档**：5.4 + gates/entry/SKILL/install 措辞，补缺省安全说明。

先做 M1（不依赖 superpowers 是否安装），再做 M2，最后 M3 收口。
