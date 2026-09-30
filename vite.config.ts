import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error - .mjs has no types
import { handleRequest, startApi } from "./scripts/api.mjs";

/**
 * Dev server: mounts the same API as scripts/serve.mjs (scripts/api.mjs) and
 * pushes an HMR event after every re-parse so the UI refetches immediately.
 */
function ccblackboxApi(): Plugin {
  return {
    name: "ccblackbox-api",
    configureServer(server) {
      startApi({
        onParsed: () => server.ws.send({ type: "custom", event: "ccblackbox:sessions-updated" }),
      });
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!(await handleRequest(req, res))) next();
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ccblackboxApi()],
});
