import { runFixedCommand } from "./shared.mjs";

export const commandActions = {
  install_frontend_dependencies: {
    run: ({ rootPath, actionId }) => runFixedCommand(rootPath, ["npm", "install"], actionId)
  }
};
