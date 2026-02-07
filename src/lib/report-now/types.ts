// /var/www/vps-sentry-web/src/lib/report-now/types.ts

export type StatusJson = {
  ts?: string;
  host?: string;
  version?: string;
  baseline_last_accepted_ts?: string;

  alerts_count?: number;
  public_ports_count?: number;

  auth?: {
    ssh_failed_password?: number;
    ssh_invalid_user?: number;
  };

  alerts?: Array<{ title?: string; detail?: string }>;

  ports_public?: Array<{
    proto?: string;
    host?: string;
    port?: number;
    proc?: string;
    pid?: number;
  }>;
};

export type SeverityHeadline = "ACTION NEEDED" | "REVIEW" | "OK";
export type SeverityTone = "bad" | "warn" | "ok";

export type Severity = {
  headline: SeverityHeadline;
  emoji: string;
  tone: SeverityTone;
};
