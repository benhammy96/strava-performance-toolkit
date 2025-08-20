import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import {
  exchangeCodeForToken,
  refreshAccessToken,
  getAthlete,
  getActivities,
} from "./strava.js"; // keep .js for ESM path mapping at runtime
import { predictPerformance } from "./predictor.js"; // <-- NEW

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.STRAVA_CLIENT_ID!;
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI!; // e.g., http://localhost:4000/auth/strava/callback

app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * Start Strava OAuth
 * Optional: ?app_redirect=<your app scheme, e.g. app://auth>
 */
app.get("/auth/strava/start", (req, res) => {
  const appRedirect = String(req.query.app_redirect || "app://auth");
  const scopes = ["read,activity:read_all"];

  const url =
    `https://www.strava.com/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&approval_prompt=auto` +
    `&scope=${scopes.join(",")}` +
    `&state=${encodeURIComponent(appRedirect)}`;

  res.redirect(url);
});

/**
 * OAuth callback from Strava
 * Exchanges code -> tokens, upserts user, deep-links back with ?userId=
 */
app.get("/auth/strava/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const appRedirect =
      typeof req.query.state === "string" && req.query.state.length > 0
        ? req.query.state
        : "app://auth";

    if (!code) return res.status(400).send("Missing code");

    const tokenData = await exchangeCodeForToken(code);
    const { access_token, refresh_token, expires_at, athlete } = tokenData;

    const user = await prisma.user.upsert({
      where: { stravaId: athlete.id },
      update: {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expires_at,
        athleteJson: athlete,
      },
      create: {
        stravaId: athlete.id,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expires_at,
        athleteJson: athlete,
      },
    });

    const glue = appRedirect.includes("?") ? "&" : "?";
    const deepLink = `${appRedirect}${glue}userId=${encodeURIComponent(user.id)}`;
    return res.redirect(deepLink);
  } catch (e) {
    console.error("Auth callback error:", e);
    return res.status(500).send("Auth failed");
  }
});

async function ensureFreshToken(user: {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  if (user.expiresAt - now > 60) return user.accessToken;

  const data = await refreshAccessToken(user.refreshToken);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? user.refreshToken,
      expiresAt: data.expires_at,
    },
  });
  return data.access_token;
}

app.get("/me/:userId", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!user) return res.status(404).json({ error: "Not found" });
  try {
    const token = await ensureFreshToken(user);
    const me = await getAthlete(token);
    res.json(me);
  } catch (e) {
    console.error("GET /me error:", e);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.get("/activities/:userId", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!user) return res.status(404).json({ error: "Not found" });
  try {
    const token = await ensureFreshToken(user);
    const perPage = Number(req.query.per_page) || 20;
    const acts = await getActivities(token, perPage);
    res.json(acts);
  } catch (e) {
    console.error("GET /activities error:", e);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

/**
 * Weather proxy (24h forecast + current + AQ)
 * GET /weather?lat=..&lon=..
 */
app.get("/weather", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!lat || !lon) return res.status(400).json({ error: "lat & lon required" });

    const key = process.env.WEATHER_API_KEY;
    if (!key) return res.status(500).json({ error: "WEATHER_API_KEY missing" });

    const url = `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${lat},${lon}&days=1&aqi=yes&alerts=no`;
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: `WeatherAPI ${r.status}` });
    const j = (await r.json()) as {
      forecast?: { forecastday?: { hour?: any[] }[] },
      current?: { [key: string]: any },
      location?: { [key: string]: any }
    };

    const hoursRaw = j?.forecast?.forecastday?.[0]?.hour ?? [];
    const hours = hoursRaw.map((h: any) => ({
      ts: Number(h.time_epoch),
      temp_c: Number(h.temp_c),
      humidity: Number(h.humidity),
      wind_kph: Number(h.wind_kph),
      pop: Math.max(0, Math.min(1, (Number(h.chance_of_rain) || 0) / 100)),
      uv: Number(h.uv ?? 0),
      aqi: null as number | null,
    }));

    const aq = j?.current?.air_quality;
    const current = {
      temp_c: j?.current?.temp_c,
      condition: j?.current?.condition?.text,
      uv: j?.current?.uv,
      aqi_like: typeof aq?.pm2_5 === "number" ? Math.round(aq.pm2_5) : null,
      air_quality: aq ?? null,
    };

    const location = {
      name: j?.location?.name,
      region: j?.location?.region,
      country: j?.location?.country,
      lat: j?.location?.lat,
      lon: j?.location?.lon,
      tz_id: j?.location?.tz_id,
    };

    res.set("Cache-Control", "public, max-age=300");
    return res.json({ hours, current, location });
  } catch (e: any) {
    console.error("GET /weather error:", e);
    return res.status(500).json({ error: e.message ?? String(e) });
  }
});

/** Performance predictor endpoint */
app.get("/api/predict", predictPerformance); // <-- NEW

/** Optional helper to grab your latest user quickly */
app.get("/debug/last-user", async (_req, res) => {
  const u = await prisma.user.findFirst({ orderBy: { createdAt: "desc" } });
  if (!u) return res.status(404).json({ error: "No users yet" });
  res.json({ id: u.id, stravaId: u.stravaId, createdAt: u.createdAt });
});

const port = Number(process.env.PORT) || 4000;
// 👇 bind to 0.0.0.0 so LAN devices (your phone) can connect
app.listen(port, "0.0.0.0", () =>
  console.log(`✅ Server listening on http://0.0.0.0:${port}`)
);


