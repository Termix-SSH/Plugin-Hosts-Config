/**
 * Turns a checked hosts file into the writes for Termix: owners, roles and
 * credential names become ids, and secret refs become values. Nothing is
 * written here, so a file with a bad reference never half applies.
 */

import type {
  PluginHostCreateInput,
  PluginHostProtocolAuthInput,
  PluginHostShareGrant,
} from "@termix-ssh/plugin-sdk/backend";
import type {
  HostEntry,
  HostsFile,
  ProtocolLogin,
  SecretRef,
  ShareEntry,
} from "./config.js";

export interface Lookups {
  /** Lowercase username to user id. */
  users: Map<string, string>;
  /** Lowercase role name to role id. */
  roles: Map<string, number>;
  /** Owner id to lowercase credential name to the ids with that name. */
  credentials: Map<string, Map<string, number[]>>;
  env: (name: string) => string | undefined;
  readFile: (path: string) => string;
}

export interface PlannedHost {
  configId: string;
  ownerId: string;
  /** Everything but jump hosts, which need the other hosts' ids first. */
  input: PluginHostCreateInput;
  jumpHosts: string[];
  shares: PluginHostShareGrant[];
}

export type PlanResult =
  | { ok: true; hosts: PlannedHost[]; strict: boolean }
  | { ok: false; errors: string[] };

const LEVEL_RANK: Record<string, number> = {
  connect: 1,
  view: 2,
  edit: 3,
  manage: 4,
};

function inFolder(folder: string | undefined, path: string): boolean {
  return !!folder && (folder === path || folder.startsWith(`${path} / `));
}

export function planHosts(file: HostsFile, lookups: Lookups): PlanResult {
  const errors: string[] = [];

  const secret = (ref: SecretRef | undefined, at: string): string | null => {
    if (ref === undefined) return null;
    if (typeof ref === "string") return ref;
    if ("env" in ref) {
      const value = lookups.env(ref.env);
      if (value === undefined) {
        errors.push(`${at}: env var ${ref.env} is not set`);
        return null;
      }
      return value;
    }
    try {
      return lookups.readFile(ref.file).replace(/\r?\n$/, "");
    } catch (error) {
      errors.push(
        `${at}: can't read ${ref.file} (${error instanceof Error ? error.message : String(error)})`,
      );
      return null;
    }
  };

  const credentialId = (
    ownerId: string,
    name: string,
    at: string,
  ): number | null => {
    const ids = lookups.credentials.get(ownerId)?.get(name.toLowerCase()) ?? [];
    if (ids.length === 1) return ids[0];
    errors.push(
      ids.length === 0
        ? `${at}: the owner has no credential named "${name}"`
        : `${at}: the owner has ${ids.length} credentials named "${name}", rename one`,
    );
    return null;
  };

  const grants = (entries: ShareEntry[], at: string): PluginHostShareGrant[] =>
    entries.flatMap((entry): PluginHostShareGrant[] => {
      if (entry.user) {
        const id = lookups.users.get(entry.user.toLowerCase());
        if (!id) {
          errors.push(`${at}: no user named "${entry.user}"`);
          return [];
        }
        return [{ target: { type: "user", id }, permissionLevel: entry.level }];
      }
      const id = lookups.roles.get((entry.role ?? "").toLowerCase());
      if (id === undefined) {
        errors.push(`${at}: no role named "${entry.role}"`);
        return [];
      }
      return [{ target: { type: "role", id }, permissionLevel: entry.level }];
    });

  const folderGrants = file.folders.map((folder, i) => ({
    path: folder.path,
    grants: grants(folder.share, `folders[${i}].share`),
  }));

  const protocolAuth = (
    ownerId: string,
    logins: Record<string, ProtocolLogin | null>,
    at: string,
  ): Record<string, PluginHostProtocolAuthInput | null> => {
    const out: Record<string, PluginHostProtocolAuthInput | null> = {};
    for (const [protocol, login] of Object.entries(logins)) {
      if (!login) {
        out[protocol] = null;
        continue;
      }
      const where = `${at}.${protocol}`;
      const input: PluginHostProtocolAuthInput = {};
      if (login.credential) {
        input.authType = "credential";
        input.credentialId = credentialId(ownerId, login.credential, where);
      } else if (login.authType) {
        input.authType = login.authType;
      }
      if (login.username !== undefined) input.username = login.username;
      const password = secret(login.password, `${where}.password`);
      if (password !== null) input.password = password;
      if (login.fields) {
        input.fields = {};
        for (const [field, ref] of Object.entries(login.fields)) {
          const value = secret(ref, `${where}.fields.${field}`);
          if (value !== null) input.fields[field] = value;
        }
      }
      out[protocol] = input;
    }
    return out;
  };

  const planned = file.hosts.map((host: HostEntry, i): PlannedHost | null => {
    const at = `hosts[${i}] (${host.id})`;
    const ownerName = host.owner ?? file.owner ?? "";
    const ownerId = lookups.users.get(ownerName.toLowerCase());
    if (!ownerId) {
      errors.push(`${at}: no user named "${ownerName}" to own it`);
      return null;
    }

    const pluginSettings: Record<string, Record<string, unknown>> = {};
    const pluginEnable: Record<string, boolean> = {};
    for (const [pluginId, values] of Object.entries(host.plugins)) {
      const { enabled, ...rest } = values;
      if (typeof enabled === "boolean") pluginEnable[pluginId] = enabled;
      if (Object.keys(rest).length > 0) pluginSettings[pluginId] = rest;
    }

    const password = secret(host.password, `${at}.password`);
    const key = secret(host.key, `${at}.key`);
    const authType =
      host.authType ??
      (host.credential
        ? "credential"
        : key
          ? "key"
          : password
            ? "password"
            : "none");

    const shares = new Map<string, PluginHostShareGrant>();
    const add = (grant: PluginHostShareGrant) => {
      const id = `${grant.target.type}:${grant.target.id}`;
      const current = shares.get(id);
      if (
        !current ||
        LEVEL_RANK[grant.permissionLevel] > LEVEL_RANK[current.permissionLevel]
      ) {
        shares.set(id, grant);
      }
    };
    for (const folder of folderGrants) {
      if (inFolder(host.folder, folder.path)) folder.grants.forEach(add);
    }
    grants(host.share, `${at}.share`).forEach(add);
    if (shares.has(`user:${ownerId}`)) {
      shares.delete(`user:${ownerId}`);
    }

    const input: PluginHostCreateInput = {
      name: host.name ?? host.id,
      ip: host.ip,
      port: host.port ?? 22,
      username: host.username ?? "",
      authType,
      credentialId: host.credential
        ? credentialId(ownerId, host.credential, `${at}.credential`)
        : null,
      connectionType: host.connectionType,
      tags: host.tags,
      folder: host.folder ?? null,
      notes: host.notes ?? null,
      sshOptions: host.sshOptions ?? null,
      password,
      key,
      keyPassword: secret(host.keyPassword, `${at}.keyPassword`),
      keyType: host.keyType ?? null,
      sudoPassword: secret(host.sudoPassword, `${at}.sudoPassword`),
      protocolAuth: protocolAuth(
        ownerId,
        host.protocolAuth,
        `${at}.protocolAuth`,
      ),
      pluginSettings,
      pluginEnable,
    };
    if (host.pin !== undefined) input.pin = host.pin;
    if (host.overrideCredentialUsername !== undefined) {
      input.overrideCredentialUsername = host.overrideCredentialUsername;
    }
    if (host.forceKeyboardInteractive !== undefined) {
      input.forceKeyboardInteractive = host.forceKeyboardInteractive;
    }
    if (host.enableSsh !== undefined) input.enableSsh = host.enableSsh;
    if (host.sshPort !== undefined) input.sshPort = host.sshPort;
    if (host.statusCheckEnabled !== undefined) {
      input.statusCheckEnabled = host.statusCheckEnabled;
    }
    if (host.statusCheckInterval !== undefined) {
      input.statusCheckInterval = host.statusCheckInterval;
    }

    return {
      configId: host.id,
      ownerId,
      input,
      jumpHosts: host.jumpHosts,
      shares: [...shares.values()],
    };
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    hosts: planned.filter((host): host is PlannedHost => host !== null),
    strict: file.strict,
  };
}
