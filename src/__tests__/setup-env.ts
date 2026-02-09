const LOCAL_APP_URL = "http://localhost:3036";
const LOCAL_DB_URL = "file:./prisma/dev.db";

function isInvalidEnvString(v: string | undefined): boolean {
  if (typeof v !== "string") return true;
  const s = v.trim();
  return s.length === 0 || s === "[object Object]" || s === "undefined" || s === "null";
}

if (isInvalidEnvString(process.env.NEXT_PUBLIC_APP_URL)) {
  process.env.NEXT_PUBLIC_APP_URL = LOCAL_APP_URL;
}

if (isInvalidEnvString(process.env.APP_URL)) {
  process.env.APP_URL = LOCAL_APP_URL;
}

if (isInvalidEnvString(process.env.NEXTAUTH_URL)) {
  process.env.NEXTAUTH_URL = LOCAL_APP_URL;
}

if (isInvalidEnvString(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = LOCAL_DB_URL;
}

if (!process.env.DD_TRACE_ENABLED) {
  process.env.DD_TRACE_ENABLED = "false";
}
