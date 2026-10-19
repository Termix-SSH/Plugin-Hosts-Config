import { describe, expect, it } from "vitest";
import { parseHostsFile } from "../../src/backend/config";

const yaml = `
version: 1
owner: admin
strict: true
folders:
  - path: Prod
    share: [{ role: ops }]
hosts:
  - id: bastion
    ip: 10.0.0.1
    username: jump
    password: { env: BASTION_PASS }
  - id: web-1
    ip: 10.0.0.5
    port: 2222
    folder: Prod / Web
    tags: web, prod
    credential: Deploy key
    jumpHosts: [bastion]
    protocolAuth:
      rdp: { authType: direct, username: admin, password: { file: /run/secrets/rdp } }
    plugins:
      host-metrics: true
      docker: { enabled: false }
    share: [{ user: alice, level: view }]
`;

describe("parseHostsFile", () => {
  it("reads a full YAML file", () => {
    const result = parseHostsFile(yaml, "hosts.yaml");
    if ("errors" in result) throw new Error(result.errors.join("\n"));
    expect(result.file.strict).toBe(true);
    expect(result.file.folders).toEqual([
      { path: "Prod", share: [{ role: "ops", level: "connect" }] },
    ]);
    const [bastion, web] = result.file.hosts;
    expect(bastion).toMatchObject({
      id: "bastion",
      connectionType: "ssh",
      password: { env: "BASTION_PASS" },
    });
    expect(web).toMatchObject({
      port: 2222,
      tags: ["web", "prod"],
      credential: "Deploy key",
      jumpHosts: ["bastion"],
      protocolAuth: {
        rdp: { password: { file: "/run/secrets/rdp" }, username: "admin" },
      },
      plugins: {
        "host-metrics": { enabled: true },
        docker: { enabled: false },
      },
      share: [{ user: "alice", level: "view" }],
    });
    expect(result.warnings).toEqual([]);
  });

  it("reads JSON when the file ends in .json", () => {
    const result = parseHostsFile(
      JSON.stringify({ owner: "admin", hosts: [{ id: "a", ip: "1.2.3.4" }] }),
      "hosts.json",
    );
    expect(result.ok).toBe(true);
  });

  it("reports every problem with its path", () => {
    const result = parseHostsFile(
      `
owner: admin
hosts:
  - id: a
    ip: 10.0.0.1
    port: 70000
  - id: a
    ip: 10.0.0.2
    jumpHosts: [missing]
  - ip: 10.0.0.3
    connectionType: rdp
    color: red
    share: [{ user: bob, role: ops }]
`,
      "hosts.yml",
    );
    expect(result.ok).toBe(false);
    if (!("errors" in result)) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "hosts[0].port: must be a whole number from 1 to 65535",
        'hosts[1].id: "a" is already used by hosts[0]',
        'hosts[1].jumpHosts: "missing" is not a host id in this file',
        "hosts[2].id: is required",
        "hosts[2].color: is not a known field",
        "hosts[2].port: is required for rdp",
        "hosts[2].share[0]: needs exactly one of user or role",
      ]),
    );
  });

  it("needs an owner for every host", () => {
    const result = parseHostsFile(
      "hosts:\n  - id: a\n    ip: 1.1.1.1\n",
      "h.yaml",
    );
    expect(result.ok).toBe(false);
    if (!("errors" in result)) return;
    expect(result.errors).toContain(
      "owner: is required, or set owner on every host",
    );
  });

  it("needs a hosts list so an empty file never deletes everything", () => {
    const result = parseHostsFile("owner: admin\n", "h.yaml");
    expect(result.ok).toBe(false);
  });

  it("names the line of a YAML syntax error", () => {
    const result = parseHostsFile("hosts:\n  - id: [a\n", "h.yaml");
    expect(result.ok).toBe(false);
    if (!("errors" in result)) return;
    expect(result.errors[0]).toMatch(/^Invalid YAML at line \d+/);
  });

  it("warns about a password written in the file", () => {
    const result = parseHostsFile(
      "owner: admin\nhosts:\n  - id: a\n    ip: 1.1.1.1\n    password: hunter2\n",
      "h.yaml",
    );
    expect(result.ok).toBe(true);
    if ("errors" in result) return;
    expect(result.warnings).toEqual([
      "hosts[0].password is written in the file. Use { env: NAME } or { file: path } instead",
    ]);
  });

  it("refuses a malformed secret ref", () => {
    const result = parseHostsFile(
      "owner: admin\nhosts:\n  - id: a\n    ip: 1.1.1.1\n    key: { vault: x }\n",
      "h.yaml",
    );
    expect(result.ok).toBe(false);
  });
});
