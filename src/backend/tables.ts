import {
  defineTable,
  id,
  refHost,
  refUser,
  varchar,
} from "@termix-ssh/plugin-sdk/db";

// Stored as p_hosts_config_hosts: which Termix host each file id became, so a
// reload updates the same host. The row goes with the host when it is deleted.
export const managedHosts = defineTable(
  "hosts",
  {
    id: id(),
    configId: varchar(100).notNull(),
    hostId: refHost(),
    ownerId: refUser(),
  },
  {
    uniques: [
      { name: "uq_p_hosts_config_hosts_config_id", columns: ["configId"] },
    ],
    indexes: [
      { name: "idx_p_hosts_config_hosts_host_id", columns: ["hostId"] },
    ],
  },
);

// termix-plugin migrations reads this list.
export const tables = [managedHosts];
