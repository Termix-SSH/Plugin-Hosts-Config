import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { managedHosts } from "./tables.js";
import { createMapStore } from "./store.js";
import { createLoader, watchHostsFile, type LoaderDeps } from "./loader.js";
import { registerRoutes } from "./routes.js";

/** Let other plugins start first, so their host settings validate. */
export const FIRST_LOAD_DELAY_MS = 5000;

export async function activateWith(ctx: PluginContext, deps?: LoaderDeps) {
  const table = await ctx.db.define(managedHosts);
  const loader = createLoader(ctx, createMapStore(ctx, table), deps);
  registerRoutes(ctx, ctx.http.router<Router>(), loader);

  const file = loader.status().path;
  if (!file) {
    ctx.log.info("TERMIX_HOSTS_CONFIG is not set, so no hosts are loaded");
    return loader;
  }

  // Hosts from the last load are read only from the start.
  await loader.refreshLocks();
  ctx.hosts.locks.provide({
    isLocked: loader.isLocked,
    note: loader.note,
    allowManualCreate: loader.allowManualCreate,
  });

  const load = () => {
    loader
      .load()
      .catch((error) =>
        ctx.log.warn(
          `Hosts file load failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  };
  ctx.schedule.after(FIRST_LOAD_DELAY_MS, load);
  ctx.disposables.add(watchHostsFile(file, load));
  return loader;
}

export async function activate(ctx: PluginContext) {
  await activateWith(ctx);
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
