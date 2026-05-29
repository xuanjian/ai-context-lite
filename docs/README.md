# docs

`docs` 目录用于放初始化后生成的本地说明文档。刚安装时这里保持最小状态，不预置个人项目或公司资料。

## 框架文档

- `docs/install.md`：新机器安装、OpenSpec/superpowers 依赖、首次初始化、项目接入和隐私检查。
- `docs/project-introduction.md`：DevFlow 的任务处理流程、G1-G7、OpenSpec/superpowers 分工和看板用法。
- `docs/product/devflow-workset-redesign.md`：DevFlow 动态上下文工作台的产品定位、Workset、按需加载和 agent 入口边界。
- `docs/product/devflow-storage-panel-remediation.md`：DevFlow 存储介质、面板拆分、脑图修复和 SQLite 查询层整改方案。
- `docs/product/implementation/2026-05-22-devflow-sqlite-workset-implementation-plan.md`：SQLite、Workset、query/command service 的开发执行计划。
- `docs/product/implementation/2026-05-22-devflow-sqlite-workset-execution-matrix.md`：开发任务并行关系、等待关系和最终批次说明。

## 初始化后通常会生成

- 项目介绍正文当前默认放在业务项目的 `.ai-configs/project.md`；DevFlow 只在关系/状态层登记入口路径和挂载关系。
- 业务项目的 `.ai-configs/rules/` 和 `.ai-configs/skills/` 可存放项目专属 rule/skill；DevFlow 只登记外部来源路径和挂载关系。
- `docs/scenes/<scene-template-id>.md`：少量 scene template 说明、候选项目、协作步骤、验证方式；任务真实范围以动态 Workset 为准。
- `docs/person/profile.md`：本机用户画像和 AI 协作偏好。

## 生成方式

推荐让 AI 执行 `devflow-init`，通过对话收集信息后自动生成这些文档，并在 DevFlow 的关系/状态层登记挂载关系。

也可以通过 CLI/TUI 或可选面板新增项目、scene template、skill、rule，让 core command 登记关系和生成必要文件。

## 隐私边界

公开仓库不要提交真实项目资料、账号、token、工单、内部链接或个人画像。需要共享最小版时，只保留示例或空模板。
