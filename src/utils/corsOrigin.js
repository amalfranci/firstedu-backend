const PRIVATE_LAN_HOST =
  /^(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/;

const DEFAULT_ORIGINS = [
  "https://iscorre.com",
  "https://www.iscorre.com",
  "https://app.iscorre.com",
  "https://www.app.iscorre.com",
  "http://localhost:3000",
  "http://localhost:5174",
  "http://localhost:5173",
  "http://localhost:5175",
  "https://testladr.com",
  "https://www.testladr.com",
  "https://admin.testladr.com",
  "https://www.admin.testladr.com",
];

/** www and non-www variants of the same host (e.g. iscorre.com ↔ www.iscorre.com). */
function originAliases(origin) {
  try {
    const u = new URL(origin);
    const aliases = [origin];
    if (u.hostname.startsWith("www.")) {
      aliases.push(`${u.protocol}//${u.hostname.slice(4)}`);
    } else {
      aliases.push(`${u.protocol}//www.${u.hostname}`);
    }
    return aliases;
  } catch {
    return [origin];
  }
}

export function getAllowedCorsOrigins() {
  const fromEnv = process.env.CORS_ORIGIN?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return fromEnv?.length ? fromEnv : DEFAULT_ORIGINS;
}

/** Allow explicit list + www/non-www alias + private-LAN in non-production. */
export function isCorsOriginAllowed(origin) {
  if (!origin) return true;

  const allowed = getAllowedCorsOrigins();
  if (allowed.includes(origin)) return true;

  const aliases = originAliases(origin);
  if (aliases.some((a) => allowed.includes(a))) return true;

  if (process.env.NODE_ENV === "production") return false;

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return PRIVATE_LAN_HOST.test(hostname);
  } catch {
    return false;
  }
}
