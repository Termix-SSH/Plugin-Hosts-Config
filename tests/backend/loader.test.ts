import { beforeEach, describe, expect, it } from "vitest";
import { createFakeContext } from "@termix-ssh/plugin-sdk/testing";
import type { MapRow, MapStore } from "../../src/backend/apply";
import { createLoader, ENV_VAR } from "../../src/backend/loader";

function memoryStore(): MapStore & { rows: Map<string, MapRow> } {
  const rows = new Map<string, MapRow>();
  return {
    rows,
    list: async () => [...rows.values()],
    put: async (row) => {
      rows.set(row.configId, row);
    },
    remove: async (configId) => {
      rows.delete(configId);
    },
  };
}

const twoHosts = `
owner: admin
strict: true
hosts:
  - id: bastion
    ip: 10.0.0.1
    username: jump
  - id: web
    ip: 10.0.0.5
    username: deploy
    jumpHosts: [bastion]
    share: [{ user: alice, level: view }]
`;

let files: Record<string, string>;
let fake: ReturnType<typeof createFakeContext>;
let ctx: ReturnType<typeof createFakeContext>["ctx"];
let store: ReturnType<typeof memoryStore>;

function loader(env: Record<string, string> = { [ENV_VAR]: "/c/hosts.yaml" }) {
  return createLoader(ctx, store, {
    env: (name) => env[name],
    readFile: (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
  });
}

beforeEach(() => {
  files = { "/c/hosts.yaml": twoHosts };
  fake = createFakeContext({
    pluginId: "hosts-config",
    shareableUsers: [
      { id: "u-admin", username: "admin" },
      { id: "u-alice", username: "alice" },
    ],
  });
  ctx = fake.ctx;
  store = memoryStore();
});

describe("hosts file loader", () => {
  it("does nothing without TERMIX_HOSTS_CONFIG", async () => {
    const l = loader({});
    expect((await l.load()).enabled).toBe(false);
    expect(await ctx.hosts.listOwned()).toEqual([]);
    expect(l.isLocked(1)).toBe(false);
  });

  it("creates the hosts, locks them and applies jump hosts and shares", async () => {
    const l = loader();
    const status = await l.load();
    expect(status.errors).toEqual([]);
    expect(status.lastResult).toEqual({ created: 2, updated: 0, deleted: 0 });
    expect(status.strict).toBe(true);
    expect(l.allowManualCreate()).toBe(false);

    const bastionId = store.rows.get("bastion")!.hostId;
    const webId = store.rows.get("web")!.hostId;
    const web = (await ctx.hosts.listOwned()).find((h) => h.id === webId)!;
    expect(web.jumpHosts).toEqual([{ hostId: bastionId }]);
    expect(web.userId).toBe("u-admin");
    expect(l.isLocked(webId)).toBe(true);
    expect(l.note(webId)).toBe("From hosts.yaml (id web)");
    expect(fake.hostShareSets.find((s) => s.hostId === webId)?.grants).toEqual([
      { target: { type: "user", id: "u-alice" }, permissionLevel: "view" },
    ]);
  });

  it("updates in place on reload and deletes ids gone from the file", async () => {
    const l = loader();
    await l.load();
    const webId = store.rows.get("web")!.hostId;

    files["/c/hosts.yaml"] = `
owner: admin
hosts:
  - id: web
    ip: 10.0.0.6
    username: deploy
`;
    const status = await l.load();
    expect(status.lastResult).toEqual({ created: 0, updated: 1, deleted: 1 });
    expect(store.rows.get("web")!.hostId).toBe(webId);
    expect(store.rows.has("bastion")).toBe(false);
    const hosts = await ctx.hosts.listOwned();
    expect(hosts.map((h) => [h.id, h.ip])).toEqual([[webId, "10.0.0.6"]]);
    expect(l.allowManualCreate()).toBe(true);
  });

  it("writes nothing and keeps the last good load when the file is bad", async () => {
    const l = loader();
    await l.load();
    const before = await ctx.hosts.listOwned();

    files["/c/hosts.yaml"] = "owner: admin\nhosts:\n  - id: web\n";
    const status = await l.load();
    expect(status.errors).toEqual(["hosts[0].ip: is required"]);
    expect(await ctx.hosts.listOwned()).toEqual(before);
    expect(l.allowManualCreate()).toBe(false);
    expect(store.rows.size).toBe(2);
  });

  it("refuses an unknown share target without writing", async () => {
    files["/c/hosts.yaml"] = `
owner: admin
hosts:
  - { id: a, ip: 1.1.1.1, share: [{ user: mallory }] }
`;
    const status = await loader().load();
    expect(status.errors).toEqual([
      'hosts[0] (a).share: no user named "mallory"',
    ]);
    expect(await ctx.hosts.listOwned()).toEqual([]);
  });

  it("skips an unchanged file unless forced", async () => {
    const l = loader();
    await l.load();
    expect((await l.load()).lastResult).toEqual({
      created: 2,
      updated: 0,
      deleted: 0,
    });
    expect((await l.load(true)).lastResult).toEqual({
      created: 0,
      updated: 2,
      deleted: 0,
    });
  });

  it("keeps the user's pin after the first load", async () => {
    files["/c/hosts.yaml"] =
      "owner: admin\nhosts:\n  - { id: a, ip: 1.1.1.1, pin: true }\n";
    const l = loader();
    await l.load();
    const id = store.rows.get("a")!.hostId;
    await ctx.hosts.update(id, { pin: false });
    await l.load(true);
    expect((await ctx.hosts.listOwned())[0].pin).toBe(false);
  });

  it("brings back a host deleted outside the file", async () => {
    const l = loader();
    await l.load();
    const oldId = store.rows.get("bastion")!.hostId;
    await ctx.hosts.delete(oldId);
    await l.load(true);
    expect(store.rows.get("bastion")!.hostId).not.toBe(oldId);
  });
});
