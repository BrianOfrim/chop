import {
  STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET,
  STRAVA_REDIRECT_URI,
} from "./env.ts";
import {
  readTokens,
  writeTokens,
  type StoredTokens,
  type StravaAthlete,
} from "./tokens.ts";

const STRAVA_OAUTH = "https://www.strava.com/oauth/token";
const STRAVA_API = "https://www.strava.com/api/v3";
const REFRESH_SKEW_SEC = 5 * 60;

export class StravaHttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "StravaHttpError";
    this.status = status;
    this.body = body;
  }
}

type TokenResponse = {
  token_type?: string;
  expires_at: number;
  expires_in?: number;
  refresh_token: string;
  access_token: string;
  athlete?: StravaAthlete;
};

function athleteFromUnknown(value: unknown): StravaAthlete | undefined {
  if (!value || typeof value !== "object") return undefined;
  const a = value as Record<string, unknown>;
  if (typeof a.id !== "number") return undefined;
  return {
    id: a.id,
    firstname: typeof a.firstname === "string" ? a.firstname : undefined,
    lastname: typeof a.lastname === "string" ? a.lastname : undefined,
  };
}

function tokensFromResponse(
  data: TokenResponse,
  prevAthlete?: StravaAthlete,
): StoredTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athlete: athleteFromUnknown(data.athlete) ?? prevAthlete,
  };
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function authorizeUrl(): string {
  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    redirect_uri: STRAVA_REDIRECT_URI,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<StoredTokens> {
  const res = await fetch(STRAVA_OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  const body = await parseJson(res);
  if (!res.ok) {
    throw new StravaHttpError(
      res.status,
      "Strava token exchange failed",
      body,
    );
  }
  const data = body as TokenResponse;
  const tokens = tokensFromResponse(data);
  await writeTokens(tokens);
  return tokens;
}

async function refresh(tokens: StoredTokens): Promise<StoredTokens> {
  const res = await fetch(STRAVA_OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await parseJson(res);
  if (!res.ok) {
    throw new StravaHttpError(res.status, "Strava token refresh failed", body);
  }
  const next = tokensFromResponse(body as TokenResponse, tokens.athlete);
  await writeTokens(next);
  return next;
}

export async function getValidTokens(): Promise<StoredTokens | null> {
  const tokens = await readTokens();
  if (!tokens) return null;
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt - now > REFRESH_SKEW_SEC) return tokens;
  return refresh(tokens);
}

export async function stravaGet<T>(path: string): Promise<T> {
  const tokens = await getValidTokens();
  if (!tokens) {
    throw new StravaHttpError(401, "Not connected to Strava");
  }
  const res = await fetch(`${STRAVA_API}${path}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const body = await parseJson(res);
  if (!res.ok) {
    throw new StravaHttpError(
      res.status,
      `Strava request failed (${res.status})`,
      body,
    );
  }
  return body as T;
}
