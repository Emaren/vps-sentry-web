import type { AppRole } from "@/lib/rbac-policy";

export type ScriptActionEntry = {
  script: string;
  title: string;
  summary: string;
  requiredRole: AppRole;
};

// Explicit allowlist: only these scripts may be invoked from the web Actions page.
export const SCRIPT_ACTIONS: ScriptActionEntry[] = [
  {
    script: "abuse-closeout",
    title: "Abuse closeout",
    summary: "Generate a closeout summary for abuse-response evidence.",
    requiredRole: "admin",
  },
  {
    script: "context-hygiene",
    title: "Context hygiene",
    summary: "Repairs missing checksums and normalizes context archive hygiene.",
    requiredRole: "ops",
  },
  {
    script: "context-overlap",
    title: "Context overlap",
    summary: "Compares ZIP/TGZ overlap and recommends ZIP-only vs BOTH.",
    requiredRole: "ops",
  },
  {
    script: "context-prune-latest",
    title: "Prune context latest",
    summary: "Keeps only the newest archive set per series.",
    requiredRole: "ops",
  },
  {
    script: "dev-doctor",
    title: "Dev doctor",
    summary: "Runs local diagnostics for common environment and tool issues.",
    requiredRole: "ops",
  },
  {
    script: "full-context",
    title: "Full context (legacy zip flow)",
    summary: "Legacy wrapper for context generation workflow.",
    requiredRole: "ops",
  },
  {
    script: "full-context-all",
    title: "Full context all",
    summary: "One-shot ZIP+TGZ generation for envs and projects.",
    requiredRole: "ops",
  },
  {
    script: "full-context-tgz",
    title: "Full context TGZ",
    summary: "TGZ-focused context sweep for envs and projects.",
    requiredRole: "ops",
  },
  {
    script: "git-guard",
    title: "Git guard",
    summary: "Checks repo cleanliness and parity guardrails before sync/deploy.",
    requiredRole: "ops",
  },
  {
    script: "help-context",
    title: "Help context",
    summary: "Prints context command usage matrix and quick help.",
    requiredRole: "viewer",
  },
  {
    script: "install-git-guards",
    title: "Install git guards",
    summary: "Installs git hooks/guards for safer local workflows.",
    requiredRole: "owner",
  },
  {
    script: "mbp-context",
    title: "MBP context ZIP",
    summary: "Captures MBP environment context as ZIP+SHA.",
    requiredRole: "ops",
  },
  {
    script: "mbp-context-tgz",
    title: "MBP context TGZ",
    summary: "Captures MBP environment context as TGZ+SHA.",
    requiredRole: "ops",
  },
  {
    script: "project-context-tgz",
    title: "Project context TGZ engine",
    summary: "Shared TGZ packager for project source snapshots.",
    requiredRole: "ops",
  },
  {
    script: "sync-audit",
    title: "Sync audit",
    summary: "Audits MBP/VPS/Git branch, dirty state, and commit parity.",
    requiredRole: "ops",
  },
  {
    script: "vps-pull-context",
    title: "VPS pull context",
    summary: "Generates VPS contexts and pulls newest bundles to MBP.",
    requiredRole: "ops",
  },
  {
    script: "vps-tunnel-check",
    title: "VPS tunnel check",
    summary: "Verifies reverse-tunnel path and MBP target reachability.",
    requiredRole: "ops",
  },
  {
    script: "vps-context",
    title: "VPS context ZIP",
    summary: "Captures VPS environment context as ZIP+SHA.",
    requiredRole: "ops",
  },
  {
    script: "vps-context-tgz",
    title: "VPS context TGZ",
    summary: "Captures VPS environment context as TGZ+SHA (or ZIP+TGZ).",
    requiredRole: "ops",
  },
  {
    script: "aoe2hdbets-context",
    title: "AoE2HDBets context ZIP",
    summary: "Packages AoE2HDBets project context as ZIP+SHA.",
    requiredRole: "ops",
  },
  {
    script: "aoe2hdbets-context-tgz",
    title: "AoE2HDBets context TGZ",
    summary: "Packages AoE2HDBets project context as TGZ+SHA.",
    requiredRole: "ops",
  },
  {
    script: "llama-context",
    title: "Llama context ZIP",
    summary: "Packages Llama project context as ZIP+SHA.",
    requiredRole: "ops",
  },
  {
    script: "llama-context-tgz",
    title: "Llama context TGZ",
    summary: "Packages Llama project context as TGZ+SHA.",
    requiredRole: "ops",
  },
  {
    script: "redlinelegal-context",
    title: "RedlineLegal context ZIP",
    summary: "Packages RedlineLegal project context as ZIP+SHA.",
    requiredRole: "ops",
  },
  {
    script: "redlinelegal-context-tgz",
    title: "RedlineLegal context TGZ",
    summary: "Packages RedlineLegal project context as TGZ+SHA.",
    requiredRole: "ops",
  },
  {
    script: "tokentap-context",
    title: "TokenTap context ZIP",
    summary: "Packages TokenTap project context as ZIP+SHA.",
    requiredRole: "ops",
  },
  {
    script: "tokentap-context-tgz",
    title: "TokenTap context TGZ",
    summary: "Packages TokenTap project context as TGZ+SHA.",
    requiredRole: "ops",
  },
  {
    script: "vpssentry-context",
    title: "VPSSentry context ZIP",
    summary: "Packages VPSSentry project context as ZIP+SHA.",
    requiredRole: "ops",
  },
  {
    script: "vpssentry-context-tgz",
    title: "VPSSentry context TGZ",
    summary: "Packages VPSSentry project context as TGZ+SHA.",
    requiredRole: "ops",
  },
  {
    script: "wheatandstone-context",
    title: "WheatAndStone context ZIP",
    summary: "Packages WheatAndStone project context as ZIP+SHA.",
    requiredRole: "ops",
  },
  {
    script: "wheatandstone-context-tgz",
    title: "WheatAndStone context TGZ",
    summary: "Packages WheatAndStone project context as TGZ+SHA.",
    requiredRole: "ops",
  },
];

export const SCRIPT_ACTIONS_BY_NAME = new Map(
  SCRIPT_ACTIONS.map((entry) => [entry.script, entry] as const)
);
