import { queryRoute } from "../queries/route-query.mjs";
import { queryCurrent, queryRules, querySkills } from "../queries/current-query.mjs";
import { buildGraph } from "../queries/graph-query.mjs";
import { startTask, updateTask, finishTask, deleteTask } from "../commands/task-commands.mjs";
import { addProject } from "../commands/project-commands.mjs";
import { addSceneTemplate } from "../commands/template-commands.mjs";
import { runAction as runPanelAction } from "../actions.mjs";
import { runChecks as runPanelChecks } from "../checks.mjs";
import { buildPanelGraph, getPanelNodeDetails } from "../panel-graph.mjs";
import { ensureSqliteDatabase } from "../storage/sqlite-bootstrap.mjs";

export function createDevFlowService({ rootDir, backend = "auto", repository } = {}) {
  const getRepository = createRepositoryResolver({ rootDir, backend, repository });

  return {
    async queryRoute(input = {}) {
      return queryRoute(await getRepository(), input);
    },
    async queryCurrent(input = {}) {
      return queryCurrent(await getRepository(), input);
    },
    async querySkills(input = {}) {
      return querySkills(await getRepository(), input);
    },
    async queryRules(input = {}) {
      return queryRules(await getRepository(), input);
    },
    async buildGraph(input = {}) {
      return buildGraph(await getRepository(), input);
    },
    async buildContextGraph(input = {}) {
      return buildPanelGraph(await getRepository(), { rootDir, ...input });
    },
    async getNodeDetails(nodeId, input = {}) {
      const graph = input.graph || await buildPanelGraph(await getRepository(), { rootDir, ...input });
      return getPanelNodeDetails(graph, nodeId);
    },
    async runChecks(input = {}) {
      return runPanelChecks({ rootDir, ...input });
    },
    async runAction(input = {}) {
      return runPanelAction({ rootDir, ...input });
    },
    async startTask(input = {}) {
      return startTask(await getRepository(), { rootDir, ...input });
    },
    async updateTask(input = {}) {
      return updateTask(await getRepository(), { rootDir, ...input });
    },
    async finishTask(input = {}) {
      return finishTask(await getRepository(), { rootDir, ...input });
    },
    async deleteTask(input = {}) {
      return deleteTask(await getRepository(), { rootDir, ...input });
    },
    async addProject(input = {}) {
      return addProject(await getRepository(), input);
    },
    async addSceneTemplate(input = {}) {
      return addSceneTemplate(await getRepository(), input);
    }
  };
}

function createRepositoryResolver({ rootDir, backend, repository }) {
  let resolvedRepository = repository;

  return async function getRepository() {
    if (resolvedRepository) {
      return resolvedRepository;
    }
    if (backend === "auto") {
      await ensureSqliteDatabase({ rootDir });
      backend = "sqlite";
    }

    if (backend === "sqlite") {
      const module = await import("../repositories/sqlite-repository.mjs");
      const createSqliteRepository = module.createSqliteRepository || module.default;
      if (typeof createSqliteRepository !== "function") {
        throw new Error("SQLite repository backend does not export createSqliteRepository.");
      }
      resolvedRepository = createSqliteRepository({ rootDir });
      return resolvedRepository;
    }

    throw new Error(`Unsupported DevFlow repository backend: ${backend}`);
  };
}
