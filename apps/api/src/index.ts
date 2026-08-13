import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  PORT,
  WEB_ORIGIN,
  stravaConfigured,
} from "./env.ts";
import {
  authorizeUrl,
  exchangeCode,
  getValidTokens,
  stravaGet,
  StravaHttpError,
} from "./strava.ts";
import { deleteTokens } from "./tokens.ts";
import {
  fetchActivityTrack,
  summarizeActivity,
  type StravaActivitySummary,
} from "./track.ts";

type ListedActivity = {
  id: number;
  name?: string;
  sport_type?: string;
  type?: string;
  start_date?: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  start_latlng?: unknown;
  end_latlng?: unknown;
};

const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: WEB_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/auth/strava", (c) => {
  if (!stravaConfigured()) {
    return c.json(
      {
        error:
          "Strava is not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env.local.",
      },
      503,
    );
  }
  return c.redirect(authorizeUrl());
});

app.get("/api/auth/strava/callback", async (c) => {
  const err = c.req.query("error");
  if (err) {
    return c.redirect(`${WEB_ORIGIN}/?strava=error`);
  }
  const code = c.req.query("code");
  if (!code) {
    return c.redirect(`${WEB_ORIGIN}/?strava=error`);
  }
  try {
    await exchangeCode(code);
    return c.redirect(`${WEB_ORIGIN}/?strava=connected`);
  } catch (e) {
    console.error(e);
    return c.redirect(`${WEB_ORIGIN}/?strava=error`);
  }
});

app.get("/api/strava/status", async (c) => {
  if (!stravaConfigured()) {
    return c.json({ connected: false, configured: false });
  }
  try {
    const tokens = await getValidTokens();
    if (!tokens) return c.json({ connected: false, configured: true });
    return c.json({
      connected: true,
      configured: true,
      athlete: tokens.athlete ?? null,
    });
  } catch (e) {
    if (e instanceof StravaHttpError && e.status === 401) {
      return c.json({ connected: false, configured: true });
    }
    throw e;
  }
});

app.get("/api/strava/activities", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1) || 1);
  const perPage = Math.min(
    200,
    Math.max(1, Number(c.req.query("per_page") || 50) || 50),
  );
  const rows = await stravaGet<ListedActivity[]>(
    `/athlete/activities?page=${page}&per_page=${perPage}`,
  );
  const activities: StravaActivitySummary[] = rows.map(summarizeActivity);
  return c.json({ page, perPage, activities });
});

app.get("/api/strava/activities/:id/track", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid activity id" }, 400);
  }
  try {
    const track = await fetchActivityTrack(id);
    return c.json(track);
  } catch (e) {
    if (e instanceof Error && e.message === "Activity has no GPS track") {
      return c.json({ error: e.message }, 422);
    }
    throw e;
  }
});

app.post("/api/strava/disconnect", async (c) => {
  await deleteTokens();
  return c.json({ connected: false });
});

app.onError((err, c) => {
  if (err instanceof StravaHttpError) {
    const status = err.status === 401 ? 401 : err.status >= 400 && err.status < 600
      ? err.status
      : 502;
    return c.json(
      { error: err.message, detail: err.body ?? null },
      status as 401 | 400 | 404 | 422 | 502 | 503,
    );
  }
  console.error(err);
  return c.json(
    { error: err instanceof Error ? err.message : "Internal error" },
    500,
  );
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`chop api listening on http://127.0.0.1:${info.port}`);
});
