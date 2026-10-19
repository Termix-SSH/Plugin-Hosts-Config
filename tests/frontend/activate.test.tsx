import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const status = {
  enabled: true,
  path: "/config/hosts.yaml",
  strict: true,
  hosts: 3,
  lastLoadedAt: "2026-10-19T10:00:00.000Z",
  lastAttemptAt: "2026-10-19T10:00:00.000Z",
  errors: ["hosts[1].port: must be a whole number from 1 to 65535"],
  applyErrors: [],
  warnings: [],
  lastResult: { created: 3, updated: 0, deleted: 0 },
};

describe(`${manifest.id} activate`, () => {
  it("registers the status settings component", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.settingsComponents()).toEqual(["status"]);
  });

  it("shows the file, host count and errors", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get: vi.fn(async () => ({ data: status })) } as never,
    });
    rendered.renderSettingsComponent("status", { running: true });
    expect(await screen.findByText("File: /config/hosts.yaml")).toBeTruthy();
    expect(screen.getByText(/3 hosts from the file/)).toBeTruthy();
    expect(screen.getByText(status.errors[0])).toBeTruthy();
  });
});
