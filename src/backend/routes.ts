import type { Request, RequestHandler, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { Loader } from "./loader.js";

export function registerRoutes(
  ctx: PluginContext,
  router: Router,
  loader: Loader,
): void {
  router.use(ctx.rbac.require("manage") as unknown as RequestHandler);

  /**
   * @openapi
   * /plugin-api/hosts-config/status:
   *   get:
   *     summary: Hosts file status
   *     description: The file path, when it last applied, how many hosts it manages, and any problems from the last load.
   *     tags: [Hosts Config]
   *     responses:
   *       200:
   *         description: Status.
   *       403:
   *         description: Missing the hosts-config.manage permission.
   */
  router.get("/status", (_req: Request, res: Response) => {
    res.json(loader.status());
  });

  /**
   * @openapi
   * /plugin-api/hosts-config/reload:
   *   post:
   *     summary: Reload the hosts file now
   *     description: Reads the file again and applies it, even when it has not changed. A file with problems applies nothing.
   *     tags: [Hosts Config]
   *     responses:
   *       200:
   *         description: The status after the load. errors is empty when it applied.
   *       400:
   *         description: TERMIX_HOSTS_CONFIG is not set.
   *       403:
   *         description: Missing the hosts-config.manage permission.
   */
  router.post("/reload", async (req: Request, res: Response) => {
    if (!loader.status().enabled) {
      return res
        .status(400)
        .json({ error: "TERMIX_HOSTS_CONFIG is not set", ...loader.status() });
    }
    const status = await loader.load(true);
    await ctx.audit.record({
      action: "reload",
      details: status.errors.length
        ? `hosts file not applied: ${status.errors.length} problem(s)`
        : "hosts file applied",
      success: status.errors.length === 0,
      request: req,
    });
    res.json(status);
  });
}
