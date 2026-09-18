import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const unitSource = fs.readFileSync(path.join(root, "scripts/vps-ops-worker-service.sh"), "utf8");

const expected = {
  next: "16.3.5",
  react: "19.2.4",
  "react-dom": "19.2.4",
};
for (const [name, version] of Object.entries(expected)) {
  if (pkg.dependencies?.[name] !== version) {
    throw new Error(`${name} must be pinned to ${version}; found ${pkg.dependencies?.[name] ?? "missing"}`);
  }
}

const requiredWorkerDirectives = [
  "NoNewPrivileges=true",
  "PrivateTmp=true",
  "PrivateDevices=true",
  "ProtectSystem=strict",
  "ProtectHome=read-only",
  "ProtectKernelTunables=true",
  "ProtectKernelModules=true",
  "ProtectControlGroups=true",
  "CapabilityBoundingSet=",
  "AmbientCapabilities=",
  "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
];
for (const directive of requiredWorkerDirectives) {
  if (!unitSource.includes(directive)) {
    throw new Error(`ops worker hardening directive missing: ${directive}`);
  }
}

console.log("VPSSentry security posture PASS");
