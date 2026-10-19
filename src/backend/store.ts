import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { MapRow, MapStore } from "./apply.js";

// The table object ctx.db.define hands back. Drizzle's own types are per
// dialect, so it is treated loosely.
type HostsTable = any;

export function createMapStore(
  ctx: PluginContext,
  table: HostsTable,
): MapStore {
  const client = () => ctx.db.client<BetterSQLite3Database>();
  return {
    list: async () => {
      const db = await client();
      const rows = await db.select().from(table);
      return rows.map((row: Record<string, unknown>): MapRow => ({
        configId: String(row.configId),
        hostId: Number(row.hostId),
        ownerId: String(row.ownerId),
      }));
    },
    put: async (row) => {
      const db = await client();
      await db.delete(table).where(eq(table.configId, row.configId));
      await db.insert(table).values(row);
      await ctx.db.persist();
    },
    remove: async (configId) => {
      const db = await client();
      await db.delete(table).where(eq(table.configId, configId));
      await ctx.db.persist();
    },
  };
}
