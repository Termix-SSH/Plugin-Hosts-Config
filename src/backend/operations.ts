import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { Loader } from "./loader.js";

/** The hosts file as actions: its state as a tile, and a reload. */
export function registerOperations(ctx: PluginContext, loader: Loader): void {
  if (typeof ctx.operations?.register !== "function") return;

  ctx.operations.register("hosts-config.status", {
    run: () => {
      const status = loader.status();
      if (!status.enabled) {
        return {
          summary: "No hosts file is set",
          data: { value: null, status: "unknown", label: "Off" },
        };
      }
      const problems = status.errors.length + status.applyErrors.length;
      const label = problems
        ? `${problems} problems`
        : `${status.hosts} hosts loaded`;
      return {
        summary: label,
        data: {
          ...status,
          value: status.hosts,
          status: problems ? "fail" : status.warnings.length ? "warn" : "ok",
          label,
        },
      };
    },
  });

  ctx.operations.register("hosts-config.reload", {
    describe: () => `Would reload ${loader.status().path ?? "the hosts file"}`,
    run: async () => {
      if (!loader.status().enabled) {
        throw new Error("TERMIX_HOSTS_CONFIG is not set");
      }
      const status = await loader.load(true);
      if (status.errors.length) {
        throw new Error(`Not applied: ${status.errors.join("; ")}`);
      }
      const result = status.lastResult;
      return {
        summary: result
          ? `${result.created} created, ${result.updated} updated, ${result.deleted} deleted`
          : "Reloaded",
        changed:
          !!result && result.created + result.updated + result.deleted > 0,
      };
    },
  });
}
