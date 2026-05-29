import test from "node:test";
import assert from "node:assert/strict";
import { buildPanelGraph, getPanelNodeDetails } from "../../src/core/panel-graph.mjs";
import { createJsonRepository } from "../../src/core/repositories/json-repository.mjs";

const fixtureRoot = new URL("./fixtures/basic-ai-context/", import.meta.url);

test("buildPanelGraph adapts repository graph to panel shape", async () => {
  const repository = createJsonRepository({ rootDir: fixtureRoot });
  const graph = await buildPanelGraph(repository, { rootDir: fixtureRoot });

  assert.ok(graph.nodes.some((node) => node.id === "group:sceneTemplates"));
  assert.ok(graph.nodes.some((node) => node.id === "sceneTemplate:demo-scene" && node.type === "sceneTemplate"));
  assert.ok(graph.nodes.some((node) => node.id === "task:demo-task" && node.raw.isActive));
  assert.ok(graph.nodes.some((node) => node.id === "workset:workset-demo-task" && node.type === "workset"));
  assert.ok(graph.nodes.some((node) => node.id === "gate:demo-task:G1" && node.type === "gate"));
  assert.ok(graph.edges.some((edge) => edge.from === "workset:workset-demo-task" && edge.to === "skill:demo-skill" && edge.relation === "loads-skill"));
});

test("buildPanelGraph exposes project metadata and relation edge types for panel visualization", async () => {
  const repository = {
    async listProjects() {
      return [
        { id: "goods-h5", name: "Goods H5", products: ["dhb"], domains: ["goods"], role: "h5" },
        { id: "bff-goods", name: "BFF Goods", products: ["dhb"], domains: ["goods"], role: "bff-service" },
        { id: "dhbfront-utils", name: "dhbfront-utils", products: ["dhb"], domains: [], role: "frontend-common" }
      ];
    },
    async getProject(projectId) {
      return (await this.listProjects()).find((project) => project.id === projectId) || null;
    },
    async listSceneTemplates() {
      return [];
    },
    async getSceneTemplate() {
      return null;
    },
    async listSkills() {
      return [];
    },
    async listRules() {
      return [];
    },
    async listTasks() {
      return [];
    },
    async getActiveTask() {
      return null;
    },
    async listGraphEdges() {
      return [
        { from: "project:goods-h5", to: "project:bff-goods", relation: "calls" },
        { from: "project:goods-h5", to: "project:dhbfront-utils", relation: "depends-on" },
        { from: "project:goods-h5", to: "project:container", relation: "chain" }
      ];
    }
  };

  const graph = await buildPanelGraph(repository, { rootDir: fixtureRoot });
  const goodsH5 = graph.nodes.find((node) => node.id === "project:goods-h5");

  assert.deepEqual(goodsH5.metadata, {
    products: ["dhb"],
    domains: ["goods"],
    role: "h5"
  });
  assert.ok(graph.edges.some((edge) => edge.from === "project:goods-h5" && edge.to === "project:bff-goods" && edge.relation === "calls"));
  assert.ok(graph.edges.some((edge) => edge.from === "project:goods-h5" && edge.to === "project:dhbfront-utils" && edge.relation === "depends-on"));
  assert.ok(graph.edges.some((edge) => edge.from === "project:goods-h5" && edge.to === "project:container" && edge.relation === "chain"));
});

test("buildPanelGraph hides DevFlow framework self nodes", async () => {
  const repository = {
    async listProjects() {
      return [
        { id: "devflow", name: "DevFlow" },
        { id: "business-app", name: "Business App" }
      ];
    },
    async getProject(projectId) {
      return (await this.listProjects()).find((project) => project.id === projectId) || null;
    },
    async listSceneTemplates() {
      return [];
    },
    async getSceneTemplate() {
      return null;
    },
    async listSkills() {
      return [
        { id: "devflow", name: "DevFlow" },
        { id: "devflow-init", name: "devflow-init" },
        { id: "business-skill", name: "Business Skill" }
      ];
    },
    async listRules() {
      return [];
    },
    async listTasks() {
      return [
        {
          id: "demo-task",
          title: "Demo Task",
          workset: {
            id: "workset-demo-task",
            taskId: "demo-task",
            projects: [{ id: "devflow" }, { id: "business-app" }]
          }
        }
      ];
    },
    async getActiveTask() {
      return null;
    },
    async listGraphEdges() {
      return [
        { from: "project:devflow", to: "skill:devflow", relation: "uses-skill" },
        { from: "project:devflow", to: "skill:devflow-init", relation: "uses-skill" },
        { from: "project:business-app", to: "skill:business-skill", relation: "uses-skill" }
      ];
    }
  };

  const graph = await buildPanelGraph(repository, { rootDir: fixtureRoot });

  assert.equal(graph.nodes.some((node) => node.id === "project:devflow"), false);
  assert.equal(graph.nodes.some((node) => node.id === "skill:devflow"), false);
  assert.equal(graph.nodes.some((node) => node.id === "skill:devflow-init"), false);
  assert.ok(graph.nodes.some((node) => node.id === "project:business-app"));
  assert.ok(graph.nodes.some((node) => node.id === "skill:business-skill"));
  assert.equal(graph.edges.some((edge) => edge.from === "project:devflow" || edge.to === "project:devflow"), false);
  assert.equal(graph.edges.some((edge) => edge.from === "skill:devflow" || edge.to === "skill:devflow"), false);
  assert.equal(graph.edges.some((edge) => edge.from === "workset:workset-demo-task" && edge.to === "project:devflow"), false);
  assert.ok(graph.edges.some((edge) => edge.from === "project:business-app" && edge.to === "skill:business-skill"));
  assert.ok(graph.edges.some((edge) => edge.from === "workset:workset-demo-task" && edge.to === "project:business-app"));
});

test("getPanelNodeDetails returns Workset, skill, and gate relationships", async () => {
  const repository = createJsonRepository({ rootDir: fixtureRoot });
  const graph = await buildPanelGraph(repository, { rootDir: fixtureRoot });
  const details = getPanelNodeDetails(graph, "task:demo-task");

  assert.equal(details.node.id, "task:demo-task");
  assert.ok(details.related.worksets.some((node) => node.id === "workset:workset-demo-task"));
  assert.ok(details.related.gates.some((node) => node.id === "gate:demo-task:G1"));
});

test("buildPanelGraph links task and gate artifacts", async () => {
  const repository = createJsonRepository({ rootDir: fixtureRoot });
  const graph = await buildPanelGraph(repository, { rootDir: fixtureRoot });
  const taskDetails = getPanelNodeDetails(graph, "task:demo-task");
  const gateDetails = getPanelNodeDetails(graph, "gate:demo-task:G4");
  const implementationId = `artifact:${encodeURIComponent("src/demo-implementation.ts")}`;
  const technicalDocId = `artifact:${encodeURIComponent("docs/demo-technical-design.md")}`;
  const productPlanId = `artifact:${encodeURIComponent("docs/demo-product-plan.md")}`;

  assert.ok(graph.nodes.some((node) => node.id === `artifact:${encodeURIComponent("runtime/tasks/demo-task/handoff.md")}`));
  assert.ok(graph.nodes.some((node) => node.id === implementationId && node.status === "ok"));
  assert.ok(graph.nodes.some((node) => node.id === technicalDocId && node.status === "ok"));
  assert.ok(graph.nodes.some((node) => node.id === productPlanId && node.status === "ok"));
  assert.ok(graph.edges.some((edge) => edge.from === "task:demo-task" && edge.to === implementationId && edge.relation === "has-artifact"));
  assert.ok(graph.edges.some((edge) => edge.from === "gate:demo-task:G4" && edge.to === implementationId && edge.relation === "produced-artifact"));
  assert.ok(graph.edges.some((edge) => edge.from === "gate:demo-task:G3" && edge.to === technicalDocId && edge.relation === "produced-artifact"));
  assert.ok(graph.edges.some((edge) => edge.from === "gate:demo-task:G3" && edge.to === productPlanId && edge.relation === "produced-artifact"));
  assert.equal(graph.edges.some((edge) => edge.from === "gate:demo-task:G1" && edge.to === technicalDocId && edge.relation === "produced-artifact"), false);
  assert.ok(taskDetails.related.artifacts.some((node) => node.id === technicalDocId));
  assert.ok(gateDetails.related.artifacts.some((node) => node.id === implementationId));
});

test("buildPanelGraph normalizes migrated task gate fields and default gate nodes", async () => {
  const repository = {
    async listProjects() {
      return [{ id: "dhb-packages", name: "DHB_PACKAGES" }, { id: "bff-goods", name: "bff-goods" }];
    },
    async getProject(projectId) {
      return (await this.listProjects()).find((project) => project.id === projectId) || null;
    },
    async listSceneTemplates() {
      return [{ id: "frontend-bff-debug", name: "前端 BFF 联调" }];
    },
    async getSceneTemplate(sceneTemplateId) {
      return (await this.listSceneTemplates()).find((template) => template.id === sceneTemplateId) || null;
    },
    async listSkills() {
      return [];
    },
    async listRules() {
      return [];
    },
    async listTasks() {
      return [this.task];
    },
    async getTask(taskId) {
      return taskId === this.task.id ? this.task : null;
    },
    async getActiveTask() {
      return this.task;
    },
    async getWorkset(worksetId) {
      return worksetId === this.task.workset.id || worksetId === this.task.id ? this.task.workset : null;
    },
    async listGraphEdges() {
      return [];
    },
    task: {
      id: "2026-05-25-yorder-recommend-goods-list",
      title: "建议订单商品列表页",
      gate: "G1",
      level: "L3",
      status: "active",
      workset: {
        id: "workset-2026-05-25-yorder-recommend-goods-list",
        taskId: "2026-05-25-yorder-recommend-goods-list",
        sceneTemplateId: "frontend-bff-debug",
        projects: [{ id: "dhb-packages" }, { id: "bff-goods" }]
      }
    }
  };

  const graph = await buildPanelGraph(repository, { rootDir: fixtureRoot });
  const task = graph.nodes.find((node) => node.id === "task:2026-05-25-yorder-recommend-goods-list");

  assert.equal(task.raw.currentGate, "G1");
  assert.deepEqual(task.raw.projectIds, ["dhb-packages", "bff-goods"]);
  assert.ok(graph.nodes.some((node) => node.id === "gate:2026-05-25-yorder-recommend-goods-list:G1"));
  assert.ok(graph.edges.some((edge) => edge.from === "workset:workset-2026-05-25-yorder-recommend-goods-list" && edge.to === "project:dhb-packages"));
});
