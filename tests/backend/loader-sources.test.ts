import { describe, expect, it } from "vitest";
import { createMockCtx } from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import {
  ctxDeps,
  ENV_VAR,
  secretRefs,
  watchHostsFile,
} from "../../src/backend/loader";

const manifest = manifestJson as unknown as PluginManifest;

describe("reading through Termix", () => {
  it("finds every env and file secret in a parsed file", () => {
    const refs = secretRefs({
      hosts: [
        {
          password: { env: "A" },
          rdp: { password: { file: "/run/secrets/b" } },
        },
        { key: { env: "C" }, note: "plain", nested: { env: "A", other: 1 } },
      ],
    });
    expect([...refs.env]).toEqual(["A", "C"]);
    expect([...refs.file]).toEqual(["/run/secrets/b"]);
  });

  it("reads the hosts file and secrets through ctx.files", async () => {
    process.env[ENV_VAR] = "/config/hosts.yaml";
    try {
      const mock = createMockCtx({
        sandbox: true,
        manifest,
        capabilities: manifest.capabilities,
        envFiles: { [ENV_VAR]: "hosts: []" },
        configSecrets: {
          "env:NAS_PASSWORD": "p",
          "file:/run/secrets/k": "key",
        },
      });
      const deps = ctxDeps(mock.ctx);
      expect(await deps.env(ENV_VAR)).toBe("/config/hosts.yaml");
      expect(await deps.readFile("/config/hosts.yaml")).toBe("hosts: []");
      expect(await deps.env("NAS_PASSWORD")).toBe("p");
      expect(await deps.env("MISSING")).toBeUndefined();
      expect(await deps.readFile("/run/secrets/k")).toBe("key");
      await expect(deps.readFile("/run/secrets/none")).rejects.toThrow(
        /no such file/,
      );
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  it("needs config:secrets for secrets", async () => {
    const mock = createMockCtx({
      sandbox: true,
      manifest,
      capabilities: manifest.capabilities.filter((c) => c !== "config:secrets"),
      configSecrets: { "env:NAS_PASSWORD": "p" },
    });
    await expect(ctxDeps(mock.ctx).env("NAS_PASSWORD")).rejects.toThrow(
      /config:secrets/,
    );
  });

  it("calls back only when the file's contents change", async () => {
    let text: string | null = "a";
    let changes = 0;
    const tick = watchHostsFile(
      async () => text,
      () => changes++,
    );
    await tick();
    await tick();
    expect(changes).toBe(0);
    text = "b";
    await tick();
    expect(changes).toBe(1);
    text = null;
    await tick();
    expect(changes).toBe(2);
  });
});
