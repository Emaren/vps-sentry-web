export type ProjectService = {
  label: string;
  port: number;
  required?: boolean;
};

export type ProjectDef = {
  key: string;
  displayKey?: string;
  name: string;
  subtitle: string;
  href?: string;
  backendHref?: string;
  state?: "live" | "dormant";
  services: ProjectService[];
  storage?: {
    localRoots?: string[];
    vpsRoots?: string[];
    contextRoots?: string[];
    residencyHint?: "root_disk" | "mounted_volume" | "symlinked_to_volume" | "mixed";
  };
};

export const MAIN_PROJECTS: ProjectDef[] = [
  {
    key: "vps-sentry",
    name: "VPS Sentry",
    subtitle: "vps-sentry.tokentap.ca/api/status",
    href: "https://vps-sentry.tokentap.ca",
    backendHref: "https://vps-sentry.tokentap.ca/api/status",
    services: [{ label: "web", port: 3035, required: true }],
  },
  {
    key: "aoe2hdbets",
    displayKey: "aoe2war",
    name: "AoE2War",
    subtitle: "api-prodn.aoe2war.com",
    href: "https://aoe2war.com",
    backendHref: "https://api-prodn.aoe2war.com",
    services: [
      { label: "web", port: 3030, required: true },
      { label: "api", port: 3330, required: true },
    ],
    storage: {
      localRoots: ["~/projects/AoE2HDBets"],
      vpsRoots: ["/var/www/AoE2HDBets"],
      contextRoots: ["~/projects/AoE2HDBets/aoe2-watcher"],
      residencyHint: "root_disk",
    },
  },
  {
    key: "aoe2dewarwagers",
    name: "AoE2DEWarWagers",
    subtitle: "api-prodn.aoe2dewarwagers.com",
    href: "https://aoe2dewarwagers.com",
    backendHref: "https://api-prodn.aoe2dewarwagers.com",
    services: [
      { label: "web", port: 4000, required: true },
      { label: "api", port: 4400, required: true },
    ],
    storage: {
      localRoots: ["~/projects/AoE2DEWarWagers"],
      vpsRoots: ["/var/www/AoE2DEWarWagers"],
      contextRoots: [
        "~/projects/AoE2DEWarWagers",
        "~/projects/AoE2DEWarWagers/aoe2de-watcher",
      ],
      residencyHint: "symlinked_to_volume",
    },
  },
  {
    key: "wolochain",
    name: "WoloChain",
    subtitle: "wolo chain rest/rpc",
    services: [
      { label: "rest", port: 1317, required: true },
      { label: "rpc", port: 26657, required: true },
    ],
  },
  {
    key: "wheatandstone",
    name: "Wheat & Stone",
    subtitle: "api.wheatandstone.ca",
    href: "https://wheatandstone.ca",
    backendHref: "https://api.wheatandstone.ca",
    services: [
      { label: "web", port: 3010, required: true },
      { label: "api", port: 3310, required: true },
    ],
  },
  {
    key: "tokentap",
    name: "TokenTap",
    subtitle: "api.tokentap.ca",
    href: "https://tokentap.ca",
    backendHref: "https://api.tokentap.ca",
    services: [
      { label: "web", port: 3020, required: true },
      { label: "api", port: 3320, required: true },
    ],
  },
  {
    key: "tokenchain",
    name: "TokenChain",
    subtitle: "tokenchain core services",
    services: [
      { label: "web", port: 3021, required: true },
      { label: "p2p", port: 26656, required: true },
    ],
  },
  {
    key: "tokenchain-bigdipper",
    name: "TokenChain BigDipper",
    subtitle: "tokenchain explorer",
    services: [
      { label: "web", port: 3032, required: true },
      { label: "worker", port: 37891 },
    ],
  },
  {
    key: "tokenchain-indexer",
    name: "TokenChain Indexer",
    subtitle: "tokenchain indexer",
    services: [{ label: "api", port: 3321, required: true }],
  },
  {
    key: "llama",
    name: "Llama",
    subtitle: "llama-api.tokentap.ca",
    href: "https://llama.tokentap.ca",
    backendHref: "https://llama-api.tokentap.ca",
    services: [
      { label: "api", port: 3360, required: true },
      { label: "chat-api", port: 3350, required: true },
      { label: "landing", port: 3070 },
    ],
  },
  {
    key: "pulse",
    name: "Pulse",
    subtitle: "api.pulse.tokentap.ca",
    href: "https://pulse.tokentap.ca",
    backendHref: "https://api.pulse.tokentap.ca",
    services: [
      { label: "web", port: 3090, required: true },
      { label: "api", port: 3390, required: true },
    ],
  },
  {
    key: "redlinelegal",
    name: "Redline Legal",
    subtitle: "api.redlinelegal.ca",
    href: "https://redlinelegal.ca",
    backendHref: "https://api.redlinelegal.ca",
    services: [
      { label: "web", port: 3040, required: true },
      { label: "api", port: 3340, required: true },
    ],
  },
  {
    key: "tmail",
    name: "TMail",
    subtitle: "tmail.tokentap.ca",
    href: "https://tmail.tokentap.ca",
    backendHref: "https://tmail-api.tokentap.ca",
    services: [
      { label: "web", port: 3100, required: true },
      { label: "api", port: 3400, required: true },
    ],
  },
  {
    key: "traffic",
    name: "Traffic",
    subtitle: "traffic.tokentap.ca/api/overview",
    href: "https://traffic.tokentap.ca",
    backendHref: "https://traffic.tokentap.ca/api/overview",
    services: [
      { label: "web", port: 3045, required: true },
      { label: "api", port: 3345, required: true },
    ],
  },
  {
    key: "wallygotchi",
    name: "Wallygotchi",
    subtitle: "pending deploy",
    state: "dormant",
    services: [],
  },
  {
    key: "wallyverse",
    name: "Wallyverse",
    subtitle: "api.wallyverse.tokentap.ca/health",
    href: "https://wallyverse.tokentap.ca",
    backendHref: "https://api.wallyverse.tokentap.ca/health",
    services: [
      { label: "web", port: 3110, required: true },
      { label: "api", port: 3410, required: true },
    ],
  },
  {
    key: "4o",
    name: "4o API",
    subtitle: "api.4o.tokentap.ca",
    href: "https://api.4o.tokentap.ca",
    services: [{ label: "api", port: 3380, required: true }],
  },
];
