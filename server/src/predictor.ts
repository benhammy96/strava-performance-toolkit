// server/src/predictor.ts
import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { getActivities, refreshAccessToken } from "./strava.js"; // <-- reuse your existing Strava helpers

const prisma = new PrismaClient();

// ---- Tunables --------------------------------------------------------------
const HALF_LIFE_DAYS = 60;
const MIN_DISTANCE_M = 800;
const MIN_POINTS = 4;
const MIN_MOVE_ELAPSED_RATIO = 0.8;
// ---------------------------------------------------------------------------

function getUserId(req: Request): string | null {
  const anyReq = req as any;
  return (
    (anyReq.user && typeof anyReq.user.id === "string" && anyReq.user.id) ||
    (anyReq.session && typeof anyReq.session.userId === "string" && anyReq.session.userId) ||
    (typeof req.headers["x-user-id"] === "string" && req.headers["x-user-id"]) ||
    null
  );
}

async function ensureFreshTokenForUserId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const now = Math.floor(Date.now() / 1000);
  if (user.expiresAt - now > 60) return user.accessToken;

  const data = await refreshAccessToken(user.refreshToken);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? user.refreshToken,
      expiresAt: data.expires_at,
    },
  });
  return updated.accessToken;
}

function recencyWeight(start: Date, now: Date): number {
  const ms = Math.max(0, now.getTime() - start.getTime());
  const days = ms / 86_400_000;
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

function median(nums: readonly number[]): number {
  const n = nums.length;
  if (n === 0) return 0;
  const arr = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? arr[mid]! : (arr[mid - 1]! + arr[mid]!) / 2;
}

type Point = {
  distance: number;
  movingTime: number;
  elapsedTime?: number | undefined; // exactOptionalPropertyTypes-safe
  startDate: Date;
};

function fitPowerLaw(points: Point[]) {
  if (points.length < 2) return null;

  const x = points.map((p) => Math.log(p.distance));
  const y = points.map((p) => Math.log(p.movingTime));
  const now = new Date();
  const w = points.map((p) => recencyWeight(p.startDate, now));

  let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
  for (let i = 0; i < x.length; i++) {
    const wi = w[i]!, xi = x[i]!, yi = y[i]!;
    sw += wi; swx += wi * xi; swy += wi * yi; swxx += wi * xi * xi; swxy += wi * xi * yi;
  }
  const det = sw * swxx - swx * swx;
  if (!isFinite(det) || Math.abs(det) < 1e-12 || sw === 0) return null;

  const beta0 = (swy * swxx - swx * swxy) / det; // log(a)
  const beta1 = (sw * swxy - swx * swy) / det;   // b

  let sse = 0;
  for (let i = 0; i < x.length; i++) {
    const yhat = beta0 + beta1 * x[i]!;
    const r = y[i]! - yhat;
    sse += w[i]! * r * r;
  }
  const rmseLog = Math.sqrt(sse / sw);

  return { logA: beta0, b: beta1, rmseLog };
}

function predictSeconds(logA: number, b: number, distanceM: number) {
  return Math.exp(logA) * Math.pow(distanceM, b);
}

function formatHHMMSS(totalSec: number) {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}` : `${m}:${s.toString().padStart(2,"0")}`;
}

function pacePerKm(totalSec: number, km: number) {
  const spk = km > 0 ? totalSec / km : 0;
  const mm = Math.floor(spk / 60);
  const ss = Math.round(spk % 60);
  return `${mm}:${ss.toString().padStart(2,"0")}/km`;
}

// Normalize a Strava activity object into our Point
function mapStravaAct(a: any): Point | null {
  // Strava fields: distance (m), moving_time (s), elapsed_time (s), start_date (ISO), type
  if (!a || a.type?.toLowerCase() !== "run") return null;

  const distance = Number(a.distance);
  const movingTime = Number(a.moving_time);
  const elapsedMaybe = a.elapsed_time == null ? undefined : Number(a.elapsed_time);
  const startDate = new Date(String(a.start_date));

  if (!isFinite(distance) || !isFinite(movingTime) || isNaN(startDate.getTime())) return null;

  return {
    distance,
    movingTime,
    elapsedTime: typeof elapsedMaybe === "number" && isFinite(elapsedMaybe) ? elapsedMaybe : undefined,
    startDate,
  };
}

/**
 * GET /api/predict?distance_km=5.0
 */
export async function predictPerformance(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const targetKm = Number((req.query.distance_km as string | undefined) ?? "5.0");
    if (!isFinite(targetKm) || targetKm <= 0) {
      return res.status(400).json({ error: "Invalid distance_km" });
    }

    const token = await ensureFreshTokenForUserId(userId);
    // Pull up to 200 recent acts from Strava (tweak as needed)
    const acts = await getActivities(token, 200);

    let pts: Point[] = (acts as any[])
      .map(mapStravaAct)
      .filter((p): p is Point => p !== null)
      .filter((p) => p.distance > MIN_DISTANCE_M && p.movingTime > 0);

    if (pts.length < MIN_POINTS) {
      return res.status(400).json({ error: "Need at least 4 valid runs" });
    }

    // Filter pause-heavy
    pts = pts.filter((p) => {
      if (typeof p.elapsedTime !== "number" || p.elapsedTime <= 0) return true;
      return p.movingTime / p.elapsedTime >= MIN_MOVE_ELAPSED_RATIO;
    });
    if (pts.length < MIN_POINTS) {
      return res.status(400).json({ error: "Not enough clean runs after filtering" });
    }

    // Outlier clipping by pace
    const paces = pts.map((p) => p.movingTime / p.distance);
    const med = median(paces);
    const low = 0.5 * med, high = 2.0 * med;
    pts = pts.filter((_p, i) => {
      const pace = paces[i]!;
      return pace >= low && pace <= high;
    });
    if (pts.length < MIN_POINTS) {
      return res.status(400).json({ error: "Too many outliers removed; collect a few more steady runs" });
    }

    const fit = fitPowerLaw(pts);
    if (!fit) return res.status(500).json({ error: "Model fit failed" });

    const { logA, b, rmseLog } = fit;
    const targetM = targetKm * 1000;
    const predSec = predictSeconds(logA, b, targetM);
    const lowSec = Math.exp(Math.log(predSec) - rmseLog);
    const highSec = Math.exp(Math.log(predSec) + rmseLog);

    return res.json({
      distance_km: targetKm,
      prediction_seconds: Number(predSec.toFixed(1)),
      prediction_time: formatHHMMSS(predSec),
      pace_per_km: pacePerKm(predSec, targetKm),
      confidence_low_time: formatHHMMSS(lowSec),
      confidence_high_time: formatHHMMSS(highSec),
      model: { log_a: logA, b, rmse_log: rmseLog },
      used_points: pts.length,
    });
  } catch (err) {
    console.error("predictPerformance error", err);
    return res.status(500).json({ error: "Server error" });
  }
}

