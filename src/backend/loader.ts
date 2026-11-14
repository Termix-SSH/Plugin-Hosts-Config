/**
 * Loads the hosts file named by TERMIX_HOSTS_CONFIG: read, check, resolve,
 * then write. A file that fails any check writes nothing and the last good
 * load stays in place. Loads run one at a time.
 */

import { createHash } from "node:crypto";
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

/** Reads the hosts file and the secrets it points at. */
export interface LoaderDeps {
  env: (name: string) => string | undefined | Promise<string | undefined>;
  readFile: (file: string) => string | Promise<string>;
}

type Ctx = Pick<
  PluginContext,
  "hosts" | "asUser" | "credentials" | "log" | "settings" | "notify" | "files"
>;

/**
 * Termix reads the files: this process can only read its own folders. The
 * hosts file comes through its env variable, secrets through config:secrets.
 */
export function ctxDeps(ctx: Pick<PluginContext, "files">): LoaderDeps {
  const hostsFile = process.env[ENV_VAR]?.trim() || null;
  return {
    env: async (name) => {
      if (name === ENV_VAR) return process.env[ENV_VAR];
      return (await ctx.files.readSecret({ env: name })) ?? undefined;
    },
    readFile: async (file) => {
      if (file === hostsFile) {
        const read = await ctx.files.readEnvFile(ENV_VAR);
        if (!read) throw new Error(`${ENV_VAR} is not set`);
        return read.text;
      }
      const secret = await ctx.files.readSecret({ file });
      if (secret === null) throw new Error("no such file");
      return secret;
    },
  };
}

/** Every { env } and { file } secret a parsed hosts file points at. */
export function secretRefs(
  value: unknown,
  out: SecretRefs = { env: new Set(), file: new Set() },
): SecretRefs {
  if (Array.isArray(value)) {
    for (const item of value) secretRefs(item, out);
  } else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const ref = value as { env?: unknown; file?: unknown };
    if (keys.length === 1 && typeof ref.env === "string") out.env.add(ref.env);
    else if (keys.length === 1 && typeof ref.file === "string") {
      out.file.add(ref.file);
    } else for (const item of Object.values(value)) secretRefs(item, out);
  }
  return out;
}

interface SecretRefs {
  env: Set<string>;
  file: Set<string>;
}

/** Reads every secret first, so planning stays synchronous. */
async function prefetchSecrets(
  refs: SecretRefs,
  deps: LoaderDeps,
): Promise<Pick<Lookups, "env" | "readFile">> {
  const env = new Map<string, string | undefined>();
  const files = new Map<string, string | Error>();
  for (const name of refs.env) {
    try {
      env.set(name, await deps.env(name));
    } catch {
      env.set(name, undefined);
    }
  }
  for (const file of refs.file) {
    try {
      files.set(file, await deps.readFile(file));
    } catch (error) {
      files.set(
        file,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  return {
    env: (name) => env.get(name),
    readFile: (file) => {
      const found = files.get(file);
      if (found === undefined) throw new Error("not read");
      if (found instanceof Error) throw found;
      return found;
    },
  };
}

export function createLoader(ctx: Ctx, store: MapStore, deps?: LoaderDeps) {
  const sources = deps ?? ctxDeps(ctx);
  const raw = sources.env(ENV_VAR);
  const file = (typeof raw === "string" ? raw.trim() : "") || null;
  const locked = new Map<number, string>();
  let appliedHash: string | null = null;
  let lastAlerted = "";
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

  async function lookups(
    ownerNames: string[],
    secrets: Pick<Lookups, "env" | "readFile">,
  ): Promise<Lookups> {
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
      ...secrets,
    };
  }

  /** One alert per distinct set of problems, none when it applies cleanly. */
  async function alertProblems(problems: string[]): Promise<void> {
    const key = problems.join("|");
    if (key === lastAlerted) return;
    lastAlerted = key;
    if (problems.length === 0) return;
    try {
      if ((await ctx.settings.get<boolean>("alertOnError")) === false) return;
      await ctx.notify.send({
        title: "The hosts file was not fully applied",
        body: problems.slice(0, 5).join("; "),
        severity: "warning",
        category: "hosts-config.apply_error",
        audience: "admins",
        dedupeKey: "hosts-config:apply-error",
      });
    } catch (error) {
      ctx.log.warn(
        `Could not send a hosts file alert: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function run(force: boolean): Promise<LoaderStatus> {
    if (!file) return status;
    status.lastAttemptAt = new Date().toISOString();
    const fail = (errors: string[]) => {
      status.errors = errors;
      void alertProblems(errors);
      ctx.log.warn(
        `Hosts file ${file} was not applied: ${errors.length} problem(s). ${errors.slice(0, 5).join("; ")}`,
      );
      return status;
    };

    let text: string;
    try {
      text = await sources.readFile(file);
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
      const secrets = await prefetchSecrets(secretRefs(parsed.file), sources);
      plan = planHosts(parsed.file, await lookups(owners, secrets));
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
    await alertProblems(report.errors);
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
    lockedHosts: () => (file ? [...locked.keys()] : []),
    note: (hostId: number) => {
      const id = locked.get(hostId);
      return file && id ? `From ${path.basename(file)} (id ${id})` : null;
    },
    allowManualCreate: () => !status.strict,
  };
}

export type Loader = ReturnType<typeof createLoader>;

/** How often the hosts file is checked for changes. */
export const WATCH_MS = 3000;

/**
 * Polls the file, since inotify misses bind mounts and ConfigMap swaps. Each
 * tick reads it through Termix and calls onChange when its contents changed.
 */
export function watchHostsFile(
  read: () => Promise<string | null>,
  onChange: () => void,
) {
  let seen: string | null | undefined;
  return async () => {
    let text: string | null;
    try {
      text = await read();
    } catch {
      return;
    }
    const hash =
      text === null ? null : createHash("sha256").update(text).digest("hex");
    if (seen !== undefined && hash !== seen) onChange();
    seen = hash;
  };
}
