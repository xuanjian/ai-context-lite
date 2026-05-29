# DevFlow 动态上下文工作台产品文档

## 1. 背景和目标

当前 DevFlow 已经有项目、场景、规则、技能和任务状态，但它的问题是概念重心不准：`Scene` 被设计成较固定的项目组合，而真实开发里每次需求涉及的前端、BFF、容器、脚本、设计资料都可能变化。

DevFlow 后续应该从“固定流程系统”收敛成“动态上下文工作台”：

- 统一管理本机多个项目、业务域、项目能力和项目关系。
- 让 AI 在聊天开始时只加载最小必要上下文，而不是一次性读取全部项目资料。
- 让一个开发任务可以摆脱单个聊天线程，切到新对话后仍能恢复目标、范围、进度、证据和下一步。
- 让用户可以在面板里看清楚任务开发到哪一步、当前卡点是什么、下一步该做什么。
- 把 DevFlow 的使用规则安装到 Codex、Claude Code、Cursor 等 Agent IDE 的入口文件里，让不同工具知道什么时候读 DevFlow、什么时候轻量记录、什么时候进入完整流程。

一句话定位：

> DevFlow 是本地 AI 开发上下文和任务状态工作台，用项目能力图谱动态推断每次任务的最小工作集，并记录任务进度、证据和恢复点。

最终原则：

> DevFlow 是按需能力集合，不是每个新对话的默认完整流程。Agent 入口文件只负责教 Agent 何时调用哪项 DevFlow 能力，默认只加载最小必要上下文。

这意味着新开一个 Codex、Claude Code 或 Cursor 对话时，Agent 不应该默认加载 DevFlow 全部项目、全部规则、完整 G1-G7 和 OpenSpec。Agent 应该先根据用户当前输入判断是否需要 DevFlow，以及只需要使用 DevFlow 的哪一项能力。

## 2. 目标形态

最终的 DevFlow 不应该要求用户提前选择固定场景，也不应该让每个任务都重新写一份 `AGENTS.md`。用户只需要说需求，例如：

```text
修库存打印预览数量口径
```

DevFlow 应该自动完成：

1. 从项目索引和能力图谱里找到候选业务域，例如 `inventory`、`print`、`webview`。
2. 推断本次任务可能涉及的项目，例如 `mobile-h5-app`、`native-ios-app`、`inventory-bff`。
3. 如果置信度不够，只问一个关键问题，例如“这次是否涉及 BFF 接口修改？”。
4. 创建或更新任务，记录本次实际 `Workset`、当前步骤、下一步、证据和恢复点。
5. 只加载本次 Workset 命中的项目文档、规则、技能和任务上下文。
6. 在任务看板里展示任务进度、项目组合、阻塞项、验证结果和下次继续入口。

同时，DevFlow 安装时应该把这些能力扩散给不同 Agent IDE：

- Codex：写入或更新 `AGENTS.md` / Codex skill 入口，告诉 Codex 如何判断 `resume`、`light`、`full`、`none`。
- Claude Code：写入或更新 `CLAUDE.md` / Claude skill 入口，告诉 Claude 先读 DevFlow 状态层而不是把流程写死在聊天里。
- Cursor：写入或更新 `.cursor/rules`，让 Cursor 知道 DevFlow 是项目关系和任务状态源。
- 其他工具：通过各自支持的规则文件或 skill link 接入同一套 DevFlow 入口。

## 3. 核心模型

### Project Registry

记录单个项目的稳定信息：

- 项目 ID、名称、路径、技术栈和仓库类型。
- 项目负责的业务域和能力，例如 `inventory`、`goods`、`order`、`print`、`webview`。
- 常用入口文件、接口目录、运行命令、验证命令。
- 项目本地 AI 入口，例如 `.ai-configs/project.md`、项目规则、项目技能。
- 可能关联的上游和下游项目，但只作为候选关系，不代表每次任务都必须加载。

### Capability Map

能力图谱是动态推断的基础。它记录业务能力和项目能力之间的关系：

- `inventory`：盘点、库存、仓库相关能力。
- `goods`：商品详情、商品列表、SKU、合并商品。
- `order`：购物车、下单、订单、税费、优惠。
- `webview`：H5 与 iOS/Android 容器桥接。
- `print`：打印模板、打印预览、原生打印。
- `release`：打包、发布、版本、环境切换。

一个项目可以挂多个 capability，一个 capability 也可以被多个项目实现。

### Scene Template

`Scene` 不再作为固定项目组合，而是作为可复用的业务方向模板：

- 提供常见关键词、业务范围、候选项目、候选规则和常见验证方式。
- 帮助 Workset 推断，但不直接决定本次任务最终范围。
- 适合表达“盘点/库存”“商品”“订单”“H5 WebView 联调”“发布打包”等方向。

### Task Workset

`Workset` 是每次任务真正使用的动态项目组合。它应该被写进任务 JSON：

```json
{
  "workset": {
    "capabilities": ["inventory", "print", "webview"],
    "projects": ["mobile-h5-app", "native-ios-app", "inventory-bff"],
    "rules": ["frontend/h5-bridge", "ios/webview-bridge"],
    "confidence": "high",
    "reason": "命中库存、打印预览、H5/native bridge 关键词"
  }
}
```

Workset 是跨聊天恢复的核心。新对话不需要读取旧聊天全文，只要读取任务 JSON 和 Workset，就能知道该加载哪些上下文。

### Task Board

任务看板展示任务状态，不负责替代 AI 执行：

- 当前任务目标。
- 当前步骤或 Gate。
- 本次 Workset 项目组合。
- 下一步 `nextAction`。
- 最近证据 `lastEvidence`。
- 阻塞项 `blockers`。
- 验证结果 `verification`。
- 恢复点 `recoveryPoint`。

### Agent Adapter

Agent Adapter 是安装时写入各类 AI 工具入口文件的行为规则层。它不保存业务状态，只告诉不同工具如何使用 DevFlow。

职责边界：

- Codex、Claude Code、Cursor 等 Agent IDE 负责“怎么工作”。
- DevFlow 负责“有哪些项目、能力、Workset、任务状态和恢复点”。
- 面板负责“把这些状态展示给用户看”。

Agent Adapter 需要写清楚：

- 新对话不等于新流程。
- DevFlow 是按需能力集合，不是默认完整流程入口。
- 用户说“继续、接着、当前任务、上次”时，先读 DevFlow active task、Workset、`nextAction`、`recoveryPoint`。
- 用户只是问概念、解释、代码片段时，不使用 DevFlow，除非问题明确需要项目上下文。
- 用户问项目关系或任务进度时，只读取项目索引、能力图谱、current task 或 panel 数据。
- 小 bug、小改动默认走 `light` tracking，不跑完整 G1-G7。
- 大需求、跨项目、高风险、PRD/Jira/Figma/Notion 输入才走 `full` tracking 和 OpenSpec。
- 普通问答或资料查询走 `none`，不创建 task，只按需读取最小上下文。
- 任何工具都不要把 DevFlow 当执行器；DevFlow 只提供状态和上下文选择。

## 4. 需要修复的点

### 第一阶段：重新定义文档和概念边界

目标：先把 DevFlow 的产品方向说清楚，避免继续按旧的固定场景和重流程扩展。

需要修改：

- `README.md`：把定位改成“动态上下文工作台”，弱化“控制面”和“固定流程编排”表述。
- `docs/project-introduction.md`：补充 Project Registry、Capability Map、Scene Template、Task Workset、Task Board 的边界。
- `config/entry.json`：把默认读取顺序改成“先读项目/能力/任务索引，再推断 Workset”，不要把 scene 当成最终范围。
- `docs/README.md`：增加本文档入口。

验收结果：

- 新用户能理解 DevFlow 解决的是四件事：项目关系、最小上下文、跨聊天续接、步骤可视化。
- 文档里不再暗示每次任务都必须先选固定 scene。

### 第二阶段：重做安装和 Agent IDE 入口适配

目标：让 DevFlow 的能力能被 Codex、Claude Code、Cursor 等工具正确使用。行为策略应该写在各工具入口里，而不是只存在 DevFlow 文档中。

需要修改：

- 安装脚本按工具生成或更新入口：
  - Codex：`AGENTS.md` 或 Codex skill link。
  - Claude Code：`CLAUDE.md` 或 Claude skill link。
  - Cursor：`.cursor/rules`。
  - 其他工具：对应规则文件或 skill 目录。
- 入口规则统一包含：
  - 如何读取 DevFlow 根目录。
  - DevFlow 是哪些按需能力，而不是默认完整流程。
  - 如何判断 `resume`、`light`、`full`、`none`。
  - 什么时候读取 `runtime/current.json`。
  - 什么时候执行 Workset 推断。
  - 什么时候创建 task，什么时候不创建 task。
  - 什么时候才进入 OpenSpec 或完整 G1-G7。
- DevFlow skill 文案同步收敛：skill 只负责教 Agent “如何用 DevFlow 数据”，不把 DevFlow 包装成执行器。

验收结果：

- 新开 Codex 对话时，Codex 能先判断任务类型，而不是默认启动完整流程。
- 新开 Claude Code 对话时，Claude 能读取 DevFlow task 状态和恢复点，而不是另起一套 `.claude/task-state`。
- Cursor 等 IDE 能识别 DevFlow 是项目关系和任务状态源。
- 同一个 DevFlow 数据层可以被多个 Agent IDE 复用。
- 问普通问题时不会加载 DevFlow；续接任务时只读 current task；小 bug 只走 light；大需求才走 full。

### 第三阶段：给项目增加能力字段

目标：让项目不只是“仓库卡片”，而是可被动态匹配的能力节点。

需要修改：

- `config/projects/<project-id>.json` 增加可选字段：
  - `capabilities`
  - `domains`
  - `entrypoints`
  - `runCommands`
  - `verifyCommands`
  - `relatedProjectHints`
- `devflow` CLI 的项目导入逻辑支持生成这些字段。
- 面板详情页展示项目能力、入口和验证命令。

验收结果：

- `inventory-bff` 能被 `inventory`、`stock`、`print` 等能力命中。
- `mobile-h5-app` 能被 `mobile-h5`、`inventory-ui`、`webview-bridge` 等能力命中。
- AI 不需要先读完整项目文档，也能判断项目是否可能相关。

### 第四阶段：新增 Capability Map

目标：用能力图谱替代固定项目组合，作为 Workset 推断的基础。

建议新增：

```text
config/capabilities/index.json
config/capabilities/<capability-id>.json
```

能力文件记录：

- capability ID 和名称。
- 关键词和同义词。
- 相关项目候选。
- 常见上下游关系。
- 可能需要加载的规则和技能。
- 常见验证方式。

验收结果：

- 输入“库存打印预览”时，能命中 `inventory`、`print`、`webview`。
- 输入“商品详情相关商品”时，能命中 `goods`、`sku`、`frontend`。
- 输入“发布失败”时，能命中 `release`、`package`、`version`。

### 第五阶段：把 Scene 改成模板

目标：保留 scene 的价值，但不让它承担固定项目组合职责。

需要修改：

- `config/scenes/*.json` 增加 `templateType: "scene-template"`。
- scene 中的 `projects` 改成候选项目或推荐项目，不作为最终任务范围。
- scene 增加 `capabilityIds`、`keywords`、`routingHints`。
- 文档里明确：Scene 只辅助推断，Task Workset 才是本次任务真实范围。

验收结果：

- `stock-inventory-cross-stack` 可以推荐 `mobile-h5-app`、`native-ios-app`、`inventory-bff`，但任务可以只选择其中一部分。
- 每次任务不需要复制或新建 scene。

### 第六阶段：新增 Workset 推断和确认

目标：用户只说需求，DevFlow 能生成本次最小工作集。

需要新增逻辑：

- 根据用户需求文本匹配 capability、project、scene template、历史任务。
- 生成候选 Workset，包含项目、能力、规则、技能、置信度和原因。
- 置信度高时直接使用。
- 置信度中等时只问一个关键问题。
- 置信度低时提供候选项目列表，让用户确认。

建议命令：

```bash
devflow workset infer "<需求文本>"
devflow task start "<需求文本>" --infer-workset
```

验收结果：

- 一个需求能得到清晰的项目组合和原因。
- Workset 能写入 task JSON。
- 新聊天框能从 task Workset 恢复最小上下文。

### 第七阶段：任务状态轻量化

目标：避免每个任务都被完整 G1-G7 压住，同时保留大任务的完整流程能力。

需要修改：

- task JSON 增加：
  - `trackingMode`: `light` 或 `full`
  - `workset`
  - `currentStep`
  - `nextAction`
  - `lastEvidence`
  - `recoveryPoint`
- 小任务默认 `light`，只记录当前步骤、下一步、证据和恢复点。
- 大任务、跨项目、高风险、PRD/Jira/Figma/Notion 任务使用 `full`，保留 G1-G7 和 OpenSpec。

验收结果：

- 小修复可以快速记录，不需要完整 artifacts。
- 大需求仍能完整追踪方案、开发、联调、验收和归档。

### 第八阶段：看板围绕任务和 Workset 重做

目标：面板优先回答“我现在开发到哪了”，而不是优先展示配置图谱。

需要调整：

- 首页优先展示任务列表、当前任务、下一步、阻塞、最近验证。
- 任务详情展示 Workset 项目组合和每个项目的角色。
- 项目关系图作为辅助视图，不作为默认入口。
- 支持从任务详情看到“新聊天续接提示词”。

验收结果：

- 用户打开面板能 10 秒内看懂当前任务在哪一步。
- 能看到本次任务涉及哪些项目，以及为什么涉及。
- 能直接复制或生成续接提示：继续某 task，读取 Workset 和 recoveryPoint。

## 5. 最终满足的四个诉求

### 诉求一：统一管理项目和不同开发组合

通过 Project Registry、Capability Map、Scene Template 和 Workset 实现。项目关系不是写死在固定场景里，而是根据能力动态组合。

### 诉求二：聊天框最小上下文加载

通过“索引优先 + Workset 推断 + 按需读取”实现。AI 先读轻量索引和任务状态，只加载本次 Workset 命中的项目文档、规则和技能。

### 诉求三：摆脱单对话线程

通过 task JSON 中的 Workset、nextAction、lastEvidence、recoveryPoint 实现。新聊天框只要读取任务状态，就能继续，不依赖旧聊天全文。

### 诉求四：看开发步骤

通过 Task Board 实现。小任务展示 currentStep，完整任务展示 G1-G7；两者都展示下一步、阻塞、证据、验证和恢复点。

## 6. 不做什么

第一阶段不要做这些事：

- 不把 DevFlow 做成执行器。
- 不让 DevFlow 替代 Codex、Claude Code、OpenHands。
- 不把 Agent 的行为判断硬编码成 DevFlow 数据层职责。
- 不强制每个任务进入 OpenSpec。
- 不强制每个任务走完整 G1-G7。
- 不把固定 Scene 当成最终项目范围。
- 不要求用户每次手写 workspace 或 AGENTS.md。

## 7. 推荐实施顺序

1. 合并阶段：统一“动态上下文工作台 / 按需能力集合”定位，同时完成 Agent IDE 入口适配和公开模板/本机私有边界。这是明天整改的第一优先级。
2. 给项目 JSON 增加能力字段，并让面板能展示。
3. 新增 Capability Map。
4. 把 Scene 改造成 Scene Template。
5. 实现 Workset 推断命令。
6. 修改 task JSON，支持 `resume` / `light` / `full` / `none` 的行为判断和 light/full 两种追踪模式。
7. 重做任务看板，让 Workset、下一步和恢复点成为一等信息。

做完这些步骤后，DevFlow 的中心对象会从固定 `Scene` 转成动态 `Workset`，同时 Codex、Claude Code、Cursor 等 Agent IDE 会通过各自入口知道如何使用 DevFlow，而不是每次新对话都重新启动一套繁琐流程。

## 8. 明天执行入口

明天开始整改时，先不要改 Workset 推断算法，也不要先重做面板。第一天做一个合并阶段：修正 Agent 入口行为，并同步划清公开模板和本机私有数据边界。这两件事强关联，不能拆开做。

### 8.1 Agent 入口按需路由

1. 梳理当前安装脚本实际写入了哪些 Codex、Claude Code、Cursor 入口文件。
2. 找出现在为什么会让每个新对话默认加载 DevFlow 完整 G1-G7。
3. 把入口规则改成按需路由：
   - `none`：普通问答，不读 DevFlow。
   - `resume`：续接任务，只读 current task、Workset、`nextAction`、`recoveryPoint`。
   - `light`：小 bug、小改动，必要时轻量记录。
   - `full`：大需求、跨项目、高风险、PRD/Jira/Figma/Notion 输入才走完整流程。
4. 验证新开对话时不会默认进入完整 DevFlow 流程。

### 8.2 公开模板和隐私边界

1. 梳理当前仓库里哪些内容可以进入公共模板：
   - 通用安装脚本。
   - 通用 schema。
   - 通用文档。
   - 空示例配置。
   - 不含个人和公司信息的通用 skill / rule。
2. 梳理哪些内容必须保持本机私有：
   - 个人画像。
   - 公司项目路径。
   - 真实项目关系。
   - 任务 JSON 和任务证据。
   - 内部工单、接口、截图、账号线索。
3. 更新 `.gitignore`、初始化逻辑或模板生成逻辑，确保私有数据不会被误提交。
4. `doctor` 或 `validate` 至少要能检查明显的隐私泄漏风险，例如真实本机路径、任务证据目录、个人 profile。

这个合并阶段完成后，再继续做 Project Capability、Capability Map、Scene Template 和 Workset 推断。

## 9. 第二批改进项

下面这些能力大部分不放进明天第一阶段，避免范围发散。但“隐私和公开模板边界”必须前移到明天一起做，因为后续代码可能提交到公共模板，不能把个人数据、公司项目和任务证据提交进去。

### 9.1 稳定数据模型和 Schema 边界

目标：让 DevFlow 的 JSON、文档、skill 和面板不再各说各话。

需要明确：

- 哪些字段是 AI 路由用的。
- 哪些字段是面板展示用的。
- 哪些字段由用户或初始化流程维护。
- 哪些字段是运行时生成的。
- 哪些字段可以公开提交，哪些只能保留在本机。

建议补充：

- `schemas/project.schema.json`
- `schemas/capability.schema.json`
- `schemas/scene-template.schema.json`
- `schemas/task.schema.json`
- `schemas/workset.schema.json`

验收结果：

- 修改项目、能力、scene、task 时有明确字段依据。
- 安装、导入、面板、doctor 都使用同一套 schema 口径。

### 9.2 加强 Validate / Doctor

目标：保证 DevFlow 长期运行不漂移。

需要检查：

- 项目路径是否存在。
- 项目文档、规则、技能 sourcePath 是否存在。
- task 引用的 project、capability、scene template、rule、skill 是否有效。
- Agent IDE 入口文件是否已安装。
- Codex、Claude Code、Cursor 入口规则是否过期或仍在默认加载完整 G1-G7。
- Workset 中的项目是否仍存在。

验收结果：

- `devflow validate` 检查数据结构和引用完整性。
- `devflow doctor` 检查本机安装、Agent 入口和运行环境。
- 出错时能给出明确修复建议，而不是只报 JSON 错。

### 9.3 自动生成续接提示词

目标：跨对话续接时，不需要用户自己组织上下文。

DevFlow 应能从 task 自动生成：

```text
继续任务 <task-id>。
只读取本任务 Workset 中的项目和规则。
当前步骤是 <currentStep/currentGate>。
下一步是 <nextAction>。
最近证据是 <lastEvidence>。
不要重新执行 G1-G3，除非用户明确要求重新梳理方案。
```

建议命令：

```bash
devflow task resume-prompt <task-id>
devflow current resume-prompt
```

验收结果：

- 新聊天框可以直接用生成的提示词恢复任务。
- 续接提示能区分 `resume`、`light`、`full`。
- 续接提示不会加载无关项目和旧聊天全文。

### 9.4 历史经验回流

目标：让任务中的可复用结论沉淀成长期能力，而不是永远留在某个 task 里。

回流目标：

- task lesson -> project rule
- task lesson -> capability hint
- task lesson -> Agent Adapter rule
- task lesson -> memory note

需要有人工确认，不自动把所有任务记录都变成长规则。

验收结果：

- G7 或任务结束时能提示“哪些经验值得回流”。
- 回流后的规则能被 validate 检查。
- 不把一次性排障细节误写成长期规则。

### 9.5 面板工作台化

目标：面板第一屏回答“我现在在做什么”，而不是优先展示关系图。

第一屏应该展示：

- 当前任务。
- 当前步骤。
- Workset 项目组合。
- 下一步。
- 最近证据。
- 阻塞项。
- 验证结果。
- 续接提示词入口。

项目关系图、规则/技能目录、安装检查放到辅助视图。

验收结果：

- 用户打开面板 10 秒内能看懂当前工作状态。
- 可以从任务详情直接复制续接提示词。
- 可以看出当前任务为什么涉及这些项目。

### 9.6 隐私和公开模板边界（明天前置）

目标：让 DevFlow 能安全安装到新机器，也能保留公开骨架。

需要分清：

- 公开模板：脚本、通用 schema、通用文档、空示例。
- 本机配置：个人画像、项目路径、Agent IDE 安装状态。
- 公司项目：项目说明、规则、业务场景、内部路径。
- 任务证据：截图、接口、工单、验证记录。
- 禁止进入 DevFlow 的内容：token、账号、密钥、私有 cookie。

验收结果：

- 公开仓库不会混入公司项目和个人任务证据。
- 本机初始化后可以生成私有配置。
- doctor 能提示可能的隐私泄漏风险。
- 明天任何实现改动提交前，先确认哪些文件属于公开模板、哪些属于本机私有生成物。
- 公开模板里只能提交空示例、schema、通用脚本、通用 skill/rule 和不含个人业务信息的文档。

## 10. 长期优先级

长期推进顺序建议：

1. Agent 入口按需路由。
2. 隐私和公开模板边界。
3. Workset / Capability 模型。
4. Schema 和 validate / doctor。
5. task 续接提示词生成。
6. panel 任务工作台化。
7. 历史经验回流。
