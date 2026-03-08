export type ProjectService = {
  label: string;
  port: number;
  required?: boolean;
};

export type ProjectDef = {
  key: string;
  name: string;
  subtitle: string;
  href?: string;
  backendHref?: string;
  services: ProjectService[];
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
    name: "AoE2HDBets",
    subtitle: "api-prodn.aoe2hdbets.com",
    href: "https://aoe2hdbets.com",
    backendHref: "https://api-prodn.aoe2hdbets.com",
    services: [
      { label: "web", port: 3030, required: true },
      { label: "api", port: 3330, required: true },
    ],
  },
  {
    key: "4o",
    name: "4o API",
    subtitle: "api.4o.tokentap.ca",
    href: "https://api.4o.tokentap.ca",
    services: [{ label: "api", port: 3380, required: true }],
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
];
