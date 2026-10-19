import { describe, expect, it } from "vitest";
import { parseHostsFile, type HostsFile } from "../../src/backend/config";
import { planHosts, type Lookups } from "../../src/backend/plan";

function file(text: string): HostsFile {
  const result = parseHostsFile(text, "hosts.yaml");
  if ("errors" in result) throw new Error(result.errors.join("\n"));
  return result.file;
}

function lookups(overrides: Partial<Lookups> = {}): Lookups {
  return {
    users: new Map([
      ["admin", "u-admin"],
      ["alice", "u-alice"],
    ]),
    roles: new Map([["ops", 7]]),
    credentials: new Map([
      [
        "u-admin",
        new Map([
          ["deploy key", [11]],
          ["twice", [12, 13]],
        ]),
      ],
    ]),
    env: (name) => ({ RDP_PASS: "rdp-secret" })[name],
    readFile: (path) => {
      if (path === "/run/secrets/key") return "KEY DATA\n";
      throw new Error("ENOENT");
    },
    ...overrides,
  };
}

describe("planHosts", () => {
  it("resolves owners, credentials, secrets, plugins and shares", () => {
    const result = planHosts(
      file(`
owner: admin
folders:
  - path: Prod
    share: [{ role: ops, level: connect }]
hosts:
  - id: web
    ip: 10.0.0.5
    folder: Prod / Web
    credential: deploy KEY
    sudoPassword: { file: /run/secrets/key }
    protocolAuth:
      rdp: { username: admin, password: { env: RDP_PASS } }
    plugins:
      host-metrics: { enabled: true, interval: 30 }
    share:
      - { role: ops, level: edit }
      - { user: alice }
      - { user: admin, level: manage }
`),
      lookups(),
    );
    if ("errors" in result) throw new Error(result.errors.join("\n"));
    const [web] = result.hosts;
    expect(web.ownerId).toBe("u-admin");
    expect(web.input).toMatchObject({
      name: "web",
      port: 22,
      authType: "credential",
      credentialId: 11,
      folder: "Prod / Web",
      sudoPassword: "KEY DATA",
      password: null,
      protocolAuth: { rdp: { username: "admin", password: "rdp-secret" } },
      pluginEnable: { "host-metrics": true },
      pluginSettings: { "host-metrics": { interval: 30 } },
    });
    // The highest level wins and the owner is never shared with.
    expect(web.shares).toEqual([
      { target: { type: "role", id: 7 }, permissionLevel: "edit" },
      { target: { type: "user", id: "u-alice" }, permissionLevel: "connect" },
    ]);
  });

  it("collects every reference that does not resolve", () => {
    const result = planHosts(
      file(`
owner: admin
hosts:
  - id: a
    ip: 1.1.1.1
    credential: nope
    password: { env: MISSING }
  - id: b
    ip: 1.1.1.2
    owner: nobody
  - id: c
    ip: 1.1.1.3
    credential: twice
    key: { file: /nope }
    share: [{ role: ghosts }]
`),
      lookups(),
    );
    expect(result.ok).toBe(false);
    if (!("errors" in result)) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'hosts[0] (a).credential: the owner has no credential named "nope"',
        "hosts[0] (a).password: env var MISSING is not set",
        'hosts[1] (b): no user named "nobody" to own it',
        'hosts[2] (c).credential: the owner has 2 credentials named "twice", rename one',
        expect.stringMatching(/^hosts\[2\] \(c\)\.key: can't read \/nope/),
        'hosts[2] (c).share: no role named "ghosts"',
      ]),
    );
  });

  it("guesses the auth type from what is set", () => {
    const result = planHosts(
      file(`
owner: admin
hosts:
  - { id: k, ip: 1.1.1.1, key: { file: /run/secrets/key } }
  - { id: p, ip: 1.1.1.2, password: plain }
  - { id: n, ip: 1.1.1.3 }
`),
      lookups(),
    );
    if ("errors" in result) throw new Error(result.errors.join("\n"));
    expect(result.hosts.map((h) => h.input.authType)).toEqual([
      "key",
      "password",
      "none",
    ]);
  });
});
