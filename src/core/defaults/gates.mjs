export const GATES_CONFIG_KEY = "gates";

// Mirrored from config/tasks/gates.json. JSON file will be removed after devflow migrate from-json (Round 2).
export const DEFAULT_GATES = {
  "version": 1,
  "gates": [
    {
      "id": "G1",
      "name": "Intent / Intake",
      "purpose": "记录用户目标、任务类型、任务等级、是否需要完整 G1-G7，以及是否触发 OpenSpec 规格层。",
      "defaultArtifacts": [
        "runtime/tasks/<task-id>.json",
        "handoff: scope, level, selected projects/scenes, OpenSpec needed yes/no"
      ]
    },
    {
      "id": "G2",
      "name": "Discovery",
      "purpose": "记录调研过程中选中的项目、场景、规则、skill、证据来源、未知项；若已注册 superpowers，可检索相关调研纪律，并把调研结论交给 G3。",
      "defaultArtifacts": [
        "discovery notes in task JSON",
        "handoff: evidence, constraints, unknowns, upstream links"
      ]
    },
    {
      "id": "G3",
      "name": "Plan / Product UI",
      "purpose": "记录产品、UI、技术方案或交互原型；若已注册 superpowers，可检索相关规划纪律；若已选用 OpenSpec，可在这里记录 proposal/design/tasks/spec delta，并把可执行边界交给 G4。",
      "defaultArtifacts": [
        "plan or prototype references",
        "OpenSpec proposal/design/tasks/spec delta when selected",
        "handoff: approved plan, write scopes, acceptance criteria"
      ]
    },
    {
      "id": "G4",
      "name": "Development",
      "purpose": "记录当前开发项目、写入范围、已选用的执行纪律、若已选用 OpenSpec 时的 spec 对齐状态、验证预期和恢复位置。",
      "defaultArtifacts": [
        "project progress entries",
        "handoff: changed files, implementation notes, local verification expected"
      ]
    },
    {
      "id": "G5",
      "name": "Integration",
      "purpose": "记录单项目运行、跨项目联调、环境切换、阻塞项、处理后恢复步骤，并把联调证据交给 G6。",
      "defaultArtifacts": [
        "integration notes",
        "handoff: run commands, environments, integration evidence, unresolved risks"
      ]
    },
    {
      "id": "G6",
      "name": "Acceptance",
      "purpose": "记录对照需求、若已选用 OpenSpec 时的 spec、UI、接口、diff 和测试结果的验收状态。",
      "defaultArtifacts": [
        "acceptance result",
        "OpenSpec verification note when selected",
        "handoff: accepted scope, gaps, release/archive decision"
      ]
    },
    {
      "id": "G7",
      "name": "Run / Package Archive",
      "purpose": "记录调试运行、测试/预发/正式打包、最终验证、若已选用 OpenSpec 时的 archive/sync 状态、复盘提炼、已知缺口和交接说明。",
      "defaultArtifacts": [
        "run/package archive",
        "OpenSpec archive/sync result when selected; if used, delta specs should merge back into openspec/specs/ and completed changes should move to openspec/changes/archive/",
        "lessons learned or reusable decisions worth feeding future specs/tasks",
        "handoff: durable recovery point for future sessions"
      ]
    }
  ]
};
