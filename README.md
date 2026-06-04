# DevFlow

`DevFlow` 是给 AI 编程工具使用的本地上下文和任务状态工作台。

它不负责替代 Codex、Claude Code、Cursor、OpenSpec 或 superpowers。它负责保存项目关系、规则/技能索引、任务状态和恢复点，让 Agent 在需要时只读取最小上下文。

核心原则：

> DevFlow 是按需能力集合，不是每个新对话的默认完整流程。

新对话开始时，Agent 应先根据用户输入判断是否需要 DevFlow，以及只需要哪一项能力：

- `none`：普通问答、解释、代码片段，不读取 DevFlow。
- `resume`：续接任务，只读当前任务、Workset、下一步和恢复点。
- `light`：小 bug 或小改动，只做最小上下文和轻量记录。
- `full`：大需求、跨项目、高风险或外部 PRD/工单/设计输入，才进入完整任务追踪、G1-G7 或 OpenSpec。

## 这个工具有什么用

- 管理本机项目、项目关系、场景模板、规则和技能入口。
- 帮 Agent 从需求里推断最小工作集，而不是一次性加载所有资料。
- 保存任务状态、验证结果、阻塞项、下一步和恢复点。
- 支持 Codex、Claude Code、Cursor 等工具读取同一套本地状态。
- 保持公开模板干净；个人画像、公司项目、任务证据只在本机初始化后生成。

刚安装的公开模板只包含：

- 1 个项目：`DevFlow`
- 无默认场景配置
- 2 个核心 skill：`devflow`、`devflow-init`
- 空 rules
- 空当前任务

真实项目、个人画像、历史任务、公司规则和任务证据不属于公开模板。

## 安装

```bash
npm install -g @xuanmimi/devflow --registry=https://registry.npmjs.org/
devflow init
```

指定工具：

```bash
devflow init --tools codex,claude-code,cursor
```

如果当前目录没有 DevFlow checkout，`devflow init` 会创建 `./devflow`。也可以指定目录：

```bash
devflow init --dir ~/.local/share/devflow
```

安装后，在 AI 工具里运行 `devflow-init`，用对话方式生成本机私有 profile、项目清单、场景模板、规则和技能。

### 可选依赖（按需，缺省安全）

DevFlow 本身不依赖它们；**不装也能正常用**，只是大任务会自动跳过对应能力，不报错、不阻塞。

- **OpenSpec**——规格驱动的真相源，给 L3/L4 或有 PRD/工单/设计输入的大任务用：

  ```bash
  npm install -g @fission-ai/openspec@latest   # 可选
  ```

  不想要可以跳过：`devflow init --skip-openspec`。没装时 `devflow doctor` 只警告不报错，full 任务自动跳过规格层。

- **superpowers**——执行纪律技能（头脑风暴、写计划、TDD、调试、验证等）。把 superpowers 的技能目录放/链接到 AI 工具的技能目录后，注册进 DevFlow：

  ```bash
  devflow add skill <superpowers-root> --family superpowers --scope global   # 可选
  ```

  注册只是让这些技能「**可被检索**」，**不会默认加载**；只有当任务真正需要某条纪律时，路由才会把对应技能带出来。

## 真实开发流程（站在用户角度）

装好之后，日常开发你**不需要手动选项目、选场景、写 `AGENTS.md`**。流程是这样的：

### 一次性：登记你的项目和能力

```text
@devflow:init                                 # 首次：生成本机 profile
@devflow:add /path/to/your-project            # 登记每个常用项目
@devflow:add rule bff/error-handling          # 可选：登记团队规则
@devflow:add skill <superpowers-root> --family superpowers --scope global   # 可选
```

### 日常：开一个 AI 对话，直接说需求

直接说「给订货宝加订单导出功能」「修一下库存打印数量口径」这种话。DevFlow 会先**按需判断任务大小**，只加载必要上下文：

| 任务大小 | DevFlow 怎么做 | 用 OpenSpec / superpowers 吗 |
|----------|----------------|------------------------------|
| 查代码 / 普通问答 | 直接答，不读 DevFlow | 不用 |
| 小 bug / 小改动 | 轻量记录，能跨对话恢复 | 一般不用 |
| 大需求 / 跨前后端 / 有 PRD·工单·设计 | 建可恢复任务，走 G1-G7 | 大任务才可选启用 |

### 大任务：跟着 G1-G7 走，每步交接给下一步

1. **G1 意图**：AI 用选项式问你（任务类型？优先目标？边界？要不要走 OpenSpec？），你选 `1/2/3` 或改写。
2. **G2 调研**：找相关项目、接口、约束、未知项（装了 superpowers 可拉「头脑风暴」纪律）。
3. **G3 方案/UI**：出技术方案或交互原型；大任务可写 OpenSpec proposal（装了 superpowers 可拉「写计划」纪律）。
4. **G4 开发**：按「先 BFF 接口 → 再前端页面 → 最后原生对接」的顺序写码（可拉 TDD 纪律）。
5. **G5 联调**：单项目跑通、跨项目联调、环境切换。
6. **G6 验收**：对照需求、接口、diff、（如选用）OpenSpec spec 验收。
7. **G7 运行/归档**：打包、最终验证、（如选用）`openspec archive` 把规格合并回主线、复盘。

### 关了对话也能继续，还能换工具接力

任务状态存在 DevFlow 里（不在某个对话里）。换新对话说「继续当前任务」，或在任何工具里跑：

```bash
devflow query current
```

就能恢复目标、当前步骤、下一步和恢复点。**这就是为什么可以「Claude Code 出方案、Codex 接手实现」**——两边读的是同一套本地状态。

> 真实例子：这次「把 OpenSpec + superpowers 集成进 DevFlow」就是 Claude Code 出方案 + 建任务，Codex 分 M1/M2/M3 接手实现，全程靠 `devflow query current` 跨工具接力完成的。

## 聊天入口

```text
@devflow:init
@devflow:add /path/to/project
@devflow:add scene-template 前后端联调
@devflow:add skill /path/to/skill
@devflow:add skill /path/to/superpowers --family superpowers --scope global
@devflow:add rule bff/error-handling
@devflow:del project old-project
@devflow:del skill old-skill
@devflow:del rule old/rule
@devflow:del scene-template old-scene
@devflow:task 新增订单导出功能
@devflow:panel
```

- `@devflow:init`：首次配置本机资料；如果还没有个人画像，AI 会通过选项式提问帮你整理。
- `@devflow:add`：登记项目、场景模板、skill 或 rule。
- `@devflow:del`：移除 DevFlow 登记关系，不删除真实业务仓库。
- `@devflow:task`：创建、续接或更新可恢复任务。
- `@devflow:panel`：打开或查看任务/项目看板。

当需求还很模糊或比较大时，AI 应给出几个可选方向，用户可以选 `1/2/3` 或直接修改选项。普通小改不强制使用 OpenSpec，也不强制完整 G1-G7。

## 面板

```bash
cd devflow
npm install
npm run dev
```

面板读取同一套本地状态：

- 当前任务和当前步骤
- Workset 或项目组合
- 下一步和恢复点
- 项目、场景模板、skill、rule 关系
- 配置检查结果

面板是观察层，不是新增配置的主入口。新增项目、规则、技能优先通过 AI 聊天里的 `@devflow:add`。

## PM 编排模式（可选）

把**当前这个对话**锁成 PM（编排者）：能读码、能写 `.md` 任务文档、能跑 `git` 合并，但**一调 `Edit`/`Write`/`MultiEdit` 改源码就被硬拦**。改码活打成任务派给开发 agent（codex 子会话 / multi-model-pipeline / 新开发会话），PM 只收报告、跟你验收。

解决的痛点：在编排对话里随手报个 bug，模型会自己去读码改码，上下文暴涨，而且「改过一次就一直自己改」。PM 模式用 **hook 在工具层硬拦**源码改动——不靠模型自觉，模型漂不漂都拦得住，自然会去派发。

触发（按**当前工作目录**绑定，只影响这个目录的会话）：

```text
/devflow-pm           # 开启
/devflow-pm off       # 关闭（想亲自改码时显式退出）
/devflow-pm status    # 查看状态
```

一次性安装（注册 guard / reminder 两个 hook，**装完需重启会话才生效**）：

```bash
bash bundles/hooks/install-pm-hooks.sh            # 在 DevFlow 安装目录下运行
bash bundles/hooks/install-pm-hooks.sh status     # 查看是否已注册
bash bundles/hooks/install-pm-hooks.sh uninstall  # 卸载
```

安装器把版本化的 hook 脚本 symlink 到 `~/.claude/devflow-pm/hooks/`（稳定的 `$HOME` 位置），再幂等合并进 `~/.claude/settings.json`（改动前自动备份）。仓库里不写死任何绝对路径。

> 边界：hook 只拦文件改写类工具，不拦 `Bash`；合并冲突要手改源码会被拦（按设计派发，或先 `/devflow-pm off`）。

## 公开模板边界

公开模板可以包含：

- 通用安装脚本
- 通用文档
- 通用 schema
- 空示例配置
- 不含个人和公司信息的通用 skill / rule

公开模板不应该包含：

- 个人画像
- 公司项目路径
- 真实项目关系
- 任务 JSON 和任务证据
- 内部工单、接口、截图、账号线索
- token、账号、密钥、cookie

## 文档

- [docs/install.md](docs/install.md)：安装、初始化、隐私边界和排障。
- [docs/project-introduction.md](docs/project-introduction.md)：DevFlow 信息模型和任务状态说明。
- [docs/product/devflow-workset-redesign.md](docs/product/devflow-workset-redesign.md)：动态 Workset 改造产品文档。
