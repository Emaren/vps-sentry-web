import crypto from "node:crypto";

export type HostTokenBundle = {
  token: string;
  tokenHash: string;
  prefix: string;
};

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function slugifyHostName(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "host";
}

export function buildUniqueSlug(baseSlug: string, attempt: number): string {
  if (attempt <= 0) return baseSlug;
  const suffix = `${attempt + 1}`;
  const maxBase = Math.max(1, 48 - (suffix.length + 1));
  return `${baseSlug.slice(0, maxBase)}-${suffix}`;
}

export function generateHostTokenBundle(): HostTokenBundle {
  const raw = crypto.randomBytes(24).toString("base64url");
  const token = `vs_${raw}`;
  return {
    token,
    tokenHash: sha256(token),
    prefix: `${token.slice(0, 11)}...`,
  };
}

export function buildIngestEndpoint(baseUrl: string, hostId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/hosts/${hostId}/status`;
}

export function buildTestIngestCommand(input: {
  ingestEndpoint: string;
  token: string;
}): string {
  const { ingestEndpoint, token } = input;
  return [
    `curl -fsS -X POST '${ingestEndpoint}' \\`,
    `  -H 'Authorization: Bearer ${token}' \\`,
    "  -H 'Content-Type: application/json' \\",
    "  --data-binary @/var/lib/vps-sentry/public/status.json",
  ].join("\n");
}

export function buildShipHookInstallScript(input: {
  ingestEndpoint: string;
  token: string;
}): string {
  const { ingestEndpoint, token } = input;

  return [
    "sudo tee /usr/local/bin/vps-sentry-push-web >/dev/null <<'EOF'",
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "STATUS='/var/lib/vps-sentry/public/status.json'",
    "if [[ ! -f \"$STATUS\" ]]; then",
    "  exit 0",
    "fi",
    "",
    `INGEST_URL='${ingestEndpoint}'`,
    `TOKEN='${token}'`,
    "",
    "curl -fsS -X POST \"$INGEST_URL\" \\",
    "  -H \"Authorization: Bearer $TOKEN\" \\",
    "  -H \"Content-Type: application/json\" \\",
    "  --data-binary @\"$STATUS\" >/dev/null",
    "EOF",
    "",
    "sudo chmod 0755 /usr/local/bin/vps-sentry-push-web",
    "sudo mkdir -p /etc/systemd/system/vps-sentry.service.d",
    "sudo tee /etc/systemd/system/vps-sentry.service.d/web-ingest.conf >/dev/null <<'EOF'",
    "[Service]",
    "ExecStartPost=-/usr/local/bin/vps-sentry-push-web",
    "EOF",
    "",
    "sudo systemctl daemon-reload",
    "sudo systemctl restart vps-sentry.service",
    "sudo systemctl status vps-sentry.service --no-pager -l",
  ].join("\n");
}
