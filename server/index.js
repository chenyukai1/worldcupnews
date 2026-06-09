import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 5173);

const FIFA_COMPETITION_ID = "17";
const FIFA_SEASON_ID = "285023";
const FIFA_SCHEDULE_PAGE =
  "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums";
const FIFA_CALENDAR_URL = "https://api.fifa.com/api/v3/calendar/matches";
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const WORLD_CUP_SPORT_KEY = "soccer_fifa_world_cup";
const WORLD_CUP_WINNER_KEY = "soccer_fifa_world_cup_winner";
const DEFAULT_API_CACHE_TTL_MS =
  Number(process.env.API_CACHE_TTL_HOURS || 24) * 60 * 60 * 1000;
const CACHE_DIR = path.resolve(process.env.DATA_CACHE_DIR || path.join(root, ".api-cache"));

const cache = new Map();

function cacheKey(parts) {
  return parts.filter(Boolean).join(":");
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.value;
}

function setCached(key, value, ttlMs) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

function cacheFilePath(key) {
  const safeName = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(CACHE_DIR, `${safeName}.json`);
}

async function readDiskCache(key) {
  try {
    const raw = await readFile(cacheFilePath(key), "utf8");
    const entry = JSON.parse(raw);
    if (!entry?.cachedAt || !entry?.value) return null;
    return entry;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    console.warn(`Unable to read cache ${key}:`, error.message);
    return null;
  }
}

async function writeDiskCache(key, value) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    cacheFilePath(key),
    JSON.stringify(
      {
        cachedAt: new Date().toISOString(),
        value,
      },
      null,
      2,
    ),
  );
}

async function getPersistentCached(key, ttlMs) {
  const memoryCached = getCached(key);
  if (memoryCached) return memoryCached;

  const diskCached = await readDiskCache(key);
  if (!diskCached) return null;

  const cachedAt = new Date(diskCached.cachedAt).getTime();
  if (Number.isNaN(cachedAt) || cachedAt + ttlMs < Date.now()) return null;

  const remainingTtl = cachedAt + ttlMs - Date.now();
  return setCached(key, diskCached.value, remainingTtl);
}

async function setPersistentCached(key, value, ttlMs) {
  setCached(key, value, ttlMs);
  await writeDiskCache(key, value);
  return value;
}

async function withPersistentCache(key, ttlMs, fetcher) {
  const cached = await getPersistentCached(key, ttlMs);
  if (cached) return cached;

  try {
    return await setPersistentCached(key, await fetcher(), ttlMs);
  } catch (error) {
    const stale = await readDiskCache(key);
    if (stale?.value) {
      return {
        ...stale.value,
        stale: true,
        staleReason: error.message,
      };
    }
    throw error;
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "world-cup-odds-hub/0.1",
        ...options.headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message =
        payload?.message || payload?.error || `${response.status} ${response.statusText}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      error.headers = response.headers;
      throw error;
    }

    return {
      payload,
      headers: response.headers,
    };
  } finally {
    clearTimeout(timer);
  }
}

function localized(list, fallback = "") {
  if (!Array.isArray(list)) return fallback;
  return (
    list.find((item) => item.Locale === "en-GB")?.Description ||
    list.find((item) => item.Locale === "en")?.Description ||
    list[0]?.Description ||
    fallback
  );
}

function placeholderLabel(code) {
  if (!code) return "";
  const token = String(code).trim();
  const groupPlace = token.match(/^(\d)([A-L])$/i);
  if (groupPlace) {
    const [, place, group] = groupPlace;
    if (place === "1") return `Group ${group.toUpperCase()} winner`;
    if (place === "2") return `Group ${group.toUpperCase()} runner-up`;
    if (place === "3") return `Group ${group.toUpperCase()} third place`;
  }

  const winner = token.match(/^W(\d+)$/i);
  if (winner) return `Winner match ${winner[1]}`;

  const runnerUp = token.match(/^L(\d+)$/i);
  if (runnerUp) return `Runner-up match ${runnerUp[1]}`;

  return token;
}

function normalizeTeam(team, placeholder) {
  if (!team) {
    return {
      name: placeholderLabel(placeholder),
      abbreviation: placeholder || "",
      countryCode: "",
      flagUrl: "",
      isPlaceholder: true,
    };
  }

  return {
    name: localized(team.TeamName, team.ShortClubName || team.Abbreviation),
    abbreviation: team.Abbreviation || team.IdCountry || "",
    countryCode: team.IdCountry || "",
    flagUrl: team.PictureUrl
      ? team.PictureUrl.replace("{format}-{size}", "sq-4")
      : "",
    isPlaceholder: false,
  };
}

function normalizeFifaMatch(match) {
  const stadium = match.Stadium || {};
  const stage = localized(match.StageName, "Unknown stage");
  const group = localized(match.GroupName, "");
  const idStage = match.IdStage;
  const idMatch = match.IdMatch;

  return {
    id: idMatch,
    matchNumber: match.MatchNumber,
    stage,
    group,
    dateUtc: match.Date,
    localDate: match.LocalDate,
    timeDefined: Boolean(match.TimeDefined),
    status: match.MatchStatus,
    home: normalizeTeam(match.Home, match.PlaceHolderA),
    away: normalizeTeam(match.Away, match.PlaceHolderB),
    stadium: {
      name: localized(stadium.Name),
      city: localized(stadium.CityName),
      countryCode: stadium.IdCountry || "",
    },
    sourceUrl: `https://www.fifa.com/en/match-centre/match/${FIFA_COMPETITION_ID}/${FIFA_SEASON_ID}/${idStage}/${idMatch}`,
  };
}

async function getFifaSchedule() {
  const key = cacheKey(["fifa", "schedule"]);
  return withPersistentCache(key, DEFAULT_API_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({
      language: "en",
      count: "500",
      idSeason: FIFA_SEASON_ID,
      idCompetition: FIFA_COMPETITION_ID,
    });
    const url = `${FIFA_CALENDAR_URL}?${params}`;
    const { payload } = await fetchJson(url, { timeoutMs: 15000 });
    const matches = [...(payload?.Results || [])]
      .sort((a, b) => Number(a.MatchNumber) - Number(b.MatchNumber))
      .map(normalizeFifaMatch);

    return {
      matches,
      fetchedAt: new Date().toISOString(),
      cachePolicy: {
        ttlHours: DEFAULT_API_CACHE_TTL_MS / 36e5,
        storage: "file",
      },
      source: {
        name: "FIFA official match calendar",
        pageUrl: FIFA_SCHEDULE_PAGE,
        apiUrl: url,
        competitionId: FIFA_COMPETITION_ID,
        seasonId: FIFA_SEASON_ID,
      },
    };
  });
}

function usageFromHeaders(headers) {
  return {
    remaining: headers.get("x-requests-remaining"),
    used: headers.get("x-requests-used"),
    last: headers.get("x-requests-last"),
  };
}

function safeOddsQuery(query, allowedMarkets = ["h2h", "spreads", "totals"]) {
  const regions = String(query.regions || process.env.ODDS_REGIONS || "us")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => ["us", "uk", "eu", "au"].includes(item));
  const markets = String(query.markets || process.env.ODDS_MARKETS || "h2h")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => allowedMarkets.includes(item));

  return {
    regions: regions.length ? regions.join(",") : "us",
    markets: markets.length ? markets.join(",") : allowedMarkets[0],
    oddsFormat: query.oddsFormat === "american" ? "american" : "decimal",
  };
}

async function getOdds({ sportKey, query, ttlMs = DEFAULT_API_CACHE_TTL_MS }) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    const error = new Error("ODDS_API_KEY is not configured");
    error.status = 503;
    throw error;
  }

  const allowedMarkets =
    sportKey === WORLD_CUP_WINNER_KEY ? ["outrights"] : ["h2h", "spreads", "totals"];
  const safe = safeOddsQuery(query, allowedMarkets);
  const key = cacheKey(["odds", sportKey, safe.regions, safe.markets, safe.oddsFormat]);
  return withPersistentCache(key, ttlMs, async () => {
    const params = new URLSearchParams({
      apiKey,
      regions: safe.regions,
      markets: safe.markets,
      oddsFormat: safe.oddsFormat,
      dateFormat: "iso",
    });
    const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?${params}`;
    const { payload, headers } = await fetchJson(url, { timeoutMs: 15000 });

    return {
      events: payload || [],
      fetchedAt: new Date().toISOString(),
      query: safe,
      usage: usageFromHeaders(headers),
      cachePolicy: {
        ttlHours: ttlMs / 36e5,
        storage: "file",
      },
      source: {
        name: "The Odds API",
        sportKey,
        docsUrl: "https://the-odds-api.com/liveapi/guides/v4/",
      },
    };
  });
}

async function getSportsStatus() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    const error = new Error("ODDS_API_KEY is not configured");
    error.status = 503;
    throw error;
  }

  const key = cacheKey(["odds", "sports"]);
  return withPersistentCache(key, DEFAULT_API_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({
      apiKey,
      all: "true",
    });
    const url = `${ODDS_API_BASE}/sports?${params}`;
    const { payload, headers } = await fetchJson(url, { timeoutMs: 15000 });
    const wanted = (payload || []).filter((sport) =>
      [WORLD_CUP_SPORT_KEY, WORLD_CUP_WINNER_KEY].includes(sport.key),
    );

    return {
      sports: wanted,
      fetchedAt: new Date().toISOString(),
      usage: usageFromHeaders(headers),
      cachePolicy: {
        ttlHours: DEFAULT_API_CACHE_TTL_MS / 36e5,
        storage: "file",
      },
      source: {
        name: "The Odds API sports catalog",
        docsUrl: "https://the-odds-api.com/liveapi/guides/v4/",
      },
    };
  });
}

const app = express();

app.get("/api/health", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/schedule", async (req, res) => {
  try {
    res.json(await getFifaSchedule());
  } catch (error) {
    console.error("schedule error", error);
    res.status(error.status || 502).json({
      message: "Unable to load FIFA schedule",
      detail: error.message,
    });
  }
});

app.get("/api/odds", async (req, res) => {
  try {
    res.json(await getOdds({ sportKey: WORLD_CUP_SPORT_KEY, query: req.query }));
  } catch (error) {
    console.error("odds error", error);
    res.status(error.status || 502).json({
      message: "Unable to load World Cup match odds",
      detail: error.message,
    });
  }
});

app.get("/api/outrights", async (req, res) => {
  try {
    res.json(
      await getOdds({
        sportKey: WORLD_CUP_WINNER_KEY,
        query: { ...req.query, markets: "outrights" },
      }),
    );
  } catch (error) {
    console.error("outrights error", error);
    res.status(error.status || 502).json({
      message: "Unable to load World Cup winner odds",
      detail: error.message,
    });
  }
});

app.get("/api/sports-status", async (req, res) => {
  try {
    res.json(await getSportsStatus());
  } catch (error) {
    console.error("sports status error", error);
    res.status(error.status || 502).json({
      message: "Unable to load sports catalog",
      detail: error.message,
    });
  }
});

if (isProduction) {
  app.use(express.static(path.join(root, "dist")));
  app.get("*splat", async (req, res) => {
    const indexHtml = await readFile(path.join(root, "dist", "index.html"), "utf8");
    res.type("html").send(indexHtml);
  });
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`World Cup odds hub running at http://localhost:${port}`);
});
