/**
 * Writes a plan through ctx.hosts. A file id keeps its Termix host across
 * reloads, so shares, recordings and history stay attached. Ids gone from the
 * file are deleted. A failed write is reported and the rest still applies;
 * the next reload fixes it since every id is stable.
 */

import type {
  PluginContext,
  PluginHostUpdateInput,
} from "@termix-ssh/plugin-sdk/backend";
import type { PlannedHost } from "./plan.js";

export interface MapRow {
  configId: string;
  hostId: number;
  ownerId: string;
}

export interface MapStore {
  list: () => Promise<MapRow[]>;
  put: (row: MapRow) => Promise<void>;
  remove: (configId: string) => Promise<void>;
}

export interface ApplyReport {
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

type Ctx = Pick<PluginContext, "hosts" | "asUser">;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function applyPlan(
  ctx: Ctx,
  store: MapStore,
  plan: PlannedHost[],
): Promise<ApplyReport> {
  const report: ApplyReport = {
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  };
  const rows = new Map((await store.list()).map((row) => [row.configId, row]));
  const wanted = new Map(plan.map((host) => [host.configId, host]));

  const remove = async (row: MapRow) => {
    try {
      await ctx.asUser(row.ownerId, () => ctx.hosts.delete(row.hostId));
      await store.remove(row.configId);
      rows.delete(row.configId);
      report.deleted++;
    } catch (error) {
      report.errors.push(
        `${row.configId}: could not delete (${message(error)})`,
      );
    }
  };

  // Gone from the file, or moved to another owner (recreated below).
  for (const row of [...rows.values()]) {
    const next = wanted.get(row.configId);
    if (!next || next.ownerId !== row.ownerId) await remove(row);
  }

  const hostIds = new Map<string, number>();
  for (const row of rows.values()) hostIds.set(row.configId, row.hostId);
  const jumpHostsFor = (host: PlannedHost) =>
    host.jumpHosts.every((id) => hostIds.has(id))
      ? host.jumpHosts.map((id) => ({ hostId: hostIds.get(id) as number }))
      : undefined;

  const written: PlannedHost[] = [];
  const needsJumpHosts = new Set<string>();
  for (const host of plan) {
    try {
      await ctx.asUser(host.ownerId, async () => {
        const existing = rows.get(host.configId);
        // Pins stay the user's own after the first load.
        const { pin: _pin, ...rest } = host.input;
        const jumpHosts = jumpHostsFor(host);
        if (!jumpHosts) needsJumpHosts.add(host.configId);
        if (existing) {
          const patch: PluginHostUpdateInput = { ...rest };
          if (jumpHosts) patch.jumpHosts = jumpHosts;
          const updated = await ctx.hosts.update(existing.hostId, patch);
          if (updated) {
            report.updated++;
            return;
          }
          // Deleted outside the file, so it comes back as a new host.
          await store.remove(host.configId);
        }
        const created = await ctx.hosts.create({
          ...host.input,
          ...(jumpHosts ? { jumpHosts } : {}),
        });
        hostIds.set(host.configId, created.id);
        await store.put({
          configId: host.configId,
          hostId: created.id,
          ownerId: host.ownerId,
        });
        report.created++;
      });
      written.push(host);
    } catch (error) {
      report.errors.push(`${host.configId}: ${message(error)}`);
    }
  }

  for (const host of written) {
    const hostId = hostIds.get(host.configId) as number;
    try {
      await ctx.asUser(host.ownerId, async () => {
        if (needsJumpHosts.has(host.configId)) {
          const missing = host.jumpHosts.filter((id) => !hostIds.has(id));
          if (missing.length > 0) {
            throw new Error(`jump hosts not written: ${missing.join(", ")}`);
          }
          await ctx.hosts.update(hostId, {
            jumpHosts: host.jumpHosts.map((id) => ({
              hostId: hostIds.get(id) as number,
            })),
          });
        }
        const shared = await ctx.hosts.setShares(hostId, host.shares);
        if (!shared.shared) {
          throw new Error(`sharing refused (${shared.reason ?? "unknown"})`);
        }
      });
    } catch (error) {
      report.errors.push(`${host.configId}: ${message(error)}`);
    }
  }

  return report;
}
