/**
 * Loads the hosts file named by TERMIX_HOSTS_CONFIG: read, check, resolve,
 * then write. A file that fails any check writes nothing and the last good
 * load stays in place. Loads run one at a time.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { parseHostsFile } from "./config.js";
import { planHosts, type Lookups } from "./plan.js";
import { applyPlan, type MapStore } from "./apply.js";

export const ENV_VAR = "TERMIX_HOSTS_CONFIG";

export interface LoaderStatus {
  enabled: boolean;
  path: string | null;
  strict: boolean;
  hosts: number;
  lastLoadedAt: string | null;
  lastAttemptAt: string | null;
  /** Why the last load wrote nothing. Empty when it applied. */
  errors: string[];
  /** Hosts the last load could not write; the rest applied. */
  applyErrors: string[];
  warnings: string[];
  lastResult: { created: number; updated: number; deleted: number } | null;
}

export interface LoaderDeps {
  env: (name: string) => string | undefined;
  readFile: (file: string) => string;
}

const nodeDeps: LoaderDeps = {
  env: (name) => process.env[name],
  readFile: (file) => fs.readFileSync(file, "utf8"),
};

type Ctx = Pick<PluginContext, "hosts" | "asUser" | "credentials" | "log">;

export function createLoader(
  ctx: Ctx,
  store: MapStore,
  deps: LoaderDeps = nodeDeps,
) {
  const file = deps.env(ENV_VAR)?.trim() || null;
  const locked = new Map<number, string>();
  let appliedHash: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const status: LoaderStatus = {
    enabled: !!file,
    path: file,
    strict: false,
    hosts: 0,
    lastLoadedAt: null,
    lastAttemptAt: null,
    errors: [],
    applyErrors: [],
    warnings: [],
    lastResult: null,
  };

  async function refreshLocks(): Promise<void> {
    locked.clear();
    for (const row of await store.list()) locked.set(row.hostId, row.configId);
    status.hosts = locked.size;
  }

  async function lookups(ownerNames: string[]): Promise<Lookups> {
    const users = new Map(
      (await ctx.hosts.listUsers()).map((u) => [
        u.username.toLowerCase(),
        u.id,
      ]),
    );
    const roles = new Map(
      (await ctx.hosts.listRoles()).map((r) => [r.name.toLowerCase(), r.id]),
    );
    const credentials = new Map<string, Map<string, number[]>>();
    for (const name of new Set(ownerNames.map((n) => n.toLowerCase()))) {
      const ownerId = users.get(name);
      if (!ownerId || credentials.has(ownerId)) continue;
      const byName = new Map<string, number[]>();
      const list = await ctx.asUser(ownerId, () => ctx.credentials.list());
      for (const credential of list) {
        const key = credential.name.toLowerCase();
        byName.set(key, [...(byName.get(key) ?? []), credential.id]);
      }
      credentials.set(ownerId, byName);
    }
    return {
      users,
      roles,
      credentials,
      env: deps.env,
      readFile: deps.readFile,
    };
  }

  async function run(force: boolean): Promise<LoaderStatus> {
    if (!file) return status;
    status.lastAttemptAt = new Date().toISOString();
    const fail = (errors: string[]) => {
      status.errors = errors;
      ctx.log.warn(
        `Hosts file ${file} was not applied: ${errors.length} problem(s). ${errors.slice(0, 5).join("; ")}`,
      );
      return status;
    };

    let text: string;
    try {
      text = deps.readFile(file);
    } catch (error) {
      return fail([
        `Can't read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    const hash = createHash("sha256").update(text).digest("hex");
    if (!force && hash === appliedHash) return status;

    const parsed = parseHostsFile(text, path.basename(file));
    if ("errors" in parsed) return fail(parsed.errors);

    let plan;
    try {
      const owners = [
        ...(parsed.file.owner ? [parsed.file.owner] : []),
        ...parsed.file.hosts.flatMap((h) => (h.owner ? [h.owner] : [])),
      ];
      plan = planHosts(parsed.file, await lookups(owners));
    } catch (error) {
      return fail([
        `Could not look up users, roles or credentials: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    if ("errors" in plan) return fail(plan.errors);

    const report = await applyPlan(ctx, store, plan.hosts);
    await refreshLocks();
    appliedHash = report.errors.length === 0 ? hash : null;
    status.strict = plan.strict;
    status.errors = [];
    status.applyErrors = report.errors;
    status.warnings = parsed.warnings;
    status.lastLoadedAt = new Date().toISOString();
    status.lastResult = {
      created: report.created,
      updated: report.updated,
      deleted: report.deleted,
    };
    ctx.log.info(
      `Hosts file applied: ${report.created} created, ${report.updated} updated, ${report.deleted} deleted`,
    );
    for (const warning of parsed.warnings) ctx.log.warn(warning);
    for (const error of report.errors)
      ctx.log.warn(`Host not applied: ${error}`);
    return status;
  }

  return {
    status: () => status,
    refreshLocks,
    /** force reloads even when the file has not changed. */
    load: (force = false): Promise<LoaderStatus> => {
      const next = queue.then(() => run(force));
      queue = next.catch(() => {});
      return next;
    },
    isLocked: (hostId: number) => !!file && locked.has(hostId),
    note: (hostId: number) => {
      const id = locked.get(hostId);
      return file && id ? `From ${path.basename(file)} (id ${id})` : null;
    },
    allowManualCreate: () => !status.strict,
  };
}

export type Loader = ReturnType<typeof createLoader>;

/** Polls the file, since inotify misses bind mounts and ConfigMap swaps. */
export function watchHostsFile(
  file: string,
  onChange: () => void,
  intervalMs = 3000,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listener = (current: fs.Stats, previous: fs.Stats) => {
    if (
      current.mtimeMs === previous.mtimeMs &&
      current.size === previous.size
    ) {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 500);
  };
  fs.watchFile(file, { interval: intervalMs, persistent: false }, listener);
  return () => {
    if (timer) clearTimeout(timer);
    fs.unwatchFile(file, listener);
  };
}
