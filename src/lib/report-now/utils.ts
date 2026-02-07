// /var/www/vps-sentry-web/src/lib/report-now/utils.ts

import { promises as fs } from "node:fs";

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function readJsonSafe<T = unknown>(path: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(path, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

export function safeNum(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export function isoOrDash(s?: string): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(s);
}

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function firstLines(input: string, maxLines: number): string {
  return input.split("\n").slice(0, maxLines).join("\n");
}
