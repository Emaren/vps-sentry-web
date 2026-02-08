#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = parseArgs(process.argv.slice(2));
const lsPath = args["ls-json"];
const sbomPath = args["sbom"];
const reportPath = args["report"];
const denyRegexValue = args["deny-regex"] ?? "";
const failUnknown = toBool(args["fail-unknown"] ?? process.env.VPS_SUPPLYCHAIN_FAIL_UNKNOWN_LICENSE ?? "0");

if (!lsPath) {
  console.error("[supply] missing required --ls-json path");
  process.exit(2);
}

if (!sbomPath && !reportPath) {
  console.error("[supply] provide at least one output path: --sbom and/or --report");
  process.exit(2);
}

const raw = fs.readFileSync(lsPath, "utf8");
let tree;
try {
  tree = JSON.parse(raw);
} catch (err) {
  console.error(`[supply] unable to parse ls json: ${stringifyError(err)}`);
  process.exit(2);
}

if (!Array.isArray(tree) || tree.length === 0 || !tree[0] || typeof tree[0] !== "object") {
  console.error("[supply] unexpected pnpm ls structure");
  process.exit(2);
}

const root = tree[0];
const denyRegex = denyRegexValue.trim() ? new RegExp(denyRegexValue, "i") : null;

const componentMap = new Map();
const dependencyEdges = new Map();
const walkSeen = new Set();

function addEdge(parentRef, childRef) {
  if (!parentRef || !childRef) return;
  if (!dependencyEdges.has(parentRef)) {
    dependencyEdges.set(parentRef, new Set());
  }
  dependencyEdges.get(parentRef).add(childRef);
}

function normalizeLicense(rawLicense) {
  if (!rawLicense) return "";
  if (typeof rawLicense === "string") return rawLicense.trim();
  if (Array.isArray(rawLicense)) {
    return rawLicense
      .map((item) => normalizeLicense(item))
      .filter(Boolean)
      .join(" OR ");
  }
  if (typeof rawLicense === "object") {
    if (typeof rawLicense.type === "string") return rawLicense.type.trim();
    if (typeof rawLicense.name === "string") return rawLicense.name.trim();
  }
  return "";
}

function readLicenseFromPackageJson(depPath) {
  if (!depPath) return "";
  const pkgPath = path.join(depPath, "package.json");
  if (!fs.existsSync(pkgPath)) return "";
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const primary = normalizeLicense(pkg.license);
    if (primary) return primary;
    const secondary = normalizeLicense(pkg.licenses);
    return secondary || "";
  } catch {
    return "";
  }
}

function componentKey(name, version) {
  return `${name}@${version || "0.0.0-unknown"}`;
}

function componentRef(name, version) {
  const safeVersion = version || "0.0.0-unknown";
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(safeVersion)}`;
}

function walkDeps(parentRef, depMap) {
  if (!depMap || typeof depMap !== "object") return;
  for (const [depName, depValue] of Object.entries(depMap)) {
    if (!depValue || typeof depValue !== "object") continue;
    const depVersion = String(depValue.version || "0.0.0-unknown");
    const key = componentKey(depName, depVersion);
    const ref = componentRef(depName, depVersion);
    const visitKey = `${depValue.path || "no-path"}::${key}`;
    addEdge(parentRef, ref);

    if (!componentMap.has(key)) {
      const license = readLicenseFromPackageJson(depValue.path);
      componentMap.set(key, {
        name: depName,
        version: depVersion,
        ref,
        path: depValue.path || "",
        resolved: depValue.resolved || "",
        license: license || "UNKNOWN",
      });
    }

    if (walkSeen.has(visitKey)) continue;
    walkSeen.add(visitKey);
    walkDeps(ref, depValue.dependencies);
  }
}

const rootName = String(root.name || "vps-sentry-web");
const rootVersion = String(root.version || "0.0.0");
const rootRef = componentRef(rootName, rootVersion);
walkDeps(rootRef, root.dependencies);

const components = Array.from(componentMap.values()).sort((a, b) => {
  if (a.name === b.name) return a.version.localeCompare(b.version);
  return a.name.localeCompare(b.name);
});

const licenseCounts = new Map();
const deniedPackages = [];
const unknownPackages = [];

for (const component of components) {
  const license = component.license || "UNKNOWN";
  const count = licenseCounts.get(license) || 0;
  licenseCounts.set(license, count + 1);
  if (license === "UNKNOWN") {
    unknownPackages.push(`${component.name}@${component.version}`);
  }
  if (denyRegex && denyRegex.test(license)) {
    deniedPackages.push({
      package: `${component.name}@${component.version}`,
      license,
    });
  }
}

const licenseSummary = Object.fromEntries(
  Array.from(licenseCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
);

if (reportPath) {
  const report = {
    generatedAt: new Date().toISOString(),
    packageManager: "pnpm",
    root: {
      name: rootName,
      version: rootVersion,
      path: root.path || "",
    },
    totals: {
      uniquePackages: components.length,
      deniedLicenses: deniedPackages.length,
      unknownLicenses: unknownPackages.length,
    },
    licenseCounts: licenseSummary,
    deniedPackages,
    unknownPackages,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (sbomPath) {
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: "vps-sentry",
          name: "supply-chain-report",
          version: "1.0.0",
        },
      ],
      component: {
        type: "application",
        name: rootName,
        version: rootVersion,
        "bom-ref": rootRef,
        purl: rootRef,
      },
    },
    components: components.map((component) => ({
      type: "library",
      name: component.name,
      version: component.version,
      "bom-ref": component.ref,
      purl: component.ref,
      licenses: component.license && component.license !== "UNKNOWN"
        ? [{ license: { id: component.license } }]
        : [{ license: { name: "UNKNOWN" } }],
      properties: [
        { name: "vps-sentry:path", value: component.path || "" },
        { name: "vps-sentry:resolved", value: component.resolved || "" },
      ],
    })),
    dependencies: [
      {
        ref: rootRef,
        dependsOn: Array.from(dependencyEdges.get(rootRef) || []).sort(),
      },
      ...components.map((component) => ({
        ref: component.ref,
        dependsOn: Array.from(dependencyEdges.get(component.ref) || []).sort(),
      })),
    ],
  };
  fs.mkdirSync(path.dirname(sbomPath), { recursive: true });
  fs.writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
}

console.log(`[supply] unique_packages:${components.length}`);
console.log(`[supply] denied_licenses:${deniedPackages.length}`);
console.log(`[supply] unknown_licenses:${unknownPackages.length}`);

if (deniedPackages.length > 0) {
  for (const item of deniedPackages.slice(0, 25)) {
    console.error(`[supply] denied:${item.package} license=${item.license}`);
  }
  process.exit(1);
}

if (failUnknown && unknownPackages.length > 0) {
  for (const pkg of unknownPackages.slice(0, 25)) {
    console.error(`[supply] unknown:${pkg}`);
  }
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "1";
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function toBool(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function stringifyError(err) {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return JSON.stringify(err);
}
