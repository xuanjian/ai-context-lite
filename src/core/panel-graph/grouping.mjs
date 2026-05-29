export const GROUPS = [
  { id: "group:projects", type: "group", title: "Projects", summary: "Configured projects" },
  { id: "group:sceneTemplates", type: "group", title: "Scene Templates", summary: "Reusable routing templates" },
  { id: "group:skills", type: "group", title: "Skills", summary: "Mounted skills" },
  { id: "group:rules", type: "group", title: "Rules", summary: "Active rules" }
];

export const GROUP_BY_TYPE = {
  project: "group:projects",
  sceneTemplate: "group:sceneTemplates",
  skill: "group:skills",
  rule: "group:rules"
};

export const DEFAULT_GATES = [
  { id: "G1", name: "Intent / Intake", purpose: "记录用户目标、任务类型、任务等级、是否需要完整 G1-G7，以及是否触发 OpenSpec 规格层。" },
  { id: "G2", name: "Discovery", purpose: "记录调研过程中选中的项目、场景、规则、skill、证据来源、未知项，并把调研结论交给 G3。" },
  { id: "G3", name: "Plan / Product UI", purpose: "记录产品、UI、技术方案或交互原型，并把可执行边界交给 G4。" },
  { id: "G4", name: "Development", purpose: "记录当前开发项目、写入范围、验证预期和恢复位置。" },
  { id: "G5", name: "Integration", purpose: "记录单项目运行、跨项目联调、环境切换、阻塞项和联调证据。" },
  { id: "G6", name: "Acceptance", purpose: "记录对照需求、UI、接口、diff 和测试结果的验收状态。" },
  { id: "G7", name: "Run / Package Archive", purpose: "记录运行、测试、打包、最终验证、归档和交接说明。" }
];
