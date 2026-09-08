import React, { useState, useMemo, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from "recharts";
import { ChevronLeft, ChevronDown, Waves, Moon, Wind, Thermometer, Eye, Fish, AlertTriangle, Info, RefreshCw, WifiOff } from "lucide-react";

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
function estimateWaterClarity(buoy, precip) {
  const hasBuoyInput = buoy && (buoy.waveHeightFt != null || buoy.windSpeedKt != null || buoy.dominantWavePeriodS != null);
  const rainAmountIn = precip
    ? (precip.precipLast6HoursIn ?? precip.precipLast3HoursIn ?? precip.precipLastHourIn)
    : null;
  if (!hasBuoyInput && rainAmountIn == null) return null;

  let score = 70; // baseline: moderately clean, adjusted by what's actually present
  const factors = [];

  if (buoy?.waveHeightFt != null) {
    let waveDelta;
    if (buoy.waveHeightFt <= 1.5) waveDelta = 12;
    else if (buoy.waveHeightFt <= 3) waveDelta = 0;
    else if (buoy.waveHeightFt <= 5) waveDelta = -18;
    else waveDelta = -32;
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
// SCORING — pompano, tide-only model (first real, non-demo score in the app)
//
// This deliberately only uses genuinely live data. Wave height/period, wind,
// and water temp are not wired in yet (that's the NDBC step), so this does
// NOT try to fake those axes — it produces a partial but honest score
// based purely on tide dynamics, and every other species stays demo until
// its own rule is built.
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

// Pompano rule: moving water matters more than direction, but incoming tide
// gets a documented edge (bait fleas washing up the beach face).
// Pompano are classic visual sight-feeders hunting sand fleas in the swash
// zone — clean water is a big deal for them (clarityWeight 1.0, same tier
// as mackerel), unlike the sharks below which barely react to it.
function scorePompanoFromTide(tideStage, moonFactor, buoyFactor, clarityEstimate) {
  if (!tideStage) return null;
  const flowBonus = Math.round(tideStage.flowStrength * 30); // 0-30
  const incomingBonus = tideStage.direction === "incoming" ? 8 : 0;
  const moonBonus = moonFactor ? moonFactor.bonus : 0;
  const buoyBonus = buoyFactor ? buoyFactor.bonus : 0;
  const clarity = clarityBonusForProfile(clarityEstimate, 1.0);
  const clarityBonus = clarity ? clarity.delta : 0;
  const score = Math.max(5, Math.min(95, 50 + flowBonus + incomingBonus + moonBonus + buoyBonus + clarityBonus));
  const factors = [
    { label: `${tideStage.direction === "incoming" ? "Incoming" : "Outgoing"} tide, ${Math.round(tideStage.flowStrength * 100)}% of peak flow strength`, shortLabel: "Tide", delta: flowBonus },
  ];
  if (incomingBonus) factors.push({ label: "Incoming tide historically favored for pompano", shortLabel: "Incoming", delta: incomingBonus });
  if (moonFactor) factors.push({ label: `${moonFactor.moonPhase.name}, ${Math.round(moonFactor.intensity * 100)}% solunar intensity`, shortLabel: "Moon", delta: moonBonus });
  if (buoyFactor) factors.push(...buoyFactor.factors);
  if (clarity) factors.push(clarity);
  return { score, factors, tideStage };
}

// ===========================================================================
// SPECIES PROFILES — the other 8 species used to share one identical
// formula, which meant they always landed on the same score (a real bug,
// not just a look). Real predators don't behave alike: bull sharks push
// into murky/rough water, tarpon are calm-water and heavily moon-driven,
// jack crevalle feed aggressively in almost anything, cobia want calm water
// and barely care about tide. Each profile below weights the SAME real
// inputs (tide, moon, buoy) differently per species — these weights are
// documented angling behavior, not a new data source, and can be tuned.
// ===========================================================================

function waveBonusForProfile(waveHeightFt, wavePreference) {
  if (waveHeightFt == null) return null;
  if (wavePreference === "calm") {
    if (waveHeightFt <= 2) return 6;
    if (waveHeightFt <= 4) return 10;
    if (waveHeightFt <= 6.5) return 2;
    return -10;
  }
  if (wavePreference === "rough") {
    if (waveHeightFt <= 1.5) return -2;
    if (waveHeightFt <= 4) return 6;
    if (waveHeightFt <= 7) return 10;
    return 3;
  }
  // "tolerant" — generalist, flatter curve, only extreme chop hurts
  if (waveHeightFt <= 6) return 5;
  if (waveHeightFt <= 8) return 1;
  return -4;
}

function pressureBonusBase(pressureTendencyHpa) {
  if (pressureTendencyHpa == null) return null;
  if (pressureTendencyHpa <= -1) return 8;
  if (pressureTendencyHpa < 0) return 3;
  if (pressureTendencyHpa <= 1) return 0;
  return -6;
}

function scoreSpeciesFromProfile(tideStage, moonFactor, buoyFactor, profile, clarityEstimate) {
  if (!tideStage) return null;
  const factors = [];

  const flowBonus = Math.round(tideStage.flowStrength * profile.flowWeight);
  factors.push({
    label: `${tideStage.direction === "incoming" ? "Incoming" : "Outgoing"} tide, ${Math.round(tideStage.flowStrength * 100)}% of peak flow strength${profile.bidirectional ? " — both directions count for this species" : ""}`,
    shortLabel: "Tide",
    delta: flowBonus,
  });

  let directionBonus = 0;
  if (profile.favoredDirection && tideStage.direction === profile.favoredDirection) {
    directionBonus = profile.directionBonus;
    factors.push({ label: profile.directionLabel, shortLabel: "Incoming", delta: directionBonus });
  }

  let moonBonus = 0;
  if (moonFactor) {
    moonBonus = Math.round(moonFactor.bonus * profile.moonWeight);
    factors.push({ label: `${moonFactor.moonPhase.name}, ${Math.round(moonFactor.intensity * 100)}% solunar intensity`, shortLabel: "Moon", delta: moonBonus });
  }

  let waveBonus = 0;
  let pressureBonus = 0;
  if (buoyFactor?.buoy) {
    const wb = waveBonusForProfile(buoyFactor.buoy.waveHeightFt, profile.wavePreference);
    if (wb != null) {
      waveBonus = Math.round(wb * profile.waveWeight);
      factors.push({ label: `Offshore wave height ${buoyFactor.buoy.waveHeightFt.toFixed(1)} ft (${profile.wavePreference}-water species)`, shortLabel: "Wave", delta: waveBonus });
    }
    const pb = pressureBonusBase(buoyFactor.buoy.pressureTendencyHpa);
    if (pb != null) {
      pressureBonus = Math.round(pb * profile.pressureWeight);
      factors.push({ label: `Barometric pressure ${buoyFactor.buoy.pressureTendencyHpa >= 0 ? "+" : ""}${buoyFactor.buoy.pressureTendencyHpa.toFixed(1)} hPa (3-hr trend)`, shortLabel: "Pressure", delta: pressureBonus });
    }
  }

  const clarity = clarityBonusForProfile(clarityEstimate, profile.clarityWeight);
  const clarityBonus = clarity ? clarity.delta : 0;
  if (clarity) factors.push(clarity);

  const score = Math.max(5, Math.min(95, profile.base + flowBonus + directionBonus + moonBonus + waveBonus + pressureBonus + clarityBonus));
  return { score, factors, tideStage };
}

// clarityWeight: how much this species' bite quality depends on seeing its
// food. Sharks hunt primarily by smell/electroreception, so per the real
// behavior described for this app, they're treated as clarity-indifferent
// (weight 0, no factor shown at all) — visual/sight-feeders get meaningful
// weight instead.
const SPECIES_PROFILES = {
  blacktip: { base: 48, flowWeight: 35, bidirectional: true, moonWeight: 1.0, wavePreference: "rough", waveWeight: 1.0, pressureWeight: 1.1, clarityWeight: 0 },
  spinner: { base: 46, flowWeight: 32, bidirectional: true, moonWeight: 1.0, wavePreference: "tolerant", waveWeight: 0.9, pressureWeight: 0.9, clarityWeight: 0 },
  bull: { base: 50, flowWeight: 38, bidirectional: true, moonWeight: 0.9, wavePreference: "rough", waveWeight: 1.1, pressureWeight: 1.0, clarityWeight: 0 },
  tarpon: { base: 42, flowWeight: 22, bidirectional: true, moonWeight: 1.3, wavePreference: "calm", waveWeight: 1.0, pressureWeight: 0.7, clarityWeight: 0.8 },
  snook: { base: 40, flowWeight: 28, bidirectional: false, favoredDirection: "incoming", directionBonus: 6, directionLabel: "Incoming tide favored — ambushes bait at structure on the push", moonWeight: 1.0, wavePreference: "calm", waveWeight: 1.1, pressureWeight: 0.9, clarityWeight: 0.9 },
  jack: { base: 55, flowWeight: 28, bidirectional: true, moonWeight: 0.5, wavePreference: "tolerant", waveWeight: 0.6, pressureWeight: 0.6, clarityWeight: 0.5 },
  cobia: { base: 38, flowWeight: 18, bidirectional: true, moonWeight: 1.0, wavePreference: "calm", waveWeight: 1.2, pressureWeight: 0.9, clarityWeight: 0.9 },
  mackerel: { base: 45, flowWeight: 33, bidirectional: true, moonWeight: 0.8, wavePreference: "calm", waveWeight: 1.2, pressureWeight: 0.9, clarityWeight: 1.0 },
};

// Converts the water clarity estimate (5-95, baseline 70) into a scaled
// bonus/penalty. Bucketed like the other factors for readability. A weight
// of 0 (sharks) means this returns null and no factor is shown at all —
// clarity genuinely isn't a meaningful input for how they're modeled here.
function clarityBonusForProfile(clarityEstimate, weight) {
  if (!clarityEstimate || !weight) return null;
  let base;
  if (clarityEstimate.score >= 80) base = 16;
  else if (clarityEstimate.score >= 70) base = 8;
  else if (clarityEstimate.score >= 45) base = -6;
  else base = -20;
  const delta = Math.round(base * weight);
  return {
    delta,
    label: `${clarityEstimate.label} (estimated) — ${delta >= 0 ? "favorable for a sight-feeder" : "reduced visibility hurts a sight-feeder"}`,
    shortLabel: "Clarity",
  };
}

// Maps each species to its live scoring rule. Only species listed here can
// ever show a LIVE badge; anything missing (none currently) stays demo.
const TIDE_MODELS = {
  pompano: scorePompanoFromTide,
  blacktip: (t, m, b, c) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.blacktip, c),
  spinner: (t, m, b, c) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.spinner, c),
  bull: (t, m, b, c) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.bull, c),
  tarpon: (t, m, b, c) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.tarpon, c),
  snook: (t, m, b, c) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.snook, c),
  jack: (t, m, b, c) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.jack, c),
  cobia: (t, m, b, c) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.cobia, c),
  mackerel: (t, m, b, c) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.mackerel, c),
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
  { id: "cobia", name: "Cobia", tag: "gamefish" },
  { id: "mackerel", name: "Spanish mackerel", tag: "gamefish" },
];

// Real geography only — name, zone, coastal region. Every score, condition,
// evidence item, and trend is now computed live via NOAA/NDBC/moon math (see
// TIDE_MODELS above) or fetched on-demand (Activity tab); nothing here is
// fabricated. Order is Jacksonville → Miami, north to south.
const BEACHES = [
  { id: "amelia-island", name: "Amelia Island", zone: "Main Beach access", coast: "First Coast" },
  { id: "jacksonville-beach", name: "Jacksonville Beach", zone: "Beach Blvd access", coast: "First Coast" },
  { id: "ponte-vedra-beach", name: "Ponte Vedra Beach", zone: "Guana Preserve access", coast: "First Coast" },
  { id: "st-augustine-beach", name: "St. Augustine Beach", zone: "St. Johns County Pier", coast: "First Coast" },
  { id: "vilano-beach", name: "Vilano Beach", zone: "Vilano Bridge, north side", coast: "First Coast" },
  { id: "flagler-beach", name: "Flagler Beach", zone: "Flagler Beach Pier", coast: "Flagler / Volusia Coast" },
  { id: "playalinda-beach", name: "Playalinda Beach", zone: "Canaveral National Seashore", coast: "Space Coast" },
  { id: "new-smyrna-beach", name: "New Smyrna Beach", zone: "27th Ave approach", coast: "Flagler / Volusia Coast" },
  { id: "daytona-beach", name: "Daytona Beach", zone: "Sun Splash Park access", coast: "Flagler / Volusia Coast" },
  { id: "cocoa-beach", name: "Cocoa Beach", zone: "Cocoa Beach Pier", coast: "Space Coast" },
  { id: "melbourne-beach", name: "Melbourne Beach", zone: "Spessard Holland Park", coast: "Space Coast" },
  { id: "vero-beach", name: "Vero Beach", zone: "South Beach Park", coast: "Treasure Coast" },
  { id: "fort-pierce", name: "Fort Pierce Inlet", zone: "North jetty", coast: "Treasure Coast" },
  { id: "jensen-beach", name: "Jensen Beach", zone: "Jensen Beach Park", coast: "Treasure Coast" },
  { id: "bathtub-beach", name: "Bathtub Beach", zone: "Sandbar cut", coast: "Treasure Coast" },
  { id: "stuart-beach", name: "Stuart Beach", zone: "Main lifeguard stand", coast: "Treasure Coast" },
  { id: "juno-beach", name: "Juno Beach", zone: "Juno Beach Pier", coast: "Palm Beaches" },
  { id: "jupiter-beach", name: "Jupiter Beach", zone: "Jupiter Inlet", coast: "Palm Beaches" },
  { id: "palm-beach", name: "Palm Beach", zone: "Midtown Beach", coast: "Palm Beaches" },
  { id: "fort-lauderdale-beach", name: "Fort Lauderdale Beach", zone: "Las Olas Blvd access", coast: "Broward" },
  { id: "hollywood-beach", name: "Hollywood Beach", zone: "Hollywood Broadwalk", coast: "Broward" },
  { id: "haulover-beach", name: "Haulover Beach", zone: "Haulover Inlet", coast: "Miami-Dade" },
  { id: "south-beach", name: "South Beach", zone: "5th St access", coast: "Miami-Dade" },
  { id: "key-biscayne", name: "Key Biscayne", zone: "Crandon Park", coast: "Miami-Dade" },
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
  const clarityEstimate = estimateWaterClarity(buoyState.buoy, precipState.precip);

  const liveResults = {}; // speciesId -> { score, factors, tideStage }
  if (tideStage) {
    for (const [sid, modelFn] of Object.entries(TIDE_MODELS)) {
      const result = modelFn(tideStage, moonFactor, buoyFactor, clarityEstimate);
      if (result) liveResults[sid] = result;
    }
  }

  return {
    isLive, hasBuoy, hasMetar, noaaState, buoyState, precipState, tideStage, moonFactor, buoyFactor, clarityEstimate,
    liveResults, loadNoaa, loadBuoy, loadPrecip, refresh,
    loading: isLive && (noaaState.loading || buoyState.loading),
  };
}

function BeachRadarCard({ beach, onSelectBeach }) {
  const { liveResults, loading } = useLiveSpeciesScores(beach.id);

  const liveEntries = Object.entries(liveResults);
  const liveOverall = liveEntries.length > 0
    ? Math.round(liveEntries.reduce((sum, [, r]) => sum + r.score, 0) / liveEntries.length)
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
        Listed north to south. Ring and badges are computed live from tide, moon, and buoy data per beach.
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

      {curve.ok ? (
        <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 4px 4px", marginBottom: 10, height: 110 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={curve.data.map((d) => ({ t: d.observedAt.slice(11, 16), ft: d.value }))} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tideFillLive" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#17D9C4" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#17D9C4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fill: "#4A6270", fontSize: 9 }} axisLine={{ stroke: "#1F3444" }} tickLine={false} interval={2} />
              <YAxis hide domain={["dataMin - 0.3", "dataMax + 0.3"]} />
              <ReferenceLine y={0} stroke="#2B3F4D" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="ft" stroke="#17D9C4" strokeWidth={2} fill="url(#tideFillLive)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
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
  const {
    hasBuoy, noaaState, buoyState, tideStage, moonFactor, buoyFactor, clarityEstimate,
    liveResults, refresh,
  } = useLiveSpeciesScores(beach.id);

  const liveEntries = Object.entries(liveResults);
  const liveOverall = liveEntries.length > 0
    ? Math.round(liveEntries.reduce((sum, [, r]) => sum + r.score, 0) / liveEntries.length)
    : null;

  // Confidence is derived honestly from what actually loaded, not asserted:
  // tide + buoy both live = High, tide only = Medium, neither = no reading.
  const confidenceLevel = tideStage && buoyFactor ? "High" : tideStage ? "Medium" : null;

  const speciesOrder = SPECIES.map((s) => s.id);

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
          {noaaState.loading || buoyState.loading ? "Updating…" : "Live — NOAA + NDBC + moon"}
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
              ? "Live scores are computed from tide, moon, and buoy data — water clarity and bait presence still aren't wired in. Honest partial scores, not full predictions."
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
                  : `Wind/swell/temp/pressure from NDBC buoy ${NDBC_STATIONS[beach.id].stationId} (${NDBC_STATIONS[beach.id].stationName}) — an offshore reading, not measured at the beach itself. Water clarity and bait presence still aren't connected.`
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
                        </div>
                      )}
                    </button>
                  );
                })}
              <div style={{ color: "#4A6270", fontSize: 10.5, marginTop: 4, marginBottom: 10, lineHeight: 1.4 }}>
                Every species starts from the same live inputs above, weighted differently per species by real behavior (e.g. sharks barely react to water clarity; pompano and mackerel react a lot). Bait presence still isn't factored in — see the Activity tab for real public reports instead.
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
        NOAA CO-OPS (tide), NDBC (wind/wave/pressure), and moon phase are live for every beach below — this is the schema those feeds are normalized into, plus what's still ahead.
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

      {screen === "radar" && <RadarScreen onSelectBeach={openBeach} />}
      {screen === "beachDetail" && selectedBeach && (
        <BeachDetailScreen beach={selectedBeach} onBack={() => setScreen("radar")} tab={detailTab} setTab={setDetailTab} />
      )}
      {screen === "species" && (
        <SpeciesScreen selectedSpecies={selectedSpecies} setSelectedSpecies={setSelectedSpecies} onSelectBeach={openBeach} />
      )}
      {screen === "architecture" && <ArchitectureScreen />}

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
