import type { Status } from "@/lib/status";

export type DashboardEnv = {
  ok: boolean;
  ts?: string;
  diff?: unknown;
  raw: unknown;
  last: Status;
};

export type DashboardBilling = {
  plan?: string | null;
  hostLimit?: number | null;
  stripeCustomerId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionId?: string | null;
  currentPeriodEnd?: string | Date | null;
} | null;
