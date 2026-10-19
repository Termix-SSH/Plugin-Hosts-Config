import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { HostsFileStatus } from "./HostsFileStatus";

export function activate(app: TermixApp): void {
  app.registerSettingsComponent("status", HostsFileStatus);
}

export function deactivate(): void {
  // Registrations through app are disposed by core.
}
