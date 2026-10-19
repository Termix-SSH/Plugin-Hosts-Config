/**
 * Reads and checks a hosts file without touching Termix. Every problem is
 * collected with its path, so one load reports them all.
 */

import { parseDocument } from "yaml";

export type ShareLevel = "connect" | "view" | "edit" | "manage";

/** A secret given inline, from an env var or from a file (Docker secrets). */
export type SecretRef = string | { env: string } | { file: string };

export interface ShareEntry {
  user?: string;
  role?: string;
  level: ShareLevel;
}

export interface ProtocolLogin {
  authType?: "direct" | "credential" | "none";
  username?: string;
  password?: SecretRef;
  credential?: string;
  fields?: Record<string, SecretRef>;
}

export interface HostEntry {
  id: string;
  owner?: string;
  name?: string;
  connectionType: string;
  ip: string;
  port?: number;
  username?: string;
  folder?: string;
  tags: string[];
  notes?: string;
  pin?: boolean;
  authType?: string;
  credential?: string;
  password?: SecretRef;
  key?: SecretRef;
  keyPassword?: SecretRef;
  keyType?: string;
  sudoPassword?: SecretRef;
  overrideCredentialUsername?: boolean;
  forceKeyboardInteractive?: boolean;
  enableSsh?: boolean;
  sshPort?: number;
  statusCheckEnabled?: boolean;
  statusCheckInterval?: number;
  sshOptions?: Record<string, unknown>;
  jumpHosts: string[];
  protocolAuth: Record<string, ProtocolLogin | null>;
  plugins: Record<string, Record<string, unknown>>;
  share: ShareEntry[];
}

export interface FolderEntry {
  path: string;
  share: ShareEntry[];
}

export interface HostsFile {
  strict: boolean;
  owner?: string;
  folders: FolderEntry[];
  hosts: HostEntry[];
}

export type ParseResult =
  | { ok: true; file: HostsFile; warnings: string[] }
  | { ok: false; errors: string[] };

const ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const LEVELS: readonly string[] = ["connect", "view", "edit", "manage"];
const PROTOCOL_AUTH_TYPES: readonly string[] = ["direct", "credential", "none"];
const SECRET_KEYS = ["password", "key", "keyPassword", "sudoPassword"] as const;

const HOST_KEYS = new Set([
  "id",
  "owner",
  "name",
  "connectionType",
  "ip",
  "port",
  "username",
  "folder",
  "tags",
  "notes",
  "pin",
  "authType",
  "credential",
  ...SECRET_KEYS,
  "keyType",
  "overrideCredentialUsername",
  "forceKeyboardInteractive",
  "enableSsh",
  "sshPort",
  "statusCheckEnabled",
  "statusCheckInterval",
  "sshOptions",
  "jumpHosts",
  "protocolAuth",
  "plugins",
  "share",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

class Checker {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];

  fail(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  string(
    obj: Record<string, unknown>,
    key: string,
    path: string,
    required = false,
  ): string | undefined {
    const value = obj[key];
    if (value === undefined || value === null) {
      if (required) this.fail(`${path}.${key}`, "is required");
      return undefined;
    }
    if (typeof value === "number") return String(value);
    if (typeof value !== "string" || (required && !value.trim())) {
      this.fail(`${path}.${key}`, "must be text");
      return undefined;
    }
    return value.trim();
  }

  bool(
    obj: Record<string, unknown>,
    key: string,
    path: string,
  ): boolean | undefined {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "boolean") {
      this.fail(`${path}.${key}`, "must be true or false");
      return undefined;
    }
    return value;
  }

  int(
    obj: Record<string, unknown>,
    key: string,
    path: string,
    min: number,
    max: number,
  ): number | undefined {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      this.fail(
        `${path}.${key}`,
        `must be a whole number from ${min} to ${max}`,
      );
      return undefined;
    }
    return value;
  }

  secret(value: unknown, path: string): SecretRef | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") {
      if (value) {
        this.warnings.push(
          `${path} is written in the file. Use { env: NAME } or { file: path } instead`,
        );
      }
      return value;
    }
    if (isObject(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && typeof value.env === "string" && value.env) {
        return { env: value.env };
      }
      if (keys.length === 1 && typeof value.file === "string" && value.file) {
        return { file: value.file };
      }
    }
    this.fail(path, "must be text, { env: NAME } or { file: path }");
    return undefined;
  }

  shares(value: unknown, path: string): ShareEntry[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.fail(path, "must be a list");
      return [];
    }
    const out: ShareEntry[] = [];
    value.forEach((raw, i) => {
      const at = `${path}[${i}]`;
      if (!isObject(raw))
        return this.fail(at, "must be { user or role, level }");
      const user = this.string(raw, "user", at);
      const role = this.string(raw, "role", at);
      if (!!user === !!role)
        return this.fail(at, "needs exactly one of user or role");
      const level = raw.level ?? "connect";
      if (typeof level !== "string" || !LEVELS.includes(level)) {
        return this.fail(`${at}.level`, `must be one of ${LEVELS.join(", ")}`);
      }
      out.push({ ...(user ? { user } : { role }), level: level as ShareLevel });
    });
    return out;
  }
}

function readProtocolAuth(
  check: Checker,
  value: unknown,
  path: string,
): Record<string, ProtocolLogin | null> {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) {
    check.fail(path, "must map protocol ids to logins");
    return {};
  }
  const out: Record<string, ProtocolLogin | null> = {};
  for (const [protocol, raw] of Object.entries(value)) {
    const at = `${path}.${protocol}`;
    if (raw === null) {
      out[protocol] = null;
      continue;
    }
    if (!isObject(raw)) {
      check.fail(at, "must be a login object or null");
      continue;
    }
    const authType = check.string(raw, "authType", at);
    if (authType && !PROTOCOL_AUTH_TYPES.includes(authType)) {
      check.fail(
        `${at}.authType`,
        `must be one of ${PROTOCOL_AUTH_TYPES.join(", ")}`,
      );
    }
    const login: ProtocolLogin = {
      authType: authType as ProtocolLogin["authType"],
      username: check.string(raw, "username", at),
      password: check.secret(raw.password, `${at}.password`),
      credential: check.string(raw, "credential", at),
    };
    if (raw.fields !== undefined) {
      if (!isObject(raw.fields)) {
        check.fail(`${at}.fields`, "must map field names to values");
      } else {
        login.fields = {};
        for (const [field, fieldValue] of Object.entries(raw.fields)) {
          const secret = check.secret(fieldValue, `${at}.fields.${field}`);
          if (secret !== undefined) login.fields[field] = secret;
        }
      }
    }
    out[protocol] = login;
  }
  return out;
}

function readPlugins(
  check: Checker,
  value: unknown,
  path: string,
): Record<string, Record<string, unknown>> {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) {
    check.fail(path, "must map plugin ids to their host settings");
    return {};
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [pluginId, settings] of Object.entries(value)) {
    if (typeof settings === "boolean") {
      out[pluginId] = { enabled: settings };
    } else if (isObject(settings)) {
      if (
        settings.enabled !== undefined &&
        typeof settings.enabled !== "boolean"
      ) {
        check.fail(`${path}.${pluginId}.enabled`, "must be true or false");
      }
      out[pluginId] = settings;
    } else {
      check.fail(
        `${path}.${pluginId}`,
        "must be true, false or an object of settings",
      );
    }
  }
  return out;
}

function readHost(
  check: Checker,
  raw: unknown,
  path: string,
): HostEntry | null {
  if (!isObject(raw)) {
    check.fail(path, "must be an object");
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!HOST_KEYS.has(key))
      check.fail(`${path}.${key}`, "is not a known field");
  }
  const id = check.string(raw, "id", path, true);
  if (id && !ID_PATTERN.test(id)) {
    check.fail(
      `${path}.id`,
      "may only use letters, numbers, dot, dash and underscore (up to 100)",
    );
  }
  const connectionType = check.string(raw, "connectionType", path) || "ssh";
  const ip = check.string(raw, "ip", path, true);

  let tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    tags = raw.tags.map((tag) => String(tag).trim()).filter(Boolean);
  } else if (typeof raw.tags === "string") {
    tags = raw.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  } else if (raw.tags !== undefined && raw.tags !== null) {
    check.fail(`${path}.tags`, "must be a list or comma separated text");
  }

  let jumpHosts: string[] = [];
  if (Array.isArray(raw.jumpHosts)) {
    jumpHosts = raw.jumpHosts.map(String);
  } else if (raw.jumpHosts !== undefined && raw.jumpHosts !== null) {
    check.fail(
      `${path}.jumpHosts`,
      "must be a list of host ids from this file",
    );
  }

  if (
    raw.sshOptions !== undefined &&
    raw.sshOptions !== null &&
    !isObject(raw.sshOptions)
  ) {
    check.fail(`${path}.sshOptions`, "must be an object");
  }

  const host: HostEntry = {
    id: id ?? "",
    owner: check.string(raw, "owner", path),
    name: check.string(raw, "name", path),
    connectionType,
    ip: ip ?? "",
    port: check.int(raw, "port", path, 1, 65535),
    username: check.string(raw, "username", path),
    folder: check.string(raw, "folder", path),
    tags,
    notes: check.string(raw, "notes", path),
    pin: check.bool(raw, "pin", path),
    authType: check.string(raw, "authType", path),
    credential: check.string(raw, "credential", path),
    keyType: check.string(raw, "keyType", path),
    overrideCredentialUsername: check.bool(
      raw,
      "overrideCredentialUsername",
      path,
    ),
    forceKeyboardInteractive: check.bool(raw, "forceKeyboardInteractive", path),
    enableSsh: check.bool(raw, "enableSsh", path),
    sshPort: check.int(raw, "sshPort", path, 1, 65535),
    statusCheckEnabled: check.bool(raw, "statusCheckEnabled", path),
    statusCheckInterval: check.int(raw, "statusCheckInterval", path, 5, 3600),
    sshOptions: isObject(raw.sshOptions) ? raw.sshOptions : undefined,
    jumpHosts,
    protocolAuth: readProtocolAuth(
      check,
      raw.protocolAuth,
      `${path}.protocolAuth`,
    ),
    plugins: readPlugins(check, raw.plugins, `${path}.plugins`),
    share: check.shares(raw.share, `${path}.share`),
  };
  for (const key of SECRET_KEYS) {
    host[key] = check.secret(raw[key], `${path}.${key}`);
  }
  if (connectionType !== "ssh" && host.port === undefined) {
    check.fail(`${path}.port`, `is required for ${connectionType}`);
  }
  if (host.credential && host.authType && host.authType !== "credential") {
    check.fail(
      `${path}.authType`,
      "must be credential when a credential is named",
    );
  }
  if (host.authType === "credential" && !host.credential) {
    check.fail(`${path}.credential`, "is required when authType is credential");
  }
  return host;
}

/** Turns the parsed document into a checked HostsFile. */
export function checkHostsFile(data: unknown): ParseResult {
  const check = new Checker();
  if (!isObject(data)) {
    return {
      ok: false,
      errors: ["The file must hold an object with a hosts list"],
    };
  }
  const known = new Set(["version", "strict", "owner", "folders", "hosts"]);
  for (const key of Object.keys(data)) {
    if (!known.has(key)) check.fail(key, "is not a known field");
  }
  if (data.version !== undefined && data.version !== 1) {
    check.fail("version", "must be 1");
  }
  if (!Array.isArray(data.hosts)) {
    check.fail("hosts", "must be a list (use [] for none)");
  }

  const folders: FolderEntry[] = [];
  if (data.folders !== undefined && data.folders !== null) {
    if (!Array.isArray(data.folders)) {
      check.fail("folders", "must be a list");
    } else {
      data.folders.forEach((raw, i) => {
        const at = `folders[${i}]`;
        if (!isObject(raw)) return check.fail(at, "must be an object");
        const path = check.string(raw, "path", at, true);
        if (path)
          folders.push({ path, share: check.shares(raw.share, `${at}.share`) });
      });
    }
  }

  const hosts: HostEntry[] = [];
  const seen = new Map<string, number>();
  (Array.isArray(data.hosts) ? data.hosts : []).forEach((raw, i) => {
    const host = readHost(check, raw, `hosts[${i}]`);
    if (!host) return;
    if (host.id) {
      const first = seen.get(host.id);
      if (first !== undefined) {
        check.fail(
          `hosts[${i}].id`,
          `"${host.id}" is already used by hosts[${first}]`,
        );
      } else {
        seen.set(host.id, i);
      }
    }
    hosts.push(host);
  });
  hosts.forEach((host, i) => {
    for (const jump of host.jumpHosts) {
      if (!seen.has(jump)) {
        check.fail(
          `hosts[${i}].jumpHosts`,
          `"${jump}" is not a host id in this file`,
        );
      } else if (jump === host.id) {
        check.fail(`hosts[${i}].jumpHosts`, "a host can't jump through itself");
      }
    }
  });

  const strict = check.bool(data, "strict", "file") ?? false;
  const owner = check.string(data, "owner", "file");
  if (!owner && hosts.some((host) => !host.owner)) {
    check.fail("owner", "is required, or set owner on every host");
  }

  if (check.errors.length > 0) return { ok: false, errors: check.errors };
  return {
    ok: true,
    file: { strict, owner, folders, hosts },
    warnings: check.warnings,
  };
}

/** Parses YAML or JSON text. A .json file name means strict JSON. */
export function parseHostsFile(text: string, fileName: string): ParseResult {
  if (fileName.toLowerCase().endsWith(".json")) {
    try {
      return checkHostsFile(JSON.parse(text));
    } catch (error) {
      return {
        ok: false,
        errors: [
          `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((error) => {
        const line = error.linePos?.[0];
        return line
          ? `Invalid YAML at line ${line.line}, column ${line.col}: ${error.message.split("\n")[0]}`
          : `Invalid YAML: ${error.message.split("\n")[0]}`;
      }),
    };
  }
  return checkHostsFile(doc.toJS());
}
