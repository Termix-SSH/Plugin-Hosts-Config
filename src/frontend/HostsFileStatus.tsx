import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  usePluginApi,
  useTranslation,
  type SettingsComponentProps,
} from "@termix-ssh/plugin-sdk/frontend";
import { Button } from "@termix-ssh/plugin-sdk/ui";

export interface HostsFileStatusData {
  enabled: boolean;
  path: string | null;
  strict: boolean;
  hosts: number;
  lastLoadedAt: string | null;
  lastAttemptAt: string | null;
  errors: string[];
  applyErrors: string[];
  warnings: string[];
  lastResult: { created: number; updated: number; deleted: number } | null;
}

function errorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { error?: string } } })?.response
    ?.data;
  if (data?.error) return data.error;
  return error instanceof Error ? error.message : String(error);
}

function Lines({ items, className }: { items: string[]; className: string }) {
  return (
    <ul className={`flex flex-col gap-0.5 text-[10px] ${className}`}>
      {items.map((item, i) => (
        <li key={i} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function HostsFileStatus({ running }: SettingsComponentProps) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const [status, setStatus] = useState<HostsFileStatusData | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<HostsFileStatusData>("/status");
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [api]);

  useEffect(() => {
    if (running) void load();
  }, [running, load]);

  async function reload() {
    setReloading(true);
    try {
      const { data } = await api.post<HostsFileStatusData>("/reload");
      setStatus(data);
      if (data.errors.length > 0) toast.error(t("status.notApplied"));
      else toast.success(t("status.applied"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setReloading(false);
    }
  }

  if (status && !status.enabled) {
    return (
      <div className="flex flex-col gap-1 border border-border bg-background/50 p-2">
        <span className="text-xs font-medium">{t("status.title")}</span>
        <span className="text-[10px] text-muted-foreground">
          {t("status.notSet")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border border-border bg-background/50 p-2">
      <span className="text-xs font-medium">{t("status.title")}</span>
      {status && (
        <>
          <span className="text-[10px] text-muted-foreground break-all">
            {t("status.file", { path: status.path })}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("status.hosts", { count: status.hosts })}
            {status.strict ? ` | ${t("status.strict")}` : ""}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {status.lastLoadedAt
              ? t("status.lastLoaded", {
                  date: new Date(status.lastLoadedAt).toLocaleString(),
                })
              : t("status.neverLoaded")}
          </span>
          {status.errors.length > 0 && (
            <>
              <span className="text-[10px] text-destructive">
                {t("status.errorsTitle")}
              </span>
              <Lines items={status.errors} className="text-destructive" />
            </>
          )}
          {status.applyErrors.length > 0 && (
            <>
              <span className="text-[10px] text-destructive">
                {t("status.applyErrorsTitle")}
              </span>
              <Lines items={status.applyErrors} className="text-destructive" />
            </>
          )}
          {status.warnings.length > 0 && (
            <Lines items={status.warnings} className="text-muted-foreground" />
          )}
        </>
      )}
      <Button
        type="button"
        variant="outline"
        className="rounded-none self-start"
        disabled={!running || reloading}
        onClick={reload}
      >
        {reloading ? t("status.reloading") : t("status.reload")}
      </Button>
    </div>
  );
}
