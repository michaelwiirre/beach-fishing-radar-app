import React, { useState, useMemo, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from "recharts";
import { ChevronLeft, ChevronDown, Waves, Moon, Wind, Thermometer, Eye, Fish, AlertTriangle, TrendingUp, Info, RefreshCw, WifiOff } from "lucide-react";

// ===========================================================================
// DATA SOURCE ADAPTER — NOAA CO-OPS (via Cloudflare Worker proxy)
//
// This is written as a standalone adapter module (in a real repo this would
// be src/adapters/noaaCoOps.js) rather than inline fetch calls in components.
// It knows nothing about beaches, species, or the UI — it only knows how to
// talk to the proxy and hand back normalized environmental_observations rows.
//
// CONFIRMED: a direct browser fetch() from this Artifact to NOAA's own
// domain fails (tested — network/CORS error on every request). All requests
// now go through a Cloudflare Worker (beach-proxy.michaelwiirre.workers.dev)
// that fetches NOAA server-side and adds CORS headers. That proxy has been
// tested directly in Safari and confirmed working for /tides/predictions.
// ===========================================================================

// This adapter now calls our own Cloudflare Worker proxy, not NOAA directly —
// the Artifact's sandbox can't reach api.tidesandcurrents.noaa.gov (confirmed
// by testing: every request failed with a network/CORS error). The proxy
// fetches NOAA server-side and returns NOAA's JSON unmodified, so the
// response-parsing logic below is unchanged from the direct-NOAA version.
const PROXY_BASE_URL = "https://beach-proxy.michaelwiirre.workers.dev";

// Shared cache: several beaches map to the SAME NOAA/NDBC station (e.g. 6
// beaches all use buoy 41068), so opening the Radar screen used to fire
// redundant duplicate requests for identical data, all at once. This
// collapses same-station requests into one, and treats results as fresh for
// 2 minutes — switching screens or reopening a beach within that window
// reuses the cached value instead of refetching. Manual refresh (the retry
// button) bypasses the cache on purpose.
const CACHE_TTL_MS = 120000; // 2 minutes
const dataCache = new Map(); // key -> { data, fetchedAt }
const inFlight = new Map(); // key -> Promise

function cachedFetch(key, fetchFn, { force = false } = {}) {
  if (!force) {
    const cached = dataCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return Promise.resolve(cached.data);
    }
    if (inFlight.has(key)) return inFlight.get(key);
  }
  const promise = fetchFn()
    .then((data) => {
      dataCache.set(key, { data, fetchedAt: Date.now() });
      inFlight.delete(key);
      return data;
    })
    .catch((err) => {
      inFlight.delete(key);
      throw err;
    });
  inFlight.set(key, promise);
  return promise;
}


// All 24 beaches now mapped to their nearest official NOAA CO-OPS station.
// Several beaches share a station with a close neighbor where no dedicated
// oceanfront gauge exists (noted below) — tide timing is still accurate,
// but "nearest station" isn't always "station right on that beach."
const NOAA_STATIONS = {
  "fort-pierce": { stationId: "8722212", stationName: "Fort Pierce, South Jetty, FL" },
  "bathtub-beach": { stationId: "8722357", stationName: "Stuart, St. Lucie River, FL (nearest — ICWW, not oceanfront)" },
  "stuart-beach": { stationId: "8722357", stationName: "Stuart, St. Lucie River, FL (nearest — ICWW, not oceanfront)" },
  "amelia-island": { stationId: "8720030", stationName: "Fernandina Beach, FL" },
  "jacksonville-beach": { stationId: "8720291", stationName: "Jacksonville Beach, FL" },
  "ponte-vedra-beach": { stationId: "8720291", stationName: "Jacksonville Beach, FL (nearest station)" },
  "st-augustine-beach": { stationId: "8720587", stationName: "St. Augustine Beach, FL" },
  "vilano-beach": { stationId: "8720587", stationName: "St. Augustine Beach, FL (nearest station)" },
  "flagler-beach": { stationId: "8720833", stationName: "Smith Creek, Flagler Beach, FL (nearest — ICWW, not oceanfront)" },
  "playalinda-beach": { stationId: "8721604", stationName: "Trident Pier, Port Canaveral, FL (nearest station)" },
  "new-smyrna-beach": { stationId: "8721164", stationName: "New Smyrna Beach, FL" },
  "daytona-beach": { stationId: "8721120", stationName: "Daytona Beach Shores, FL" },
  "cocoa-beach": { stationId: "8721649", stationName: "Cocoa Beach, FL" },
  "melbourne-beach": { stationId: "8722004", stationName: "Sebastian Inlet & Wabasso Beach, FL (nearest station)" },
  "vero-beach": { stationId: "8722105", stationName: "Vero Beach (ocean), FL" },
  "jensen-beach": { stationId: "8722212", stationName: "Fort Pierce, South Jetty, FL (nearest station)" },
  "juno-beach": { stationId: "8722670", stationName: "Lake Worth Pier (Ocean), FL (nearest station)" },
  "jupiter-beach": { stationId: "8722495", stationName: "Jupiter Inlet, South Jetty, FL" },
  "palm-beach": { stationId: "8722670", stationName: "Lake Worth Pier (Ocean), FL (nearest station)" },
  "fort-lauderdale-beach": { stationId: "8722956", stationName: "Port Everglades, ICWW, FL (nearest station)" },
  "hollywood-beach": { stationId: "8722979", stationName: "Hollywood Beach, FL" },
  "haulover-beach": { stationId: "8723080", stationName: "Haulover Pier, N. Miami Beach, FL" },
  "south-beach": { stationId: "8723170", stationName: "Miami Beach, FL" },
  "key-biscayne": { stationId: "8723214", stationName: "Virginia Key, FL (nearest station)" },
};

// NDBC buoy stations mapped to nearest beach. Several southern beaches are
// 40+ miles from their nearest confirmed buoy (labeled below) since NDBC's
// coverage thins out south of Fort Pierce — still the best real data
// available, just not local the way the northern mappings are.
const NDBC_STATIONS = {
  "amelia-island": { stationId: "41112", stationName: "Offshore Fernandina Beach, FL" },
  "jacksonville-beach": { stationId: "41117", stationName: "St. Augustine, FL (nearest buoy)" },
  "ponte-vedra-beach": { stationId: "41117", stationName: "St. Augustine, FL (nearest buoy)" },
  "st-augustine-beach": { stationId: "41117", stationName: "St. Augustine, FL" },
  "vilano-beach": { stationId: "41117", stationName: "St. Augustine, FL (nearest buoy)" },
  "flagler-beach": { stationId: "41069", stationName: "Ponce de Leon Inlet, FL (nearest buoy)" },
  "playalinda-beach": { stationId: "41113", stationName: "Cape Canaveral Nearshore, FL" },
  "new-smyrna-beach": { stationId: "41069", stationName: "Ponce de Leon Inlet, FL" },
  "daytona-beach": { stationId: "41069", stationName: "Ponce de Leon Inlet, FL (nearest buoy)" },
  "cocoa-beach": { stationId: "41113", stationName: "Cape Canaveral Nearshore, FL" },
  "melbourne-beach": { stationId: "41113", stationName: "Cape Canaveral Nearshore, FL (nearest buoy)" },
  "vero-beach": { stationId: "41068", stationName: "Fort Pierce, FL (nearest buoy)" },
  "fort-pierce": { stationId: "41068", stationName: "Fort Pierce, FL" },
  "jensen-beach": { stationId: "41068", stationName: "Fort Pierce, FL (nearest buoy)" },
  "bathtub-beach": { stationId: "41068", stationName: "Fort Pierce, FL (nearest buoy, ~20mi)" },
  "stuart-beach": { stationId: "41068", stationName: "Fort Pierce, FL (nearest buoy, ~20mi)" },
  "juno-beach": { stationId: "41068", stationName: "Fort Pierce, FL (nearest buoy, ~45mi — not local)" },
  "jupiter-beach": { stationId: "41068", stationName: "Fort Pierce, FL (nearest buoy, ~40mi — not local)" },
  "palm-beach": { stationId: "41122", stationName: "Hollywood Beach, FL (nearest buoy, ~45mi — not local)" },
  "fort-lauderdale-beach": { stationId: "41122", stationName: "Hollywood Beach, FL" },
  "hollywood-beach": { stationId: "41122", stationName: "Hollywood Beach, FL" },
  "haulover-beach": { stationId: "41122", stationName: "Hollywood Beach, FL (nearest buoy, ~15mi)" },
  "south-beach": { stationId: "41122", stationName: "Hollywood Beach, FL (nearest buoy, ~15mi)" },
  "key-biscayne": { stationId: "41122", stationName: "Hollywood Beach, FL (nearest buoy, ~20mi)" },
};

// Blog/tackle-shop RSS sources mapped to nearby beaches. Only two feeds are
// confirmed real (their exact URLs were verified before building the Worker
// route) — most beaches honestly have no local source mapped yet rather
// than guessing at an unconfirmed feed URL.
const RSS_BEACH_SOURCES = {
  "jensen-beach": "snook-nook",
  "fort-pierce": "snook-nook",
  "bathtub-beach": "snook-nook",
  "stuart-beach": "snook-nook",
  "vero-beach": "snook-nook",
  "new-smyrna-beach": "ponce-inlet",
  "daytona-beach": "ponce-inlet",
  "flagler-beach": "ponce-inlet",
};

// NWS/METAR stations for rainfall data, mapped to nearest beach — every code
// individually verified (ICAO identifier confirmed real), not guessed.
const METAR_STATIONS = {
  "amelia-island": { stationId: "KFHB", stationName: "Fernandina Beach Municipal" },
  "jacksonville-beach": { stationId: "KCRG", stationName: "Jacksonville Executive at Craig" },
  "ponte-vedra-beach": { stationId: "KCRG", stationName: "Jacksonville Executive at Craig (nearest station)" },
  "st-augustine-beach": { stationId: "KSGJ", stationName: "Northeast Florida Regional (St. Augustine)" },
  "vilano-beach": { stationId: "KSGJ", stationName: "Northeast Florida Regional (nearest station)" },
  "flagler-beach": { stationId: "KDAB", stationName: "Daytona Beach Intl (nearest station)" },
  "playalinda-beach": { stationId: "KTIX", stationName: "Space Coast Regional (Titusville)" },
  "new-smyrna-beach": { stationId: "KDAB", stationName: "Daytona Beach Intl (nearest station)" },
  "daytona-beach": { stationId: "KDAB", stationName: "Daytona Beach Intl" },
  "cocoa-beach": { stationId: "KTIX", stationName: "Space Coast Regional (nearest station)" },
  "melbourne-beach": { stationId: "KMLB", stationName: "Melbourne Orlando Intl" },
  "vero-beach": { stationId: "KVRB", stationName: "Vero Beach Regional" },
  "fort-pierce": { stationId: "KFPR", stationName: "Treasure Coast Intl (Fort Pierce)" },
  "jensen-beach": { stationId: "KFPR", stationName: "Treasure Coast Intl (nearest station)" },
  "bathtub-beach": { stationId: "KSUA", stationName: "Witham Field (Stuart)" },
  "stuart-beach": { stationId: "KSUA", stationName: "Witham Field (Stuart)" },
  "juno-beach": { stationId: "KPBI", stationName: "Palm Beach Intl (nearest station)" },
  "jupiter-beach": { stationId: "KPBI", stationName: "Palm Beach Intl (nearest station)" },
  "palm-beach": { stationId: "KPBI", stationName: "Palm Beach Intl" },
  "fort-lauderdale-beach": { stationId: "KFLL", stationName: "Fort Lauderdale/Hollywood Intl" },
  "hollywood-beach": { stationId: "KHWO", stationName: "North Perry (Hollywood)" },
  "haulover-beach": { stationId: "KOPF", stationName: "Miami-Opa Locka Executive (nearest station)" },
  "south-beach": { stationId: "KMIA", stationName: "Miami Intl" },
  "key-biscayne": { stationId: "KMIA", stationName: "Miami Intl (nearest station)" },
};

// Fetches recent precipitation from NWS via the proxy. Cached per station.
// A null field means NWS didn't report a value for that window — a known
// gap in their data, never assumed to mean zero rain.
async function fetchPrecip(stationId, { force = false } = {}) {
  return cachedFetch(`precip:${stationId}`, async () => {
    const json = await fetchViaProxy("/weather/precip", null, { station: stationId });
    return {
      stationId,
      timestamp: json.timestamp,
      precipLastHourIn: json.precipLastHourIn,
      precipLast3HoursIn: json.precipLast3HoursIn,
      precipLast6HoursIn: json.precipLast6HoursIn,
    };
  }, { force });
}

async function fetchLatestBuoy(stationId, { force = false } = {}) {
  return cachedFetch(`buoy:${stationId}`, async () => {
    const json = await fetchViaProxy("/buoy/latest", stationId);
    return {
      stationId,
      observedAtUtc: json.observedAtUtc,
      windSpeedKt: json.windSpeedMs != null ? json.windSpeedMs * 1.94384 : null,
      gustKt: json.gustMs != null ? json.gustMs * 1.94384 : null,
      windDirDeg: json.windDirDeg,
      waveHeightFt: json.waveHeightM != null ? json.waveHeightM * 3.28084 : null,
      waveHeightM: json.waveHeightM,
      dominantWavePeriodS: json.dominantWavePeriodS,
      pressureHpa: json.pressureHpa,
      pressureTendencyHpa: json.pressureTendencyHpa,
      airTempF: json.airTempC != null ? json.airTempC * 9 / 5 + 32 : null,
      waterTempF: json.waterTempC != null ? json.waterTempC * 9 / 5 + 32 : null,
    };
  }, { force });
}

// Fetches real, recent blog/report posts via the proxy's allowlisted RSS
// route. On-demand only — never auto-fetched alongside tide/buoy data.
async function fetchRssTrends(sourceKey) {
  const json = await fetchViaProxy("/trends/rss", null, { source: sourceKey });
  return { sourceName: json.sourceName, items: json.items || [] };
}

// Scores the environmental bonus from live buoy data. Calm-to-moderate surf
// is favored (per documented preference for "semi calm clean water");
// falling barometric pressure gets a bonus (classic pre-frontal feeding
// push), sharply rising pressure gets a penalty (post-frontal lull). Only
// contributes what data is actually present — missing wave or pressure
// data just means that piece is skipped, not estimated.
function scoreBuoyFactor(buoy) {
  if (!buoy) return null;
  let bonus = 0;
  const factors = [];

  if (buoy.waveHeightFt != null) {
    let waveBonus;
    if (buoy.waveHeightFt <= 2) waveBonus = 6;
    else if (buoy.waveHeightFt <= 4) waveBonus = 10;
    else if (buoy.waveHeightFt <= 6.5) waveBonus = 2;
    else waveBonus = -10;
    bonus += waveBonus;
    factors.push({ label: `Offshore wave height ${buoy.waveHeightFt.toFixed(1)} ft`, shortLabel: "Wave", delta: waveBonus });
  }

  if (buoy.pressureTendencyHpa != null) {
    let pBonus;
    if (buoy.pressureTendencyHpa <= -1) pBonus = 8;
    else if (buoy.pressureTendencyHpa < 0) pBonus = 3;
    else if (buoy.pressureTendencyHpa <= 1) pBonus = 0;
    else pBonus = -6;
    bonus += pBonus;
    factors.push({ label: `Barometric pressure ${buoy.pressureTendencyHpa >= 0 ? "+" : ""}${buoy.pressureTendencyHpa.toFixed(1)} hPa (3-hr trend)`, shortLabel: "Pressure", delta: pBonus });
  }

  if (factors.length === 0) return null; // buoy reachable but no usable fields
  return { bonus, factors, buoy };
}

// ===========================================================================
// WATER CLARITY — an ESTIMATE, not a measurement. There's no live sensor
// for turbidity at these beaches, but wave height, wind, and wave period
// (all real, already-live buoy fields) are genuine, documented correlates:
// bigger waves and shorter-period windswell stir up bottom sediment; calm,
// long-period groundswell tends to run clean. This is explicitly labeled
// ESTIMATED everywhere it appears — never shown with a LIVE tag — so it's
// never mistaken for a real clarity reading.
// ===========================================================================
function estimateWaterClarity(buoy, precip, tideStage) {
  const hasBuoyInput = buoy && (buoy.waveHeightFt != null || buoy.windSpeedKt != null || buoy.dominantWavePeriodS != null);
  const rainAmountIn = precip
    ? (precip.precipLast6HoursIn ?? precip.precipLast3HoursIn ?? precip.precipLastHourIn)
    : null;
  if (!hasBuoyInput && rainAmountIn == null) return null;

  let score = 70; // baseline: moderately clean, adjusted by what's actually present
  const factors = [];

  // Wave height is deliberately the heaviest-weighted factor here — the
  // single biggest driver of how much bottom sediment is in suspension.
  if (buoy?.waveHeightFt != null) {
    let waveDelta;
    if (buoy.waveHeightFt <= 1.5) waveDelta = 14;
    else if (buoy.waveHeightFt <= 2.5) waveDelta = 4;
    else if (buoy.waveHeightFt <= 3.0) waveDelta = -8; // "ok but degrading"
    else if (buoy.waveHeightFt <= 3.5) waveDelta = -20;
    else if (buoy.waveHeightFt <= 4.0) waveDelta = -32; // "not good" quality
    else if (buoy.waveHeightFt <= 5.0) waveDelta = -42;
    else waveDelta = -50;
    score += waveDelta;
    factors.push({
      label: `Wave height ${buoy.waveHeightFt.toFixed(1)} ft — ${waveDelta >= 0 ? "little sediment stirring expected" : "more bottom sediment likely stirred up"}`,
      delta: waveDelta,
    });
  }

  if (buoy?.windSpeedKt != null) {
    let windDelta;
    if (buoy.windSpeedKt <= 8) windDelta = 8;
    else if (buoy.windSpeedKt <= 15) windDelta = -6;
    else windDelta = -18;
    score += windDelta;
    factors.push({
      label: `Wind ${Math.round(buoy.windSpeedKt)} kt — ${windDelta >= 0 ? "calm surface" : "choppier surface, more mixing"}`,
      delta: windDelta,
    });
  }

  // Wind DIRECTION, separate from speed — FL Atlantic beaches all face
  // roughly east, so an onshore wind (blowing in FROM the ocean, ~E-SE)
  // pushes stirred-up nearshore water onto the beach; offshore wind
  // (blowing out FROM land, ~W-SW) tends to flatten and clear it. Kept
  // modest — this is a real but secondary factor next to wave height.
  if (buoy?.windDirDeg != null && buoy.windSpeedKt != null && buoy.windSpeedKt > 5) {
    const d = buoy.windDirDeg;
    let dirDelta = 0, dirNote = "mostly alongshore, minimal effect";
    if (d >= 45 && d <= 140) { dirDelta = -8; dirNote = "onshore — pushes turbid nearshore water toward the beach"; }
    else if (d >= 225 && d <= 320) { dirDelta = 6; dirNote = "offshore — tends to flatten and clear nearshore water"; }
    if (dirDelta !== 0) {
      score += dirDelta;
      factors.push({ label: `Wind direction ${Math.round(d)}° — ${dirNote}`, delta: dirDelta });
    }
  }

  if (buoy?.dominantWavePeriodS != null) {
    let periodDelta;
    if (buoy.dominantWavePeriodS >= 8) periodDelta = 8;
    else if (buoy.dominantWavePeriodS >= 6) periodDelta = 0;
    else periodDelta = -10;
    score += periodDelta;
    factors.push({
      label: `${buoy.dominantWavePeriodS}s dominant period — ${periodDelta > 0 ? "longer-period groundswell, typically cleaner" : periodDelta < 0 ? "short-period windswell, typically murkier" : "moderate period"}`,
      delta: periodDelta,
    });
  }

  if (rainAmountIn != null) {
    let rainDelta;
    if (rainAmountIn <= 0.01) rainDelta = 5;
    else if (rainAmountIn <= 0.25) rainDelta = -10;
    else if (rainAmountIn <= 0.75) rainDelta = -25;
    else rainDelta = -40;
    score += rainDelta;
    const windowLabel = precip.precipLast6HoursIn != null ? "6 hrs" : precip.precipLast3HoursIn != null ? "3 hrs" : "1 hr";
    factors.push({
      label: `${rainAmountIn.toFixed(2)} in rain, last ${windowLabel} (NWS) — ${rainDelta >= 0 ? "confirmed dry, favors clean water" : "freshwater runoff likely reducing clarity"}`,
      delta: rainDelta,
    });
  }

  // Tide direction — outgoing tide can pull tannic/stained backwater and
  // inlet discharge into the surf zone; incoming tide brings in cleaner
  // offshore water. Modest, secondary to wave height.
  if (tideStage) {
    const tideDelta = tideStage.direction === "incoming" ? 4 : -6;
    score += tideDelta;
    factors.push({
      label: `${tideStage.direction === "incoming" ? "Incoming" : "Outgoing"} tide — ${tideStage.direction === "incoming" ? "pulling in cleaner offshore water" : "may pull stained backwater/inlet discharge into the surf zone"}`,
      delta: tideDelta,
    });
  }

  score = Math.max(5, Math.min(95, Math.round(score)));
  const label = score >= 70 ? "Likely clean" : score >= 45 ? "Likely stained / mixed" : "Likely murky";
  return { score, label, factors };
}


// Normalizes one NOAA response into rows matching the environmental_observations
// shape from the data architecture: source, source type, observed/retrieved
// timestamps, units, freshness, and a status flag.
function normalizeObservations({ rows, stationId, stationName, product, parameter, unit, datum, sourceType, reliability, retrievedAt }) {
  return rows.map((r) => ({
    source: "NOAA CO-OPS",
    sourceType, // "official_prediction" | "official_live_observation"
    stationId,
    stationName,
    product,
    parameter,
    value: r.value,
    unit,
    datum: datum || null,
    tideType: r.tideType || null, // "H" or "L" for hi/lo predictions
    observedAt: r.time, // station-local timestamp as returned by NOAA
    retrievedAt,
    reliability, // 0-100, from the data_source_reliability concept
    status: "ok",
  }));
}

function freshnessLabel(observedAtIso, retrievedAtIso) {
  const observed = new Date(observedAtIso.replace(" ", "T"));
  const retrieved = new Date(retrievedAtIso);
  const minutes = Math.round((retrieved - observed) / 60000);
  if (Number.isNaN(minutes)) return "Unknown freshness";
  if (minutes < 0) return "Predicted (future)";
  if (minutes < 15) return `${minutes} min old`;
  if (minutes < 60) return `${minutes} min old`;
  return `${Math.round(minutes / 60)} hr old`;
}

// ===========================================================================
// SCORING — Presence × Feeding × Final, per-species, using tide, moon,
// buoy (wave/wind/pressure), water temperature, season, water clarity, and
// bait (observed/inferred-seasonal/unknown). See the full V3 engine below
// (TEMP_CURVE_POINTS onward) for the actual per-species math.
// ===========================================================================

// Finds the two tide events bracketing `atDate` and returns how far through
// that swing we are, which direction, and a flow-strength estimate (0 at
// slack/the tide extremes, close to 1 near the midpoint of the swing —
// a standard approximation for when current is strongest).
function computeTideStage(hiloRows, atDate) {
  const sorted = [...hiloRows].sort(
    (a, b) => new Date(a.observedAt.replace(" ", "T")) - new Date(b.observedAt.replace(" ", "T"))
  );
  const atMs = atDate.getTime();
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i], next = sorted[i + 1];
    const prevMs = new Date(prev.observedAt.replace(" ", "T")).getTime();
    const nextMs = new Date(next.observedAt.replace(" ", "T")).getTime();
    if (atMs >= prevMs && atMs <= nextMs) {
      const fraction = (atMs - prevMs) / (nextMs - prevMs);
      const direction = prev.tideType === "H" ? "outgoing" : "incoming";
      const flowStrength = Math.sin(fraction * Math.PI);
      return { prev, next, fraction, direction, flowStrength };
    }
  }
  return null; // "now" falls outside the fetched prediction window
}

// ===========================================================================
// V3 SCORING ENGINE — Presence / Feeding / Final, replacing the old flat
// additive per-species formula entirely. Core philosophy:
//
//   PRESENCE = is this species likely even around, given season + water
//     temperature (direct species-specific curves, not a bait proxy)?
//   FEEDING  = given it's around, how favorable are RIGHT NOW's tide/wave/
//     clarity/light/wind/bait conditions for it to actively bite?
//   FINAL    = presenceWeight*presence + feedingWeight*feeding, with
//     presence readings above 90 compressed toward 90 first (a 100 is
//     almost always a clamp artifact of temp+season both maxing out at
//     once, not extra real information, and shouldn't fully convert into
//     final score when feeding is only mediocre) — plus a small bounded
//     "confirmed bait can partially rescue a weak season" adjustment.
//
// Season is a PRIOR (a multiplier on the temperature-driven core), not an
// independent score — a great season can't fix genuinely wrong water temp,
// and unusual real-time conditions can still shine through a normally
// quiet month.
// ===========================================================================

// Piecewise-linear temperature suitability control points per species:
// [tempF, suitability 0-100], interpolated smoothly — no cliffs anywhere.
// Grounded in documented FL Atlantic species temperature behavior.
const TEMP_CURVE_POINTS = {
  // Warm-water visitor; scarce well below 70, thin by the upper 50s/low
  // 60s — gradual falloff, not a cutoff at any single degree.
  tarpon:   [[55,1],[60,4],[65,12],[68,28],[70,40],[72,55],[74,80],[78,100],[82,100],[84,92],[86,78],[90,45],[94,15],[98,3]],
  // Cold-sensitive but real winter presence continues at reduced activity;
  // the biological cold-stress risk zone is well below this curve's floor.
  snook:    [[50,2],[55,10],[60,22],[65,38],[68,55],[70,65],[72,80],[75,95],[80,100],[85,100],[88,92],[90,75],[92,45],[95,15]],
  // Classic COOL-water FL surf species — often BETTER in cooler water.
  pompano:  [[45,4],[50,20],[55,45],[58,70],[62,90],[66,100],[70,100],[74,95],[78,80],[82,55],[85,30],[88,10]],
  // Broadly tolerant resident — flattest curve, present nearly year-round.
  whiting:  [[44,10],[50,35],[55,60],[60,85],[65,100],[72,100],[78,95],[82,80],[86,55],[90,25]],
  // COOL-water run species, roughly inverse of tarpon/snook.
  bluefish: [[45,10],[50,30],[55,55],[58,75],[62,95],[66,100],[70,95],[74,75],[77,45],[80,15],[83,3]],
  // Winter FL Atlantic migratory aggregations happen in comfortably cool
  // water (low-mid 70s), not extreme cold — broad warm-leaning tolerance.
  blacktip: [[58,10],[62,30],[66,55],[70,80],[74,100],[80,100],[84,90],[86,70],[90,35],[93,10]],
  spinner:  [[62,10],[66,30],[70,55],[74,85],[78,100],[84,100],[87,80],[90,45],[93,15]],
  // Eurythermal — broadest tolerance of the sharks, mild warm lean.
  bull:     [[62,15],[66,35],[70,60],[75,90],[80,100],[86,100],[89,75],[92,40]],
  // Warm-water aggressive generalist.
  jack:     [[60,10],[64,25],[68,45],[72,70],[76,95],[80,100],[86,100],[90,70],[93,30]],
  // Spring/fall migratory run species through FL Atlantic surf.
  mackerel: [[58,10],[62,30],[66,55],[70,85],[74,100],[80,100],[84,75],[87,40],[90,15]],
};

function tempSuitability(species, tempF) {
  if (tempF == null) return null;
  const pts = TEMP_CURVE_POINTS[species];
  if (tempF <= pts[0][0]) return pts[0][1];
  if (tempF >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, s0] = pts[i], [t1, s1] = pts[i + 1];
    if (tempF >= t0 && tempF <= t1) return Math.round(s0 + (s1 - s0) * (tempF - t0) / (t1 - t0));
  }
}

// Monthly multiplier (Jan=index0...Dec=index11) on the temperature-driven
// presence core — NOT an independent baseline. Range ~0.6-1.25. Documented
// FL Atlantic seasonal patterns (migration timing, run seasons).
const SEASONAL_MULT = {
  tarpon:   [0.60,0.62,0.75,0.95,1.20,1.25,1.20,1.15,1.05,0.85,0.68,0.60], // strong spring/summer migration
  snook:    [0.85,0.85,0.90,0.95,1.05,1.10,1.10,1.10,1.05,1.00,0.90,0.85], // modest — temp curve already does most of the work
  pompano:  [1.15,1.20,1.15,1.05,0.90,0.78,0.75,0.78,0.90,1.05,1.15,1.20], // classic fall-winter-spring FL staple
  whiting:  [1.05,1.05,1.00,1.00,0.95,0.95,0.95,0.95,0.98,1.00,1.05,1.08], // resident, low variance
  bluefish: [1.15,1.15,1.05,0.95,0.80,0.65,0.60,0.65,0.80,1.05,1.15,1.20], // strong fall-winter-spring run
  blacktip: [1.20,1.15,1.10,0.95,0.90,0.90,0.90,0.90,0.95,1.00,1.10,1.20], // famous winter SE FL aggregation
  spinner:  [1.10,1.10,1.05,0.95,0.90,0.90,0.90,0.90,0.95,1.00,1.05,1.10], // similar, less extreme
  bull:     [0.95,0.95,0.95,1.00,1.05,1.05,1.05,1.05,1.00,0.95,0.95,0.95], // fairly flat, mild warm lean
  jack:     [0.85,0.85,0.90,0.95,1.05,1.10,1.10,1.10,1.05,1.00,0.90,0.85], // warm-season bias
  mackerel: [0.75,0.80,1.00,1.15,1.10,0.90,0.80,0.85,1.05,1.15,1.00,0.80], // spring + fall run, dips mid-summer/winter
};

// Per-species rules: how Presence and Feeding combine, bait/clarity/wind/
// light sensitivity, tide-direction preference, and wave-condition
// preference. Weights kept in a narrow band (0.48-0.60 presence) so no
// species lets Presence fully overwhelm a real Feeding problem — migratory
// species (tarpon, blacktip, bluefish, mackerel) sit at the top of that
// band, resident/consistent species (whiting, jack) at the bottom.
const SPECIES_RULES = {
  tarpon:   { presenceWeight: 0.58, feedingWeight: 0.42, baitWeight: 1.0,  favoredDirection: null,       directionBonus: 0, wavePreference: "calm",     clarityW: 0.18, lightW: 0.12, windW: 0.06, nightWeight: 0,   zoneBias: 0.6 },
  snook:    { presenceWeight: 0.50, feedingWeight: 0.50, baitWeight: 1.0,  favoredDirection: "incoming", directionBonus: 8, wavePreference: "calm",     clarityW: 0.20, lightW: 0.12, windW: 0.08, nightWeight: 0,   zoneBias: -0.6 },
  pompano:  { presenceWeight: 0.52, feedingWeight: 0.48, baitWeight: 0.15, favoredDirection: "incoming", directionBonus: 8, wavePreference: "calm",     clarityW: 0.20, lightW: 0.04, windW: 0.08, nightWeight: 0,   zoneBias: -0.4 },
  whiting:  { presenceWeight: 0.48, feedingWeight: 0.52, baitWeight: 0.10, favoredDirection: null,       directionBonus: 0, wavePreference: "calm",     clarityW: 0.16, lightW: 0.03, windW: 0.08, nightWeight: 0,   zoneBias: -0.5 },
  bluefish: { presenceWeight: 0.58, feedingWeight: 0.42, baitWeight: 1.0,  favoredDirection: null,       directionBonus: 0, wavePreference: "rough",    clarityW: 0.08, lightW: 0.10, windW: 0.10, nightWeight: 0,   zoneBias: 0.2 },
  blacktip: { presenceWeight: 0.56, feedingWeight: 0.44, baitWeight: 0.8,  favoredDirection: null,       directionBonus: 0, wavePreference: "rough",    clarityW: 0,    lightW: 0.05, windW: 0.06, nightWeight: 1.0, zoneBias: 0.4 },
  spinner:  { presenceWeight: 0.54, feedingWeight: 0.46, baitWeight: 0.8,  favoredDirection: null,       directionBonus: 0, wavePreference: "tolerant", clarityW: 0,    lightW: 0.05, windW: 0.06, nightWeight: 1.0, zoneBias: 0.3 },
  bull:     { presenceWeight: 0.50, feedingWeight: 0.50, baitWeight: 0.8,  favoredDirection: null,       directionBonus: 0, wavePreference: "rough",    clarityW: 0,    lightW: 0.05, windW: 0.06, nightWeight: 0.9, zoneBias: 0.6 },
  jack:     { presenceWeight: 0.48, feedingWeight: 0.52, baitWeight: 0.9,  favoredDirection: null,       directionBonus: 0, wavePreference: "tolerant", clarityW: 0.10, lightW: 0.06, windW: 0.08, nightWeight: 0,   zoneBias: 0 },
  mackerel: { presenceWeight: 0.56, feedingWeight: 0.44, baitWeight: 0.6,  favoredDirection: null,       directionBonus: 0, wavePreference: "calm",     clarityW: 0.18, lightW: 0.06, windW: 0.08, nightWeight: 0,   zoneBias: 0.1 },
};

// ---------------------------------------------------------------------
// PRESENCE — temp × season, plus a small bait-driven nudge. Bait's
// "inferred-seasonal" tier is a WEAK secondary nudge here (it's a prior,
// not evidence); its "observed" tier gets a modestly larger nudge (a
// confirmed sighting is real evidence the species is around), but the
// true observed rescue happens in finalActivity, not here — Presence
// stays honest about season+temp.
// ---------------------------------------------------------------------
function computePresence(species, tempF, month, baitInfo) {
  const suit = tempSuitability(species, tempF);
  if (suit == null) return null;
  const core = suit * SEASONAL_MULT[species][month - 1];
  const r = SPECIES_RULES[species];
  let bait = 0;
  if (baitInfo?.tier === "observed") bait = Math.round(10 * r.baitWeight);
  else if (baitInfo?.tier === "inferred-seasonal") bait = Math.round(((baitInfo.score - 50) / 50) * 6 * r.baitWeight);
  return Math.max(0, Math.min(100, Math.round(core) + bait));
}

// Surf height penalty is now deliberately steep for calm-preference species
// — under 3ft is the real "ideal" zone, 3ft itself is only okay (not great),
// and 4ft is a genuine, visible drop, not a mild dip. This also compounds
// with estimateWaterClarity() below (rough surf independently degrades
// clarity too), so rough surf hits calm-water species twice: once directly
// via wave conditions, once again via the water it stirs up.
function waveSubscore(waveFt, preference) {
  if (waveFt == null) return 50;
  if (preference === "calm") {
    if (waveFt <= 1.5) return 100;
    if (waveFt <= 2.5) return 88;
    if (waveFt <= 3.0) return 68; // "ok but not great"
    if (waveFt <= 3.5) return 48;
    if (waveFt <= 4.0) return 32; // "not good"
    if (waveFt <= 5.0) return 18;
    if (waveFt <= 6.5) return 8;
    return 3;
  }
  if (preference === "rough") {
    if (waveFt <= 1.5) return 40; if (waveFt <= 4) return 75; if (waveFt <= 7) return 100; return 55;
  }
  // "tolerant" — flatter curve, only extreme chop really hurts
  if (waveFt <= 6) return 85; if (waveFt <= 8) return 55; return 25;
}
function windSubscore(windKt) {
  if (windKt == null) return 50;
  if (windKt <= 10) return 90; if (windKt <= 18) return 55; return 20;
}

// Rough/dirty conditions cap FEEDING specifically, never Presence — a
// blown-out day doesn't mean the fish left, just that they're hard to
// catch. Thresholds now match the same 3ft/4ft boundaries as the wave
// sub-score and clarity estimate — so even rough-water-tolerant species
// (sharks, jack, bluefish) feel a real ceiling by 4ft, not just calm-
// preference species via their wave curve alone.
function computeFeedingCeiling(waveFt, clarityScore) {
  let ceiling = 98;
  if (waveFt != null) {
    if (waveFt > 5) ceiling = 45;
    else if (waveFt > 4) ceiling = 65;
    else if (waveFt > 3) ceiling = 85;
  }
  if (clarityScore != null) {
    if (clarityScore < 30) ceiling = Math.min(ceiling, 55);
    else if (clarityScore < 45) ceiling = Math.min(ceiling, 75);
  }
  return ceiling;
}

// ---------------------------------------------------------------------
// FEEDING — a WEIGHTED AVERAGE of already-normalized 0-100 sub-scores
// (tide flow, wave, clarity, wind, low-light, bait), which guarantees the
// 0-100 range BY CONSTRUCTION rather than by clamping an unbounded
// additive pile after the fact. A small species-specific tide-direction
// nudge and (sharks only) a true-darkness nudge apply after the average.
// ---------------------------------------------------------------------
function computeFeeding(species, { tideStage, waveFt, clarityScore, windKt, isNight, lowLight, baitInfo }) {
  const r = SPECIES_RULES[species];
  const tideSub = tideStage ? Math.round(tideStage.flowStrength * 100) : 50;
  const waveSub = waveSubscore(waveFt, r.wavePreference);
  const claritySub = clarityScore != null ? clarityScore : 50;
  const windSub = windSubscore(windKt);
  const lightSub = lowLight ? 90 : 50;
  const baitSub = baitInfo?.tier === "observed" ? 95 : baitInfo?.tier === "inferred-seasonal" ? baitInfo.score : 50;

  const wTide = 0.32, wWave = 0.14, wClarity = r.clarityW, wWind = r.windW, wLight = r.lightW;
  const wBait = 0.10 + 0.20 * r.baitWeight;
  const wSum = wTide + wWave + wClarity + wWind + wLight + wBait;

  const contributions = [
    { key: "Tide", sub: tideSub, w: wTide },
    { key: "Wave", sub: waveSub, w: wWave },
    { key: "Clarity", sub: claritySub, w: wClarity },
    { key: "Wind", sub: windSub, w: wWind },
    { key: "Light", sub: lightSub, w: wLight },
    { key: "Bait", sub: baitSub, w: wBait },
  ];

  let score = contributions.reduce((sum, c) => sum + c.sub * c.w, 0) / wSum;

  if (tideStage && r.favoredDirection) {
    score += tideStage.direction === r.favoredDirection ? r.directionBonus : -2;
  }
  let nightBonus = 0;
  if (isNight && r.nightWeight) {
    nightBonus = Math.round(15 * r.nightWeight);
    score += nightBonus;
  }

  const ceiling = computeFeedingCeiling(waveFt, clarityScore);
  const finalScore = Math.max(5, Math.min(ceiling, Math.round(score)));

  return { score: finalScore, contributions, wSum, nightBonus, tideStage };
}

// Presence readings above 90 are hard-capped at 90 before blending — a 100
// is almost always a clamp artifact of temp+season both saturating at
// once, not extra real information, so it shouldn't fully convert into a
// high final score when Feeding is only mediocre. Presence <=90 is
// completely untouched by this.
function effectivePresence(presence) {
  return Math.min(presence, 90);
}

// FINAL = weighted blend of (compressed) presence and feeding, plus a
// small bounded "confirmed bait can partially rescue a weak season"
// adjustment — capped so it can meaningfully lift the score without ever
// reading as "excellent" when the season/temp fundamentals are poor.
function computeFinalActivity(species, presence, feeding, baitInfo, secondaryAdj) {
  const r = SPECIES_RULES[species];
  let final = r.presenceWeight * effectivePresence(presence) + r.feedingWeight * feeding + (secondaryAdj || 0);
  let opportunistic = false;
  if (baitInfo?.tier === "observed" && presence < 40 && feeding >= 75) {
    final += 8;
    opportunistic = true;
    final = Math.min(final, 62);
  }
  return { final: Math.max(5, Math.min(98, Math.round(final))), opportunistic };
}

// Confidence reflects DATA QUALITY, not score magnitude — a 90 built on
// unknowns is Low confidence; a 55 built on full real data can be High.
function computeSpeciesConfidence(baitInfo, tempKnown, clarityKnown, buoyKnown) {
  let points = (tempKnown ? 1 : 0) + (clarityKnown ? 1 : 0) + (buoyKnown ? 1 : 0) + 1; // +1 for tide (always known here)
  if (baitInfo?.tier === "observed") points += 2;
  else if (baitInfo?.tier === "inferred-seasonal") points += 0.5;
  if (points >= 5.5) return "High";
  if (points >= 4) return "Moderate";
  return "Low";
}

// Builds the display factors[] array the Evidence tab already knows how
// to render — each Feeding sub-score's CONTRIBUTION (weight × deviation
// from neutral 50) sums exactly back to (feeding-50), so the breakdown is
// mathematically honest, not decorative.
function buildSpeciesFactors(species, presence, feedingResult, tempF, month, baitInfo, isNight) {
  const factors = [];
  const suit = tempSuitability(species, tempF);
  factors.push({ label: `Water temp ${tempF != null ? Math.round(tempF) + "°F" : "unknown"} — ${suit}/100 suitability for this species`, shortLabel: "Temp", delta: suit != null ? (suit - 50) : 0 });
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const seasonMult = SEASONAL_MULT[species][month - 1];
  factors.push({ label: `${monthNames[month - 1]} seasonal likelihood ×${seasonMult.toFixed(2)} on the temperature baseline`, shortLabel: "Season", delta: Math.round((seasonMult - 1) * 40) });
  for (const c of feedingResult.contributions) {
    if (c.w <= 0) continue;
    const delta = Math.round((c.sub - 50) * c.w / feedingResult.wSum);
    if (delta === 0 && c.key === "Bait" && baitInfo?.tier === "unknown") continue; // don't clutter with a true no-op
    let label;
    if (c.key === "Tide") label = `Tide flow ${c.sub}%`;
    else if (c.key === "Wave") label = "Offshore wave height";
    else if (c.key === "Clarity") label = "Water clarity (estimated)";
    else if (c.key === "Wind") label = "Wind";
    else if (c.key === "Light") label = c.sub > 50 ? "Low-light window" : "Midday light";
    else if (c.key === "Bait") label = baitInfo?.tier === "observed" ? "Observed bait" : baitInfo?.tier === "inferred-seasonal" ? `${baitInfo.level} inferred-seasonal bait` : "Bait unknown";
    factors.push({ label, shortLabel: c.key, delta });
  }
  if (feedingResult.nightBonus) factors.push({ label: "After dark — this species feeds more actively at night", shortLabel: "Night", delta: feedingResult.nightBonus });
  return factors;
}


// zoneBias: shifts predicted fish position closer to shore (negative) or
// farther out (positive) — snook/whiting are classic trough hunters that
// hold tight, tarpon and the sharks range farther and past the bars.
// baitWeight: how much a predator's score responds to inferred bait
// presence. Sand-flea/crustacean feeders (pompano, whiting) barely react;
// bait-school predators (tarpon, snook, jacks, bluefish, sharks) react a lot.

// ===========================================================================
// BAIT ACTIVITY — three explicit tiers, never blended into one fake number:
//
//   OBSERVED — would come from real reports (Activity tab RSS / future user
//     logs). None exist yet; this app doesn't fabricate them. When a report
//     pipeline exists, it plugs in here without changing this shape.
//   INFERRED-SEASONAL — a weak, indirect signal, and only when water temp
//     AND the FL fall mullet-run calendar window both point the same way.
//     Previously this fired on temp alone OR season alone, which is exactly
//     the "warm water + September = bait" assumption that doesn't actually
//     hold — a warm February day isn't the mullet run, and cool October
//     water isn't guaranteed bait either. Kept deliberately low-weight.
//   UNKNOWN — no water temp reading at all. Shown as Unknown, not defaulted
//     to Moderate.
// ===========================================================================
function inferBaitActivity(buoy, now) {
  if (!buoy || buoy.waterTempF == null) {
    return { tier: "unknown", level: "Unknown", score: null, basis: "No water temperature reading available" };
  }
  const t = buoy.waterTempF;
  const tempFavorable = t >= 72 && t <= 84;
  const month = now.getUTCMonth() + 1;
  const inMulletRun = month >= 9 && month <= 11;

  if (tempFavorable && inMulletRun) {
    return { tier: "inferred-seasonal", level: "Elevated (seasonal)", score: 68, basis: `Water temp ${Math.round(t)}°F is in the comfortable range AND it's the FL fall mullet-run window — both together, not either alone` };
  }
  if (tempFavorable || inMulletRun) {
    return { tier: "inferred-seasonal", level: "Typical", score: 52, basis: tempFavorable ? `Water temp ${Math.round(t)}°F is in the comfortable range, but it's outside the fall mullet-run window` : "It's the fall mullet-run window, but water temp isn't in the typically favorable range" };
  }
  return { tier: "inferred-seasonal", level: "Reduced (seasonal)", score: 38, basis: `Water temp ${Math.round(t)}°F is outside the typically favorable range, and it's not the fall mullet-run window` };
}

// ===========================================================================
// FISH POSITION + CASTING DISTANCE — the app's signature feature. Turns
// surf height + tide movement into a concrete surf-zone guess and a yardage
// range, instead of just showing raw wave height and leaving the angler to
// interpret it. This is explicitly an INFERENCE, not measured structure —
// there's no real bathymetry data source here, and this app doesn't invent
// one. Confidence is downgraded honestly when inputs are thin.
// ===========================================================================
const ZONE_NAMES = ["Beach edge", "Shorebreak", "First trough", "First bar", "Second trough", "Second bar", "Beyond second bar"];
const ZONE_DISTANCES_YD = [[0, 10], [5, 20], [20, 40], [35, 55], [50, 80], [70, 95], [90, 120]];

function baseZoneFromSurf(waveHeightFt) {
  if (waveHeightFt == null) return null;
  if (waveHeightFt <= 1.0) return 1;
  if (waveHeightFt <= 2.0) return 2;
  if (waveHeightFt <= 3.0) return 2.5;
  if (waveHeightFt <= 4.5) return 3.3;
  if (waveHeightFt <= 6.0) return 4.2;
  return 5.5;
}

function predictFishPosition(tideStage, buoy, zoneBias) {
  const waveFt = buoy?.waveHeightFt;
  const base = baseZoneFromSurf(waveFt);
  if (base == null) return null; // honest: no surf reading, no position guess
  let idx = base;
  let confidence = "Medium";
  if (tideStage) {
    idx += tideStage.flowStrength > 0.6 ? -0.4 : 0.25;
    confidence = tideStage.flowStrength > 0.3 ? "High" : "Medium";
  } else {
    confidence = "Low";
  }
  idx += zoneBias || 0;
  idx = Math.max(0, Math.min(6, idx));
  const lower = Math.floor(idx), upper = Math.min(6, lower + 1);
  const frac = idx - lower;
  const primary = frac < 0.5 ? lower : upper;
  const secondary = frac < 0.5 ? Math.min(6, lower + 1) : Math.max(0, upper - 1);
  return {
    primaryZone: ZONE_NAMES[primary],
    secondaryZone: ZONE_NAMES[secondary],
    distanceYd: ZONE_DISTANCES_YD[primary],
    confidence,
    waveFt,
  };
}

function computeFishability(buoy) {
  if (!buoy || (buoy.waveHeightFt == null && buoy.windSpeedKt == null)) return null;
  let score = 85;
  const factors = [];
  if (buoy.waveHeightFt != null) {
    let d;
    if (buoy.waveHeightFt <= 2) d = 5;
    else if (buoy.waveHeightFt <= 4) d = -8;
    else if (buoy.waveHeightFt <= 6) d = -22;
    else d = -40;
    score += d;
    factors.push({ label: `Surf ${buoy.waveHeightFt.toFixed(1)} ft`, shortLabel: "Surf", delta: d });
  }
  if (buoy.windSpeedKt != null) {
    let d;
    if (buoy.windSpeedKt <= 10) d = 5;
    else if (buoy.windSpeedKt <= 18) d = -8;
    else d = -20;
    score += d;
    factors.push({ label: `Wind ${Math.round(buoy.windSpeedKt)} kt`, shortLabel: "Wind", delta: d });
  }
  score = Math.max(5, Math.min(95, Math.round(score)));
  return { score, factors };
}

// GO / MAYBE / DON'T GO — the single headline judgment, built from Fish
// Activity (average of live species scores) and Fishability (above). Kept
// deliberately coarse (3 buckets, no decimal percentages) — this is a
// behavioral read of conditions, not a catch guarantee.
function computeGoStatus(fishActivity, fishability) {
  if (fishActivity == null || fishability == null) return null;
  if (fishActivity >= 65 && fishability >= 55) return { label: "GO FISH", color: "#17D9C4" };
  if ((fishActivity + fishability) / 2 >= 45) return { label: "MAYBE", color: "#F5A623" };
  return { label: "DON'T GO", color: "#FF5D5D" };
}


// Is it dark right now at this beach? Brackets "now" against both today's
// and adjacent days' sunrise/sunset (using the same verified sun-time math
// as the bite-window predictor) so it's correct near midnight too.
function computeIsNight(now, lat, lon) {
  const y = computeSunTimes(new Date(now.getTime() - 86400000), lat, lon);
  const t = computeSunTimes(now, lat, lon);
  const tmrw = computeSunTimes(new Date(now.getTime() + 86400000), lat, lon);
  return (now >= t.sunset && now < tmrw.sunrise) || (now >= y.sunset && now < t.sunrise);
}

// Weak secondary modifier — moon (tarpon only, folklore-grade for
// everyone else) and pressure (bluefish + the 3 sharks, some documented
// storm-linked feeding behavior). Hard-capped at ±5 total regardless of
// species so it can never rescue a poor Presence/Feeding combination, per
// the "weak secondary variable" requirement — this sits OUTSIDE both
// Presence and Feeding, not blended into either.
function computeSecondaryAdjustment(species, moonFactor, buoy) {
  const moonWeight = species === "tarpon" ? 0.4 : 0;
  const pressureWeight = (species === "bluefish" || species === "blacktip" || species === "spinner" || species === "bull") ? 0.5 : 0;
  let adj = 0;
  if (moonFactor && moonWeight) adj += moonFactor.bonus * moonWeight;
  if (buoy?.pressureTendencyHpa != null && pressureWeight) {
    let pb;
    if (buoy.pressureTendencyHpa <= -1) pb = 8;
    else if (buoy.pressureTendencyHpa < 0) pb = 3;
    else if (buoy.pressureTendencyHpa <= 1) pb = 0;
    else pb = -6;
    adj += pb * pressureWeight;
  }
  return Math.max(-5, Math.min(5, Math.round(adj)));
}

// Single unified scorer used by every species — pompano no longer needs
// bespoke treatment now that temp curves/seasonal priors/rules cover it
// the same way as everyone else.
function scoreSpecies(species, tideStage, moonFactor, buoyFactor, clarityEstimate, isNight, baitInfo) {
  if (!tideStage) return null;
  const buoy = buoyFactor?.buoy;
  const tempF = buoy?.waterTempF ?? null;
  const now = new Date();
  const month = now.getUTCMonth() + 1;

  const presence = computePresence(species, tempF, month, baitInfo);
  const feedingResult = computeFeeding(species, {
    tideStage, waveFt: buoy?.waveHeightFt, clarityScore: clarityEstimate?.score,
    windKt: buoy?.windSpeedKt, isNight, lowLight: isNight, baitInfo,
  });
  const secondaryAdj = computeSecondaryAdjustment(species, moonFactor, buoy);
  const { final, opportunistic } = computeFinalActivity(species, presence ?? 50, feedingResult.score, baitInfo, secondaryAdj);
  const confidence = computeSpeciesConfidence(baitInfo, tempF != null, clarityEstimate != null, buoy != null);
  const factors = buildSpeciesFactors(species, presence ?? 50, feedingResult, tempF, month, baitInfo, isNight);
  if (secondaryAdj !== 0) {
    const label = species === "tarpon" ? "Moon phase (weak secondary modifier, capped ±5)" : "Barometric pressure (weak secondary modifier, capped ±5)";
    factors.push({ label, shortLabel: "Secondary", delta: secondaryAdj });
  }

  return {
    score: final, presence, feeding: feedingResult.score, confidence, opportunistic,
    factors, tideStage,
  };
}

const TIDE_MODELS = {
  pompano: (t, m, b, c, n, k) => scoreSpecies("pompano", t, m, b, c, n, k),
  blacktip: (t, m, b, c, n, k) => scoreSpecies("blacktip", t, m, b, c, n, k),
  spinner: (t, m, b, c, n, k) => scoreSpecies("spinner", t, m, b, c, n, k),
  bull: (t, m, b, c, n, k) => scoreSpecies("bull", t, m, b, c, n, k),
  tarpon: (t, m, b, c, n, k) => scoreSpecies("tarpon", t, m, b, c, n, k),
  snook: (t, m, b, c, n, k) => scoreSpecies("snook", t, m, b, c, n, k),
  jack: (t, m, b, c, n, k) => scoreSpecies("jack", t, m, b, c, n, k),
  bluefish: (t, m, b, c, n, k) => scoreSpecies("bluefish", t, m, b, c, n, k),
  whiting: (t, m, b, c, n, k) => scoreSpecies("whiting", t, m, b, c, n, k),
  mackerel: (t, m, b, c, n, k) => scoreSpecies("mackerel", t, m, b, c, n, k),
};




// ===========================================================================
// MOON — pure astronomical calculation, not a live feed. Reliable and
// deterministic the same way tide harmonic predictions are: it's math, not a
// fabricated guess, so it's fair to treat as a real input alongside tide.
// ===========================================================================

const SYNODIC_MONTH_DAYS = 29.53058867;

// Age in days since the last new moon (0 = new moon), plus a fraction-based
// illumination estimate and the conventional phase name.
function computeMoonPhase(date) {
  const knownNewMoonMs = Date.UTC(2000, 0, 6, 18, 14, 0);
  const diffDays = (date.getTime() - knownNewMoonMs) / 86400000;
  const age = ((diffDays % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  const illumination = (1 - Math.cos((age / SYNODIC_MONTH_DAYS) * 2 * Math.PI)) / 2;
  let name;
  if (age < 1.84566) name = "New Moon";
  else if (age < 5.53699) name = "Waxing Crescent";
  else if (age < 9.22831) name = "First Quarter";
  else if (age < 12.91963) name = "Waxing Gibbous";
  else if (age < 16.61096) name = "Full Moon";
  else if (age < 20.30228) name = "Waning Gibbous";
  else if (age < 23.99361) name = "Last Quarter";
  else if (age < 27.68493) name = "Waning Crescent";
  else name = "New Moon";
  return { age, illumination, name };
}

// Folk/solunar heuristic: feeding activity is commonly associated with new
// and full moons (strongest spring tides, most light/dark contrast), weakest
// at the quarters. `intensity` is 1.0 at new/full, 0 at the quarters. Kept
// as a modest bonus (max 10 pts) since this is the softest-evidence factor
// in the model — real, but folklore-grade, not measured-grade like tide.
function scoreMoonFactor(moonPhase) {
  const intensity = Math.abs(Math.cos((moonPhase.age / SYNODIC_MONTH_DAYS) * 2 * Math.PI));
  const bonus = Math.round(intensity * 10);
  return { bonus, intensity, moonPhase };
}

// ===========================================================================
// SUN TIMES — pure astronomical calculation (standard NOAA solar calculator
// equations), same honesty tier as moon phase: deterministic math, not a
// fabricated guess or a live fetch. Verified against published sunrise/
// sunset times for Miami and Jacksonville Beach (within 1-2 minutes).
// ===========================================================================
function computeSunTimes(dateUTC, lat, lon) {
  const rad = Math.PI / 180;
  const yearStart = Date.UTC(dateUTC.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((dateUTC.getTime() - yearStart) / 86400000);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (dateUTC.getUTCHours() - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const latRad = lat * rad;
  const zenith = 90.833 * rad; // standard sunrise/sunset zenith (refraction + solar radius)
  const cosHA = (Math.cos(zenith) / (Math.cos(latRad) * Math.cos(decl))) - Math.tan(latRad) * Math.tan(decl);
  const haDeg = Math.acos(Math.max(-1, Math.min(1, cosHA))) / rad;
  const solarNoonMin = 720 - 4 * lon - eqTime; // minutes UTC
  const dayStartUTC = Date.UTC(dateUTC.getUTCFullYear(), dateUTC.getUTCMonth(), dateUTC.getUTCDate());
  return {
    sunrise: new Date(dayStartUTC + (solarNoonMin - 4 * haDeg) * 60000),
    sunset: new Date(dayStartUTC + (solarNoonMin + 4 * haDeg) * 60000),
  };
}

// Bonus for being near a sunrise/sunset transition, tapering to a mild
// penalty deep in the midday (or overnight) trough — reflects the classic
// low-light bite-window pattern, not just tide flow in isolation.
function solarProximityBonus(t, sunEvents) {
  let minDist = Infinity;
  for (const ev of sunEvents) {
    const dist = Math.abs(t.getTime() - ev.getTime()) / 60000; // minutes
    if (dist < minDist) minDist = dist;
  }
  if (minDist <= 30) return 22;
  if (minDist <= 60) return 15;
  if (minDist <= 120) return 6;
  if (minDist <= 240) return -4;
  return -12;
}

// Scans the next ~24 hours of already-fetched tide predictions (15-min
// steps) for the best combined tide-flow + dawn/dusk window. Only tide,
// sun, and moon are included — wave/wind/pressure aren't forecast, only
// measured right now, so they can't honestly feed a future prediction yet.
function predictNextBestBite(hiloRows, lat, lon, moonFactor, fromDate) {
  if (!hiloRows || hiloRows.length < 2) return null;
  const sorted = [...hiloRows].sort(
    (a, b) => new Date(a.observedAt.replace(" ", "T")) - new Date(b.observedAt.replace(" ", "T"))
  );
  const start = fromDate.getTime();
  const horizonMs = 24 * 3600 * 1000;

  const sunEvents = [];
  for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
    const d = new Date(start + dayOffset * 86400000);
    const { sunrise, sunset } = computeSunTimes(d, lat, lon);
    sunEvents.push(sunrise, sunset);
  }

  const stepMs = 15 * 60000;
  const samples = [];
  for (let t = start; t <= start + horizonMs; t += stepMs) {
    const sampleDate = new Date(t);
    const stage = computeTideStage(sorted, sampleDate);
    if (!stage) continue;
    const flowBonus = Math.round(stage.flowStrength * 30);
    const solarBonus = solarProximityBonus(sampleDate, sunEvents);
    const moonBonus = moonFactor ? Math.round(moonFactor.bonus * 0.4) : 0;
    const score = Math.max(5, Math.min(95, 50 + flowBonus + solarBonus + moonBonus));
    samples.push({ time: sampleDate, score, stage, flowBonus, solarBonus, moonBonus });
  }
  if (samples.length === 0) return null;

  let peakIdx = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].score > samples[peakIdx].score) peakIdx = i;
  const peak = samples[peakIdx];

  const threshold = peak.score - 8;
  let startIdx = peakIdx, endIdx = peakIdx;
  while (startIdx > 0 && samples[startIdx - 1].score >= threshold) startIdx--;
  while (endIdx < samples.length - 1 && samples[endIdx + 1].score >= threshold) endIdx++;

  const reasonParts = [
    { label: `${peak.stage.direction === "incoming" ? "Incoming" : "Outgoing"} tide, ${Math.round(peak.stage.flowStrength * 100)}% of peak flow`, shortLabel: "Tide", delta: peak.flowBonus },
    {
      label: peak.solarBonus >= 15
        ? "Near sunrise/sunset — the classic low-light bite window"
        : peak.solarBonus <= -4
          ? "Midday, away from dawn/dusk"
          : "Moderate light, not right at dawn/dusk",
      shortLabel: "Light",
      delta: peak.solarBonus,
    },
  ];
  if (moonFactor) reasonParts.push({ label: `${moonFactor.moonPhase.name} lunar influence`, shortLabel: "Moon", delta: peak.moonBonus });

  return {
    windowStart: samples[startIdx].time,
    windowEnd: samples[endIdx].time,
    peakTime: peak.time,
    score: peak.score,
    reasonParts,
  };
}

// Calls one of our proxy's routes. The proxy validates its own params and
// returns either the real upstream JSON (success) or {error} with a
// non-200 status (failure) — never silently substituted data. `stationId`
// is the common case (becomes ?station=...); pass extraParams for routes
// that use a different query key (e.g. /trends/rss?source=...).
async function fetchViaProxy(path, stationId, extraParams) {
  const params = new URLSearchParams(extraParams || {});
  if (stationId != null) params.set("station", stationId);
  const url = `${PROXY_BASE_URL}${path}?${params.toString()}`;
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    // Fires if the Worker itself is unreachable — different failure mode
    // than a NOAA-side error, worth distinguishing in the message.
    throw new Error(`Could not reach the proxy at ${PROXY_BASE_URL}: ${networkErr.message}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Proxy returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok || json.error) {
    throw new Error(json.error || `Proxy/NOAA returned HTTP ${res.status}`);
  }
  return json;
}


// Predicted high/low tides for the next ~36-48 hours.
async function fetchTidePredictions(stationId) {
  const json = await fetchViaProxy("/tides/predictions", stationId);
  const retrievedAt = new Date().toISOString();
  const rows = (json.predictions || []).map((p) => ({
    time: p.t, value: parseFloat(p.v), tideType: p.type === "H" ? "H" : "L",
  }));
  return normalizeObservations({
    rows, stationId, stationName: NOAA_STATIONS[stationId]?.stationName,
    product: "predictions", parameter: "tide_height", unit: "ft", datum: "MLLW",
    sourceType: "official_prediction", reliability: 90, retrievedAt,
  });
}

// Predicted tide height curve at hourly steps, for charting. Only available
// at "harmonic" NOAA stations — subordinate stations (like Fort Pierce, South
// Jetty) legitimately don't offer this and will report DATA UNAVAILABLE.
async function fetchTideCurve(stationId) {
  const json = await fetchViaProxy("/tides/curve", stationId);
  const retrievedAt = new Date().toISOString();
  const rows = (json.predictions || []).map((p) => ({ time: p.t, value: parseFloat(p.v) }));
  return normalizeObservations({
    rows, stationId, stationName: NOAA_STATIONS[stationId]?.stationName,
    product: "predictions", parameter: "tide_height", unit: "ft", datum: "MLLW",
    sourceType: "official_prediction", reliability: 90, retrievedAt,
  });
}

// Actual observed water level from the station sensor (not a prediction).
// This will legitimately fail with "no data" on stations without a working
// sensor, or during an outage — that is reported as DATA UNAVAILABLE, never
// backfilled with a prediction or demo value.
async function fetchLiveWaterLevel(stationId) {
  const json = await fetchViaProxy("/tides/current", stationId);
  const retrievedAt = new Date().toISOString();
  const rows = (json.data || []).map((d) => ({ time: d.t, value: parseFloat(d.v) }));
  if (rows.length === 0) throw new Error("NOAA returned no current water-level reading for this station");
  return normalizeObservations({
    rows, stationId, stationName: NOAA_STATIONS[stationId]?.stationName,
    product: "water_level", parameter: "water_level", unit: "ft", datum: "MLLW",
    sourceType: "official_live_observation", reliability: 97, retrievedAt,
  })[0];
}

// Top-level call the UI uses. Fetches everything for one beach's mapped
// station and returns a clear ok/error result per product — never mixes
// in demo data as a fallback.
async function fetchNoaaBundleForBeach(beachId, { force = false } = {}) {
  const station = NOAA_STATIONS[beachId];
  if (!station) {
    return { connected: false, reason: "No NOAA station has been mapped to this beach yet." };
  }
  return cachedFetch(`tide:${station.stationId}`, async () => {
    const results = await Promise.allSettled([
      fetchTidePredictions(station.stationId),
      fetchTideCurve(station.stationId),
      fetchLiveWaterLevel(station.stationId),
    ]);
    const [hiloRes, curveRes, liveRes] = results;
    return {
      connected: true,
      stationId: station.stationId,
      stationName: station.stationName,
      hilo: hiloRes.status === "fulfilled" ? { ok: true, data: hiloRes.value } : { ok: false, error: hiloRes.reason.message },
      curve: curveRes.status === "fulfilled" ? { ok: true, data: curveRes.value } : { ok: false, error: curveRes.reason.message },
      liveLevel: liveRes.status === "fulfilled" ? { ok: true, data: liveRes.value } : { ok: false, error: liveRes.reason.message },
    };
  }, { force });
}

// ===========================================================================
// DEMO DATA — everything below is fabricated for prototyping the UI/UX only.
// No live buoys, weather APIs, or social scrapers are connected. Only tide
// data for Fort Pierce Inlet can be switched to LIVE (NOAA CO-OPS) below.
// ===========================================================================

const SPECIES = [
  { id: "pompano", name: "Pompano", tag: "gamefish" },
  { id: "blacktip", name: "Blacktip shark", tag: "shark" },
  { id: "spinner", name: "Spinner shark", tag: "shark" },
  { id: "bull", name: "Bull shark", tag: "shark" },
  { id: "tarpon", name: "Tarpon", tag: "gamefish" },
  { id: "snook", name: "Snook", tag: "gamefish" },
  { id: "jack", name: "Jack crevalle", tag: "gamefish" },
  { id: "bluefish", name: "Bluefish", tag: "gamefish" },
  { id: "whiting", name: "Whiting", tag: "gamefish" },
  { id: "mackerel", name: "Spanish mackerel", tag: "gamefish" },
];

// Real geography only — name, zone, coastal region, and lat/lon (for
// sunrise/sunset calculation). Every score, condition, evidence item, and
// trend is now computed live via NOAA/NDBC/moon math (see TIDE_MODELS above)
// or fetched on-demand (Activity tab); nothing here is fabricated. Order is
// Jacksonville → Miami, north to south.
const BEACHES = [
  { id: "amelia-island", name: "Amelia Island", zone: "Main Beach access", coast: "First Coast", lat: 30.6714, lon: -81.4551 },
  { id: "jacksonville-beach", name: "Jacksonville Beach", zone: "Beach Blvd access", coast: "First Coast", lat: 30.2947, lon: -81.3931 },
  { id: "ponte-vedra-beach", name: "Ponte Vedra Beach", zone: "Guana Preserve access", coast: "First Coast", lat: 30.2394, lon: -81.3862 },
  { id: "st-augustine-beach", name: "St. Augustine Beach", zone: "St. Johns County Pier", coast: "First Coast", lat: 29.8508, lon: -81.2648 },
  { id: "vilano-beach", name: "Vilano Beach", zone: "Vilano Bridge, north side", coast: "First Coast", lat: 29.9139, lon: -81.3081 },
  { id: "flagler-beach", name: "Flagler Beach", zone: "Flagler Beach Pier", coast: "Flagler / Volusia Coast", lat: 29.4747, lon: -81.1256 },
  { id: "playalinda-beach", name: "Playalinda Beach", zone: "Canaveral National Seashore", coast: "Space Coast", lat: 28.6197, lon: -80.6081 },
  { id: "new-smyrna-beach", name: "New Smyrna Beach", zone: "27th Ave approach", coast: "Flagler / Volusia Coast", lat: 29.0258, lon: -80.9270 },
  { id: "daytona-beach", name: "Daytona Beach", zone: "Sun Splash Park access", coast: "Flagler / Volusia Coast", lat: 29.2108, lon: -81.0228 },
  { id: "cocoa-beach", name: "Cocoa Beach", zone: "Cocoa Beach Pier", coast: "Space Coast", lat: 28.3200, lon: -80.6076 },
  { id: "melbourne-beach", name: "Melbourne Beach", zone: "Spessard Holland Park", coast: "Space Coast", lat: 28.0798, lon: -80.5623 },
  { id: "vero-beach", name: "Vero Beach", zone: "South Beach Park", coast: "Treasure Coast", lat: 27.6386, lon: -80.3973 },
  { id: "fort-pierce", name: "Fort Pierce Inlet", zone: "North jetty", coast: "Treasure Coast", lat: 27.4762, lon: -80.3078 },
  { id: "jensen-beach", name: "Jensen Beach", zone: "Jensen Beach Park", coast: "Treasure Coast", lat: 27.2515, lon: -80.2231 },
  { id: "bathtub-beach", name: "Bathtub Beach", zone: "Sandbar cut", coast: "Treasure Coast", lat: 27.1706, lon: -80.2298 },
  { id: "stuart-beach", name: "Stuart Beach", zone: "Main lifeguard stand", coast: "Treasure Coast", lat: 27.1739, lon: -80.1917 },
  { id: "juno-beach", name: "Juno Beach", zone: "Juno Beach Pier", coast: "Palm Beaches", lat: 26.8792, lon: -80.0553 },
  { id: "jupiter-beach", name: "Jupiter Beach", zone: "Jupiter Inlet", coast: "Palm Beaches", lat: 26.9342, lon: -80.0731 },
  { id: "palm-beach", name: "Palm Beach", zone: "Midtown Beach", coast: "Palm Beaches", lat: 26.7056, lon: -80.0364 },
  { id: "fort-lauderdale-beach", name: "Fort Lauderdale Beach", zone: "Las Olas Blvd access", coast: "Broward", lat: 26.1224, lon: -80.1039 },
  { id: "hollywood-beach", name: "Hollywood Beach", zone: "Hollywood Broadwalk", coast: "Broward", lat: 26.0112, lon: -80.1187 },
  { id: "haulover-beach", name: "Haulover Beach", zone: "Haulover Inlet", coast: "Miami-Dade", lat: 25.9026, lon: -80.1211 },
  { id: "south-beach", name: "South Beach", zone: "5th St access", coast: "Miami-Dade", lat: 25.7826, lon: -80.1341 },
  { id: "key-biscayne", name: "Key Biscayne", zone: "Crandon Park", coast: "Miami-Dade", lat: 25.6931, lon: -80.1625 },
];

// ---------------------------------------------------------------------------

function scoreColor(score) {
  if (score >= 75) return "#17D9C4";
  if (score >= 50) return "#F5A623";
  return "#FF5D5D";
}

function ScoreRing({ score, size = 56 }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#1F3444" strokeWidth="5" fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="5" fill="none"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontFamily="'Space Grotesk', sans-serif" fontSize={size * 0.32} fontWeight="600" fill="#E7EFF3">
        {score}
      </text>
    </svg>
  );
}

function ConfidenceBadge({ level }) {
  const map = { High: "#17D9C4", Medium: "#F5A623", Low: "#FF5D5D" };
  return (
    <span style={{
      color: map[level] || "#8AA6B8", border: `1px solid ${map[level] || "#8AA6B8"}`,
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif",
      letterSpacing: 0.5,
    }}>
      {level} confidence
    </span>
  );
}

function LiveBadge({ small }) {
  return (
    <span style={{
      background: "#0F2B28", color: "#17D9C4", border: "1px solid #1F6B5F",
      borderRadius: 4, padding: small ? "1px 6px" : "3px 9px", fontSize: small ? 9.5 : 11,
      fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.6, whiteSpace: "nowrap",
    }}>
      LIVE
    </span>
  );
}

// Distinct from LiveBadge on purpose — amber, not teal — so an estimated
// value is never visually confused with a measured one.
function EstimatedBadge({ small }) {
  return (
    <span style={{
      background: "#2A2008", color: "#F5A623", border: "1px solid #6B4F1E",
      borderRadius: 4, padding: small ? "1px 6px" : "3px 9px", fontSize: small ? 9.5 : 11,
      fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.6, whiteSpace: "nowrap",
    }}>
      ESTIMATED
    </span>
  );
}

function DataUnavailable({ message }) {
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "flex-start", background: "#1A0E0E",
      border: "1px solid #6B1E1E", borderRadius: 10, padding: 12, marginBottom: 14,
    }}>
      <WifiOff size={14} color="#FF5D5D" style={{ marginTop: 2, flexShrink: 0 }} />
      <div>
        <div style={{ color: "#FF5D5D", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 3 }}>
          DATA UNAVAILABLE
        </div>
        <div style={{ color: "#E0A8A8", fontSize: 12, lineHeight: 1.4 }}>{message}</div>
      </div>
    </div>
  );
}

function ConditionRow({ icon: Icon, label, value }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
      <Icon size={14} color="#5A7A8A" />
      <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>{label}</span>
      <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// ---- Screens ---------------------------------------------------------------

// Shared hook: fetches live tide + buoy data for one beach (when active) and
// computes every species' live score from it. Used by both the beach detail
// screen and the radar list, so the list no longer shows stale demo numbers
// while claiming to be in LIVE mode.
function useLiveSpeciesScores(beachId) {
  const isLive = !!NOAA_STATIONS[beachId];
  const hasBuoy = !!NDBC_STATIONS[beachId];
  const hasMetar = !!METAR_STATIONS[beachId];

  const [noaaState, setNoaaState] = useState({ loading: isLive, bundle: null, fatalError: null });
  const [buoyState, setBuoyState] = useState({ loading: hasBuoy, buoy: null, fatalError: null });
  const [precipState, setPrecipState] = useState({ loading: hasMetar, precip: null, fatalError: null });

  const loadNoaa = useCallback((force = false) => {
    if (!isLive) { setNoaaState({ loading: false, bundle: null, fatalError: null }); return; }
    setNoaaState({ loading: true, bundle: null, fatalError: null });
    fetchNoaaBundleForBeach(beachId, { force })
      .then((bundle) => setNoaaState({ loading: false, bundle, fatalError: null }))
      .catch((err) => setNoaaState({ loading: false, bundle: null, fatalError: err.message }));
  }, [beachId, isLive]);

  const loadBuoy = useCallback((force = false) => {
    if (!hasBuoy) { setBuoyState({ loading: false, buoy: null, fatalError: null }); return; }
    setBuoyState({ loading: true, buoy: null, fatalError: null });
    fetchLatestBuoy(NDBC_STATIONS[beachId].stationId, { force })
      .then((buoy) => setBuoyState({ loading: false, buoy, fatalError: null }))
      .catch((err) => setBuoyState({ loading: false, buoy: null, fatalError: err.message }));
  }, [beachId, hasBuoy]);

  const loadPrecip = useCallback((force = false) => {
    if (!hasMetar) { setPrecipState({ loading: false, precip: null, fatalError: null }); return; }
    setPrecipState({ loading: true, precip: null, fatalError: null });
    fetchPrecip(METAR_STATIONS[beachId].stationId, { force })
      .then((precip) => setPrecipState({ loading: false, precip, fatalError: null }))
      .catch((err) => setPrecipState({ loading: false, precip: null, fatalError: err.message }));
  }, [beachId, hasMetar]);

  // Initial load uses the shared 2-minute cache (see cachedFetch above) so
  // beaches sharing a station, or revisiting a screen quickly, don't refire
  // identical requests. The refresh button below forces a real refetch.
  useEffect(() => { loadNoaa(false); }, [loadNoaa]);
  useEffect(() => { loadBuoy(false); }, [loadBuoy]);
  useEffect(() => { loadPrecip(false); }, [loadPrecip]);

  const refresh = useCallback(() => {
    loadNoaa(true);
    loadBuoy(true);
    loadPrecip(true);
  }, [loadNoaa, loadBuoy, loadPrecip]);

  const tideStage = (isLive && noaaState.bundle?.hilo?.ok)
    ? computeTideStage(noaaState.bundle.hilo.data, new Date())
    : null;
  const moonFactor = isLive ? scoreMoonFactor(computeMoonPhase(new Date())) : null;
  const buoyFactor = buoyState.buoy ? scoreBuoyFactor(buoyState.buoy) : null;
  const clarityEstimate = estimateWaterClarity(buoyState.buoy, precipState.precip, tideStage);
  const baitInfo = inferBaitActivity(buoyState.buoy, new Date());

  const beach = BEACHES.find((b) => b.id === beachId);
  const isNight = beach ? computeIsNight(new Date(), beach.lat, beach.lon) : false;

  const liveResults = {}; // speciesId -> { score, factors, tideStage }
  if (tideStage) {
    for (const [sid, modelFn] of Object.entries(TIDE_MODELS)) {
      const result = modelFn(tideStage, moonFactor, buoyFactor, clarityEstimate, isNight, baitInfo);
      if (result) liveResults[sid] = result;
    }
  }

  const liveEntries = Object.entries(liveResults);
  // Fish Activity is now target-specific — the top-relevant species' own
  // score — not a flat average across all 9 species (several of which may
  // not even be seasonally/behaviorally relevant to current conditions).
  // The average was diluting a strong single-species read into a mediocre
  // blended number, which is also why GO status rarely fired.
  const topEntry = liveEntries.length > 0 ? [...liveEntries].sort((a, b) => b[1].score - a[1].score)[0] : null;
  const fishActivity = topEntry ? topEntry[1].score : null;
  const topSpeciesId = topEntry ? topEntry[0] : null;
  const fishability = computeFishability(buoyState.buoy);
  const goStatus = computeGoStatus(fishActivity, fishability);

  // Position/casting distance depend on species (zoneBias), so this is a
  // function the caller invokes per species rather than one fixed value.
  // Explicitly a behavioral starting estimate, not measured trough
  // location — there's no real bathymetry source behind this.
  const getFishPosition = useCallback((speciesId) => {
    const bias = SPECIES_RULES[speciesId]?.zoneBias || 0;
    const pos = predictFishPosition(tideStage, buoyState.buoy, bias);
    return pos ? { ...pos, isEstimate: true } : null;
  }, [tideStage, buoyState.buoy]);

  return {
    isLive, hasBuoy, hasMetar, noaaState, buoyState, precipState, tideStage, moonFactor, buoyFactor, clarityEstimate, isNight,
    baitInfo, fishActivity, topSpeciesId, fishability, goStatus, getFishPosition,
    liveResults, loadNoaa, loadBuoy, loadPrecip, refresh,
    loading: isLive && (noaaState.loading || buoyState.loading),
  };
}

function BeachRadarCard({ beach, onSelectBeach }) {
  const { liveResults, loading } = useLiveSpeciesScores(beach.id);

  const liveEntries = Object.entries(liveResults);
  const liveOverall = liveEntries.length > 0
    ? [...liveEntries].sort((a, b) => b[1].score - a[1].score)[0][1].score
    : null;

  const topSpecies = liveEntries.sort((a, b) => b[1].score - a[1].score).slice(0, 3);

  return (
    <button
      onClick={() => onSelectBeach(beach.id)}
      style={{
        width: "100%", textAlign: "left", background: "#0E1B26", border: "1px solid #1F3444",
        borderRadius: 10, padding: "12px 14px", marginBottom: 10, display: "flex",
        alignItems: "center", gap: 12, cursor: "pointer",
      }}
    >
      {loading ? (
        <div style={{ width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <RefreshCw size={16} color="#5A7A8A" style={{ animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
        </div>
      ) : liveOverall != null ? (
        <ScoreRing score={liveOverall} />
      ) : (
        <div style={{
          width: 56, height: 56, borderRadius: "50%", border: "1px solid #3A2020",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <WifiOff size={16} color="#FF5D5D" />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#E7EFF3", fontSize: 15, fontWeight: 600 }}>
          {beach.name} {liveOverall != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
        </div>
        <div style={{ color: "#5A7A8A", fontSize: 11.5, marginBottom: 6 }}>{beach.zone}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {loading ? (
            <span style={{ fontSize: 10.5, color: "#4A6270" }}>Loading live scores…</span>
          ) : topSpecies.length > 0 ? (
            topSpecies.map(([sid, r]) => {
              const sp = SPECIES.find((s) => s.id === sid);
              return (
                <span key={sid} style={{
                  fontSize: 10.5, color: scoreColor(r.score), border: `1px solid ${scoreColor(r.score)}55`,
                  borderRadius: 4, padding: "1px 6px",
                }}>
                  {sp.name} {r.score}
                </span>
              );
            })
          ) : (
            <span style={{ fontSize: 10.5, color: "#FF5D5D" }}>Live data unavailable</span>
          )}
        </div>
      </div>
      <ChevronDown size={16} color="#3E5566" style={{ transform: "rotate(-90deg)" }} />
    </button>
  );
}

function RadarScreen({ onSelectBeach }) {
  return (
    <div style={{ padding: "12px 14px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
          JACKSONVILLE → MIAMI
        </div>
        <LiveBadge small />
      </div>
      <div style={{ color: "#4A6270", fontSize: 11, marginBottom: 14 }}>
        Listed north to south. Ring and badges are computed live from season, water temperature, tide, and buoy data per beach.
      </div>
      {BEACHES.map((b) => (
        <BeachRadarCard key={b.id} beach={b} onSelectBeach={onSelectBeach} />
      ))}
    </div>
  );
}

function NoaaTideDisplay({ loading, bundle, fatalError, onRetry }) {
  if (loading) {
    return (
      <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 16, marginBottom: 16, textAlign: "center" }}>
        <RefreshCw size={16} color="#5A7A8A" style={{ animation: "spin 1s linear infinite" }} />
        <div style={{ color: "#5A7A8A", fontSize: 12, marginTop: 6 }}>Requesting live data from NOAA CO-OPS…</div>
        <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
      </div>
    );
  }

  if (fatalError || !bundle?.connected) {
    return <DataUnavailable message={fatalError || bundle?.reason || "Unknown error."} />;
  }

  const { stationId, stationName, hilo, curve, liveLevel } = bundle;
  const now = new Date().toISOString();

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
          NOAA CO-OPS · Station {stationId}
        </span>
        <button onClick={onRetry} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
          <RefreshCw size={13} color="#5A7A8A" />
        </button>
      </div>
      <div style={{ color: "#4A6270", fontSize: 10.5, marginBottom: 10 }}>{stationName}</div>

      {liveLevel.ok ? (
        <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 4 }}>
            CURRENT WATER LEVEL (OBSERVED)
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: "#17D9C4", fontSize: 24, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
              {liveLevel.data.value.toFixed(2)} {liveLevel.data.unit}
            </span>
            <span style={{ color: "#4A6270", fontSize: 11 }}>{liveLevel.data.datum}</span>
          </div>
          <div style={{ color: "#5A7A8A", fontSize: 10.5, marginTop: 4 }}>
            Observed {liveLevel.data.observedAt} local · {freshnessLabel(liveLevel.data.observedAt, now)}
          </div>
        </div>
      ) : (
        <DataUnavailable message={`Observed water level: ${liveLevel.error}`} />
      )}

      {curve.ok ? (() => {
        // The Worker now fetches a 3-day window (needed to survive the
        // UTC/Eastern date-boundary bug), but showing all 3 days at once
        // looked noisy — 6 highs/lows instead of the familiar 2. Slice back
        // down to a clean ~24hr window centered on right now for display.
        const nowMs = Date.now();
        const windowed = curve.data.filter((d) => {
          const t = new Date(d.observedAt.replace(" ", "T")).getTime();
          return t >= nowMs - 6 * 3600000 && t <= nowMs + 18 * 3600000;
        });
        const chartData = (windowed.length >= 4 ? windowed : curve.data).map((d) => ({
          t: d.observedAt.slice(11, 16), ft: d.value, ts: new Date(d.observedAt.replace(" ", "T")).getTime(),
        }));
        // Find the chart point closest to "now" so the reference line lands
        // on an actual axis tick (categorical axis needs an exact match).
        let nowLabel = null;
        if (chartData.length > 0) {
          let closest = chartData[0];
          for (const pt of chartData) {
            if (Math.abs(pt.ts - nowMs) < Math.abs(closest.ts - nowMs)) closest = pt;
          }
          nowLabel = closest.t;
        }
        return (
          <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 4px 4px", marginBottom: 10, height: 110 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="tideFillLive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#17D9C4" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#17D9C4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{ fill: "#4A6270", fontSize: 9 }} axisLine={{ stroke: "#1F3444" }} tickLine={false} interval={2} />
                <YAxis hide domain={["dataMin - 0.3", "dataMax + 0.3"]} />
                <ReferenceLine y={0} stroke="#2B3F4D" strokeDasharray="3 3" />
                {nowLabel && <ReferenceLine x={nowLabel} stroke="#F5A623" strokeWidth={1.5} label={{ value: "Now", position: "top", fill: "#F5A623", fontSize: 9 }} />}
                <Area type="monotone" dataKey="ft" stroke="#17D9C4" strokeWidth={2} fill="url(#tideFillLive)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      })() : (
        <DataUnavailable message={`Predicted tide curve: ${curve.error}`} />
      )}

      {hilo.ok ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {hilo.data.map((p, i) => (
            <div key={i} style={{
              flex: "1 1 40%", background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 8, padding: "8px 10px",
            }}>
              <div style={{ color: p.tideType === "H" ? "#17D9C4" : "#F5A623", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif" }}>
                {p.tideType === "H" ? "HIGH" : "LOW"}
              </div>
              <div style={{ color: "#DCE8EE", fontSize: 13 }}>{p.observedAt.slice(11, 16)} · {p.value.toFixed(2)} {p.unit}</div>
            </div>
          ))}
        </div>
      ) : (
        <DataUnavailable message={`High/low predictions: ${hilo.error}`} />
      )}

      <div style={{ color: "#4A6270", fontSize: 10, marginTop: 8, lineHeight: 1.4 }}>
        Predictions are harmonic calculations, always available regardless of sensor status. The observed water level above comes from the station's live sensor and can itself go DATA UNAVAILABLE during an outage — predictions are never used to paper over that.
      </div>
    </div>
  );
}

// On-demand real blog/report content — only fetched when this tab is opened
// (or refreshed), never automatically alongside tide/buoy. Shows the actual
// post title, date, and a working link out to the source; never summarized
// or reworded, so nothing here is Claude's interpretation, just a real feed.
function ActivityTab({ beachId }) {
  const sourceKey = RSS_BEACH_SOURCES[beachId];
  const [state, setState] = useState({ loading: false, data: null, error: null, requested: false });

  const load = useCallback(() => {
    if (!sourceKey) return;
    setState({ loading: true, data: null, error: null, requested: true });
    fetchRssTrends(sourceKey)
      .then((data) => setState({ loading: false, data, error: null, requested: true }))
      .catch((err) => setState({ loading: false, data: null, error: err.message, requested: true }));
  }, [sourceKey]);

  if (!sourceKey) {
    return (
      <div style={{ padding: "8px 14px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 12 }}>
          <Info size={14} color="#5A7A8A" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ color: "#8AA6B8", fontSize: 12.5, lineHeight: 1.4 }}>
            No local fishing-report source is mapped to this beach yet. Only a couple of Treasure Coast / Ponce Inlet beaches have a confirmed feed connected so far.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 14px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#1A1408", border: "1px solid #6B3B1E", borderRadius: 10, padding: 10, marginBottom: 12 }}>
        <AlertTriangle size={14} color="#FFB37A" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ color: "#E0C6A8", fontSize: 11.5, lineHeight: 1.4 }}>
          Real posts from a real tackle shop / charter blog — not fact-checked, not scored, and not written by this app. Read them as one angler's opinion, same as you would on the source site.
        </div>
      </div>

      {!state.requested ? (
        <button onClick={load} style={{
          width: "100%", padding: "12px 0", borderRadius: 10, border: "1px solid #1F3444",
          background: "#0E1B26", color: "#17D9C4", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif",
          letterSpacing: 0.4, cursor: "pointer",
        }}>
          Load recent reports
        </button>
      ) : state.loading ? (
        <div style={{ textAlign: "center", padding: 16 }}>
          <RefreshCw size={16} color="#5A7A8A" style={{ animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
        </div>
      ) : state.error ? (
        <DataUnavailable message={state.error} />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
              {state.data.sourceName}
            </span>
            <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
              <RefreshCw size={13} color="#5A7A8A" />
            </button>
          </div>
          {state.data.items.length === 0 ? (
            <div style={{ color: "#5A7A8A", fontSize: 12.5 }}>No recent posts found.</div>
          ) : (
            state.data.items.map((item, i) => (
              <a key={i} href={item.link || "#"} target="_blank" rel="noopener noreferrer" style={{
                display: "block", background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10,
                padding: "10px 12px", marginBottom: 8, textDecoration: "none",
              }}>
                <div style={{ color: "#DCE8EE", fontSize: 13, marginBottom: 4, lineHeight: 1.4 }}>{item.title || "Untitled post"}</div>
                {item.pubDate && <div style={{ color: "#4A6270", fontSize: 10.5 }}>{item.pubDate}</div>}
              </a>
            ))
          )}
        </>
      )}
    </div>
  );
}

function BeachDetailScreen({ beach, onBack, tab, setTab }) {
  const [expandedSpecies, setExpandedSpecies] = useState(null);
  const [planSpecies, setPlanSpecies] = useState(null);
  const {
    hasBuoy, noaaState, buoyState, tideStage, moonFactor, buoyFactor, clarityEstimate, isNight,
    baitInfo, fishActivity, fishability, goStatus, getFishPosition,
    liveResults, refresh,
  } = useLiveSpeciesScores(beach.id);

  const liveEntries = Object.entries(liveResults);
  const liveOverall = fishActivity;
  const topSpeciesEntry = liveEntries.length > 0
    ? [...liveEntries].sort((a, b) => b[1].score - a[1].score)[0]
    : null;
  const topPosition = topSpeciesEntry ? getFishPosition(topSpeciesEntry[0]) : null;

  // Confidence is derived honestly from what actually loaded, not asserted:
  // tide + buoy both live = High, tide only = Medium, neither = no reading.
  const confidenceLevel = tideStage && buoyFactor ? "High" : tideStage ? "Medium" : null;

  const nextBestBite = useMemo(() => {
    if (!noaaState.bundle?.hilo?.ok) return null;
    return predictNextBestBite(noaaState.bundle.hilo.data, beach.lat, beach.lon, moonFactor, new Date());
  }, [noaaState.bundle, beach.lat, beach.lon, moonFactor]);

  const speciesOrder = SPECIES.map((s) => s.id);
  const planEntry = planSpecies && liveResults[planSpecies] ? [planSpecies, liveResults[planSpecies]] : topSpeciesEntry;
  const planPosition = planEntry ? getFishPosition(planEntry[0]) : null;

  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 4px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", padding: 4, cursor: "pointer" }}>
          <ChevronLeft size={20} color="#DCE8EE" />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#E7EFF3", fontSize: 17, fontWeight: 600 }}>{beach.name}</div>
          <div style={{ color: "#5A7A8A", fontSize: 11.5 }}>{beach.zone} · {beach.coast}</div>
        </div>
        {liveOverall != null ? (
          <ScoreRing score={liveOverall} size={48} />
        ) : (
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: "1px solid #3A2020", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <WifiOff size={16} color="#FF5D5D" />
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, padding: "10px 14px", alignItems: "center", flexWrap: "wrap" }}>
        {confidenceLevel && <ConfidenceBadge level={confidenceLevel} />}
        <LiveBadge small />
        <span style={{ color: "#4A6270", fontSize: 11 }}>
          {noaaState.loading || buoyState.loading ? "Updating…" : `Live — NOAA + NDBC + moon${isNight ? " · after dark" : ""}`}
        </span>
      </div>

      <div style={{ padding: "0 14px 6px", display: "flex", gap: 6 }}>
        {["overview", "evidence", "activity"].map((k) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #1F3444",
            background: tab === k ? "#142633" : "transparent", color: tab === k ? "#17D9C4" : "#7590A0",
            fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, cursor: "pointer",
          }}>
            {k === "overview" ? "OVERVIEW" : k === "evidence" ? "EVIDENCE" : "ACTIVITY"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div style={{ padding: "8px 14px" }}>
          {goStatus && (
            <div style={{ background: "#0E1B26", border: `1.5px solid ${goStatus.color}`, borderRadius: 12, padding: 16, marginBottom: 12, textAlign: "center" }}>
              <div style={{ color: goStatus.color, fontSize: 24, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 10 }}>
                {goStatus.label}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, background: "#070D14", borderRadius: 8, padding: "8px 6px" }}>
                  <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>
                    {topSpeciesEntry ? `${SPECIES.find((s) => s.id === topSpeciesEntry[0])?.name.toUpperCase()} ACTIVITY` : "TARGET ACTIVITY"}
                  </div>
                  <div style={{ color: scoreColor(fishActivity ?? 0), fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{fishActivity ?? "—"}</div>
                </div>
                <div style={{ flex: 1, background: "#070D14", borderRadius: 8, padding: "8px 6px" }}>
                  <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>FISHABILITY</div>
                  <div style={{ color: scoreColor(fishability?.score ?? 0), fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{fishability?.score ?? "—"}</div>
                </div>
              </div>
              <div style={{ color: "#5A7A8A", fontSize: 10.5, marginTop: 8, lineHeight: 1.4 }}>
                Target Activity is the top-relevant species' own score — not a blended average across every species. Fishability is how easy/pleasant conditions are to fish, independent of that. They can disagree — e.g. a strong target species but rough surf makes it a tough session.
              </div>
            </div>
          )}

          {topSpeciesEntry && (
            <div style={{ background: "#0E1B26", border: "1px solid #17D9C455", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
                TOP TARGET RIGHT NOW
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <span style={{ color: "#E7EFF3", fontSize: 18, fontWeight: 700 }}>{SPECIES.find((s) => s.id === topSpeciesEntry[0])?.name}</span>
                <span style={{ color: scoreColor(topSpeciesEntry[1].score), fontSize: 22, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif" }}>{topSpeciesEntry[1].score}</span>
              </div>
              {topPosition ? (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1, background: "#070D14", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 3 }}>STARTING ESTIMATE</div>
                      <div style={{ color: "#DCE8EE", fontSize: 13, fontWeight: 600 }}>{topPosition.primaryZone}</div>
                      <div style={{ color: "#5A7A8A", fontSize: 10.5 }}>then {topPosition.secondaryZone}</div>
                    </div>
                    <div style={{ flex: 1, background: "#070D14", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 3 }}>CAST</div>
                      <div style={{ color: "#DCE8EE", fontSize: 13, fontWeight: 600 }}>{topPosition.distanceYd[0]}–{topPosition.distanceYd[1]} yd</div>
                      <div style={{ color: "#5A7A8A", fontSize: 10.5 }}>{topPosition.confidence} confidence</div>
                    </div>
                  </div>
                  {topPosition.distanceYd[1] <= 45 && (
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", background: "#1A1408", border: "1px solid #6B3B1E", borderRadius: 8, padding: 8, marginBottom: 4 }}>
                      <AlertTriangle size={13} color="#FFB37A" style={{ marginTop: 1, flexShrink: 0 }} />
                      <span style={{ color: "#E0C6A8", fontSize: 11, lineHeight: 1.4 }}>Don't overcast — start inside {topPosition.distanceYd[1]} yd before working farther out.</span>
                    </div>
                  )}
                  {topPosition.distanceYd[0] >= 60 && (
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", background: "#0F2B28", border: "1px solid #1F6B5F", borderRadius: 8, padding: 8, marginBottom: 4 }}>
                      <TrendingUp size={13} color="#17D9C4" style={{ marginTop: 1, flexShrink: 0 }} />
                      <span style={{ color: "#B7EFE8", fontSize: 11, lineHeight: 1.4 }}>Long cast recommended — fish likely past the first bar, start around {topPosition.distanceYd[0]} yd.</span>
                    </div>
                  )}
                  <div style={{ color: "#4A6270", fontSize: 10, marginTop: 4, lineHeight: 1.4 }}>
                    Behavioral starting estimate from surf height + tide movement — not a measured trough location. No real bathymetry data source exists for this beach; treat this as where to start, not a guarantee.
                  </div>
                </>
              ) : (
                <div style={{ color: "#5A7A8A", fontSize: 12 }}>No live surf reading yet — can't estimate position or casting distance.</div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 12 }}>
              <div style={{ color: "#7590A0", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 4 }}>WATER CLARITY</div>
              {clarityEstimate ? (
                <>
                  <div style={{ color: "#DCE8EE", fontSize: 13, fontWeight: 600 }}>{clarityEstimate.label}</div>
                  <EstimatedBadge small />
                </>
              ) : <div style={{ color: "#5A7A8A", fontSize: 11 }}>Unavailable</div>}
            </div>
            <div style={{ flex: 1, background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 12 }}>
              <div style={{ color: "#7590A0", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 4 }}>BAIT ACTIVITY</div>
              {baitInfo && baitInfo.tier !== "unknown" ? (
                <>
                  <div style={{ color: "#DCE8EE", fontSize: 13, fontWeight: 600 }}>{baitInfo.level}</div>
                  <EstimatedBadge small />
                </>
              ) : <div style={{ color: "#5A7A8A", fontSize: 11 }}>Unknown</div>}
            </div>
          </div>

          <button
            onClick={() => setPlanSpecies(planSpecies ? null : (topSpeciesEntry ? topSpeciesEntry[0] : null))}
            disabled={!topSpeciesEntry}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 10, border: "1px solid #17D9C4",
              background: planSpecies ? "#0F2B28" : "#0E1B26", color: "#17D9C4", fontSize: 13,
              fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, cursor: topSpeciesEntry ? "pointer" : "default",
              opacity: topSpeciesEntry ? 1 : 0.5, marginBottom: planSpecies ? 8 : 14,
            }}
          >
            {planSpecies ? "Hide Plan" : "Build My Plan"}
          </button>

          {planSpecies && planEntry && (
            <div style={{ background: "#0E1B26", border: "1px solid #17D9C4", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
                FISHING PLAN
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {SPECIES.filter((s) => liveResults[s.id]).map((s) => (
                  <button key={s.id} onClick={() => setPlanSpecies(s.id)} style={{
                    padding: "5px 9px", borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${planSpecies === s.id ? "#17D9C4" : "#1F3444"}`,
                    background: planSpecies === s.id ? "#0F2B28" : "#070D14",
                    color: planSpecies === s.id ? "#17D9C4" : "#8AA6B8", fontSize: 10.5,
                  }}>
                    {s.name}
                  </button>
                ))}
              </div>
              <div style={{ color: "#E7EFF3", fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
                Target: {SPECIES.find((s) => s.id === planEntry[0])?.name} ({planEntry[1].score}/100)
              </div>
              {nextBestBite && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}>Best window: </span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>
                    {nextBestBite.windowStart.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}
                    {" – "}
                    {nextBestBite.windowEnd.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              )}
              {planPosition && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}>Primary zone: </span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>{planPosition.primaryZone} ({planPosition.distanceYd[0]}–{planPosition.distanceYd[1]} yd)</span>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}> · then </span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>{planPosition.secondaryZone}</span>
                </div>
              )}
              {tideStage && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}>Tide: </span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5, textTransform: "capitalize" }}>{tideStage.direction}, {Math.round(tideStage.flowStrength * 100)}% flow</span>
                </div>
              )}
              {clarityEstimate && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}>Water: </span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>{clarityEstimate.label} (estimated)</span>
                </div>
              )}
              {baitInfo && (
                <div style={{ marginBottom: 10 }}>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}>Bait: </span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>
                    {baitInfo.tier === "unknown" ? "Unknown (no water temp reading)" : `${baitInfo.level} (inferred-seasonal, not observed)`}
                  </span>
                </div>
              )}
              <div style={{ borderTop: "1px solid #1F3444", paddingTop: 10, color: "#B7CBD6", fontSize: 12, lineHeight: 1.5 }}>
                {planPosition && planPosition.distanceYd[1] <= 45
                  ? `Strategy: Start shallow — work ${planPosition.primaryZone.toLowerCase()} at ${planPosition.distanceYd[0]}–${planPosition.distanceYd[1]} yd. After 30 minutes with no action, try ${planPosition.secondaryZone.toLowerCase()} or extend your cast.`
                  : planPosition
                    ? `Strategy: Fish are likely holding past the inner bar — start around ${planPosition.distanceYd[0]}–${planPosition.distanceYd[1]} yd in the ${planPosition.primaryZone.toLowerCase()}. Work ${planPosition.secondaryZone.toLowerCase()} if that's slow.`
                    : "Strategy: Not enough live surf data yet to recommend a starting distance — check current conditions below."}
              </div>
            </div>
          )}

          <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 6 }}>
              TIDE RIGHT NOW
            </div>
            {tideStage ? (
              <>
                <div style={{ color: "#E7EFF3", fontSize: 20, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", textTransform: "capitalize" }}>
                  {tideStage.direction}, {Math.round(tideStage.flowStrength * 100)}% flow
                </div>
                <div style={{ color: "#5A7A8A", fontSize: 12, marginTop: 2 }}>
                  Next {tideStage.next.tideType === "H" ? "high" : "low"} at {tideStage.next.observedAt.slice(11, 16)} · {tideStage.next.value.toFixed(2)} ft
                </div>
              </>
            ) : (
              <div style={{ color: "#5A7A8A", fontSize: 14 }}>
                {noaaState.loading ? "Loading live tide status…" : "Live tide status unavailable — see below"}
              </div>
            )}
          </div>

          <div style={{ background: "#0E1B26", border: "1px solid #17D9C455", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
                NEXT BEST BITE <span style={{ color: "#17D9C4" }}>(next 24 hrs)</span>
              </span>
            </div>
            {nextBestBite ? (
              <>
                <div style={{ color: "#E7EFF3", fontSize: 20, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>
                  {nextBestBite.windowStart.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}
                  {" – "}
                  {nextBestBite.windowEnd.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 8 }}>
                  <span style={{ color: scoreColor(nextBestBite.score), fontSize: 15, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{nextBestBite.score}</span>
                  <span style={{ color: "#5A7A8A", fontSize: 12 }}>
                    peak around {nextBestBite.peakTime.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {nextBestBite.reasonParts.map((f, i) => (
                    <span key={i} style={{
                      fontSize: 10.5, color: f.delta >= 0 ? "#17D9C4" : "#FF8A8A",
                      border: `1px solid ${f.delta >= 0 ? "#17D9C4" : "#FF5D5D"}40`, borderRadius: 4, padding: "1px 6px",
                    }}>
                      {f.shortLabel} {f.delta >= 0 ? "+" : ""}{f.delta}
                    </span>
                  ))}
                </div>
                <div style={{ color: "#4A6270", fontSize: 10, marginTop: 8, lineHeight: 1.4 }}>
                  Computed from tide flow + sunrise/sunset timing (calculated, not fetched) + moon. Wave, wind, and pressure aren't forecast — only measured right now — so they're not part of this future prediction.
                </div>
              </>
            ) : (
              <div style={{ color: "#5A7A8A", fontSize: 13 }}>
                {noaaState.loading ? "Loading tide predictions…" : "Not enough tide data to predict a window right now."}
              </div>
            )}
          </div>

          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
            SPECIES PROBABILITY {liveEntries.length > 0 && <span style={{ color: "#17D9C4" }}>({liveEntries.length} live)</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            {speciesOrder
              .map((sid) => [sid, liveResults[sid]])
              .sort((a, b) => (b[1]?.score || -1) - (a[1]?.score || -1))
              .map(([sid, result]) => {
                const sp = SPECIES.find((s) => s.id === sid);
                return (
                  <div key={sid} style={{ background: "#0E1B26", border: result ? "1px solid #17D9C455" : "1px solid #1F3444", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>
                        {sp.name} {result && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
                      </span>
                      {result ? (
                        <span style={{ color: scoreColor(result.score), fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{result.score}</span>
                      ) : (
                        <span style={{ color: "#4A6270", fontSize: 12 }}>—</span>
                      )}
                    </div>
                    <div style={{ background: "#16232E", height: 4, borderRadius: 2, marginTop: 6 }}>
                      {result && <div style={{ background: scoreColor(result.score), width: `${result.score}%`, height: 4, borderRadius: 2 }} />}
                    </div>
                  </div>
                );
              })}
          </div>
          <div style={{ color: "#4A6270", fontSize: 10.5, marginBottom: 16, lineHeight: 1.4 }}>
            {liveEntries.length > 0
              ? "Scores combine Presence (season + water temperature, species-specific curves) and Feeding (tide, wave, clarity, wind, light, bait) — moon and pressure are weak secondary modifiers only. Honest behavioral/environmental predictions, not full predictions or catch guarantees."
              : "No live tide data available right now, so no species scores can be computed — see below."}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
              WATER CLARITY
            </span>
            {clarityEstimate && <EstimatedBadge small />}
          </div>
          {clarityEstimate ? (
            <div style={{ background: "#0E1B26", border: "1px solid #F5A62355", borderRadius: 10, padding: 14, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ color: "#E7EFF3", fontSize: 17, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>
                  {clarityEstimate.label}
                </span>
                <span style={{ color: "#F5A623", fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
                  {clarityEstimate.score}
                </span>
              </div>
              {clarityEstimate.factors.map((f, i) => (
                <div key={i} style={{ color: "#8AA6B8", fontSize: 12, marginBottom: 3 }}>
                  {f.delta >= 0 ? "+" : ""}{f.delta} — {f.label}
                </div>
              ))}
              <div style={{ color: "#4A6270", fontSize: 10.5, marginTop: 8, lineHeight: 1.4 }}>
                Estimated from live wave height, wind, wave period, and recent NWS rainfall — there's no clarity sensor at this beach, so this is an informed inference, not a measurement.
              </div>
            </div>
          ) : (
            <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 14, marginBottom: 6 }}>
              <div style={{ color: "#5A7A8A", fontSize: 13 }}>
                {hasBuoy ? "Waiting on buoy data to estimate clarity…" : "No buoy mapped to this beach, so clarity can't be estimated."}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 16 }} />

          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
            TIDE, TODAY <span style={{ color: "#17D9C4" }}>(live — NOAA CO-OPS)</span>
          </div>
          <NoaaTideDisplay loading={noaaState.loading} bundle={noaaState.bundle} fatalError={noaaState.fatalError} onRetry={refresh} />

          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
            CURRENT CONDITIONS <span style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif" }}>(moon always live; wind/wave/temp/pressure live where buoy has that sensor)</span>
          </div>
          <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "2px 12px", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
              <Wind size={14} color={buoyState.buoy?.windSpeedKt != null ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Wind {buoyState.buoy?.windSpeedKt != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {buoyState.buoy?.windSpeedKt != null
                  ? `${Math.round(buoyState.buoy.windSpeedKt)} kt${buoyState.buoy.windDirDeg != null ? ` @ ${Math.round(buoyState.buoy.windDirDeg)}°` : ""}`
                  : "Not available"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
              <Waves size={14} color={buoyState.buoy?.waveHeightFt != null ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Swell (offshore) {buoyState.buoy?.waveHeightFt != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {buoyState.buoy?.waveHeightFt != null
                  ? `${buoyState.buoy.waveHeightFt.toFixed(1)} ft${buoyState.buoy.dominantWavePeriodS != null ? ` @ ${buoyState.buoy.dominantWavePeriodS}s` : ""}`
                  : "Not available"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
              <Thermometer size={14} color={buoyState.buoy?.waterTempF != null ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Water temp {buoyState.buoy?.waterTempF != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {buoyState.buoy?.waterTempF != null ? `${Math.round(buoyState.buoy.waterTempF)}°F` : "Not available"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
              <Info size={14} color={buoyState.buoy?.pressureHpa != null ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Pressure {buoyState.buoy?.pressureHpa != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {buoyState.buoy?.pressureHpa != null
                  ? `${buoyState.buoy.pressureHpa.toFixed(1)} hPa${buoyState.buoy.pressureTendencyHpa != null ? ` (${buoyState.buoy.pressureTendencyHpa >= 0 ? "+" : ""}${buoyState.buoy.pressureTendencyHpa.toFixed(1)}/3hr)` : ""}`
                  : "Not available"}
              </span>
            </div>
            <ConditionRow icon={Eye} label="Clarity" value={clarityEstimate ? `${clarityEstimate.label} (est.)` : "See Water Clarity above"} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0" }}>
              <Moon size={14} color={moonFactor ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Moon {moonFactor && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {moonFactor
                  ? `${moonFactor.moonPhase.name} (${Math.round(moonFactor.moonPhase.illumination * 100)}% illum.)`
                  : "Unavailable"}
              </span>
            </div>
          </div>
          <div style={{ color: "#4A6270", fontSize: 10, marginBottom: 16, lineHeight: 1.4 }}>
            {hasBuoy
              ? buoyState.loading
                ? "Requesting live buoy data from NDBC…"
                : buoyState.fatalError
                  ? `Buoy data unavailable: ${buoyState.fatalError}`
                  : `Wind/swell/temp/pressure from NDBC buoy ${NDBC_STATIONS[beach.id].stationId} (${NDBC_STATIONS[beach.id].stationName}) — an offshore reading, not measured at the beach itself. Water clarity is estimated from this data, not directly measured.`
              : "No NDBC buoy mapped to this beach yet."}
          </div>
        </div>
      ) : tab === "evidence" ? (
        <div style={{ padding: "8px 14px" }}>
          {liveEntries.length === 0 ? (
            <DataUnavailable message="No live tide data right now, so there's nothing to show evidence for yet. Try again shortly." />
          ) : (
            <>
              <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
                LIVE INPUTS RIGHT NOW
              </div>
              <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                {tideStage && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #16232E" }}>
                    <span style={{ color: "#7590A0", fontSize: 12 }}>Tide</span>
                    <span style={{ color: "#DCE8EE", fontSize: 12, textTransform: "capitalize" }}>{tideStage.direction}, {Math.round(tideStage.flowStrength * 100)}% flow</span>
                  </div>
                )}
                {moonFactor && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #16232E" }}>
                    <span style={{ color: "#7590A0", fontSize: 12 }}>Moon</span>
                    <span style={{ color: "#DCE8EE", fontSize: 12 }}>{moonFactor.moonPhase.name}, {Math.round(moonFactor.intensity * 100)}% solunar</span>
                  </div>
                )}
                {buoyFactor?.buoy?.waveHeightFt != null && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #16232E" }}>
                    <span style={{ color: "#7590A0", fontSize: 12 }}>Wave</span>
                    <span style={{ color: "#DCE8EE", fontSize: 12 }}>{buoyFactor.buoy.waveHeightFt.toFixed(1)} ft</span>
                  </div>
                )}
                {buoyFactor?.buoy?.pressureTendencyHpa != null && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
                    <span style={{ color: "#7590A0", fontSize: 12 }}>Pressure trend</span>
                    <span style={{ color: "#DCE8EE", fontSize: 12 }}>{buoyFactor.buoy.pressureTendencyHpa >= 0 ? "+" : ""}{buoyFactor.buoy.pressureTendencyHpa.toFixed(1)} hPa / 3hr</span>
                  </div>
                )}
              </div>

              <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
                SPECIES SCORES, WHY THEY DIFFER <span style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif" }}>(tap a species)</span>
              </div>
              {liveEntries
                .sort((a, b) => b[1].score - a[1].score)
                .map(([sid, result]) => {
                  const sp = SPECIES.find((s) => s.id === sid);
                  const isOpen = expandedSpecies === sid;
                  const sortedFactors = [...result.factors].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
                  const topFactor = sortedFactors[0];
                  return (
                    <button
                      key={sid}
                      onClick={() => setExpandedSpecies(isOpen ? null : sid)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                        background: "#0E1B26", border: `1px solid ${isOpen ? "#17D9C4" : "#1F3444"}`,
                        borderRadius: 10, padding: "10px 12px", marginBottom: 8,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <span style={{ color: "#DCE8EE", fontSize: 13, fontWeight: 500 }}>{sp.name}</span>
                        <span style={{ color: scoreColor(result.score), fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{result.score}</span>
                      </div>

                      {!isOpen ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {result.factors.map((f, i) => (
                            <span key={i} style={{
                              fontSize: 10.5, color: f.delta >= 0 ? "#17D9C4" : "#FF8A8A",
                              border: `1px solid ${f.delta >= 0 ? "#17D9C4" : "#FF5D5D"}40`, borderRadius: 4, padding: "1px 6px",
                            }}>
                              {f.shortLabel || f.label} {f.delta >= 0 ? "+" : ""}{f.delta}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div>
                          <div style={{ color: "#8AA6B8", fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
                            {sp.name} landed at {result.score} mainly because of {topFactor.shortLabel.toLowerCase()} ({topFactor.delta >= 0 ? "+" : ""}{topFactor.delta}) — here's the full breakdown, biggest driver first:
                          </div>
                          {sortedFactors.map((f, i) => (
                            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                              <span style={{
                                fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, flexShrink: 0, width: 34,
                                color: f.delta >= 0 ? "#17D9C4" : "#FF8A8A",
                              }}>
                                {f.delta >= 0 ? "+" : ""}{f.delta}
                              </span>
                              <span style={{ color: "#B7CBD6", fontSize: 12, lineHeight: 1.4 }}>{f.label}</span>
                            </div>
                          ))}
                          {(() => {
                            const pos = getFishPosition(sid);
                            if (!pos) return null;
                            return (
                              <div style={{ borderTop: "1px solid #1F3444", marginTop: 8, paddingTop: 8, display: "flex", gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>POSITION</div>
                                  <div style={{ color: "#DCE8EE", fontSize: 12 }}>{pos.primaryZone}</div>
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>CAST</div>
                                  <div style={{ color: "#DCE8EE", fontSize: 12 }}>{pos.distanceYd[0]}–{pos.distanceYd[1]} yd</div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </button>
                  );
                })}
              <div style={{ color: "#4A6270", fontSize: 10.5, marginTop: 4, marginBottom: 10, lineHeight: 1.4 }}>
                Every species starts from the same live inputs above, weighted differently per species by real behavior (e.g. sharks barely react to water clarity; whiting barely react to bait presence). Position and casting distance are inferred from surf height + tide, not measured structure.
              </div>
            </>
          )}
        </div>
      ) : (
        <ActivityTab beachId={beach.id} />
      )}
    </div>
  );
}

function SpeciesRankRow({ beach, speciesId, onSelectBeach }) {
  const { liveResults, loading } = useLiveSpeciesScores(beach.id);
  const result = liveResults[speciesId];
  return (
    <button onClick={() => onSelectBeach(beach.id)} style={{
      width: "100%", textAlign: "left", background: "#0E1B26", border: "1px solid #1F3444",
      borderRadius: 10, padding: "12px 14px", marginBottom: 10, display: "flex",
      alignItems: "center", gap: 12, cursor: "pointer",
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#E7EFF3", fontSize: 14.5, fontWeight: 600 }}>
          {beach.name} {result && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
        </div>
        <div style={{ color: "#5A7A8A", fontSize: 11 }}>{beach.zone}</div>
      </div>
      {loading ? (
        <RefreshCw size={14} color="#5A7A8A" style={{ animation: "spin 1s linear infinite" }} />
      ) : result ? (
        <div style={{ color: scoreColor(result.score), fontSize: 22, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
          {result.score}
        </div>
      ) : (
        <div style={{ color: "#FF5D5D", fontSize: 11 }}>Unavailable</div>
      )}
    </button>
  );
}

function SpeciesScreen({ selectedSpecies, setSelectedSpecies, onSelectBeach }) {
  return (
    <div style={{ padding: "12px 14px 90px" }}>
      <div style={{ color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 10 }}>
        BEACHES BY SPECIES <span style={{ color: "#4A6270" }}>(live, north to south)</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {SPECIES.map((s) => (
          <button key={s.id} onClick={() => setSelectedSpecies(s.id)} style={{
            padding: "6px 10px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${selectedSpecies === s.id ? "#17D9C4" : "#1F3444"}`,
            background: selectedSpecies === s.id ? "#0F2B28" : "#0E1B26",
            color: selectedSpecies === s.id ? "#17D9C4" : "#8AA6B8", fontSize: 11.5,
          }}>
            {s.tag === "shark" ? <Fish size={11} style={{ marginRight: 4, verticalAlign: -1 }} /> : null}
            {s.name}
          </button>
        ))}
      </div>
      {BEACHES.map((b) => (
        <SpeciesRankRow key={b.id} beach={b} speciesId={selectedSpecies} onSelectBeach={onSelectBeach} />
      ))}
    </div>
  );
}

function NetworkDiagnostics() {
  const [publicTest, setPublicTest] = useState({ status: "pending" });
  const [proxyTest, setProxyTest] = useState({ status: "pending" });

  const runTests = useCallback(() => {
    setPublicTest({ status: "pending" });
    setProxyTest({ status: "pending" });

    // Test 1: can this Artifact reach ANY third-party domain at all?
    // jsonplaceholder.typicode.com is a well-known public API that sends
    // permissive CORS headers — if this fails, the problem is the
    // Artifact sandbox itself, not anything about NOAA or the Worker.
    fetch("https://jsonplaceholder.typicode.com/todos/1")
      .then((res) => res.json())
      .then(() => setPublicTest({ status: "ok" }))
      .catch((err) => setPublicTest({ status: "fail", message: err.message }));

    // Test 2: can this Artifact reach our specific Worker?
    fetch(`${PROXY_BASE_URL}/`)
      .then((res) => res.json())
      .then(() => setProxyTest({ status: "ok" }))
      .catch((err) => setProxyTest({ status: "fail", message: err.message }));
  }, []);

  useEffect(() => { runTests(); }, [runTests]);

  const Row = ({ label, test }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #16232E" }}>
      <span style={{ flexShrink: 0, width: 14 }}>
        {test.status === "pending" && <RefreshCw size={13} color="#5A7A8A" />}
        {test.status === "ok" && <span style={{ color: "#17D9C4" }}>✓</span>}
        {test.status === "fail" && <span style={{ color: "#FF5D5D" }}>✕</span>}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#DCE8EE", fontSize: 12.5 }}>{label}</div>
        {test.status === "fail" && <div style={{ color: "#FF8A8A", fontSize: 10.5, marginTop: 2 }}>{test.message}</div>}
      </div>
    </div>
  );

  return (
    <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
          CONNECTIVITY TEST
        </span>
        <button onClick={runTests} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
          <RefreshCw size={13} color="#5A7A8A" />
        </button>
      </div>
      <Row label="Any external API (jsonplaceholder.typicode.com)" test={publicTest} />
      <Row label="Our Worker (beach-proxy.michaelwiirre.workers.dev)" test={proxyTest} />
      <div style={{ color: "#4A6270", fontSize: 10.5, marginTop: 8, lineHeight: 1.4 }}>
        If the first row fails too, this Artifact sandbox can't reach external domains at all — that's a platform limit, not a Worker problem. If only the second row fails, the Worker itself needs attention.
      </div>
    </div>
  );
}

function ArchitectureScreen() {
  const rows = [
    ["beaches / beach_zones", "Location hierarchy — name, coordinates, structure type"],
    ["species", "One row per target species; holds per-species model weights"],
    ["environmental_observations", "Wind, swell, tide, temp, clarity — tagged by source + time"],
    ["fishing_reports / social_observations", "Human reports and public posts, lower default trust"],
    ["user_observations", "What you personally log at the beach"],
    ["historical_data", "Aggregated past seasons for baseline pattern matching"],
    ["data_source_reliability", "Trust score per source, e.g. buoy vs anonymous post"],
    ["predictions", "One row per beach + species + time window"],
    ["prediction_factors", "Links a prediction to the exact evidence that fed it"],
    ["actual_catches", "Logged real results, linked back to the live prediction"],
    ["model_performance", "Tracks predicted-vs-actual per species over time"],
  ];
  return (
    <div style={{ padding: "12px 14px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
          DATA ARCHITECTURE
        </div>
        <Info size={14} color="#5A7A8A" />
      </div>
      <NetworkDiagnostics />
      <div style={{ color: "#4A6270", fontSize: 11.5, marginBottom: 14, lineHeight: 1.5 }}>
        NOAA CO-OPS (tide), NDBC (wind/wave/water temp/pressure), and computed season/moon/sun are live for every beach below — species scores combine Presence (season + temperature) and Feeding (tide/wave/clarity/light/bait), with moon and pressure as weak secondary modifiers. This is the schema those feeds are normalized into, plus what's still ahead.
      </div>
      {rows.map(([name, desc], i) => (
        <div key={i} style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
          <div style={{ color: "#DCE8EE", fontSize: 12.5, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 3 }}>{name}</div>
          <div style={{ color: "#7590A0", fontSize: 11.5, lineHeight: 1.4 }}>{desc}</div>
        </div>
      ))}
      <div style={{ marginTop: 16, background: "#1A1408", border: "1px solid #6B3B1E", borderRadius: 10, padding: 12 }}>
        <div style={{ color: "#FFB37A", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 6 }}>
          NOT YET CONNECTED
        </div>
        <div style={{ color: "#E0C6A8", fontSize: 12, lineHeight: 1.5 }}>
          Water clarity has no live sensor — shown as an estimate derived from live wave/wind/period (NDBC) and recent rainfall (NWS), clearly labeled. Recent reports are live only for the 2 beaches with a confirmed RSS feed (Activity tab). Social-media ingestion still needs a per-platform ToS review before anything is built there.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

// React unmounts the ENTIRE tree on any uncaught render error, with zero
// on-screen indication of why — that's almost certainly what "blank
// screen" actually was. This catches it and shows the real error message
// instead, so any future crash is diagnosable from the phone directly.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          fontFamily: "'Inter', -apple-system, sans-serif", background: "#070D14", minHeight: 640,
          maxWidth: 420, margin: "0 auto", color: "#DCE8EE", padding: 20,
        }}>
          <div style={{ color: "#FF5D5D", fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Something crashed</div>
          <div style={{ color: "#B7CBD6", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
            This screen hit an error instead of silently going blank. Screenshot this and send it back — it's exactly what's needed to fix it.
          </div>
          <div style={{ background: "#0E1B26", border: "1px solid #FF5D5D55", borderRadius: 8, padding: 12, fontSize: 12, color: "#FF8A8A", fontFamily: "monospace", whiteSpace: "pre-wrap", marginBottom: 14 }}>
            {this.state.error?.message || String(this.state.error)}
            {this.state.error?.stack ? `\n\n${this.state.error.stack}` : ""}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ background: "#17D9C4", color: "#070D14", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, fontSize: 13 }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function BeachFishingRadar() {
  const [screen, setScreen] = useState("radar");
  const [selectedBeachId, setSelectedBeachId] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [selectedSpecies, setSelectedSpecies] = useState("pompano");

  const selectedBeach = useMemo(() => BEACHES.find((b) => b.id === selectedBeachId), [selectedBeachId]);

  const openBeach = (id) => {
    setSelectedBeachId(id);
    setDetailTab("overview");
    setScreen("beachDetail");
  };

  const tabs = [
    { id: "radar", label: "Radar" },
    { id: "species", label: "Species" },
    { id: "architecture", label: "Data" },
  ];

  return (
    <div style={{
      fontFamily: "'Inter', -apple-system, sans-serif", background: "#070D14", minHeight: 640,
      maxWidth: 420, margin: "0 auto", position: "relative", color: "#DCE8EE",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
      `}</style>

      <div style={{
        position: "sticky", top: 0, zIndex: 5, background: "#070D14", borderBottom: "1px solid #16232E",
        padding: "14px 14px 10px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: 0.3, color: "#E7EFF3" }}>
            BEACH FISHING RADAR
          </div>
          <div style={{ fontSize: 10.5, color: "#4A6270" }}>Jacksonville → Miami</div>
        </div>
        <LiveBadge />
      </div>

      {screen === "radar" && (
        <ErrorBoundary key="radar"><RadarScreen onSelectBeach={openBeach} /></ErrorBoundary>
      )}
      {screen === "beachDetail" && selectedBeach && (
        <ErrorBoundary key={selectedBeach.id}>
          <BeachDetailScreen beach={selectedBeach} onBack={() => setScreen("radar")} tab={detailTab} setTab={setDetailTab} />
        </ErrorBoundary>
      )}
      {screen === "species" && (
        <ErrorBoundary key="species">
          <SpeciesScreen selectedSpecies={selectedSpecies} setSelectedSpecies={setSelectedSpecies} onSelectBeach={openBeach} />
        </ErrorBoundary>
      )}
      {screen === "architecture" && <ErrorBoundary key="architecture"><ArchitectureScreen /></ErrorBoundary>}

      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 420,
        background: "#0A1620", borderTop: "1px solid #1F3444", display: "flex", padding: "8px 4px",
      }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setScreen(t.id)} style={{
            flex: 1, background: "none", border: "none", cursor: "pointer", padding: "6px 0",
            color: screen === t.id || (t.id === "radar" && screen === "beachDetail") ? "#17D9C4" : "#4A6270",
            fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4,
          }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
