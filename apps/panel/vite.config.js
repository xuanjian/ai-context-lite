import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "../../src/server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  plugins: [
    react(),
    {
      name: "context-studio-api",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          try {
            const handled = await handleApiRequest({
              request,
              response,
              rootDir: repoRoot
            });
            if (!handled) {
              next();
            }
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ error: { code: "server_error", message: error.message } }));
          }
        });
      }
    }
  ]
});
