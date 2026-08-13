import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const apiRoot = path.resolve(srcDir, "..");
export const repoRoot = path.resolve(apiRoot, "../..");

dotenv.config({ path: path.join(apiRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, ".env") });

export const PORT = Number(process.env.PORT || 8787);
export const WEB_ORIGIN = (process.env.WEB_ORIGIN || "http://localhost:5173").replace(
  /\/$/,
  "",
);
export const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? "";
export const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? "";
export const STRAVA_REDIRECT_URI =
  process.env.STRAVA_REDIRECT_URI ||
  `${WEB_ORIGIN}/api/auth/strava/callback`;
export const TOKEN_PATH = path.join(apiRoot, ".strava-tokens.json");

export function stravaConfigured(): boolean {
  return Boolean(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET);
}
