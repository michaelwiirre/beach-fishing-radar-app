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
  // Priority 11 Part 4 — reassigned from the distant 41068/41122 buoys
  // (~40-45mi, self-documented as "not local") to LKWF1/8722670 (Lake
  // Worth Pier) — the SAME station these 3 beaches already use for tide.
  // Confirmed via research this station genuinely reports wind speed/
  // direction/gust, pressure, and water temperature (much closer: ~6-25mi
  // depending on the beach, vs ~40-45mi before). It does NOT appear to
  // report wave height/period anywhere in its data — the existing
  // "MM" -> null parsing already handles that honestly; wave-dependent
  // scoring for these 3 beaches now correctly shows unavailable instead
  // of using a marginal, distant reading. Not fully verified live from
  // this environment — spot-check /buoy/latest?station=LKWF1 once deployed.
  "juno-beach": { stationId: "LKWF1", stationName: "Lake Worth Pier, FL (local station, ~18.5mi — wind/temp/pressure only, no wave sensor)" },
  "jupiter-beach": { stationId: "LKWF1", stationName: "Lake Worth Pier, FL (local station, ~25mi — wind/temp/pressure only, no wave sensor)" },
  "palm-beach": { stationId: "LKWF1", stationName: "Lake Worth Pier, FL (local station, ~6.4mi — wind/temp/pressure only, no wave sensor)" },
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

// All distinct NDBC stations used by the app, in real north-to-south
// geographic order along the FL Atlantic coast. Ocean swell (as opposed to
// local wind chop) is a regional phenomenon that travels coherently along
// a coastline for many miles — so when a beach's own station has no wave
// sensor, borrowing a REAL reading from the nearest neighboring station
// that has one is far more accurate than guessing from local wind alone.
const NDBC_CHAIN = ["41112", "41117", "41069", "41113", "41068", "41122"];

async function fetchNearestWaveReading(primaryStationId, { force = false } = {}) {
  const idx = NDBC_CHAIN.indexOf(primaryStationId);
  if (idx === -1) return null;
  const order = [];
  for (let d = 1; d < NDBC_CHAIN.length; d++) {
    if (idx - d >= 0) order.push(idx - d);
    if (idx + d < NDBC_CHAIN.length) order.push(idx + d);
  }
  for (const i of order) {
    const candidateId = NDBC_CHAIN[i];
    try {
      const buoy = await fetchLatestBuoy(candidateId, { force });
      if (buoy.waveHeightFt != null) {
        return { stationId: candidateId, waveHeightFt: buoy.waveHeightFt, dominantWavePeriodS: buoy.dominantWavePeriodS };
      }
    } catch {
      // this neighbor failed too — keep trying the next nearest
    }
  }
  return null;
}

function dateToCompact(d) { return d.toISOString().slice(0, 10).replace(/-/g, ""); }

// Historical backfill — every row NDBC has for that UTC date (up to 45
// days back per NDBC's own retention), converted the same way as the live
// reading. Returns [] rather than throwing when the date is out of range
// or the station has no data for it, so the UI can show an honest gap.
async function fetchBuoyHistoryDay(stationId, dateCompactStr, { force = false } = {}) {
  return cachedFetch(`buoy-history:${stationId}:${dateCompactStr}`, async () => {
    const json = await fetchViaProxy("/buoy/history", stationId, { date: dateCompactStr });
    return (json.rows || []).map((r) => ({
      observedAtUtc: r.observedAtUtc,
      windSpeedKt: r.windSpeedMs != null ? r.windSpeedMs * 1.94384 : null,
      windDirDeg: r.windDirDeg,
      waveHeightFt: r.waveHeightM != null ? r.waveHeightM * 3.28084 : null,
      dominantWavePeriodS: r.dominantWavePeriodS,
      pressureHpa: r.pressureHpa,
      pressureTendencyHpa: r.pressureTendencyHpa,
      waterTempF: r.waterTempC != null ? r.waterTempC * 9 / 5 + 32 : null,
    }));
  }, { force });
}

async function fetchWeatherHistoryDay(stationId, dateCompactStr, { force = false } = {}) {
  return cachedFetch(`weather-history:${stationId}:${dateCompactStr}`, async () => {
    const json = await fetchViaProxy("/weather/history", stationId, { date: dateCompactStr });
    return json.rows || [];
  }, { force });
}

// Tide predictions are deterministic, so "history" is just the same
// predictions product scoped to a specific past date.
async function fetchTideHistoryDay(stationId, dateCompactStr, { force = false } = {}) {
  return cachedFetch(`tide-history:${stationId}:${dateCompactStr}`, async () => {
    const json = await fetchViaProxy("/tides/history", stationId, { date: dateCompactStr });
    const rows = (json.predictions || []).map((p) => ({
      time: p.t, value: parseFloat(p.v), tideType: p.type === "H" ? "H" : "L",
    }));
    return normalizeObservations({
      rows, stationId, stationName: NOAA_STATIONS[stationId]?.stationName,
      product: "predictions", parameter: "tide_height", unit: "ft", datum: "MLLW",
      sourceType: "official_prediction", reliability: 90, retrievedAt: new Date().toISOString(),
    });
  }, { force });
}

function pickNearestRow(rows, targetDate) {
  if (!rows || rows.length === 0) return null;
  const targetMs = targetDate.getTime();
  let best = null, bestDiff = Infinity;
  for (const r of rows) {
    const ts = r.observedAtUtc || r.timestamp;
    if (!ts) continue;
    const diff = Math.abs(new Date(ts).getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  return best;
}

// ===========================================================================
// HISTORICAL BACKTESTING FOUNDATION (Priority 4) — "what would the app have
// predicted at timestamp X, using only information legitimately available
// at or before X?" Reuses the exact scoreSpecies() engine (unchanged math,
// unchanged weights) and the existing historical fetch functions — the
// only new logic is the look-ahead-safe selector below.
//
// Three timestamps, kept explicitly distinct — never conflated:
//   A. OBSERVATION timestamp — when a measurement actually happened
//      (each row's own observedAtUtc).
//   B. PREDICTION timestamp — the moment being predicted FOR (the
//      predictionTimestamp argument below).
//   C. RETRIEVAL timestamp — when this backtest was actually run (real
//      "now", whenever that is) — pure bookkeeping on the result envelope,
//      never fed into the scoring math itself.
// ===========================================================================

// Look-ahead-safe selector, dedicated to backtesting — NEVER returns an
// observation whose observedAtUtc is after predictionTimestamp; among
// eligible (past-or-equal) rows, returns the LATEST one. This is
// deliberately a separate function from pickNearestRow() above: that
// existing nearest-in-either-direction selector is left completely
// untouched (it's what the already-shipped trip-log backfill feature
// uses), so nothing about current behavior changes as a side effect of
// building this foundation.
function pickLatestAvailableRow(rows, predictionTimestamp) {
  if (!rows || rows.length === 0) return null;
  const cutoffMs = predictionTimestamp.getTime();
  let best = null, bestMs = -Infinity;
  for (const r of rows) {
    const ts = r.observedAtUtc || r.timestamp;
    if (!ts) continue;
    const obsMs = new Date(ts).getTime();
    if (obsMs <= cutoffMs && obsMs > bestMs) { bestMs = obsMs; best = r; }
  }
  return best;
}

// The deterministic "predict as of timestamp X" entry point. Produces the
// exact same prediction shape scoreSpecies() always has, plus explicit
// per-input source metadata ("historical" or "unavailable") so it's never
// ambiguous what real data fed a given historical prediction. Tide
// PREDICTIONS are harmonic/deterministic and legitimately knowable
// arbitrarily far in advance (NOAA publishes them ahead of time), so they
// carry no look-ahead concern the way real-time buoy/weather observations
// do — only the latter two route through pickLatestAvailableRow.
async function predictAsOfTimestamp(beach, speciesId, predictionTimestamp) {
  const dateCompactStr = dateToCompact(predictionTimestamp);
  const noaaStation = NOAA_STATIONS[beach.id]?.stationId;
  const ndbcStation = NDBC_STATIONS[beach.id]?.stationId;
  const metarStation = METAR_STATIONS[beach.id]?.stationId;

  const sourceMeta = { tide: "unavailable", buoy: "unavailable", precip: "unavailable" };
  // Priority 10 correction — a small near-now tolerance, not a raw "> now"
  // comparison. Without this, a prediction timestamp even a few seconds
  // ahead of real "now" (clock skew, request latency, a caller rounding
  // up) would flip an effectively-current prediction onto the forecast-
  // only path and lose real observed buoy/precip data it should have
  // used. 15 minutes is chosen because it's smaller than the natural
  // refresh cadence of the underlying live sources themselves (NDBC/METAR
  // readings update roughly hourly to half-hourly), so treating anything
  // inside that window as "current" doesn't introduce meaningful
  // staleness beyond what a live reading already has. This never affects
  // genuinely historical timestamps — isFuture is always compared against
  // real current wall-clock time, so a real past timestamp is always well
  // outside this window regardless.
  const NEAR_NOW_TOLERANCE_MS = 15 * 60000;
  const isFuture = predictionTimestamp.getTime() > Date.now() + NEAR_NOW_TOLERANCE_MS;
  let forecastProvenance = null; // Priority 10 — only populated on the future path; null means this was a historical/current prediction

  let tideRows = null;
  if (noaaStation) {
    try {
      tideRows = await fetchTideHistoryDay(noaaStation, dateCompactStr);
      if (tideRows && tideRows.length > 0) sourceMeta.tide = "deterministic"; // harmonic prediction — same status regardless of past/future, never "forecast"
    } catch {
      // leave tideRows null; sourceMeta stays "unavailable"
    }
  }

  let buoyReading = null;
  let precipReading = null;

  if (isFuture) {
    // FUTURE — verified NWS gridpoint forecast only. Water temperature is
    // deliberately NEVER set here: Priority 10's research found no
    // official structured future coastal water-temperature source: it
    // stays unavailable, never carried forward from today, never inferred
    // from air temperature.
    try {
      const forecastBundle = await fetchForecastForBeach(beach);
      const forecast = forecastBundle ? resolveForecastInputs(forecastBundle, predictionTimestamp) : null;
      if (forecast) {
        const haveWave = forecast.waveHeightFt.status === "forecast";
        const haveWind = forecast.windSpeedKt.status === "forecast";
        buoyReading = {
          waveHeightFt: forecast.waveHeightFt.value, dominantWavePeriodS: forecast.wavePeriodS.value,
          windSpeedKt: forecast.windSpeedKt.value, windDirDeg: forecast.windDirDeg.value,
          pressureHpa: forecast.pressureHpa.value, pressureTendencyHpa: null,
          waterTempF: null, // never forecast — see comment above
        };
        if (haveWave || haveWind) sourceMeta.buoy = "forecast";
        if (forecast.precipAmountIn.value != null) {
          precipReading = { precipLastHourIn: forecast.precipAmountIn.value, precipLast3HoursIn: null, precipLast6HoursIn: null };
          sourceMeta.precip = "forecast";
        }
        forecastProvenance = {
          gridId: forecastBundle.gridId, gridX: forecastBundle.gridX, gridY: forecastBundle.gridY,
          updateTime: forecastBundle.updateTime,
          fields: {
            windSpeed: forecast.windSpeedKt, windDirection: forecast.windDirDeg, windGust: forecast.windGustKt,
            waveHeight: forecast.waveHeightFt, wavePeriod: forecast.wavePeriodS, waveDirection: forecast.waveDirDeg,
            primarySwellHeight: forecast.primarySwellHeightFt, windWaveHeight: forecast.windWaveHeightFt,
            precipProbability: forecast.precipProbabilityPct, precipAmount: forecast.precipAmountIn,
            pressure: forecast.pressureHpa,
          },
        };
      }
    } catch {
      // leave buoyReading/precipReading null; sourceMeta stays "unavailable" — never fall back to historical/current data for a future timestamp
    }
  } else {
    // PAST or CURRENT — existing look-ahead-safe historical-observation
    // path, byte-identical to before Priority 10.
    if (ndbcStation) {
      try {
        // Also fetch the preceding calendar day and combine — a prediction
        // near midnight (e.g. 01:00) otherwise has no eligible observation
        // to select from, since the target day's file alone might not have
        // any reading yet that early. Zero Worker/infra change: just calling
        // the existing function twice with two date strings.
        const prevDateCompactStr = dateToCompact(new Date(predictionTimestamp.getTime() - 86400000));
        const [todayRows, prevRows] = await Promise.all([
          fetchBuoyHistoryDay(ndbcStation, dateCompactStr),
          fetchBuoyHistoryDay(ndbcStation, prevDateCompactStr),
        ]);
        buoyReading = pickLatestAvailableRow([...(prevRows || []), ...(todayRows || [])], predictionTimestamp);
        if (buoyReading) sourceMeta.buoy = "historical";
      } catch {
        // leave buoyReading null; sourceMeta stays "unavailable"
      }
    }
    if (metarStation) {
      try {
        const prevDateCompactStr = dateToCompact(new Date(predictionTimestamp.getTime() - 86400000));
        const [todayRows, prevRows] = await Promise.all([
          fetchWeatherHistoryDay(metarStation, dateCompactStr),
          fetchWeatherHistoryDay(metarStation, prevDateCompactStr),
        ]);
        const nearest = pickLatestAvailableRow([...(prevRows || []), ...(todayRows || [])], predictionTimestamp);
        precipReading = nearest ? { precipLastHourIn: nearest.precipLastHourIn, precipLast3HoursIn: null, precipLast6HoursIn: null } : null;
        if (precipReading) sourceMeta.precip = "historical";
      } catch {
        // leave precipReading null; sourceMeta stays "unavailable"
      }
    }
  }

  const tideStage = tideRows ? computeTideStage(tideRows, predictionTimestamp) : null;
  const moonFactor = scoreMoonFactor(computeMoonPhase(predictionTimestamp));
  const isNight = computeIsNight(predictionTimestamp, beach.lat, beach.lon);
  const isLowLight = computeIsLowLight(predictionTimestamp, beach.lat, beach.lon);
  const clarityEstimate = estimateWaterClarity(buoyReading, precipReading, tideStage, beach.id);
  const seasonalBaitInfo = inferBaitActivity(buoyReading, predictionTimestamp);

  // Priority 9: try to upgrade the seasonal bait estimate with a real,
  // look-ahead-safe, timestamped direct observation from trip logging —
  // the app's own existing "direct user observation" evidence (the
  // strongest tier in the requested hierarchy). Reuses fetchTripsList()
  // (no new API). Wrapped defensively: if this fetch fails for any
  // reason, fall back to the seasonal estimate rather than breaking the
  // prediction — forage evidence is additive, never load-bearing.
  //
  // Priority 10 note: this already handles future timestamps correctly
  // with no changes needed — resolveForageEvidence's look-ahead check and
  // freshness-tier decay are both computed relative to predictionTimestamp,
  // so a further-future prediction automatically sees older (or zero)
  // eligible evidence and decays toward seasonal-only, exactly as required.
  let baitInfo = seasonalBaitInfo;
  try {
    const { trips } = await fetchTripsList(beach.id);
    const forage = resolveForageEvidence(trips, predictionTimestamp);
    baitInfo = buildEnhancedBaitInfo(seasonalBaitInfo, forage, speciesId);
  } catch {
    // leave baitInfo as the seasonal estimate; forage lookup is best-effort
  }

  const buoyFactor = buoyReading ? scoreBuoyFactor(buoyReading) : null;

  // Unchanged engine — same call shape TIDE_MODELS wrappers already use,
  // including the predictionTimestamp propagation from Priority 2. This is
  // the single most important architectural fact of Priority 10: nothing
  // about scoreSpecies() changed. Past, current, and future predictions
  // all still funnel through exactly this one call — only the SOURCE of
  // tideStage/buoyFactor/clarityEstimate/baitInfo differs by timestamp.
  const result = scoreSpecies(speciesId, tideStage, moonFactor, buoyFactor, clarityEstimate, isNight, baitInfo, isLowLight, predictionTimestamp);

  return {
    beachId: beach.id,
    speciesId,
    predictionTimestamp: predictionTimestamp.toISOString(), // (B)
    retrievedAt: new Date().toISOString(), // (C) — bookkeeping only, never scored
    isFuture,
    sourceMeta,
    forecastProvenance, // Priority 10 — full per-field forecast provenance, null unless this was a future prediction with a resolved forecast
    environmentalInputs: {
      waveFt: buoyReading?.waveHeightFt ?? null, wavePeriodS: buoyReading?.dominantWavePeriodS ?? null,
      windKt: buoyReading?.windSpeedKt ?? null, windDirDeg: buoyReading?.windDirDeg ?? null,
      waterTempF: buoyReading?.waterTempF ?? null,
      clarityScore: clarityEstimate?.score ?? null, clarityLabel: clarityEstimate?.label ?? null,
      tideDirection: tideStage?.direction ?? null, tideFlowPct: tideStage ? Math.round(tideStage.flowStrength * 100) : null,
      baitTier: baitInfo?.tier ?? null, baitLevel: baitInfo?.level ?? null,
      // Priority 9 audit fields — present only when a real observation was
      // used; null when this is the seasonal-only fallback, so a snapshot
      // can always answer "why did this get a bait boost?" honestly.
      baitDominantType: baitInfo?.dominantType ?? null,
      baitFreshnessTier: baitInfo?.freshnessTier ?? null,
      baitForageSource: baitInfo?.forageSource ?? null,
      baitObservedAtUtc: baitInfo?.forageObservedAtUtc ?? null,
      baitForageStrength: baitInfo?.forageStrength ?? null,
      moonPhaseName: moonFactor?.moonPhase?.name ?? null, moonIllumPct: moonFactor ? Math.round(moonFactor.moonPhase.illumination * 100) : null,
    },
    result, // null if tideStage unavailable — same "no prediction possible" contract as live scoring
  };
}

// ===========================================================================
// PREDICTION SNAPSHOTS (Priority 5) — a standalone, immutable record of what
// was predicted, deliberately decoupled from trip logging. trip_observations
// (built earlier) always requires an actual sighted/bit/caught outcome to
// exist at all — that's the wrong coupling for "I just want to permanently
// record what the model said," which is exactly what backtesting/audit
// needs. This writes to its own dedicated table via its own dedicated
// route, reusing predictAsOfTimestamp()'s output directly rather than
// recomputing anything.
//
// Works for BOTH live and historical snapshots through the same single
// path: call predictAsOfTimestamp(beach, speciesId, new Date()) for "right
// now" (NDBC's history file already includes today's readings so far) or
// with any past timestamp for a backtest — no separate live-only code path
// needed here.
// ===========================================================================
function buildSnapshotPayload(envelope) {
  const { beachId, speciesId, predictionTimestamp, retrievedAt, isFuture, sourceMeta, forecastProvenance, environmentalInputs, result } = envelope;
  if (!result) return null; // nothing to snapshot — no tide data for this timestamp, same "unavailable" contract as everywhere else
  const positiveFactors = (result.factors || []).filter((f) => f.delta > 0).map((f) => f.label);
  const limitingFactors = (result.factors || []).filter((f) => f.delta < 0).map((f) => f.label);
  // Bait's own source, not the buoy's — was previously (incorrectly)
  // tied to sourceMeta.buoy. Priority 9 distinguishes three real states:
  // a genuine direct trip-log observation, the seasonal baseline
  // inference, or fully unavailable (no water temp reading at all).
  const baitSource = environmentalInputs.baitForageSource || (environmentalInputs.baitTier === "inferred-seasonal" ? "seasonal_baseline" : environmentalInputs.baitTier === "unknown" ? "unavailable" : null);
  // Priority 10 — water temp is NEVER sourced from forecast (no official
  // source exists), so its source must reflect that honestly even when
  // sourceMeta.buoy says "forecast" for wave/wind on the same prediction.
  const waterTempSource = environmentalInputs.waterTempF != null ? sourceMeta.buoy : "unavailable";
  return {
    beach_id: beachId, species_id: speciesId,
    prediction_timestamp: predictionTimestamp, // (B) — what moment this predicts for
    retrieved_at: retrievedAt, // (C) — when this snapshot was actually saved, never scored
    is_future: isFuture ? 1 : 0,
    model_version: result.modelVersion,
    presence: result.presence, feeding: result.feeding, access: result.access, final_score: result.score,
    confidence: result.confidence,
    predicted_zone: result.position?.primaryZone ?? null,
    predicted_distance_min: result.position?.distanceYd?.[0] ?? null,
    predicted_distance_max: result.position?.distanceYd?.[1] ?? null,
    wave_ft: environmentalInputs.waveFt, wave_ft_source: sourceMeta.buoy, wave_period_s: environmentalInputs.wavePeriodS,
    wind_kt: environmentalInputs.windKt, wind_kt_source: sourceMeta.buoy, wind_dir_deg: environmentalInputs.windDirDeg,
    water_temp_f: environmentalInputs.waterTempF, water_temp_f_source: waterTempSource,
    clarity_score: environmentalInputs.clarityScore, clarity_label: environmentalInputs.clarityLabel,
    clarity_source: isFuture && environmentalInputs.clarityScore != null ? "estimated_from_forecast" : sourceMeta.buoy,
    tide_direction: environmentalInputs.tideDirection, tide_flow_pct: environmentalInputs.tideFlowPct, tide_source: sourceMeta.tide,
    bait_tier: environmentalInputs.baitTier, bait_level: environmentalInputs.baitLevel, bait_source: baitSource,
    // Priority 10 forecast provenance — null unless this was a future
    // prediction with a resolved forecast, so a snapshot can always
    // answer "which NWS gridpoint, and as of when was it issued?"
    forecast_grid_id: forecastProvenance?.gridId ?? null,
    forecast_grid_x: forecastProvenance?.gridX ?? null,
    forecast_grid_y: forecastProvenance?.gridY ?? null,
    forecast_update_time: forecastProvenance?.updateTime ?? null,
    // Priority 9 forage audit — null unless a real direct observation was
    // actually used, so "why did this get a bait boost?" is answerable.
    bait_dominant_type: environmentalInputs.baitDominantType ?? null,
    bait_freshness_tier: environmentalInputs.baitFreshnessTier ?? null,
    bait_observed_at_utc: environmentalInputs.baitObservedAtUtc ?? null,
    bait_forage_strength: environmentalInputs.baitForageStrength ?? null,
    moon_phase_name: environmentalInputs.moonPhaseName, moon_illumination_pct: environmentalInputs.moonIllumPct, moon_source: "calculated",
    major_positive_factors: positiveFactors.length ? JSON.stringify(positiveFactors) : null,
    major_limiting_factors: limitingFactors.length ? JSON.stringify(limitingFactors) : null,
  };
}

// Pure INSERT on the Worker side — never an UPDATE — so calling this twice
// for the "same" prediction (e.g. after a model version bump) always
// creates a new row with a new id, never touches the old one.
async function savePredictionSnapshot(envelope) {
  const payload = buildSnapshotPayload(envelope);
  if (!payload) throw new Error("No prediction available to snapshot for this timestamp (missing tide data).");
  return postToProxy("/snapshots/save", payload);
}

// ===========================================================================
// BACKTESTING (Priority 6) — "how good was a past prediction compared with
// what actually happened?" Reuses predictAsOfTimestamp() (and therefore the
// exact live Presence→Feeding→Access→Final pipeline) for every replayed
// prediction — there is no second scoring model here. A prediction and an
// observed outcome remain two distinct concepts throughout: this function
// only ever COMPARES them, never overwrites one with the other.
//
// No calibration, no probabilities, no ML — classification below is a
// simple, conservative, documented rule set over the app's EXISTING
// sighted/bit/caught taxonomy, nothing invented.
// ===========================================================================

// Classifies one replayed prediction against what was actually logged for
// that species on that trip. `tripHasAnyActivity` distinguishes two very
// different kinds of "nothing logged for this species": the trip exists
// and the angler was actively logging (so an unchecked box for THIS
// species is real, if soft, negative evidence) vs. no trip was logged at
// all for that day (genuinely unknown — the angler may not have fished).
function classifyBacktestResult(predictedScore, observation, tripHasAnyActivity) {
  if (predictedScore == null) {
    return { verdict: "insufficient_evidence", reason: "No prediction available for this timestamp (missing historical tide/environmental data)." };
  }
  const strongPositive = !!(observation?.caught || observation?.bit);
  const weakPositive = !!(observation?.sighted && !strongPositive);
  const hasAnyPositive = strongPositive || weakPositive;

  if (!observation && !tripHasAnyActivity) {
    return { verdict: "insufficient_evidence", reason: "No trip was logged for this date/time — unknown whether the angler even fished." };
  }
  // Unchecked for this species, but the trip itself has other logged
  // activity — a real (if soft) signal the angler was out and saw nothing
  // for this specific species.
  const impliedNoActivity = !observation && tripHasAnyActivity;

  if (predictedScore >= 65 && strongPositive) {
    return { verdict: "strong_hit", reason: "High prediction, and a bite or catch was actually logged." };
  }
  if (predictedScore >= 45 && hasAnyPositive) {
    return { verdict: "partial_hit", reason: "Moderate-or-higher prediction, and at least a sighting was logged." };
  }
  if (predictedScore >= 65 && (impliedNoActivity || (observation && !hasAnyPositive))) {
    return { verdict: "miss", reason: "High prediction, but no positive observation was logged for this species on a trip where the angler was actively fishing." };
  }
  if (predictedScore < 45 && (impliedNoActivity || (observation && !hasAnyPositive))) {
    return { verdict: "consistent_low", reason: "Low prediction and no activity logged — consistent with the model, not being scored as a \"hit\"." };
  }
  return { verdict: "insufficient_evidence", reason: "Prediction/observation combination doesn't cleanly fit a category under these conservative rules." };
}

// Runs the backtester across logged trips, replaying each species'
// prediction fresh via predictAsOfTimestamp() (never reading back the
// already-stored predicted_score, so this is a genuine independent replay,
// not just echoing what was saved at logging time) and comparing it to
// what was actually observed. Supports one beach / one species / a date
// range / everything, via optional filters — same single function for
// every case, no separate "modes."
async function runBacktest({ beachId = null, speciesId = null, startDate = null, endDate = null } = {}) {
  const { trips } = await fetchTripsList(beachId);
  const results = [];

  for (const trip of trips) {
    const tripDateUTC = new Date(`${trip.trip_date}T00:00:00Z`);
    if (startDate && tripDateUTC < startDate) continue;
    if (endDate && tripDateUTC > endDate) continue;

    const beach = BEACHES.find((b) => b.id === trip.beach_id);
    if (!beach) continue; // beach removed/renamed since this trip was logged — honestly skip, don't guess

    // observed_at is this schema's prediction-context timestamp (see the
    // known limitation on this in the final report — it does not yet
    // separately capture the exact moment a bite/sighting itself occurred).
    const predictionTimestamp = trip.observed_at
      ? new Date(trip.observed_at)
      : timeBlockTargetDate(tripDateUTC, trip.time_block, beach.lat, beach.lon);

    const tripHasAnyActivity = (trip.observations || []).some((o) => o.sighted || o.bit || o.caught);
    const speciesToTest = speciesId ? [speciesId] : SPECIES.map((s) => s.id);

    for (const sid of speciesToTest) {
      let envelope;
      try {
        envelope = await predictAsOfTimestamp(beach, sid, predictionTimestamp);
      } catch (err) {
        results.push({
          beachId: beach.id, speciesId: sid, predictionTimestamp: predictionTimestamp.toISOString(),
          error: err.message, verdict: "insufficient_evidence", verdictReason: `Replay failed: ${err.message}`,
        });
        continue;
      }
      const observation = (trip.observations || []).find((o) => o.subject_type === "species" && o.subject_id === sid) || null;
      const classification = classifyBacktestResult(envelope.result?.score ?? null, observation, tripHasAnyActivity);

      results.push({
        beachId: beach.id,
        speciesId: sid,
        predictionTimestamp: envelope.predictionTimestamp,
        modelVersion: envelope.result?.modelVersion ?? null,
        predictedScore: envelope.result?.score ?? null,
        presence: envelope.result?.presence ?? null,
        feeding: envelope.result?.feeding ?? null,
        access: envelope.result?.access ?? null,
        confidence: envelope.result?.confidence ?? null,
        predictedZone: envelope.result?.position?.primaryZone ?? null,
        predictedDistanceMin: envelope.result?.position?.distanceYd?.[0] ?? null,
        predictedDistanceMax: envelope.result?.position?.distanceYd?.[1] ?? null,
        // LIMITATION: trip_observations has no field for the actual moment a
        // bite/sighting occurred, independent of the trip's overall logged
        // timestamp — trip.observed_at IS the prediction-context timestamp
        // (used to build predictionTimestamp above), not a separately-timed
        // observation. Reusing it here as "when the fish was seen" would
        // misrepresent the schema's actual precision, so both fields stay
        // honestly null rather than implying a same-instant match that was
        // never actually recorded. This compares against trip-level logged
        // observations, not an independently timed bite/sighting — if that
        // distinction ever matters, it requires a trip-logging schema change,
        // which is explicitly out of scope here.
        observationTimestamp: null,
        observation: observation ? { sighted: !!observation.sighted, bit: !!observation.bit, caught: !!observation.caught } : null,
        timeDiffMinutes: null,
        verdict: classification.verdict,
        verdictReason: classification.reason,
      });
    }
  }
  return results;
}

// ===========================================================================
// CALIBRATION (Priority 7) — "what do the scores actually mean?" Measures
// the existing model against real outcomes; NEVER changes the model itself.
// Consumes runBacktest() output directly — no duplicate prediction logic,
// no new scoring path. The score itself remains a model score throughout,
// never presented as a probability.
// ===========================================================================
const CALIBRATION_SCORE_BINS = [[0, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]];

// A bin's observed rate is only ever shown as a rate once it clears this
// many usable (positive+negative) observations — below that, raw counts
// are still shown, but labeled "insufficient data" rather than a percentage
// that could be mistaken for reliable. Threshold rises with how narrowly
// the query is scoped, per the required Global -> Species -> Beach ->
// Species+Beach hierarchy — a beach-specific claim needs more evidence
// than a global one before it's trusted, and this stays a plain constant
// rather than a fitted/tuned value.
function calibrationMinSample(options) {
  if (options.species && options.beachId) return 20;
  if (options.beachId) return 15;
  if (options.species) return 15;
  return 10;
}

function scoreBinLabel(score) {
  for (const [lo, hi] of CALIBRATION_SCORE_BINS) {
    if (score >= lo && score <= hi) return `${lo}-${hi}`;
  }
  return null;
}

// Maps a backtest verdict (Priority 6, already tested) to an evidence
// bucket for calibration — reused rather than re-derived, so "what counts
// as positive" is defined in exactly one place, not duplicated.
//
// IMPORTANT HONESTY NOTE: "negative_inferred" is NOT an explicit
// "no activity" checkbox — the trip-logging schema has no such field
// (confirmed during Priority 6). It means the species was left unchecked
// on a trip where the angler was actively logging other activity — real,
// but soft, evidence, never presented as an explicitly recorded negative.
function verdictToEvidence(verdict) {
  switch (verdict) {
    case "strong_hit": return "strong_positive";
    case "partial_hit": return "moderate_positive";
    case "miss": return "negative_inferred";
    case "consistent_low": return "negative_inferred";
    default: return "unknown"; // insufficient_evidence
  }
}

// Raw counts + observed rate for one subset of backtest results. Unknown
// observations are excluded from the rate's denominator entirely — they
// are not counted as failures, per the observation taxonomy requirement.
function aggregateEvidence(resultsSubset, minSample) {
  const evidenced = resultsSubset.map((r) => ({ ...r, evidence: verdictToEvidence(r.verdict) }));
  const positive = evidenced.filter((r) => r.evidence === "strong_positive" || r.evidence === "moderate_positive").length;
  const strongPositive = evidenced.filter((r) => r.evidence === "strong_positive").length;
  const negative = evidenced.filter((r) => r.evidence === "negative_inferred").length;
  const unknown = evidenced.filter((r) => r.evidence === "unknown").length;
  const usable = positive + negative;
  return {
    total: resultsSubset.length, usable, positive, strongPositive, negative, unknown,
    observedPositiveRate: usable > 0 ? positive / usable : null,
    reliable: usable >= minSample,
  };
}

function applyCalibrationFilters(results, options = {}) {
  let filtered = (results || []).filter((r) => r.predictedScore != null && !r.error);
  if (options.species) filtered = filtered.filter((r) => r.speciesId === options.species);
  if (options.beachId) filtered = filtered.filter((r) => r.beachId === options.beachId);
  if (options.modelVersion) filtered = filtered.filter((r) => r.modelVersion === options.modelVersion);
  if (options.startDate) filtered = filtered.filter((r) => new Date(r.predictionTimestamp) >= options.startDate);
  if (options.endDate) filtered = filtered.filter((r) => new Date(r.predictionTimestamp) <= options.endDate);
  return filtered;
}

// Refuses to silently blend model versions — if the filtered set spans
// more than one and none was explicitly requested, this returns an error
// object rather than a number, since "V10.1 and V10.2 combined" answers a
// question nobody asked and would corrupt any later version comparison.
function checkSingleModelVersion(filtered, options) {
  const versionsPresent = [...new Set(filtered.map((r) => r.modelVersion).filter(Boolean))];
  if (!options.modelVersion && versionsPresent.length > 1) {
    return { error: `Results span multiple model versions (${versionsPresent.join(", ")}) — pass options.modelVersion to analyze one at a time rather than blending them.`, versionsPresent };
  }
  return { versionsPresent };
}

// CALIBRATION: "does a given score range's observed positive rate look
// like what that range's numbers would suggest?" Bins by score, reports
// raw counts always, a rate only once a bin clears calibrationMinSample().
function computeCalibration(results, options = {}) {
  const filtered = applyCalibrationFilters(results, options);
  const versionCheck = checkSingleModelVersion(filtered, options);
  if (versionCheck.error) return versionCheck;
  const minSample = calibrationMinSample(options);
  const bins = CALIBRATION_SCORE_BINS.map(([lo, hi]) => ({
    range: `${lo}-${hi}`,
    ...aggregateEvidence(filtered.filter((r) => r.predictedScore >= lo && r.predictedScore <= hi), minSample),
  }));
  return {
    modelVersion: options.modelVersion || (versionCheck.versionsPresent[0] ?? null),
    scope: { species: options.species ?? null, beachId: options.beachId ?? null },
    minSample, totalResults: filtered.length, bins,
  };
}

// DISCRIMINATION: a different question from calibration — not "does 75
// mean anything specific" but "do higher scores outperform lower ones at
// all, in relative terms". Aggregates two arbitrary ranges rather than
// fixed bins.
function computeDiscrimination(results, lowRange, highRange, options = {}) {
  const filtered = applyCalibrationFilters(results, options);
  const versionCheck = checkSingleModelVersion(filtered, options);
  if (versionCheck.error) return versionCheck;
  const minSample = calibrationMinSample(options);
  const low = aggregateEvidence(filtered.filter((r) => r.predictedScore >= lowRange[0] && r.predictedScore <= lowRange[1]), minSample);
  const high = aggregateEvidence(filtered.filter((r) => r.predictedScore >= highRange[0] && r.predictedScore <= highRange[1]), minSample);
  const bothReliable = low.reliable && high.reliable;
  return {
    modelVersion: options.modelVersion || (versionCheck.versionsPresent[0] ?? null),
    lowRange: { range: `${lowRange[0]}-${lowRange[1]}`, ...low },
    highRange: { range: `${highRange[0]}-${highRange[1]}`, ...high },
    higherScoresOutperform: bothReliable && low.observedPositiveRate != null && high.observedPositiveRate != null
      ? high.observedPositiveRate > low.observedPositiveRate
      : null, // null = cannot say yet, not "no"
    reliable: bothReliable,
  };
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
// Fallback swell estimate when a beach's assigned buoy reports wind but no
// wave height (confirmed real for some stations, e.g. Fort Pierce 8722212
// has no wave sensor). Uses the standard Beaufort wind/sea-state scale — a
// real, documented open-water relationship, not an invented guess — so
// scoring degrades to an honest estimate instead of silently dropping the
// wave axis entirely. Always flagged as estimated, never shown as LIVE.
function estimateWaveFromWind(windSpeedKt) {
  if (windSpeedKt == null) return null;
  if (windSpeedKt <= 3) return 0.3;
  if (windSpeedKt <= 6) return 0.8;
  if (windSpeedKt <= 10) return 1.5;
  if (windSpeedKt <= 16) return 2.8;
  if (windSpeedKt <= 21) return 4.5;
  if (windSpeedKt <= 27) return 7;
  return 10;
}

function estimateWaterClarity(buoy, precip, tideStage, beachId) {
  const hasBuoyInput = buoy && (buoy.waveHeightFt != null || buoy.windSpeedKt != null || buoy.dominantWavePeriodS != null);
  // Priority 11 Part 1 — normalize by the ACTUAL accumulation window before
  // applying the threshold table below, instead of picking whichever
  // window NWS happens to report (1/3/6hr) and treating its raw total as
  // if it always meant "the last hour." The field NAME itself encodes the
  // real window (this is live/current data — the historical/trip-log path
  // was already confirmed correct, since it only ever uses NWS's genuine
  // 1-hour field). Raw accumulated amount + window are preserved in the
  // factor label for provenance/debugging, per the explicit requirement.
  const rainWindow = precip
    ? (precip.precipLast6HoursIn != null ? { amount: precip.precipLast6HoursIn, hours: 6 }
      : precip.precipLast3HoursIn != null ? { amount: precip.precipLast3HoursIn, hours: 3 }
      : precip.precipLastHourIn != null ? { amount: precip.precipLastHourIn, hours: 1 }
      : null)
    : null;
  const rainAmountIn = rainWindow ? rainWindow.amount / rainWindow.hours : null; // normalized to an honest inches-per-hour rate
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

  // Wind DIRECTION, separate from speed — now classified relative to THIS
  // beach's actual seaward-normal heading (Priority 11 Part 3), computed
  // geometrically from real coordinates, not one fixed compass range
  // assumed for the entire Atlantic coast. Kept modest — this is a real
  // but secondary factor next to wave height.
  if (buoy?.windDirDeg != null && buoy.windSpeedKt != null && buoy.windSpeedKt > 5 && beachId) {
    const rel = classifyWindRelativeToShore(buoy.windDirDeg, beachId);
    let dirDelta = 0, dirNote = "mostly alongshore, minimal effect";
    if (rel === "onshore") { dirDelta = -8; dirNote = "onshore — pushes turbid nearshore water toward the beach"; }
    else if (rel === "oblique_onshore") { dirDelta = -4; dirNote = "oblique onshore — some turbid water pushed toward the beach"; }
    else if (rel === "offshore") { dirDelta = 6; dirNote = "offshore — tends to flatten and clear nearshore water"; }
    else if (rel === "oblique_offshore") { dirDelta = 3; dirNote = "oblique offshore — mild clearing effect"; }
    if (dirDelta !== 0) {
      score += dirDelta;
      factors.push({ label: `Wind direction ${Math.round(buoy.windDirDeg)}° relative to this beach's shoreline — ${dirNote}`, delta: dirDelta });
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
    factors.push({
      label: `${rainWindow.amount.toFixed(2)} in rain over ${rainWindow.hours}h (NWS) — normalized to ${rainAmountIn.toFixed(2)} in/hr — ${rainDelta >= 0 ? "confirmed dry, favors clean water" : "freshwater runoff likely reducing clarity"}`,
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
// Per-species rules: how Presence and Feeding combine, bait/clarity/wind/
// light sensitivity, tide-direction preference, and wave-condition
// preference. Weights kept in a narrow band (0.48-0.60 presence) so no
// species lets Presence fully overwhelm a real Feeding problem — migratory
// species (tarpon, blacktip, bluefish, mackerel) sit at the top of that
// band, resident/consistent species (whiting, jack) at the bottom.
// zoneBias spread widened deliberately (was ±0.6, now ±1.25) — the
// narrower range meant most species landed in the same predicted zone on
// ordinary calm-to-moderate days, which didn't reflect real angler
// experience: tarpon and the sharks genuinely patrol well beyond the bars
// even in calm surf, while snook/whiting/pompano are tight trough hunters
// almost regardless of conditions.
// Tied to the SCORING ALGORITHM, not the app build — bump this manually
// only when Presence/Feeding/Access math, weights, curves, or the species
// rules table materially change. Every saved prediction snapshot carries
// this, so a historical snapshot's provenance is always auditable even
// after the live model moves on.
// V10_1 -> V10_2 (Priority 9): computePresence's and computeFeeding's bait
// terms now scale by species-specific forage-type affinity when a direct
// observation sets baitInfo.dominantType, instead of one flat value for
// every species. This IS a real scoring behavior change (though it only
// engages when "observed" tier is actually reached, which was previously
// unreachable) — V10_1 snapshots remain untouched and are never recomputed.
// V10_2 -> V10_3 (Priority 9 correction pass): (1) fixed a genuine double-
// counting bug where species affinity was applied both inside
// buildEnhancedBaitInfo AND again in computePresence/computeFeeding —
// now applied exactly once, via the aggregate forageStrength field;
// (2) forageStrength now sums ALL usable observed bait types for a
// species instead of only the single strongest one; (3) live scoring can
// now reach "observed" tier for the first time (previously only
// predictAsOfTimestamp could). All three change real numeric output.
// V10_1 and V10_2 snapshots remain untouched and are never recomputed.
// V10_3 -> V10_4 (Priority 11): (1) observed/live precipitation is now
// normalized to an honest inches-per-hour rate by its real accumulation
// window (1/3/6h) before entering clarity, instead of applying the same
// fixed thresholds to whichever window happened to be available —
// confirmed to change clarity materially (0.30in/1h vs 0.30in/6h no
// longer score identically); (2) clarity's wind-direction term now
// classifies wind relative to each beach's own geometrically-computed
// shoreline heading, instead of one fixed compass range assumed for
// every beach on the coast. Both changes flow into real Feeding scores
// through the existing, unchanged clarityW weight — no weight itself was
// touched, only the honesty of what feeds it. Older snapshots remain
// tied to V10_1/V10_2/V10_3 and are never recomputed or reinterpreted.
const MODEL_VERSION = "BFR_MODEL_V10_4";

const SPECIES_RULES = {
  tarpon:   { presenceWeight: 0.58, feedingWeight: 0.42, baitWeight: 1.0,  favoredDirection: null,       directionBonus: 0, wavePreference: "calm",     clarityW: 0.18, lightW: 0.12, windW: 0.06, nightWeight: 0,   zoneBias: 1.25 },
  snook:    { presenceWeight: 0.50, feedingWeight: 0.50, baitWeight: 1.0,  favoredDirection: "incoming", directionBonus: 8, wavePreference: "calm",     clarityW: 0.20, lightW: 0.12, windW: 0.08, nightWeight: 0,   zoneBias: -1.0 },
  pompano:  { presenceWeight: 0.52, feedingWeight: 0.48, baitWeight: 0.15, favoredDirection: "incoming", directionBonus: 8, wavePreference: "calm",     clarityW: 0.20, lightW: 0.04, windW: 0.08, nightWeight: 0,   zoneBias: -0.7 },
  whiting:  { presenceWeight: 0.48, feedingWeight: 0.52, baitWeight: 0.10, favoredDirection: null,       directionBonus: 0, wavePreference: "calm",     clarityW: 0.16, lightW: 0.03, windW: 0.08, nightWeight: 0,   zoneBias: -0.9 },
  bluefish: { presenceWeight: 0.58, feedingWeight: 0.42, baitWeight: 1.0,  favoredDirection: null,       directionBonus: 0, wavePreference: "rough",    clarityW: 0.08, lightW: 0.10, windW: 0.10, nightWeight: 0,   zoneBias: 0.35 },
  blacktip: { presenceWeight: 0.56, feedingWeight: 0.44, baitWeight: 0.8,  favoredDirection: null,       directionBonus: 0, wavePreference: "rough",    clarityW: 0,    lightW: 0.05, windW: 0.06, nightWeight: 1.0, zoneBias: 0.85 },
  spinner:  { presenceWeight: 0.54, feedingWeight: 0.46, baitWeight: 0.8,  favoredDirection: null,       directionBonus: 0, wavePreference: "tolerant", clarityW: 0,    lightW: 0.05, windW: 0.06, nightWeight: 1.0, zoneBias: 0.65 },
  bull:     { presenceWeight: 0.50, feedingWeight: 0.50, baitWeight: 0.8,  favoredDirection: null,       directionBonus: 0, wavePreference: "rough",    clarityW: 0,    lightW: 0.05, windW: 0.06, nightWeight: 0.9, zoneBias: 1.15 },
  jack:     { presenceWeight: 0.48, feedingWeight: 0.52, baitWeight: 0.9,  favoredDirection: null,       directionBonus: 0, wavePreference: "tolerant", clarityW: 0.10, lightW: 0.06, windW: 0.08, nightWeight: 0,   zoneBias: 0 },
  mackerel: { presenceWeight: 0.56, feedingWeight: 0.44, baitWeight: 0.6,  favoredDirection: null,       directionBonus: 0, wavePreference: "calm",     clarityW: 0.18, lightW: 0.06, windW: 0.08, nightWeight: 0,   zoneBias: 0.2 },
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
  // forageStrength (Priority 9 correction) is an aggregate across ALL
  // usable observed bait types, with species affinity already baked in
  // once inside buildEnhancedBaitInfo — using it directly here avoids
  // re-applying affinity a second time, which the original Priority 9
  // pass incorrectly did via a separate dominantType lookup.
  let bait = 0;
  if (baitInfo?.tier === "observed") bait = 10 * r.baitWeight * Math.min(1.5, baitInfo.forageStrength ?? 1);
  else if (baitInfo?.tier === "inferred-seasonal") bait = ((baitInfo.score - 50) / 50) * 6 * r.baitWeight;
  // Priority 12 — no internal rounding. Raw fractional value preserved
  // end-to-end for ranking; rounded only at the final display step in
  // scoreSpecies(). This was previously rounded here, which was the
  // first of three separate rounding steps that manufactured artificial
  // ties in Best-Time ranking (confirmed in the Best-Time audit).
  return Math.max(0, Math.min(100, core + bait));
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
  const tideSub = tideStage ? tideStage.flowStrength * 100 : 50;
  const waveSub = waveSubscore(waveFt, r.wavePreference);
  const claritySub = clarityScore != null ? clarityScore : 50;
  const windSub = windSubscore(windKt);
  const lightSub = lowLight ? 90 : 50;
  // forageStrength (Priority 9 correction) is the aggregate across ALL
  // usable observed bait types with species affinity already baked in
  // once — using it directly avoids re-deriving affinity from
  // dominantType a second time, which double-counted it in the original
  // Priority 9 pass.
  const baitSub = baitInfo?.tier === "observed"
    ? 50 + 30 * Math.min(1.5, baitInfo.forageStrength ?? 1)
    : baitInfo?.tier === "inferred-seasonal" ? baitInfo.score : 50;

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
    nightBonus = 15 * r.nightWeight;
    score += nightBonus;
  }

  const ceiling = computeFeedingCeiling(waveFt, clarityScore);
  // Priority 12 — raw fractional score preserved (clamped, not rounded).
  // This was the second of three rounding steps that manufactured
  // artificial Best-Time ties; rounding now happens only once, at final
  // display time in scoreSpecies().
  const rawScore = Math.max(5, Math.min(ceiling, score));

  return { score: rawScore, contributions, wSum, nightBonus, tideStage };
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
// ===========================================================================
// ACCESS ("Catchability" in the UI) — answers one specific question: given
// where this species is predicted to be holding, how realistically can a
// shore angler put a bait/lure in front of it and keep it there? This is
// deliberately NOT a generic "bad conditions" score — wind and current are
// secondary and modest; predicted distance dominates. A shark 25 yards off
// the beach in 20kt wind is still highly catchable; a shark predicted 130
// yards out in dead calm conditions is not.
//
// Extensibility hook: GEAR_RANGE_SCALE lets a future species/gear/delivery
// profile (fly rod, kayak-deployed bait, etc.) rescale what "distance"
// means for catchability without restructuring this engine. Every species
// uses the standard surf-rod assumption (scale 1.0) for now.
// ===========================================================================
const GEAR_RANGE_SCALE = {}; // speciesId -> multiplier; empty = everyone uses 1.0 (surf rod) for now
function gearScaleFor(speciesId) { return GEAR_RANGE_SCALE[speciesId] || 1.0; }

// Boundary values reconciled where the source table's buckets slightly
// overlap (e.g. 70yd sits at the edge of both the "50-70" and "70-90"
// buckets) — averaged here into one continuous curve instead of a
// discontinuous jump.
const ACCESS_DISTANCE_CURVE = [[0, 100], [30, 100], [50, 100], [70, 92], [90, 72], [120, 40], [150, 15], [220, 3], [250, 0]];
// Unrounded on purpose — this is the exact evaluator used both for a single
// point and as the building block for averageAccessDistanceScore's exact
// integration below. Rounding happens once, at the final `access` output.
function accessDistanceScore(yd) {
  const pts = ACCESS_DISTANCE_CURVE;
  if (yd <= pts[0][0]) return pts[0][1];
  if (yd >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (yd >= x0 && yd <= x1) return y0 + (y1 - y0) * (yd - x0) / (x1 - x0);
  }
}
// UNIFORM (unweighted) average of accessDistanceScore across the whole
// predicted [minYd, maxYd] range — not the midpoint. Exact trapezoid
// integration between every curve knot-point inside the interval (plus
// both endpoints): since the underlying curve is itself piecewise-linear,
// this has zero approximation error, not just "dense enough" sampling.
// No center-weighting — a wide range with half its yards in an easy zone
// and half in a hard zone should average out, not be pulled toward the
// midpoint's value specifically.
function averageAccessDistanceScore(minYdRaw, maxYdRaw) {
  if (minYdRaw == null || maxYdRaw == null || isNaN(minYdRaw) || isNaN(maxYdRaw)) return null;
  const minYd = Math.min(minYdRaw, maxYdRaw);
  const maxYd = Math.max(minYdRaw, maxYdRaw);
  if (maxYd === minYd) return accessDistanceScore(minYd);
  const xs = [minYd];
  for (const [x] of ACCESS_DISTANCE_CURVE) {
    if (x > minYd && x < maxYd) xs.push(x);
  }
  xs.push(maxYd); // ACCESS_DISTANCE_CURVE is ascending, so xs is already sorted
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const y0 = accessDistanceScore(x0), y1 = accessDistanceScore(x1);
    area += 0.5 * (y0 + y1) * (x1 - x0);
  }
  return area / (maxYd - minYd);
}
// Modest — 20kt doesn't make fish inaccessible, it makes casting/line
// control/bite detection harder. Shouldn't overpower a close-in prediction.
function accessWindPenalty(windKt) {
  if (windKt == null) return 0;
  if (windKt <= 14) return 0;
  if (windKt <= 19) return 5;
  if (windKt <= 24) return 10;
  return 15;
}
// Conservative on purpose — strong current isn't inherently bad fishing
// (it's often exactly why fish are feeding); this only penalizes the
// ability to hold a presentation in place, not the fishing quality itself.
function accessCurrentPenalty(flowPct) {
  if (flowPct <= 70) return 0;
  if (flowPct <= 85) return 2;
  if (flowPct <= 95) return 5;
  return 8;
}

function computeAccess(speciesId, position, windKt, flowStrength) {
  if (!position || !Array.isArray(position.distanceYd) || position.distanceYd.length !== 2) return null;
  const [rawMin, rawMax] = position.distanceYd;
  const minYd = Math.min(rawMin, rawMax);
  const maxYd = Math.max(rawMin, rawMax);
  const scale = gearScaleFor(speciesId);
  const distScore = averageAccessDistanceScore(minYd / scale, maxYd / scale);
  if (distScore == null) return null;
  const windPenalty = accessWindPenalty(windKt);
  const currentPenalty = accessCurrentPenalty((flowStrength || 0) * 100);
  const access = Math.round(Math.max(0, Math.min(100, distScore - windPenalty - currentPenalty)));

  // Three honest tiers, so the label never contradicts the delta shown
  // next to it — a "comfortable" label sitting next to a real -5/-8
  // penalty was confusing. >=95 = truly negligible, no real explanation
  // needed. 80-94 = a real but minor reduction — say so plainly, don't
  // call it "comfortable". <80 = the existing detailed breakdown.
  let explanation;
  if (access >= 95) {
    explanation = "Fish are within comfortable casting range";
  } else if (access >= 80) {
    const parts = [];
    if (windPenalty > 0) parts.push(`${Math.round(windKt)}kt wind`);
    if (currentPenalty > 0) parts.push("strong current");
    if (distScore < 98) parts.push(`predicted ${minYd}–${maxYd} yd out`);
    explanation = `Solid access, minor reduction from ${parts.join(" + ") || "conditions"}.`;
  } else {
    const parts = [];
    if (distScore < 85) parts.push(`fish predicted ${minYd}–${maxYd} yd offshore`);
    if (windPenalty > 0) parts.push(`${Math.round(windKt)}kt wind may make presentation harder`);
    if (currentPenalty > 0) parts.push("strong current may make it hard to hold a presentation in place");
    explanation = `Catchability reduced — ${parts.join("; ")}.`;
  }
  return { access, distScore, windPenalty, currentPenalty, explanation };
}

// Access is a MULTIPLIER on the Presence+Feeding blend (0.5-1.0), not a
// third equal-weighted additive term — a great-looking score should be
// meaningfully cut when the fish are genuinely out of realistic range, not
// just nudged down by a third of a point average. When Access is unknown
// (no live surf data), it doesn't penalize at all (multiplier = 1.0).
function computeFinalActivity(species, presence, feeding, baitInfo, secondaryAdj, access) {
  const r = SPECIES_RULES[species];
  let final = r.presenceWeight * effectivePresence(presence) + r.feedingWeight * feeding + (secondaryAdj || 0);
  let opportunistic = false;
  if (baitInfo?.tier === "observed" && presence < 40 && feeding >= 75) {
    final += 8;
    opportunistic = true;
    final = Math.min(final, 62);
  }
  const accessMultiplier = access != null ? 0.5 + 0.5 * (access / 100) : 1.0;
  final = final * accessMultiplier;
  // Priority 12 — raw fractional final score preserved (finalRaw), clamped
  // but not rounded. This was the third of three rounding steps that
  // manufactured artificial Best-Time ties; rounding now happens exactly
  // once, here, purely for the "final" display value — finalRaw is what
  // ranking must use.
  const finalRaw = Math.max(5, Math.min(98, final));
  return { final: Math.round(finalRaw), finalRaw, opportunistic };
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
    if (c.key === "Tide") label = `Tide flow ${Math.round(c.sub)}%`;
    else if (c.key === "Wave") label = "Offshore wave height";
    else if (c.key === "Clarity") label = "Water clarity (estimated)";
    else if (c.key === "Wind") label = "Wind";
    else if (c.key === "Light") label = c.sub > 50 ? "Low-light window" : "Midday light";
    else if (c.key === "Bait") label = baitInfo?.tier === "observed" ? `${baitInfo.level} (direct trip-log observation)` : baitInfo?.tier === "inferred-seasonal" ? `${baitInfo.level} inferred-seasonal bait` : "Bait unknown";
    factors.push({ label, shortLabel: c.key, delta });
  }
  if (feedingResult.nightBonus) factors.push({ label: "After dark — this species feeds more actively at night", shortLabel: "Night", delta: Math.round(feedingResult.nightBonus) });
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
// FORAGE TYPE MODEL (Priority 9) — activates the "observed" bait tier that
// already existed throughout the scoring engine but was previously dead
// code (nothing ever set it — see inferBaitActivity's own comment above:
// "None exist yet"). The direct-user-trip-log observations already
// captured by trip logging (Priority 5+, BAIT_TYPES) are genuine evidence
// of the strongest kind in the requested hierarchy (#1: direct user
// observation) — this wires them into scoring for the first time, with no
// new data source, no new schema table, and no fabricated data.
//
// Deliberately scoped to predictAsOfTimestamp() only (backtesting/
// snapshots/ranking), NOT the live 24-beach hook — fetching trip history
// on every live render across every beach card would be a real new
// network burden this priority never asked for, and given how little
// trip-log volume exists right now, the honest cost/benefit doesn't
// support it yet. The live hook's bait input is unchanged.
// ===========================================================================

// Relative, within-species multipliers (0-1) — NOT a second scoring
// channel. These scale the EXISTING baitWeight-driven contribution
// (computePresence's bait term, computeFeeding's bait sub-score) toward
// whichever forage type was actually observed, rather than adding new
// independent weight. Directional, defensible-from-general-fishing-
// knowledge only — not claimed as precise biology. A species with no
// entry for a bait type is treated as low-but-nonzero affinity (0.15),
// avoiding an implied "zero response" that isn't actually known.
const BAIT_TYPE_AFFINITY = {
  tarpon:   { mullet: 1.0, menhaden: 0.9, glass_minnows: 0.4, shrimp: 0.2, sand_fleas: 0.1 },
  snook:    { mullet: 1.0, menhaden: 0.6, glass_minnows: 0.7, shrimp: 0.5, sand_fleas: 0.2 },
  jack:     { mullet: 0.8, menhaden: 0.8, glass_minnows: 1.0, shrimp: 0.3, sand_fleas: 0.15 },
  mackerel: { mullet: 0.3, menhaden: 0.5, glass_minnows: 1.0, shrimp: 0.2, sand_fleas: 0.1 },
  bluefish: { mullet: 0.7, menhaden: 0.9, glass_minnows: 0.8, shrimp: 0.2, sand_fleas: 0.1 },
  blacktip: { mullet: 0.7, menhaden: 0.6, glass_minnows: 0.3, shrimp: 0.15, sand_fleas: 0.1 },
  spinner:  { mullet: 0.6, menhaden: 0.6, glass_minnows: 0.4, shrimp: 0.15, sand_fleas: 0.1 },
  bull:     { mullet: 0.6, menhaden: 0.5, glass_minnows: 0.2, shrimp: 0.15, sand_fleas: 0.1 },
  // Pompano/whiting are crustacean/sand-flea feeders — forage should stay
  // comparatively minor for them regardless of a nearby baitfish event,
  // per the explicit instruction not to let predator-style bait dominate.
  pompano:  { mullet: 0.1, menhaden: 0.1, glass_minnows: 0.1, shrimp: 0.6, sand_fleas: 1.0 },
  whiting:  { mullet: 0.05, menhaden: 0.05, glass_minnows: 0.1, shrimp: 0.5, sand_fleas: 1.0 },
};
function baitTypeAffinity(speciesId, baitTypeId) {
  return BAIT_TYPE_AFFINITY[speciesId]?.[baitTypeId] ?? 0.15;
}

// Conservative, coarse tiers — not manufactured precision about bait
// movement rates. "very_old" collapses to effectively unknown rather than
// a small nonzero number, since a multi-day-old sighting says very little
// about forage right now.
function forageFreshnessTier(hoursAgo) {
  if (hoursAgo == null || hoursAgo < 0) return "unknown"; // negative = would require a future observation; never allowed
  if (hoursAgo <= 6) return "very_recent";
  if (hoursAgo <= 24) return "recent";
  if (hoursAgo <= 72) return "old";
  return "very_old";
}
function forageFreshnessMultiplier(tier) {
  switch (tier) {
    case "very_recent": return 1.0;
    case "recent": return 0.7;
    case "old": return 0.35;
    default: return 0; // very_old / unknown — falls back to seasonal baseline entirely
  }
}
function forageFreshnessConfidence(tier) {
  switch (tier) {
    case "very_recent": return "High";
    case "recent": return "Moderate";
    default: return "Low";
  }
}

// Builds a per-bait-type evidence object from already-fetched trips
// (reuses fetchTripsList — no new API, no new schema table). Look-ahead
// safe by construction: any trip whose observed_at is after
// predictionTimestamp is skipped entirely, mirroring the exact discipline
// pickLatestAvailableRow() already enforces for buoy/weather rows. Concen-
// tration is only ever read from an ACTUAL logged count, never invented;
// with no count logged it stays "unknown", not defaulted to "scattered".
// Presence and concentration are two SEPARATE concepts, never merged.
// Presence: unknown | observed (visual sighting) | supported (caught but
// not visually confirmed — real but weaker evidence; a single caught
// baitfish is not the same claim as seeing a school). Concentration:
// unknown | scattered | moderate | heavy — coarse engineering buckets
// derived ONLY from an actual logged count, never implied, never treated
// as a precise biological threshold. "unknown" concentration still
// carries real (weaker) weight, since positive presence evidence exists
// even without a count.
function derivePresenceState(obs) {
  if (obs.sighted) return "observed"; // visual sighting, whether or not also caught
  if (obs.caught) return "supported"; // physical evidence only, weaker on its own
  return "unknown";
}
// Coarse, explicitly non-scientific buckets — NOT a biological threshold.
// Absent a count, concentration stays "unknown"; it is never assumed.
function deriveConcentrationState(count) {
  if (count == null) return "unknown";
  if (count < 25) return "scattered";
  if (count < 200) return "moderate";
  return "heavy";
}
const CONCENTRATION_MULTIPLIER = { unknown: 0.7, scattered: 0.75, moderate: 1.0, heavy: 1.25 };
// Sighted+caught together is real corroboration and modestly improves
// confidence — but confidence is data-quality, not a score multiplier, so
// this never stacks onto the weight used for scoring.
function presenceConfidence(presence, corroborated) {
  if (presence === "observed") return corroborated ? "High" : "Moderate";
  if (presence === "supported") return corroborated ? "Moderate" : "Low";
  return "Low";
}

function resolveForageEvidence(trips, predictionTimestamp) {
  const forage = {};
  for (const bt of BAIT_TYPES) {
    forage[bt.id] = {
      presence: "unknown", concentration: "unknown", source: "unknown",
      observedAtUtc: null, freshnessTier: "unknown", confidence: "Low",
    };
  }
  for (const trip of trips || []) {
    if (!trip.observed_at) continue;
    const obsTime = new Date(trip.observed_at);
    if (obsTime > predictionTimestamp) continue; // NEVER use a future observation
    for (const obs of trip.observations || []) {
      if (obs.subject_type !== "bait" || !forage[obs.subject_id]) continue;
      const presence = derivePresenceState(obs);
      if (presence === "unknown") continue;
      const existing = forage[obs.subject_id];
      if (existing.observedAtUtc && new Date(existing.observedAtUtc) >= obsTime) continue; // keep the LATEST eligible one
      const hoursAgo = (predictionTimestamp.getTime() - obsTime.getTime()) / 3600000;
      const freshnessTier = forageFreshnessTier(hoursAgo);
      const corroborated = !!(obs.sighted && obs.caught);
      forage[obs.subject_id] = {
        presence,
        concentration: deriveConcentrationState(obs.count),
        source: "direct_user_trip_log",
        observedAtUtc: obsTime.toISOString(),
        freshnessTier,
        confidence: presenceConfidence(presence, corroborated),
      };
    }
  }
  return forage;
}

// Combines real, multi-type forage evidence with the existing seasonal-
// inference baitInfo. Produces the SAME baitInfo shape every downstream
// function already understands, plus a preserved full typeBreakdown (all
// bait types, never discarded) so a snapshot or audit can always answer
// "what forage evidence existed, not just which type won."
//
// forageStrength is a SUM across every usable bait type (freshness x
// affinity x presence x concentration for THIS species), not just the
// single strongest type — a simultaneous mullet+glass-minnows sighting is
// two real pieces of evidence, not one. dominantType/dominantConcentration
// are kept separately, purely for labeling/display and for the position
// effect below, which is about a specific physical bait push, not a
// blended average. When no bait type clears a usable weight, returns the
// seasonal baitInfo completely unchanged.
function buildEnhancedBaitInfo(seasonalBaitInfo, forage, speciesId) {
  let best = null;
  let forageStrength = 0;
  for (const bt of BAIT_TYPES) {
    const ev = forage[bt.id];
    const freshMult = forageFreshnessMultiplier(ev.freshnessTier);
    if (freshMult <= 0 || ev.presence === "unknown") continue;
    const affinity = baitTypeAffinity(speciesId, bt.id);
    const presenceMult = ev.presence === "observed" ? 1.0 : 0.6; // "supported" (caught-only) is real but weaker than a visual sighting
    const concMult = CONCENTRATION_MULTIPLIER[ev.concentration];
    const weight = freshMult * affinity * presenceMult * concMult;
    forageStrength += weight; // ALL usable types contribute, not just the strongest
    if (!best || weight > best.weight) best = { bt, ev, weight, freshMult, affinity, presenceMult, concMult };
  }
  if (!best) return seasonalBaitInfo; // no usable direct evidence — unchanged seasonal fallback

  const concLabel = best.ev.concentration !== "unknown" ? `${best.ev.concentration[0].toUpperCase()}${best.ev.concentration.slice(1)} ` : "";
  return {
    tier: "observed",
    level: `${concLabel}${BAIT_TYPES.find((b) => b.id === best.bt.id).name.toLowerCase()} — ${best.ev.presence}, ${best.ev.freshnessTier.replace("_", " ")}`,
    score: Math.max(0, Math.min(100, Math.round(50 + Math.min(1.5, forageStrength) * 30))), // aggregate across types, still bounded 0-100
    basis: `Direct trip-log observation of ${best.bt.name.toLowerCase()} (${best.ev.presence}${best.ev.concentration !== "unknown" ? `, ${best.ev.concentration} concentration` : ""}), ${best.ev.freshnessTier.replace("_", " ")}${forageStrength > best.weight ? " — plus additional forage types present, see typeBreakdown" : ""}`,
    dominantType: best.bt.id,
    dominantPresence: best.ev.presence,
    dominantConcentration: best.ev.concentration,
    freshnessTier: best.ev.freshnessTier,
    forageSource: best.ev.source,
    forageObservedAtUtc: best.ev.observedAtUtc,
    forageStrength, // aggregate species-specific strength across ALL usable types — the single source of truth Presence/Feeding scale by; affinity is baked in HERE, once, not re-derived downstream
    typeBreakdown: forage, // every bait type's evidence, never discarded — see snapshot payload
  };
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

function predictFishPosition(tideStage, buoy, zoneBias, baitInfo, species) {
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
  // Active bait pulls predators inward, into the wash, overriding their
  // normal offshore-patrol tendency — a real, well-documented pattern
  // during an actual bait push/blitz. Gated on relevance now, not just
  // tier: irrelevant forage for this species, stale evidence, or a
  // scattered/unknown-concentration sighting should NOT move the
  // estimated position — only a fresh, sufficiently concentrated
  // observation of a type this species actually responds to.
  let baitPulledIn = false;
  if (baitInfo?.tier === "observed" && species) {
    const affinity = baitInfo.dominantType ? baitTypeAffinity(species, baitInfo.dominantType) : 0;
    const freshEnough = baitInfo.freshnessTier === "very_recent" || baitInfo.freshnessTier === "recent";
    const conc = baitInfo.dominantConcentration;
    if (affinity >= 0.5 && freshEnough && conc === "heavy") { idx -= 1.2; baitPulledIn = true; }
    else if (affinity >= 0.5 && freshEnough && conc === "moderate") { idx -= 0.6; baitPulledIn = true; }
  } else if (baitInfo?.tier === "inferred-seasonal" && baitInfo.score >= 65) { idx -= 0.3; }
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
    baitPulledIn,
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

// GO / MAYBE / DON'T GO — the single headline judgment, built from Target
// Activity (the top-relevant species' own score) and Fishability (above).
// Kept deliberately coarse (3 buckets, no decimal percentages) — this is a
// behavioral read of conditions, not a catch guarantee. Takes plain numbers
// — callers must pass fishability.score, not the fishability object itself.
function computeGoStatus(fishActivity, fishabilityScore) {
  if (fishActivity == null || fishabilityScore == null) return null;
  if (fishActivity >= 65 && fishabilityScore >= 55) return { label: "GO FISH", color: "#17D9C4" };
  if ((fishActivity + fishabilityScore) / 2 >= 45) return { label: "MAYBE", color: "#F5A623" };
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

// Distinct from computeIsNight (full darkness) — this catches the dawn/
// dusk transition itself, which is a real, well-documented feeding window
// independent of whether it's technically still dark. The old code tied
// "low light" feeding bonuses directly to isNight, which meant a classic
// dawn blitz that starts right at sunrise and runs into full daylight (a
// very common real pattern) got zero low-light credit at all.
function computeIsLowLight(now, lat, lon) {
  const t = computeSunTimes(now, lat, lon);
  const windowMs = 75 * 60000; // 75 min around sunrise/sunset
  return Math.abs(now.getTime() - t.sunrise.getTime()) <= windowMs
    || Math.abs(now.getTime() - t.sunset.getTime()) <= windowMs;
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
function scoreSpecies(species, tideStage, moonFactor, buoyFactor, clarityEstimate, isNight, baitInfo, isLowLight, predictionTimestamp) {
  if (!tideStage) return null;
  const buoy = buoyFactor?.buoy;
  const tempF = buoy?.waterTempF ?? null;
  // predictionTimestamp is now the single source of truth for every time-
  // dependent calculation in this function — defaults to "now" so existing
  // live-scoring behavior is unchanged, but the same engine can be called
  // with any past or future timestamp without touching this function.
  const now = predictionTimestamp || new Date();
  const month = now.getUTCMonth() + 1;

  const presence = computePresence(species, tempF, month, baitInfo);
  const feedingResult = computeFeeding(species, {
    tideStage, waveFt: buoy?.waveHeightFt, clarityScore: clarityEstimate?.score,
    windKt: buoy?.windSpeedKt, isNight, lowLight: isLowLight, baitInfo,
  });
  const secondaryAdj = computeSecondaryAdjustment(species, moonFactor, buoy);

  const position = predictFishPosition(tideStage, buoy, SPECIES_RULES[species]?.zoneBias || 0, baitInfo, species);
  const accessResult = computeAccess(species, position, buoy?.windSpeedKt, tideStage.flowStrength);

  const { final, finalRaw, opportunistic } = computeFinalActivity(species, presence ?? 50, feedingResult.score, baitInfo, secondaryAdj, accessResult?.access);
  const confidence = computeSpeciesConfidence(baitInfo, tempF != null, clarityEstimate != null, buoy != null);
  const factors = buildSpeciesFactors(species, presence ?? 50, feedingResult, tempF, month, baitInfo, isNight);
  if (secondaryAdj !== 0) {
    const label = species === "tarpon" ? "Moon phase (weak secondary modifier, capped ±5)" : "Barometric pressure (weak secondary modifier, capped ±5)";
    factors.push({ label, shortLabel: "Secondary", delta: secondaryAdj });
  }
  if (isLowLight) {
    factors.push({ label: "Dawn/dusk window — classic low-light feeding period", shortLabel: "Low light", delta: 0 });
  }
  if (accessResult) {
    factors.push({ label: accessResult.explanation, shortLabel: "Access", delta: accessResult.access - 100 });
  }

  return {
    // Priority 12 — display values stay rounded integers exactly as
    // before (no UI change forced here); *Raw fields are the unrounded
    // values, added specifically so ranking (rankFutureSpeciesWindows)
    // can use real precision instead of manufacturing ties from three
    // independent rounding steps.
    score: final, scoreRaw: finalRaw,
    presence: presence != null ? Math.round(presence) : null, presenceRaw: presence,
    feeding: Math.round(feedingResult.score), feedingRaw: feedingResult.score,
    access: accessResult?.access ?? null,
    accessExplanation: accessResult?.explanation ?? null, confidence, opportunistic,
    factors, tideStage, modelVersion: MODEL_VERSION, position,
  };
}

const TIDE_MODELS = {
  pompano: (t, m, b, c, n, k, l, p) => scoreSpecies("pompano", t, m, b, c, n, k, l, p),
  blacktip: (t, m, b, c, n, k, l, p) => scoreSpecies("blacktip", t, m, b, c, n, k, l, p),
  spinner: (t, m, b, c, n, k, l, p) => scoreSpecies("spinner", t, m, b, c, n, k, l, p),
  bull: (t, m, b, c, n, k, l, p) => scoreSpecies("bull", t, m, b, c, n, k, l, p),
  tarpon: (t, m, b, c, n, k, l, p) => scoreSpecies("tarpon", t, m, b, c, n, k, l, p),
  snook: (t, m, b, c, n, k, l, p) => scoreSpecies("snook", t, m, b, c, n, k, l, p),
  jack: (t, m, b, c, n, k, l, p) => scoreSpecies("jack", t, m, b, c, n, k, l, p),
  bluefish: (t, m, b, c, n, k, l, p) => scoreSpecies("bluefish", t, m, b, c, n, k, l, p),
  whiting: (t, m, b, c, n, k, l, p) => scoreSpecies("whiting", t, m, b, c, n, k, l, p),
  mackerel: (t, m, b, c, n, k, l, p) => scoreSpecies("mackerel", t, m, b, c, n, k, l, p),
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

// LEGACY, no longer on any user-facing path (Priority 12 continuation) —
// predictNextBestBite() was the function actually driving the visible
// Overview's Best Bite card, and it's been replaced there by
// rankFutureSpeciesWindows()/predictAsOfTimestamp(), the real species
// Presence/Feeding/Access engine with forecast wind/wave/clarity support
// (Priority 10). This tide/moon/sun-only sampler and its blanket
// solarProximityBonus() (up to +22, identical for every species) were the
// confirmed root cause of the sunrise/sunset bias — kept only in case
// other code still references it; verified nothing else does as of this
// change. Do not wire this back into any UI.
function sampleTideWindows(hiloRows, lat, lon, moonFactor, fromDate, horizonMs, speciesId) {
  if (!hiloRows || hiloRows.length < 2) return null;
  const sorted = [...hiloRows].sort(
    (a, b) => new Date(a.observedAt.replace(" ", "T")) - new Date(b.observedAt.replace(" ", "T"))
  );
  const start = fromDate.getTime();

  const sunEvents = [];
  for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
    const d = new Date(start + dayOffset * 86400000);
    const { sunrise, sunset } = computeSunTimes(d, lat, lon);
    sunEvents.push(sunrise, sunset);
  }

  const rules = speciesId ? SPECIES_RULES[speciesId] : null;

  const stepMs = 15 * 60000;
  const samples = [];
  for (let t = start; t <= start + horizonMs; t += stepMs) {
    const sampleDate = new Date(t);
    const stage = computeTideStage(sorted, sampleDate);
    if (!stage) continue;
    const flowBonus = Math.round(stage.flowStrength * 30);
    const solarBonus = solarProximityBonus(sampleDate, sunEvents);
    const moonBonus = moonFactor ? Math.round(moonFactor.bonus * 0.4) : 0;
    const directionBonus = rules && rules.favoredDirection
      ? (stage.direction === rules.favoredDirection ? rules.directionBonus : -2)
      : 0;
    const score = Math.max(5, Math.min(95, 50 + flowBonus + solarBonus + moonBonus + directionBonus));
    samples.push({ time: sampleDate, score, stage, flowBonus, solarBonus, moonBonus, directionBonus });
  }
  return samples.length > 0 ? samples : null;
}

function predictNextBestBite(hiloRows, lat, lon, moonFactor, fromDate) {
  const samples = sampleTideWindows(hiloRows, lat, lon, moonFactor, fromDate, 24 * 3600 * 1000, null);
  if (!samples) return null;

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

// ===========================================================================
// RANKING (Priority 8, updated Priority 10/12) — "where should I fish, and
// when?" Aggregates the EXISTING prediction engine across beaches
// (rankBeaches) or across time (rankFutureSpeciesWindows). Neither
// introduces a second scoring formula: rankBeaches literally IS
// predictAsOfTimestamp()'s score, sorted; rankFutureSpeciesWindows samples
// predictAsOfTimestamp() across a time range and groups the results into
// windows — it does NOT use sampleTideWindows()/predictNextBestBite() above,
// which are legacy and no longer on any user-facing path (Priority 12).
// ===========================================================================

// Ranks all mapped beaches for one species at one (current or historical)
// timestamp. Every result keeps the full prediction — score, Presence,
// Feeding, Access, confidence, position, factors, model version — nothing
// is thrown away to produce a number. Beaches with no valid prediction
// (e.g. no tide data at that moment) are returned with an explicit
// "unavailable" status and reason, never a fabricated score or a silent
// zero.
async function rankBeaches({ speciesId, predictionTimestamp }) {
  const settled = await Promise.allSettled(
    BEACHES.map((beach) => predictAsOfTimestamp(beach, speciesId, predictionTimestamp))
  );

  const ranked = [];
  const unavailable = [];

  BEACHES.forEach((beach, i) => {
    const outcome = settled[i];
    if (outcome.status === "rejected") {
      unavailable.push({ beachId: beach.id, beachName: beach.name, status: "unavailable", reason: outcome.reason?.message || "Prediction failed." });
      return;
    }
    const envelope = outcome.value;
    if (!envelope.result) {
      unavailable.push({ beachId: beach.id, beachName: beach.name, status: "insufficient", reason: "No tide data available for this beach at this timestamp." });
      return;
    }
    const r = envelope.result;
    ranked.push({
      beachId: beach.id, beachName: beach.name, speciesId,
      status: "valid",
      score: r.score, presence: r.presence, feeding: r.feeding, access: r.access,
      confidence: r.confidence, modelVersion: r.modelVersion,
      predictedZone: r.position?.primaryZone ?? null,
      predictedDistanceMin: r.position?.distanceYd?.[0] ?? null,
      predictedDistanceMax: r.position?.distanceYd?.[1] ?? null,
      majorPositiveFactors: (r.factors || []).filter((f) => f.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3).map((f) => f.label),
      majorLimitingFactors: (r.factors || []).filter((f) => f.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3).map((f) => f.label),
      sourceMeta: envelope.sourceMeta,
      predictionTimestamp: envelope.predictionTimestamp,
    });
  });

  // Sort by the model's own score, unrounded ties broken by nothing extra —
  // no added decimal precision, no confidence-based re-sorting (confidence
  // is reported alongside, never used to reorder, per explicit instruction).
  ranked.sort((a, b) => b.score - a.score);
  return { ranked, unavailable };
}

// Ranks upcoming time windows for one beach (optionally one species, for
// Priority 10 — replaces the tide/light-only proxy score entirely, per the
// explicit instruction not to preserve an arbitrary window score once
// forecast-backed real predictions are possible. Every window's score is
// now the ACTUAL species prediction (full Presence/Feeding/Access, via
// predictAsOfTimestamp) sampled across the range — never a second scoring
// formula. Relies entirely on the existing shared 2-minute cache to avoid
// redundant fetches: every sample point for the same beach reuses the
// same one tide/forecast/trips fetch underneath, not a new one per
// sample. Renamed from rankForecastableTideLightWindows since that name
// now describes what this function explicitly no longer is — it was
// never wired into any UI, so this rename has zero UI impact.
//
// Priority 12 (Best-Time precision fix) — rewritten on top of the same
// sampling and the same underlying species model, correcting five
// confirmed issues from the Best-Time audit:
//   1. Ranks on scoreRaw (unrounded), not the rounded display integer —
//      the previous triple-rounding cascade manufactured artificial ties.
//   2. No longer picks a single "first-seen" sample on a tie — windows
//      are built from ALL local peaks in the curve, then ranked by
//      WINDOW quality, not by which sample happened to be scanned first.
//   3. Returns sustained windows, not one timestamp.
//   4. The expansion threshold is adaptive to the day's actual score
//      range instead of a fixed 8 points, which behaved badly on flat
//      days (confirmed: an 8-point threshold on a 16-point-range day
//      swallowed roughly half the day).
//   5. A near-tied secondary window is surfaced explicitly rather than
//      silently discarded.
async function rankFutureSpeciesWindows({ beachId, speciesId, start, end, maxWindows = 3, stepMinutes = 30 }) {
  const beach = BEACHES.find((b) => b.id === beachId);
  if (!beach) return { windows: [], error: "Unknown beach." };
  if (!speciesId) return { windows: [], error: "speciesId is required — a window ranking is a species prediction evaluated across time, not a generic score." };

  const stepMs = Math.max(1, stepMinutes) * 60000;
  const samples = [];
  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const ts = new Date(t);
    let envelope;
    try { envelope = await predictAsOfTimestamp(beach, speciesId, ts); } catch { continue; }
    if (!envelope.result) continue; // no valid prediction at this moment (e.g. no tide data) — skip honestly, never fabricate a score
    // scoreRaw is the unrounded value ranking must use; score (rounded)
    // is kept only for display.
    samples.push({ time: ts, scoreRaw: envelope.result.scoreRaw, score: envelope.result.score, envelope });
  }
  if (samples.length === 0) {
    return { windows: [], error: "No valid predictions across this range — required inputs (at minimum tide) were unavailable throughout." };
  }

  // Adaptive threshold — 30% of the day's actual raw-score range, floored
  // at 2 points (so a genuinely flat day still resolves something
  // sensible) and capped at 12 points (so a highly variable day doesn't
  // produce a threshold wide enough to swallow most of it). Simple,
  // auditable, and scales with the curve instead of assuming one fixed
  // number fits every day.
  const rawScores = samples.map((s) => s.scoreRaw);
  const dayMax = Math.max(...rawScores), dayMin = Math.min(...rawScores);
  const dayRange = dayMax - dayMin;
  const threshold = Math.max(2, Math.min(12, dayRange * 0.3));

  // Local peaks — every sample that is >= both neighbors (endpoints only
  // need to beat their one neighbor). This finds separated opportunities
  // directly from the curve's actual shape, not from repeatedly picking
  // whatever the single largest remaining sample is.
  const peakIndices = [];
  for (let i = 0; i < samples.length; i++) {
    const prevOk = i === 0 || samples[i].scoreRaw >= samples[i - 1].scoreRaw;
    const nextOk = i === samples.length - 1 || samples[i].scoreRaw >= samples[i + 1].scoreRaw;
    if (prevOk && nextOk) peakIndices.push(i);
  }
  // Guard against a genuinely monotonic or single-sample series producing
  // zero detected peaks — fall back to the single global max.
  if (peakIndices.length === 0) {
    let gi = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i].scoreRaw > samples[gi].scoreRaw) gi = i;
    peakIndices.push(gi);
  }

  // Expand each peak into a window using the adaptive threshold, then
  // merge any windows that touch or overlap — two peaks with no real
  // valley between them aren't separate opportunities.
  let rawWindows = peakIndices.map((peakIdx) => {
    const peakScore = samples[peakIdx].scoreRaw;
    const floor = peakScore - threshold;
    let startIdx = peakIdx, endIdx = peakIdx;
    while (startIdx > 0 && samples[startIdx - 1].scoreRaw >= floor) startIdx--;
    while (endIdx < samples.length - 1 && samples[endIdx + 1].scoreRaw >= floor) endIdx++;
    return { startIdx, endIdx, peakIdx };
  });
  rawWindows.sort((a, b) => a.startIdx - b.startIdx);
  const merged = [];
  for (const w of rawWindows) {
    const last = merged[merged.length - 1];
    if (last && w.startIdx <= last.endIdx + 1) {
      last.endIdx = Math.max(last.endIdx, w.endIdx);
      if (samples[w.peakIdx].scoreRaw > samples[last.peakIdx].scoreRaw) last.peakIdx = w.peakIdx;
    } else {
      merged.push({ ...w });
    }
  }

  // Window quality: peak weighted more than the sustained average, but
  // both matter — this is what lets a sustained 82-83 plateau beat an
  // isolated single 84 spike, without inventing a separate duration
  // bonus. A transparent blend of two numbers already in the curve.
  const windows = merged.map((w) => {
    const windowSamples = samples.slice(w.startIdx, w.endIdx + 1);
    const avgRaw = windowSamples.reduce((sum, s) => sum + s.scoreRaw, 0) / windowSamples.length;
    const peak = samples[w.peakIdx];
    const quality = peak.scoreRaw * 0.6 + avgRaw * 0.4;
    // Explanation — pulled from the peak moment's own real factors, not
    // fabricated. Picks up to 2 of the strongest genuinely-positive
    // contributions (skips the always-present, delta:0 "Low light" label
    // unless it's truly among the top drivers, so dawn isn't credited
    // just for being dawn when it didn't actually help much).
    const topFactors = [...(peak.envelope.result.factors || [])]
      .filter((f) => f.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 2)
      .map((f) => f.shortLabel);
    return {
      windowStart: samples[w.startIdx].time, windowEnd: samples[w.endIdx].time,
      peakTime: peak.time, score: peak.score, scoreRaw: peak.scoreRaw,
      avgScore: Math.round(avgRaw * 10) / 10, quality,
      confidence: peak.envelope.result.confidence,
      isFuture: peak.envelope.isFuture,
      sourceMeta: peak.envelope.sourceMeta, // shows exactly which inputs were forecast vs unavailable at the peak moment
      whyLabels: topFactors,
      // Full peak-moment prediction (score, position, access, factors,
      // confidence, everything) so a consumer like the Fishing Plan card
      // can describe THIS window's predicted conditions consistently,
      // instead of mixing a future TIME with a "right now" TARGET/WHERE/
      // ACCESS. Never recomputed separately — this is the exact same
      // result object predictAsOfTimestamp already produced for the peak
      // sample.
      peakResult: peak.envelope.result,
    };
  });

  windows.sort((a, b) => b.quality - a.quality);
  const top = windows.slice(0, maxWindows);

  // Near-tie detection — if the runner-up window's quality is within the
  // SAME adaptive threshold of the best, they're comparable given this
  // model's own precision, and the UI should say so honestly rather than
  // implying one is decisively better.
  const nearTie = top.length > 1 && (top[0].quality - top[1].quality) <= threshold;

  return {
    windows: top, beachId, speciesId,
    resultType: "species_prediction_window", // no longer a tide-only proxy — this is the real model, sampled
    rankingVersion: "BFR_RANKING_V2", // Priority 12 — ranking/window interpretation version, deliberately separate from MODEL_VERSION: the underlying species biology math (scoreSpecies) is byte-identical for any single timestamp, only how a SERIES of predictions gets ranked into windows changed
    description: "Each window's score is the actual species prediction (Presence/Feeding/Access) evaluated across that stretch of time — forecast wind/wave/precip where available, deterministic tide, existing forage rules. Missing forecast inputs (e.g. water temperature) lower confidence rather than being fabricated.",
    adaptiveThreshold: Math.round(threshold * 10) / 10,
    nearTie,
    nearTieNote: nearTie ? "Multiple windows are similarly favorable today, given this model's precision." : null,
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

// Same error-handling shape as fetchViaProxy, but for the write-capable
// trip-logging route (POST with a JSON body instead of query params).
async function postToProxy(path, body) {
  let res;
  try {
    res = await fetch(`${PROXY_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(`Could not reach the proxy at ${PROXY_BASE_URL}: ${networkErr.message}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Proxy returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok || json.error) {
    throw new Error(json.error || `Proxy returned HTTP ${res.status}`);
  }
  return json;
}

async function fetchTripsList(beachId) {
  const params = beachId ? { beach_id: beachId, limit: "200" } : { limit: "200" };
  return fetchViaProxy("/trips/list", null, params);
}

// Priority 9 correction (#1/#12) — the live cache/performance requirement.
// Wraps the existing fetchTripsList in the SAME shared cache/in-flight-
// collapse mechanism every other live data source already uses (2-minute
// TTL). This is what makes live forage wiring safe: calling this once per
// species for the same beach within one render collapses into a SINGLE
// network request (in-flight de-dupe), and revisiting a beach within 2
// minutes reuses the cached result — never 24 separate beach x trip-
// history requests, and never N-per-species either. Short enough that a
// newly logged trip is reflected again soon, without a page rebuild.
async function fetchTripsListCached(beachId, { force = false } = {}) {
  return cachedFetch(`trips:${beachId}`, () => fetchTripsList(beachId), { force });
}

// ===========================================================================
// PATTERN ANALYSIS — purely descriptive frequency counts from YOUR OWN
// logged trips, kept deliberately separate from the biologically-grounded
// scoring engine above. This never adjusts scores or predictions; it only
// surfaces "in N trips you logged under condition X, activity happened Y
// times" — and only once N is large enough that the number means anything.
// A minimum sample size AND a real divergence from the subject's overall
// rate are both required before anything is called a "possible pattern" —
// below that, it stays silent rather than dressing up noise as insight.
// ===========================================================================
const PATTERN_MIN_BUCKET_N = 5;
const PATTERN_MIN_DIVERGENCE = 0.25; // 25 percentage points from the overall rate

function bucketSurf(waveFt) {
  if (waveFt == null) return null;
  if (waveFt <= 2) return "Calm surf (≤2ft)";
  if (waveFt <= 4) return "Moderate surf (2-4ft)";
  return "Rough surf (4ft+)";
}
function bucketTide(direction) {
  return direction ? `${direction[0].toUpperCase()}${direction.slice(1)} tide` : null;
}
function bucketClarity(label) {
  return label || null;
}
function bucketTimeBlock(tb) {
  const found = TIME_BLOCKS.find((t) => t.id === tb);
  return found ? found.label : null;
}

const PATTERN_DIMENSIONS = [
  { key: "surf", label: "Surf", bucket: (trip) => bucketSurf(trip.wave_ft) },
  { key: "tide", label: "Tide", bucket: (trip) => bucketTide(trip.tide_direction) },
  { key: "clarity", label: "Clarity", bucket: (trip) => bucketClarity(trip.clarity_label) },
  { key: "time", label: "Time", bucket: (trip) => bucketTimeBlock(trip.time_block) },
];

// Returns, per subject (species/bait), per dimension, any bucket that both
// has enough trips AND diverges meaningfully from that subject's overall
// hit rate. Everything below threshold is simply omitted, not shown as a
// weak pattern — silence is the honest answer when there isn't enough data.
function computeTripPatterns(trips) {
  const bySubject = {}; // subjectId -> { hits: [], overallRate, byDimension: {...} }

  for (const trip of trips) {
    for (const obs of trip.observations || []) {
      const hit = obs.sighted || obs.bit || obs.caught ? 1 : 0;
      const key = obs.subject_id;
      if (!bySubject[key]) bySubject[key] = { subjectType: obs.subject_type, records: [] };
      bySubject[key].records.push({ hit, trip });
    }
  }

  const results = {};
  for (const [subjectId, { subjectType, records }] of Object.entries(bySubject)) {
    const overallN = records.length;
    const overallRate = records.reduce((s, r) => s + r.hit, 0) / overallN;
    const patterns = [];

    for (const dim of PATTERN_DIMENSIONS) {
      const byBucket = {};
      for (const r of records) {
        const bucket = dim.bucket(r.trip);
        if (!bucket) continue;
        if (!byBucket[bucket]) byBucket[bucket] = [];
        byBucket[bucket].push(r.hit);
      }
      for (const [bucket, hits] of Object.entries(byBucket)) {
        const n = hits.length;
        if (n < PATTERN_MIN_BUCKET_N) continue;
        const rate = hits.reduce((s, h) => s + h, 0) / n;
        const divergence = rate - overallRate;
        if (Math.abs(divergence) >= PATTERN_MIN_DIVERGENCE) {
          patterns.push({
            dimension: dim.label, bucket, n, rate, overallRate,
            direction: divergence > 0 ? "more" : "less",
          });
        }
      }
    }
    results[subjectId] = { subjectType, overallN, overallRate, patterns };
  }
  return results;
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
// FORECAST (Priority 10) — one gridpoint fetch per beach, cached and reused
// across every species AND every future timestamp requested for that beach
// (the payload covers many hours at once, not just one). Same shared
// cachedFetch/2-minute-TTL every other live source already uses — no new
// caching mechanism invented. Every field is individually
// present/forecast or absent/unavailable; nothing here assumes coverage
// just because the NWS schema defines the field.
// ===========================================================================
async function fetchForecastForBeach(beach, { force = false } = {}) {
  if (!beach) return null;
  return cachedFetch(`forecast:${beach.id}`, async () => {
    return fetchViaProxy("/forecast/gridpoint", null, { lat: beach.lat, lon: beach.lon });
  }, { force });
}

// NWS validTime is "2026-09-17T06:00:00+00:00/PT2H" — an ISO 8601 start
// time plus an ISO 8601 duration. Durations from this API are always some
// combination of days/hours/minutes (e.g. "PT2H", "P1DT6H") — no seconds,
// no invented sub-hour precision beyond what NWS itself reports.
function parseIso8601DurationMs(dur) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur || "");
  if (!m) return 0;
  const days = parseInt(m[1] || 0, 10), hours = parseInt(m[2] || 0, 10), minutes = parseInt(m[3] || 0, 10);
  return (days * 86400 + hours * 3600 + minutes * 60) * 1000;
}

// Finds the gridpoint value whose interval actually contains the
// requested timestamp — null if the timestamp falls outside this layer's
// forecast horizon (e.g. requesting 10 days out from an hourly layer that
// only covers 7). Never interpolates across a gap; the interval either
// contains the moment or it doesn't. Returns the interval's own duration
// too — needed because NWS accumulation fields (QPF) represent a total
// across that whole interval, not an instant, and the interval length
// varies (near-term periods are often 1h, farther out often 6h).
function findGridpointValueAt(layerValues, targetDate) {
  if (!layerValues) return null;
  const targetMs = targetDate.getTime();
  for (const entry of layerValues) {
    const [startStr, durStr] = entry.validTime.split("/");
    const startMs = new Date(startStr).getTime();
    const durMs = parseIso8601DurationMs(durStr);
    if (targetMs >= startMs && targetMs < startMs + durMs) return { value: entry.value, validTime: entry.validTime, durationMs: durMs };
  }
  return null;
}

// Converts NWS's WMO unit codes to the same units the rest of this app
// already uses (kt, ft, °F, in, hPa) — based on the uom string NWS itself
// returns, not an assumption, so a unit change on their end fails loud
// (wrong-looking numbers) rather than silently.
function convertForecastValue(value, uom) {
  if (value == null || !uom) return value;
  if (uom.includes("km_h")) return value * 0.539957; // km/h -> kt
  if (uom.includes("m_s-1") || uom.includes("m_s")) return value * 1.94384; // m/s -> kt
  if (uom.endsWith(":m") || uom.endsWith("_m")) return value * 3.28084; // m -> ft
  if (uom.includes("mm")) return value / 25.4; // mm -> in
  if (uom.includes(":Pa") && !uom.includes("hPa")) return value / 100; // Pa -> hPa
  if (uom.includes("degC") || uom.includes("degC")) return value * 9 / 5 + 32; // °C -> °F
  return value; // percent, degrees, seconds, already-hPa — no conversion needed
}

// Resolves one specific prediction timestamp's worth of forecast inputs
// from an already-fetched beach-level forecast bundle. Every field is
// independently present ("forecast", with source + validTime) or absent
// ("unavailable") — never a fabricated fallback value.
//
// PRECIPITATION SEMANTICS (Priority 10 correction): NWS's
// quantitativePrecipitation is an ACCUMULATED total across its own
// interval — that interval is NOT always one hour (near-term periods are
// often 1h, farther-out periods are commonly 6h). The original
// implementation copied this raw accumulated value straight into
// precipLastHourIn, which silently mislabeled a 6-hour total as one
// hour's rain — a real overstatement of rainfall rate feeding
// estimateWaterClarity. This now normalizes to an honest average hourly
// RATE (total / interval hours) before it's used as an hourly figure —
// still an approximation (real rain isn't evenly distributed across the
// period), but a correctly-scaled one, not a mislabeled multi-hour total.
function resolveForecastInputs(forecastBundle, predictionTimestamp) {
  if (!forecastBundle || !forecastBundle.layers) return null;
  const source = `NWS gridpoint ${forecastBundle.gridId} ${forecastBundle.gridX},${forecastBundle.gridY}`;
  const get = (field) => {
    const layer = forecastBundle.layers[field];
    if (!layer) return { value: null, status: "unavailable" };
    const found = findGridpointValueAt(layer.values, predictionTimestamp);
    if (!found) return { value: null, status: "unavailable" };
    return { value: convertForecastValue(found.value, layer.uom), status: "forecast", validTime: found.validTime, source, intervalHours: found.durationMs / 3600000 };
  };
  const precipAmount = get("quantitativePrecipitation");
  if (precipAmount.status === "forecast" && precipAmount.intervalHours > 0) {
    precipAmount.rawAccumulatedIn = precipAmount.value; // the real NWS total across the full interval, preserved for audit
    precipAmount.value = precipAmount.value / precipAmount.intervalHours; // normalized to an honest average hourly rate
  }
  return {
    windSpeedKt: get("windSpeed"), windDirDeg: get("windDirection"), windGustKt: get("windGust"),
    waveHeightFt: get("waveHeight"), wavePeriodS: get("wavePeriod"), waveDirDeg: get("waveDirection"),
    primarySwellHeightFt: get("primarySwellHeight"), windWaveHeightFt: get("windWaveHeight"),
    precipProbabilityPct: get("probabilityOfPrecipitation"), precipAmountIn: precipAmount,
    pressureHpa: get("pressure"),
  };
}

// ===========================================================================
// SPECIES / BAIT / BEACH REFERENCE DATA — real, live-used constants (not
// fabricated demo data). Species rules, bait types, and beach coordinates
// feed the actual scoring engine everywhere in this file. Historically
// this comment said everything below was fake prototyping data with only
// Fort Pierce's tide connected to anything real — that was true in an
// early build but is no longer accurate: NOAA tide, NDBC buoy, NWS
// precip/forecast, and D1 trip logging are all live for every mapped
// beach below (Priority 1 onward).
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

// Bait gets Sighted/Caught only (no "Bit" — doesn't apply to forage species).
const BAIT_TYPES = [
  { id: "mullet", name: "Mullet" },
  { id: "menhaden", name: "Menhaden" },
  { id: "glass_minnows", name: "Glass minnows" },
  { id: "shrimp", name: "Shrimp" },
  { id: "sand_fleas", name: "Sand fleas" },
];

// Time blocks are relative to that DATE's real sunrise/sunset, not fixed
// clock hours — "dawn" on a December day and a June day are different
// hours, and the model already computes real sun times per date/location.
const TIME_BLOCKS = [
  { id: "dawn", label: "Dawn" },
  { id: "morning", label: "Morning" },
  { id: "midday", label: "Midday" },
  { id: "afternoon", label: "Afternoon" },
  { id: "dusk", label: "Dusk" },
  { id: "night", label: "Night" },
];

// Picks a representative clock time for a time-block on a specific date at
// a specific beach, using the same verified sun-time math as everywhere
// else in the app.
function timeBlockTargetDate(dateUTC, timeBlockId, lat, lon) {
  const { sunrise, sunset } = computeSunTimes(dateUTC, lat, lon);
  const solarNoon = new Date((sunrise.getTime() + sunset.getTime()) / 2);
  switch (timeBlockId) {
    case "dawn": return sunrise;
    case "morning": return new Date((sunrise.getTime() + solarNoon.getTime()) / 2);
    case "midday": return solarNoon;
    case "afternoon": return new Date((solarNoon.getTime() + sunset.getTime()) / 2);
    case "dusk": return sunset;
    case "night": return new Date(sunset.getTime() + 3 * 3600000);
    default: return solarNoon;
  }
}

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

// ===========================================================================
// BEACH SHORELINE ORIENTATION (Priority 11 Part 3, corrected) — an
// EXPLICIT, independently-audited table, not a dynamic computation from
// neighboring entries in our own sparse beach list. The earlier
// neighbor-bearing approach was flagged, correctly, as an approximation
// of OUR beach spacing rather than the actual coastline — verified by
// re-checking every heading against independent knowledge of Florida's
// real Atlantic shoreline geometry (not survey-grade; rounded to the
// nearest 5°, which is the right precision for a secondary clarity
// modifier). Most of the First Coast / Space Coast / Treasure Coast
// values needed a real correction toward a more easterly (higher-degree)
// heading — the neighbor-bearing method had skewed them too far ENE,
// most severely at Playalinda, New Smyrna, and Jupiter (all three used
// short or geometrically awkward local baselines). Broward/Miami-Dade
// values were already close. Two genuine remaining uncertainties, named
// honestly rather than hidden: Bathtub Beach sits in an unusual sheltered
// cove/sandbar structure near the St. Lucie Inlet that doesn't reduce
// cleanly to one heading; Key Biscayne's shoreline curves toward Cape
// Florida at its southern tip, so this is a reasonable heading for the
// main swimming-beach stretch (Crandon Park), not a claim that the whole
// island shares one orientation. See the Priority 11 report for the full
// before/after table and per-beach reasoning.
const BEACH_SEAWARD_NORMAL = {
  "amelia-island": 95, "jacksonville-beach": 95, "ponte-vedra-beach": 95,
  "st-augustine-beach": 93, "vilano-beach": 93, "flagler-beach": 92,
  "playalinda-beach": 100, "new-smyrna-beach": 95, "daytona-beach": 93,
  "cocoa-beach": 90, "melbourne-beach": 92, "vero-beach": 92,
  "fort-pierce": 90, "jensen-beach": 90, "bathtub-beach": 85, "stuart-beach": 90,
  "juno-beach": 92, "jupiter-beach": 92, "palm-beach": 95,
  "fort-lauderdale-beach": 97, "hollywood-beach": 97, "haulover-beach": 98,
  "south-beach": 100, "key-biscayne": 108,
};

// Classifies a wind direction relative to THIS SPECIFIC beach's actual
// shoreline — angular difference from its seaward-normal, not a fixed
// compass bucket applied identically everywhere.
function classifyWindRelativeToShore(windDirDeg, beachId) {
  const normal = BEACH_SEAWARD_NORMAL[beachId];
  if (normal == null || windDirDeg == null) return null;
  let diff = Math.abs(windDirDeg - normal) % 360;
  if (diff > 180) diff = 360 - diff;
  if (diff <= 30) return "onshore";
  if (diff <= 60) return "oblique_onshore";
  if (diff <= 120) return "alongshore";
  if (diff <= 150) return "oblique_offshore";
  return "offshore";
}

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
  const [regionalWaveState, setRegionalWaveState] = useState({ loading: false, reading: null });
  // Priority 9 correction — ONE forage lookup per beach, shared across
  // every species scored for it, not one per species. fetchTripsListCached
  // already collapses this to a single network request even if multiple
  // species happen to trigger it in the same render pass.
  const [forageState, setForageState] = useState({ loading: true, forage: null });

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

  // Best-effort by design: trip-log history is additive evidence, never
  // load-bearing — any failure here (network, proxy, parsing) falls back
  // silently to the seasonal-only bait estimate rather than breaking the
  // rest of the prediction.
  const loadForage = useCallback((force = false) => {
    setForageState({ loading: true, forage: null });
    fetchTripsListCached(beachId, { force })
      .then((json) => setForageState({ loading: false, forage: resolveForageEvidence(json.trips || [], new Date()) }))
      .catch(() => setForageState({ loading: false, forage: null }));
  }, [beachId]);

  // Initial load uses the shared 2-minute cache (see cachedFetch above) so
  // beaches sharing a station, or revisiting a screen quickly, don't refire
  // identical requests. The refresh button below forces a real refetch.
  useEffect(() => { loadNoaa(false); }, [loadNoaa]);
  useEffect(() => { loadBuoy(false); }, [loadBuoy]);
  useEffect(() => { loadPrecip(false); }, [loadPrecip]);
  useEffect(() => { loadForage(false); }, [loadForage]);

  // Once the primary buoy resolves, if it genuinely has no wave sensor,
  // search neighboring stations for a real regional reading before ever
  // falling back to a wind-derived guess.
  useEffect(() => {
    if (!hasBuoy || buoyState.loading || !buoyState.buoy || buoyState.buoy.waveHeightFt != null) {
      setRegionalWaveState({ loading: false, reading: null });
      return;
    }
    let cancelled = false;
    setRegionalWaveState({ loading: true, reading: null });
    fetchNearestWaveReading(NDBC_STATIONS[beachId].stationId)
      .then((reading) => { if (!cancelled) setRegionalWaveState({ loading: false, reading }); })
      .catch(() => { if (!cancelled) setRegionalWaveState({ loading: false, reading: null }); });
    return () => { cancelled = true; };
  }, [beachId, hasBuoy, buoyState.loading, buoyState.buoy]);

  const refresh = useCallback(() => {
    loadNoaa(true);
    loadBuoy(true);
    loadPrecip(true);
    loadForage(true);
  }, [loadNoaa, loadBuoy, loadPrecip, loadForage]);

  // Single source of truth for every time-dependent calculation this hook
  // feeds into scoreSpecies — previously five separate new Date() calls
  // below, which meant "now" wasn't actually one consistent value. Live
  // scoring always uses the real current moment; this is also exactly the
  // seam a future hourly-forecast or backtesting caller would replace with
  // an explicit timestamp, without touching scoreSpecies itself.
  const predictionTimestamp = new Date();

  const tideStage = (isLive && noaaState.bundle?.hilo?.ok)
    ? computeTideStage(noaaState.bundle.hilo.data, predictionTimestamp)
    : null;
  const moonFactor = isLive ? scoreMoonFactor(computeMoonPhase(predictionTimestamp)) : null;

  // Wave height fallback, in order of honesty: (1) the beach's own live
  // buoy reading, (2) a REAL reading borrowed from the nearest neighboring
  // buoy that has one (swell is regional, travels coherently along the
  // coast — this is far more accurate than guessing from local wind), (3)
  // only as a last resort, a wind-derived Beaufort-scale estimate. Each
  // tier is tagged distinctly so the UI never shows (2) or (3) as LIVE.
  const effectiveBuoy = (() => {
    if (!buoyState.buoy) return null;
    if (buoyState.buoy.waveHeightFt != null) return buoyState.buoy;
    if (regionalWaveState.reading) {
      return {
        ...buoyState.buoy,
        waveHeightFt: regionalWaveState.reading.waveHeightFt,
        dominantWavePeriodS: regionalWaveState.reading.dominantWavePeriodS,
        waveHeightIsRegional: true,
        waveHeightSourceStationId: regionalWaveState.reading.stationId,
      };
    }
    const estimated = estimateWaveFromWind(buoyState.buoy.windSpeedKt);
    if (estimated == null) return buoyState.buoy;
    return { ...buoyState.buoy, waveHeightFt: estimated, waveHeightIsEstimated: true };
  })();

  const buoyFactor = effectiveBuoy ? scoreBuoyFactor(effectiveBuoy) : null;
  const clarityEstimate = estimateWaterClarity(effectiveBuoy, precipState.precip, tideStage, beachId);
  // Seasonal-only baseline (unchanged) — the per-species enhancement below
  // upgrades this to "observed" tier only for species/types where real,
  // fresh, look-ahead-safe trip-log evidence actually exists.
  const seasonalBaitInfo = inferBaitActivity(effectiveBuoy, predictionTimestamp);

  const beach = BEACHES.find((b) => b.id === beachId);
  const isNight = beach ? computeIsNight(predictionTimestamp, beach.lat, beach.lon) : false;
  const isLowLight = beach ? computeIsLowLight(predictionTimestamp, beach.lat, beach.lon) : false;

  // Priority 9 correction: live scoring can now see recent direct forage
  // observations, not just the seasonal estimate. baitInfo is built PER
  // SPECIES (each species has its own affinity to whatever was actually
  // observed) from the ONE shared forageState.forage fetched above — no
  // per-species network calls, just per-species math over already-fetched
  // data.
  const buildBaitInfoFor = (speciesId) =>
    forageState.forage ? buildEnhancedBaitInfo(seasonalBaitInfo, forageState.forage, speciesId) : seasonalBaitInfo;

  const liveResults = {}; // speciesId -> { score, factors, tideStage }
  if (tideStage) {
    for (const [sid, modelFn] of Object.entries(TIDE_MODELS)) {
      const result = modelFn(tideStage, moonFactor, buoyFactor, clarityEstimate, isNight, buildBaitInfoFor(sid), isLowLight, predictionTimestamp);
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
  const fishability = computeFishability(effectiveBuoy);
  const goStatus = computeGoStatus(fishActivity, fishability?.score);

  // Position/casting distance depend on species (zoneBias) and bait
  // (active bait pulls predators inward), so this is a function the
  // caller invokes per species rather than one fixed value. Explicitly a
  // behavioral starting estimate, not measured trough location — there's
  // no real bathymetry source behind this.
  const getFishPosition = useCallback((speciesId) => {
    const bias = SPECIES_RULES[speciesId]?.zoneBias || 0;
    const pos = predictFishPosition(tideStage, effectiveBuoy, bias, buildBaitInfoFor(speciesId), speciesId);
    return pos ? { ...pos, isEstimate: true } : null;
  }, [tideStage, effectiveBuoy, seasonalBaitInfo, forageState.forage]);

  return {
    isLive, hasBuoy, hasMetar, noaaState, buoyState, precipState, tideStage, moonFactor, buoyFactor, clarityEstimate, isNight, isLowLight,
    effectiveBuoy, baitInfo: seasonalBaitInfo, forageState, fishActivity, topSpeciesId, fishability, goStatus, getFishPosition,
    // Exposes the EXACT same per-species forage resolution the scoring
    // loop above already calls — not a UI-only recomputation. A caller
    // asking getBaitInfoForSpecies("snook") gets back the identical
    // object (same typeBreakdown, same dominantType, same forageStrength)
    // that fed snook's actual prediction.
    getBaitInfoForSpecies: buildBaitInfoFor,
    liveResults, loadNoaa, loadBuoy, loadPrecip, refresh,
    loading: isLive && (noaaState.loading || buoyState.loading),
  };
}

// Four distinct groups, not two — sharks and pompano each behave
// differently enough from their broader category to warrant their own
// number rather than being averaged in with everything else. Mackerel
// groups with the "small" leftover bucket (light-tackle/schooling
// species culture) despite its "gamefish" tag elsewhere in the app.
const SHARK_SPECIES = ["blacktip", "spinner", "bull"];
const BIG_GAME_REST = ["tarpon", "snook", "jack"];
const SMALL_GAME_REST = ["bluefish", "whiting", "mackerel"];

function averageForGroup(liveEntries, speciesIds) {
  const entries = liveEntries.filter(([sid]) => speciesIds.includes(sid));
  if (entries.length === 0) return null;
  return Math.round(entries.reduce((sum, [, r]) => sum + r.score, 0) / entries.length);
}

function GameStyleScore({ label, score }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: "#4A6270", fontSize: 7.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 1 }}>{label}</div>
      <div style={{
        color: score != null ? scoreColor(score) : "#5A7A8A", fontSize: 16, fontWeight: 700,
        fontFamily: "'Space Grotesk', sans-serif",
      }}>
        {score != null ? score : "—"}
      </div>
    </div>
  );
}

function BeachRadarCard({ beach, onSelectBeach }) {
  const { liveResults, loading } = useLiveSpeciesScores(beach.id);

  const liveEntries = Object.entries(liveResults);
  const sharkScore = averageForGroup(liveEntries, SHARK_SPECIES);
  const bigScore = averageForGroup(liveEntries, BIG_GAME_REST);
  const pompanoScore = liveResults.pompano?.score ?? null;
  const smallScore = averageForGroup(liveEntries, SMALL_GAME_REST);
  const hasAnyScore = sharkScore != null || bigScore != null || pompanoScore != null || smallScore != null;

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
        <div style={{ width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <RefreshCw size={16} color="#5A7A8A" style={{ animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
        </div>
      ) : hasAnyScore ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 8px", flexShrink: 0, width: 96 }}>
          <GameStyleScore label="SHARK" score={sharkScore} />
          <GameStyleScore label="BIG" score={bigScore} />
          <GameStyleScore label="POMP" score={pompanoScore} />
          <GameStyleScore label="SMALL" score={smallScore} />
        </div>
      ) : (
        <div style={{
          width: 56, height: 56, borderRadius: "50%", border: "1px solid #3A2020", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <WifiOff size={16} color="#FF5D5D" />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#E7EFF3", fontSize: 15, fontWeight: 600 }}>
          {beach.name} {hasAnyScore && <span style={{ color: "#17D9C4", fontSize: 9 }}>● LIVE</span>}
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
  const [rankSpecies, setRankSpecies] = useState(null);
  const [rankState, setRankState] = useState({ status: "idle", data: null, error: null });

  const runRanking = async (speciesId) => {
    setRankSpecies(speciesId);
    setRankState({ status: "loading", data: null, error: null });
    try {
      const { ranked, unavailable } = await rankBeaches({ speciesId, predictionTimestamp: new Date() });
      setRankState({ status: "done", data: { ranked, unavailable }, error: null });
    } catch (err) {
      setRankState({ status: "error", data: null, error: err.message });
    }
  };

  return (
    <div style={{ padding: "12px 14px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
          JACKSONVILLE → MIAMI
        </div>
        <LiveBadge small />
      </div>
      <div style={{ color: "#4A6270", fontSize: 11, marginBottom: 14 }}>
        Listed north to south. SHARK = blacktip/spinner/bull, BIG = tarpon/snook/jack, POMP = pompano alone, SMALL = bluefish/whiting/mackerel — all live per beach.
      </div>

      {/* ============ BEST BEACH (Priority 8) ============
          Same predictAsOfTimestamp() score every beach card already shows,
          just fetched for all 24 beaches and sorted — not a second model.
          Button-triggered (not auto-run) since it's 24 live predictions. */}
      <div style={{ background: "#0E1B26", border: "1px solid #17D9C455", borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
          BEST BEACH RIGHT NOW
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {SPECIES.map((s) => (
            <button key={s.id} onClick={() => runRanking(s.id)} disabled={rankState.status === "loading"} style={{
              padding: "5px 9px", borderRadius: 6, cursor: rankState.status === "loading" ? "default" : "pointer",
              border: `1px solid ${rankSpecies === s.id ? "#17D9C4" : "#1F3444"}`,
              background: rankSpecies === s.id ? "#0F2B28" : "#070D14",
              color: rankSpecies === s.id ? "#17D9C4" : "#8AA6B8", fontSize: 10.5,
            }}>
              {s.name}
            </button>
          ))}
        </div>
        {rankState.status === "loading" && <div style={{ color: "#5A7A8A", fontSize: 12 }}>Checking all 24 beaches…</div>}
        {rankState.status === "error" && <div style={{ color: "#FF5D5D", fontSize: 12 }}>Couldn't rank: {rankState.error}</div>}
        {rankState.status === "done" && (() => {
          const { ranked, unavailable } = rankState.data;
          if (ranked.length === 0) {
            return <div style={{ color: "#5A7A8A", fontSize: 12 }}>No valid predictions right now for {SPECIES.find(s=>s.id===rankSpecies)?.name}.</div>;
          }
          return (
            <div>
              {ranked.slice(0, 5).map((r, i) => (
                <button key={r.beachId} onClick={() => onSelectBeach(r.beachId)} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "7px 0",
                  borderBottom: i < Math.min(ranked.length, 5) - 1 ? "1px solid #16232E" : "none",
                  background: "none", border: "none", cursor: "pointer", textAlign: "left",
                }}>
                  <span style={{ color: "#4A6270", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", width: 14 }}>{i + 1}</span>
                  <span style={{ color: "#DCE8EE", fontSize: 13, flex: 1 }}>{r.beachName}</span>
                  <span style={{ color: "#5A7A8A", fontSize: 10.5 }}><span style={{ fontSize: 8.5, opacity: 0.7 }}>data </span>{r.confidence}</span>
                  <span style={{ color: scoreColor(r.score), fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{r.score}</span>
                </button>
              ))}
              {unavailable.length > 0 && (
                <div style={{ color: "#3E5566", fontSize: 10, marginTop: 8 }}>{unavailable.length} beach{unavailable.length !== 1 ? "es" : ""} skipped — no valid prediction available right now.</div>
              )}
            </div>
          );
        })()}
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
  const [logOpen, setLogOpen] = useState(false);
  const [showMoreConditions, setShowMoreConditions] = useState(false); // progressive disclosure: secondary conditions + source detail
  const [showAllFactors, setShowAllFactors] = useState(false); // progressive disclosure: full Why explanation beyond the compact line
  const [showChangeTarget, setShowChangeTarget] = useState(false); // progressive disclosure: species picker for the Fishing Plan section
  const [logDateOffset, setLogDateOffset] = useState(0); // 0 = today, 1 = yesterday, etc.
  const [logTimeBlock, setLogTimeBlock] = useState(null);
  const [logObs, setLogObs] = useState({}); // "species:tarpon" -> { sighted, bit, caught, count, distance }
  const [logNotes, setLogNotes] = useState("");
  // Priority 11 Part 7 — small, optional logging expansion for future
  // validation. All four stay optional; the existing required flow
  // (date/time block/species checkboxes) is completely unchanged.
  const [logEffortMinutes, setLogEffortMinutes] = useState("");
  const [logObservedClarity, setLogObservedClarity] = useState(null); // "clear" | "slightly_stained" | "stained" | "dirty_muddy" | null
  const [logMethod, setLogMethod] = useState(null); // "artificial_lure" | "live_bait" | "dead_bait" | "fly" | "surf_rig" | "other" | null
  const [logObservedSurf, setLogObservedSurf] = useState(null); // "calm" | "moderate" | "rough" | null
  const [logRecon, setLogRecon] = useState(null); // reconstructed snapshot for the chosen date/time-block
  const [logReconLoading, setLogReconLoading] = useState(false);
  const [logSubmitting, setLogSubmitting] = useState(false);
  const [logResult, setLogResult] = useState(null); // { ok: true } | { ok: false, error }
  const {
    hasBuoy, noaaState, buoyState, tideStage, moonFactor, buoyFactor, clarityEstimate, isNight,
    effectiveBuoy, baitInfo, forageState, getBaitInfoForSpecies, fishActivity, fishability, goStatus, getFishPosition,
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

  const speciesOrder = SPECIES.map((s) => s.id);
  const planEntry = planSpecies && liveResults[planSpecies] ? [planSpecies, liveResults[planSpecies]] : topSpeciesEntry;
  const planPosition = planEntry ? getFishPosition(planEntry[0]) : null;

  // Priority 12 continuation — the visible Overview Best Bite now runs
  // through the SAME species prediction engine as the rest of the app
  // (rankFutureSpeciesWindows -> predictAsOfTimestamp -> scoreSpecies),
  // not the old generic tide+solar-bonus calculator. Uses whichever
  // species the Fishing Plan is actually showing (planEntry — the same
  // planSpecies/top-species fallback already used elsewhere in this
  // component), so Best Bite always reflects the species the user is
  // actually looking at, not a species-blind average. Async, with a
  // cancellation guard so a stale request from a beach/species the user
  // has since navigated away from can never overwrite a newer result —
  // the same pattern already used for logRecon just below.
  const bestBiteSpeciesId = planEntry ? planEntry[0] : null;
  const [bestBiteState, setBestBiteState] = useState({ loading: true, result: null, error: null });
  useEffect(() => {
    if (!bestBiteSpeciesId) { setBestBiteState({ loading: false, result: null, error: null }); return; }
    let cancelled = false;
    setBestBiteState({ loading: true, result: null, error: null });
    const start = new Date();
    const end = new Date(start.getTime() + 24 * 3600000); // ~next 24 hours, the existing practical planning horizon
    rankFutureSpeciesWindows({ beachId: beach.id, speciesId: bestBiteSpeciesId, start, end, maxWindows: 2 })
      .then((res) => {
        if (cancelled) return;
        // Honest unavailable state — never falls back to the old generic
        // calculator. If the real engine can't produce a window (e.g. no
        // tide data), Best Bite is simply unavailable, not silently wrong.
        if (res.error || !res.windows || res.windows.length === 0) {
          setBestBiteState({ loading: false, result: null, error: res.error || "No valid prediction available for this window." });
        } else {
          setBestBiteState({ loading: false, result: res, error: null });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBestBiteState({ loading: false, result: null, error: err.message });
      });
    return () => { cancelled = true; }; // race guard — beach/species changed before this resolved
  }, [beach.id, bestBiteSpeciesId]);
  const bestWindow = bestBiteState.result?.windows?.[0] ?? null;

  // Priority 13 (informational only) — regional forage evidence from the
  // separate validation harness. Reads a dedicated public, read-only
  // endpoint that itself already applies every eligibility/human-review
  // rule server-side; this component never re-derives that logic, and
  // never touches scoreSpecies/forageStrength/Presence/Feeding — this is
  // purely a display concern, entirely separate from the app's own
  // trip-log-based forage model shown above.
  const [regionalForageState, setRegionalForageState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    setRegionalForageState({ loading: true, data: null, error: null });
    fetch(`${PROXY_BASE_URL}/forage/evidence?beachId=${encodeURIComponent(beach.id)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setRegionalForageState({ loading: false, data, error: null }); })
      .catch((err) => { if (!cancelled) setRegionalForageState({ loading: false, data: null, error: err.message || "fetch failed" }); });
    return () => { cancelled = true; };
  }, [beach.id]);
  const [regionalForageExpanded, setRegionalForageExpanded] = useState(false);
  useEffect(() => { setRegionalForageExpanded(false); }, [beach.id]); // reset on beach change (item 4)
  const secondaryWindow = bestBiteState.result?.nearTie ? bestBiteState.result?.windows?.[1] ?? null : null;
  const fmtWindowTime = (d) => d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

  // Reconstructs the FULL environmental snapshot and re-runs the live
  // scoring engine for a chosen past date/time-block — or, if it's today,
  // just reuses the already-live hook data directly with zero extra
  // fetches. Every field is tagged with its source (live/historical) so
  // the UI never shows a reconstructed value as if it were live.
  useEffect(() => {
    if (!logOpen || !logTimeBlock) return;
    let cancelled = false;
    setLogReconLoading(true);
    setLogRecon(null);

    (async () => {
      try {
        if (logDateOffset === 0) {
          const scored = {};
          for (const [sid, result] of Object.entries(liveResults)) scored[sid] = result;
          const positions = {};
          for (const s of SPECIES) positions[s.id] = getFishPosition(s.id);
          if (!cancelled) {
            setLogRecon({
              targetDate: new Date(), dateCompactStr: dateToCompact(new Date()),
              waveFt: effectiveBuoy?.waveHeightFt ?? null, waveSource: effectiveBuoy?.waveHeightFt != null ? "live" : null,
              wavePeriodS: effectiveBuoy?.dominantWavePeriodS ?? null,
              windKt: effectiveBuoy?.windSpeedKt ?? null, windSource: effectiveBuoy?.windSpeedKt != null ? "live" : null,
              windDirDeg: effectiveBuoy?.windDirDeg ?? null,
              waterTempF: effectiveBuoy?.waterTempF ?? null, waterTempSource: effectiveBuoy?.waterTempF != null ? "live" : null,
              clarityScore: clarityEstimate?.score ?? null, clarityLabel: clarityEstimate?.label ?? null, claritySource: clarityEstimate ? "live" : null,
              tideDirection: tideStage?.direction ?? null, tideFlowPct: tideStage ? Math.round(tideStage.flowStrength * 100) : null, tideSource: tideStage ? "live" : null,
              baitTier: baitInfo?.tier ?? null, baitLevel: baitInfo?.level ?? null, baitSource: baitInfo?.tier && baitInfo.tier !== "unknown" ? "live" : null,
              moonPhaseName: moonFactor?.moonPhase?.name ?? null, moonIllumPct: moonFactor ? Math.round(moonFactor.moonPhase.illumination * 100) : null, moonSource: moonFactor ? "live" : null,
              scored, positions,
            });
          }
          return;
        }

        const targetDateBase = new Date();
        targetDateBase.setUTCDate(targetDateBase.getUTCDate() - logDateOffset);
        const targetDate = timeBlockTargetDate(targetDateBase, logTimeBlock, beach.lat, beach.lon);
        const dateCompactStr = dateToCompact(targetDateBase);

        const noaaStation = NOAA_STATIONS[beach.id]?.stationId;
        const ndbcStation = NDBC_STATIONS[beach.id]?.stationId;
        const metarStation = METAR_STATIONS[beach.id]?.stationId;

        const tideRows = noaaStation ? await fetchTideHistoryDay(noaaStation, dateCompactStr) : null;

        // Same midnight protection as predictAsOfTimestamp() — also fetch
        // the preceding calendar day and combine before selecting, so a
        // target near midnight isn't limited to only that day's file.
        // Zero Worker/infra change: the existing fetch functions, called
        // once more with a second date string.
        const prevDateCompactStr = dateToCompact(new Date(targetDate.getTime() - 86400000));

        const buoyRows = ndbcStation
          ? (await Promise.all([fetchBuoyHistoryDay(ndbcStation, dateCompactStr), fetchBuoyHistoryDay(ndbcStation, prevDateCompactStr)])).flatMap((r) => r || [])
          : [];
        const buoyReading = pickLatestAvailableRow(buoyRows, targetDate);

        const precipRows = metarStation
          ? (await Promise.all([fetchWeatherHistoryDay(metarStation, dateCompactStr), fetchWeatherHistoryDay(metarStation, prevDateCompactStr)])).flatMap((r) => r || [])
          : [];
        const precipNearest = pickLatestAvailableRow(precipRows, targetDate);
        const precipReading = precipNearest ? { precipLastHourIn: precipNearest.precipLastHourIn, precipLast3HoursIn: null, precipLast6HoursIn: null } : null;

        const tideStageAt = tideRows ? computeTideStage(tideRows, targetDate) : null;
        const moonFactorAt = scoreMoonFactor(computeMoonPhase(targetDate));
        const isNightAt = computeIsNight(targetDate, beach.lat, beach.lon);
        const isLowLightAt = computeIsLowLight(targetDate, beach.lat, beach.lon);
        const clarityAt = estimateWaterClarity(buoyReading, precipReading, tideStageAt, beach.id);
        const baitAt = inferBaitActivity(buoyReading, targetDate);
        const buoyFactorAt = buoyReading ? scoreBuoyFactor(buoyReading) : null;

        const scored = {};
        if (tideStageAt) {
          for (const [sid, modelFn] of Object.entries(TIDE_MODELS)) {
            const result = modelFn(tideStageAt, moonFactorAt, buoyFactorAt, clarityAt, isNightAt, baitAt, isLowLightAt, targetDate);
            if (result) scored[sid] = result;
          }
        }
        const positions = {};
        for (const s of SPECIES) {
          const bias = SPECIES_RULES[s.id]?.zoneBias || 0;
          positions[s.id] = predictFishPosition(tideStageAt, buoyReading, bias, baitAt, s.id);
        }

        if (!cancelled) {
          setLogRecon({
            targetDate, dateCompactStr,
            waveFt: buoyReading?.waveHeightFt ?? null, waveSource: buoyReading?.waveHeightFt != null ? "historical" : null,
            wavePeriodS: buoyReading?.dominantWavePeriodS ?? null,
            windKt: buoyReading?.windSpeedKt ?? null, windSource: buoyReading?.windSpeedKt != null ? "historical" : null,
            windDirDeg: buoyReading?.windDirDeg ?? null,
            waterTempF: buoyReading?.waterTempF ?? null, waterTempSource: buoyReading?.waterTempF != null ? "historical" : null,
            clarityScore: clarityAt?.score ?? null, clarityLabel: clarityAt?.label ?? null, claritySource: clarityAt ? "historical" : null,
            tideDirection: tideStageAt?.direction ?? null, tideFlowPct: tideStageAt ? Math.round(tideStageAt.flowStrength * 100) : null, tideSource: tideStageAt ? "historical" : null,
            baitTier: baitAt?.tier ?? null, baitLevel: baitAt?.level ?? null, baitSource: baitAt?.tier && baitAt.tier !== "unknown" ? "historical" : null,
            moonPhaseName: moonFactorAt?.moonPhase?.name ?? null, moonIllumPct: moonFactorAt ? Math.round(moonFactorAt.moonPhase.illumination * 100) : null, moonSource: moonFactorAt ? "historical" : null,
            scored, positions,
          });
        }
      } catch (err) {
        if (!cancelled) setLogRecon({ error: err.message });
      } finally {
        if (!cancelled) setLogReconLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logOpen, logDateOffset, logTimeBlock, beach.id, beach.lat, beach.lon]);

  function toggleObsCheck(subjectType, subjectId, field) {
    const key = `${subjectType}:${subjectId}`;
    setLogObs((prev) => {
      const current = prev[key] || { subjectType, subjectId, sighted: false, bit: false, caught: false, count: "", distance: "" };
      return { ...prev, [key]: { ...current, [field]: !current[field] } };
    });
  }
  function updateObsValue(subjectType, subjectId, field, value) {
    const key = `${subjectType}:${subjectId}`;
    setLogObs((prev) => {
      const current = prev[key] || { subjectType, subjectId, sighted: false, bit: false, caught: false, count: "", distance: "" };
      return { ...prev, [key]: { ...current, [field]: value } };
    });
  }

  // Freezes exactly what the app predicted (score/presence/feeding/access/
  // position) for each checked species, alongside the full reconstructed
  // conditions snapshot — the whole point is being able to compare
  // predicted vs. actual later, so nothing here is inferred after the fact.
  const submitTripLog = async () => {
    if (!logTimeBlock || !logRecon || logRecon.error) return;
    const activeObs = Object.values(logObs).filter((o) => o.sighted || o.bit || o.caught);
    if (activeObs.length === 0) return;
    setLogSubmitting(true);
    setLogResult(null);

    const targetDateBase = new Date();
    targetDateBase.setUTCDate(targetDateBase.getUTCDate() - logDateOffset);
    const tripDateStr = targetDateBase.toISOString().slice(0, 10);

    const observations = activeObs.map((o) => {
      const result = logRecon.scored?.[o.subjectId];
      const position = logRecon.positions?.[o.subjectId];
      const positiveFactors = (result?.factors || []).filter((f) => f.delta > 0).map((f) => f.label);
      const limitingFactors = (result?.factors || []).filter((f) => f.delta < 0).map((f) => f.label);
      return {
        subject_type: o.subjectType, subject_id: o.subjectId,
        sighted: !!o.sighted, bit: o.subjectType === "species" ? !!o.bit : null, caught: !!o.caught,
        count: o.count !== "" && o.count != null ? parseInt(o.count, 10) : null,
        distance_yd_actual: o.distance !== "" && o.distance != null ? parseInt(o.distance, 10) : null,
        predicted_score: result?.score ?? null, predicted_presence: result?.presence ?? null,
        predicted_feeding: result?.feeding ?? null, predicted_access: result?.access ?? null,
        predicted_zone: position?.primaryZone ?? null,
        predicted_distance_min: position?.distanceYd?.[0] ?? null, predicted_distance_max: position?.distanceYd?.[1] ?? null,
        model_version: result?.modelVersion ?? null,
        confidence: result?.confidence ?? null,
        major_positive_factors: positiveFactors.length ? JSON.stringify(positiveFactors) : null,
        major_limiting_factors: limitingFactors.length ? JSON.stringify(limitingFactors) : null,
      };
    });

    const payload = {
      beach_id: beach.id, trip_date: tripDateStr, time_block: logTimeBlock,
      observed_at: logRecon.targetDate?.toISOString() ?? null, notes: logNotes || null,
      wave_ft: logRecon.waveFt, wave_ft_source: logRecon.waveSource, wave_period_s: logRecon.wavePeriodS ?? null,
      wind_kt: logRecon.windKt, wind_kt_source: logRecon.windSource, wind_dir_deg: logRecon.windDirDeg ?? null,
      water_temp_f: logRecon.waterTempF, water_temp_f_source: logRecon.waterTempSource,
      clarity_score: logRecon.clarityScore, clarity_label: logRecon.clarityLabel, clarity_source: logRecon.claritySource,
      tide_direction: logRecon.tideDirection, tide_flow_pct: logRecon.tideFlowPct, tide_source: logRecon.tideSource ?? null,
      bait_tier: logRecon.baitTier, bait_level: logRecon.baitLevel, bait_source: logRecon.baitSource ?? null,
      moon_phase_name: logRecon.moonPhaseName, moon_illumination_pct: logRecon.moonIllumPct, moon_source: logRecon.moonSource ?? null,
      // Priority 11 Part 7 — new optional fields, all user-reported (not
      // scientific measurements — "observed_clarity" is a rough
      // categorical impression, never treated as equivalent to the
      // model's own estimated clarity score).
      effort_minutes: logEffortMinutes !== "" && logEffortMinutes != null ? parseInt(logEffortMinutes, 10) : null,
      observed_clarity: logObservedClarity,
      method: logMethod,
      observed_surf: logObservedSurf,
      observations,
    };
    try {
      await postToProxy("/trips/log", payload);
      setLogResult({ ok: true });
      setLogObs({}); setLogNotes(""); setLogTimeBlock(null); setLogRecon(null);
      setLogEffortMinutes(""); setLogObservedClarity(null); setLogMethod(null); setLogObservedSurf(null);
    } catch (err) {
      setLogResult({ ok: false, error: err.message });
    } finally {
      setLogSubmitting(false);
    }
  };

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
        <div style={{ padding: "10px 14px" }}>
          {/* ============ VERDICT + BEST BET, merged into one section ============ */}
          {goStatus && (() => {
            const topFactors = topSpeciesEntry ? [...(topSpeciesEntry[1].factors || [])].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) : [];
            const verdictCopy = {
              "GO FISH": "Conditions line up well right now.",
              "MAYBE": "Fishable, but not a standout session.",
              "DON'T GO": "Conditions aren't favoring a trip right now.",
            }[goStatus.label] || "";
            const helping = topFactors.filter((f) => f.delta > 0).slice(0, 2);
            return (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ color: goStatus.color, fontSize: 22, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
                    {goStatus.label}
                  </span>
                  <span style={{ color: goStatus.color, fontSize: 30, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif" }}>
                    {fishActivity ?? "—"}
                  </span>
                </div>
                {topSpeciesEntry && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
                    <span style={{ color: "#E7EFF3", fontSize: 16, fontWeight: 700 }}>{SPECIES.find((s) => s.id === topSpeciesEntry[0])?.name}</span>
                    <span style={{ color: scoreColor(topSpeciesEntry[1].score), fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{topSpeciesEntry[1].score}</span>
                  </div>
                )}
                {bestBiteState.loading ? (
                  <div style={{ color: "#5A7A8A", fontSize: 12.5, marginTop: 2 }}>Finding best bite window…</div>
                ) : bestWindow ? (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ color: "#8AA6B8", fontSize: 10, letterSpacing: 0.4, fontFamily: "'Space Grotesk', sans-serif" }}>BEST BITE</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ color: "#E7EFF3", fontSize: 13.5, fontWeight: 600 }}>{fmtWindowTime(bestWindow.windowStart)}–{fmtWindowTime(bestWindow.windowEnd)}</span>
                      <span style={{ color: scoreColor(bestWindow.score), fontSize: 13.5, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{bestWindow.score}</span>
                    </div>
                    {bestWindow.whyLabels?.length > 0 && (
                      <div style={{ color: "#7590A0", fontSize: 11, marginTop: 1 }}>{bestWindow.whyLabels.join(" + ")}</div>
                    )}
                    {secondaryWindow && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ color: "#5A7A8A", fontSize: 9.5, letterSpacing: 0.4, fontFamily: "'Space Grotesk', sans-serif" }}>ALSO STRONG</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ color: "#B7CBD6", fontSize: 12 }}>{fmtWindowTime(secondaryWindow.windowStart)}–{fmtWindowTime(secondaryWindow.windowEnd)}</span>
                          <span style={{ color: "#7590A0", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif" }}>{secondaryWindow.score}</span>
                        </div>
                        {bestBiteState.result?.nearTieNote && (
                          <div style={{ color: "#5A7A8A", fontSize: 10, marginTop: 1, fontStyle: "italic" }}>{bestBiteState.result.nearTieNote}</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: "#5A7A8A", fontSize: 12.5, marginTop: 2 }}>Best bite window unavailable right now.</div>
                )}
                <div style={{ color: "#B7CBD6", fontSize: 12.5, marginTop: 8, lineHeight: 1.4 }}>{verdictCopy}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  {topSpeciesEntry && (
                    <span style={{ color: "#5A7A8A", fontSize: 11.5 }}>Data confidence: <span style={{ color: "#8AA6B8" }}>{topSpeciesEntry[1].confidence}</span></span>
                  )}
                  {helping.length > 0 && (
                    <span style={{ color: "#5A7A8A", fontSize: 11.5 }}>
                      Helping: <span style={{ color: "#8FE8DC" }}>{helping.map((f) => f.shortLabel).join(" · ")}</span>
                    </span>
                  )}
                </div>
                <div style={{ borderBottom: "1px solid #1F3444", marginTop: 14 }} />
              </div>
            );
          })()}

          {/* ============ FISHING PLAN — compact, always visible, replaces the old separate Casting Plan + Build My Plan cards ============ */}
          {planEntry && (() => {
            const [sid] = planEntry;
            // Priority 12 consistency fix — when a future Best Bite window
            // exists, every field below describes THAT window's predicted
            // conditions, not "right now." Reuses the exact peakResult
            // rankFutureSpeciesWindows already produced for its peak
            // sample — never recomputed separately, so this can't drift
            // from what Best Bite itself is showing above.
            const usingFutureWindow = !!(bestWindow && bestWindow.peakResult);
            const result = usingFutureWindow ? bestWindow.peakResult : planEntry[1];
            const position = usingFutureWindow ? bestWindow.peakResult.position : planPosition;
            const strategy = position && position.distanceYd[1] <= 45
              ? `Start shallow in the ${position.primaryZone.toLowerCase()} at ${position.distanceYd[0]}–${position.distanceYd[1]} yd. Work ${position.secondaryZone.toLowerCase()} if that's slow.`
              : position
                ? `Fish are likely past the inner bar — start around ${position.distanceYd[0]}–${position.distanceYd[1]} yd in the ${position.primaryZone.toLowerCase()}. Work ${position.secondaryZone.toLowerCase()} if that's slow.`
                : "Not enough live surf data yet to recommend a starting distance.";
            return (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
                    FISHING PLAN
                    <span style={{ color: usingFutureWindow ? "#8FE8DC" : "#5A7A8A", fontSize: 9, marginLeft: 6, fontWeight: 400 }}>
                      {usingFutureWindow ? "· FOR RECOMMENDED WINDOW" : "· CURRENT CONDITIONS"}
                    </span>
                  </span>
                  <button onClick={() => setShowChangeTarget(!showChangeTarget)} style={{ background: "none", border: "none", color: "#3E8FFF", fontSize: 11, cursor: "pointer", padding: 0 }}>
                    {showChangeTarget ? "close" : "change target"}
                  </button>
                </div>
                {showChangeTarget && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {SPECIES.filter((s) => liveResults[s.id]).map((s) => (
                      <button key={s.id} onClick={() => { setPlanSpecies(s.id); setShowChangeTarget(false); }} style={{
                        padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                        border: `1px solid ${sid === s.id ? "#17D9C4" : "#1F3444"}`,
                        background: sid === s.id ? "#0F2B28" : "#070D14",
                        color: sid === s.id ? "#17D9C4" : "#8AA6B8", fontSize: 10.5,
                      }}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px", marginBottom: 10 }}>
                  <div>
                    <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>TARGET</div>
                    <div style={{ color: "#DCE8EE", fontSize: 14, fontWeight: 600 }}>{SPECIES.find((s) => s.id === sid)?.name} — {result.score}</div>
                  </div>
                  <div>
                    <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>TIME</div>
                    <div style={{ color: "#DCE8EE", fontSize: 14, fontWeight: 600 }}>
                      {bestWindow ? `${fmtWindowTime(bestWindow.windowStart)}–${fmtWindowTime(bestWindow.windowEnd)}` : "Now"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>WHERE (est.)</div>
                    <div style={{ color: "#DCE8EE", fontSize: 14, fontWeight: 600 }}>{position ? `${position.primaryZone} · ${position.distanceYd[0]}–${position.distanceYd[1]} yd` : "—"}</div>
                  </div>
                  <div>
                    <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>ACCESS</div>
                    <div style={{ color: result.access != null ? scoreColor(result.access) : "#5A7A8A", fontSize: 14, fontWeight: 600 }}>{result.access ?? "—"}</div>
                  </div>
                </div>
                <div style={{ color: "#B7CBD6", fontSize: 12, lineHeight: 1.5, fontStyle: "italic" }}>{strategy}</div>
                {position && (position.distanceYd[1] <= 45 || position.distanceYd[0] >= 60) && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 8 }}>
                    {position.distanceYd[1] <= 45
                      ? <AlertTriangle size={12} color="#FFB37A" style={{ marginTop: 1, flexShrink: 0 }} />
                      : <TrendingUp size={12} color="#17D9C4" style={{ marginTop: 1, flexShrink: 0 }} />}
                    <span style={{ color: "#8AA6B8", fontSize: 10.5, lineHeight: 1.4 }}>
                      {position.distanceYd[1] <= 45 ? `Don't overcast — start inside ${position.distanceYd[1]} yd.` : `Long cast recommended — start around ${position.distanceYd[0]} yd.`}
                    </span>
                  </div>
                )}
                <div style={{ color: "#3E5566", fontSize: 9.5, marginTop: 8, lineHeight: 1.3 }}>
                  Behavioral estimate, not measured bathymetry — treat as a starting point.
                </div>

                {/* ============ FORAGE (Priority 9 transparency correction) ============
                    Reads the EXACT same forageState.forage + getBaitInfoForSpecies(sid)
                    the scoring loop itself calls — not a separate UI-only calculation.
                    Ranked by this species' real BAIT_TYPE_AFFINITY, not a fixed list. */}
                {(() => {
                  const speciesBaitInfo = forageState.forage ? getBaitInfoForSpecies(sid) : null;
                  const anyEvidence = forageState.forage && BAIT_TYPES.some((bt) => forageState.forage[bt.id]?.presence !== "unknown");
                  const relevantTypes = [...BAIT_TYPES].sort((a, b) => baitTypeAffinity(sid, b.id) - baitTypeAffinity(sid, a.id)).slice(0, 3);
                  const ageLabel = (observedAtUtc) => {
                    if (!observedAtUtc) return null;
                    const hrs = Math.round((Date.now() - new Date(observedAtUtc).getTime()) / 3600000);
                    return hrs < 1 ? "under 1h ago" : `${hrs}h ago`;
                  };
                  const relevanceLabel = (aff) => (aff >= 0.7 ? "Strong relevance" : aff >= 0.35 ? "Relevant" : null);
                  // Surfaces whether forage actually moved this prediction — pulled
                  // straight from the real scoring factors, never manufactured.
                  const baitFactor = speciesBaitInfo?.tier === "observed" ? (result.factors || []).find((f) => f.shortLabel === "Bait" && f.delta !== 0) : null;

                  return (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #16232E" }}>
                      <div style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 5 }}>FORAGE</div>
                      {forageState.loading ? (
                        <div style={{ color: "#5A7A8A", fontSize: 11 }}>Checking recent forage reports…</div>
                      ) : !anyEvidence ? (
                        <div style={{ color: "#8AA6B8", fontSize: 11.5, lineHeight: 1.5 }}>
                          No recent direct forage observations. Seasonal forage baseline only.
                        </div>
                      ) : (
                        <>
                          {relevantTypes.map((bt) => {
                            const ev = forageState.forage[bt.id];
                            const aff = baitTypeAffinity(sid, bt.id);
                            const rel = relevanceLabel(aff);
                            if (ev.presence === "unknown") {
                              return <div key={bt.id} style={{ color: "#5A7A8A", fontSize: 11, marginBottom: 2 }}>{bt.name} — No current observation</div>;
                            }
                            const verb = ev.presence === "supported" ? "supported" : "observed";
                            const age = ageLabel(ev.observedAtUtc);
                            const evidencePart = ev.concentration !== "unknown"
                              ? `${ev.concentration[0].toUpperCase()}${ev.concentration.slice(1)} · ${age ? `${verb} ${age}` : verb}`
                              : `${ev.presence === "supported" ? "Supported" : "Observed"} · ${age || "recent"}`;
                            return (
                              <div key={bt.id} style={{ color: "#DCE8EE", fontSize: 11.5, marginBottom: 2 }}>
                                {bt.name} — {evidencePart}{rel ? <span style={{ color: "#8FE8DC" }}> · {rel}</span> : null}
                              </div>
                            );
                          })}
                          {baitFactor && (
                            <div style={{ color: "#8FE8DC", fontSize: 10.5, marginTop: 5, fontStyle: "italic" }}>{baitFactor.label}</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}

                <div style={{ borderBottom: "1px solid #1F3444", marginTop: 14 }} />

                {/* ============ REGIONAL FORAGE EVIDENCE (Priority 13, informational
                    only) — deliberately visually distinct from the FORAGE block
                    above: this data comes from the separate validation harness,
                    is NOT part of forageStrength/scoreSpecies, and is labeled
                    as such explicitly, not just by omission. Loading/error/
                    supported/unsupported are checked in that explicit order so
                    no state is unreachable and network failure is never
                    confused with "checked, found nothing." ============ */}
                {regionalForageState.loading ? (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #2A3F4E" }}>
                    <span style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>REGIONAL FORAGE EVIDENCE</span>
                    <div style={{ color: "#5A7A8A", fontSize: 11, marginTop: 4 }}>Checking regional reports…</div>
                  </div>
                ) : regionalForageState.error ? (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #2A3F4E" }}>
                    <span style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>REGIONAL FORAGE EVIDENCE</span>
                    <div style={{ color: "#5A7A8A", fontSize: 11, marginTop: 4 }}>Regional forage reports temporarily unavailable.</div>
                  </div>
                ) : regionalForageState.data?.supported ? (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #2A3F4E" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                      <span style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>REGIONAL FORAGE EVIDENCE</span>
                      <span style={{ color: "#7590A0", fontSize: 8, border: "1px solid #2A3F4E", borderRadius: 4, padding: "1px 5px" }}>Informational — not used in score</span>
                    </div>
                    {regionalForageState.data.evidence.length === 0 ? (
                      <div style={{ color: "#5A7A8A", fontSize: 11 }}>No recent regional forage reports.</div>
                    ) : (
                      <>
                        {regionalForageState.data.evidence.slice(0, regionalForageExpanded ? 10 : 3).map((ev, i) => (
                          <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < regionalForageState.data.evidence.length - 1 ? "1px solid #16232E" : "none" }}>
                            <div style={{ color: "#DCE8EE", fontSize: 12, fontWeight: 600 }}>
                              {`${ev.forageType.replace("_", " ")}${ev.presence === "absent" ? " — absent" : ev.presence === "scarce" ? " — scarce" : ev.concentration && ev.concentration !== "unknown" ? ` — ${ev.concentration}` : ""}${ev.movement ? ` · ${ev.movement.replace("_", " ")}` : ""}`}
                            </div>
                            <div style={{ color: "#7590A0", fontSize: 10.5, marginTop: 1 }}>{ev.freshnessLabel}{ev.locationText ? ` · ${ev.locationText}` : ""}</div>
                            <div style={{ color: "#5A7A8A", fontSize: 10, marginTop: 3, fontStyle: "italic" }}>"{ev.supportingQuote}"</div>
                            <div style={{ color: "#4A6270", fontSize: 9.5, marginTop: 2 }}>
                              Source: {ev.sourceName} · {ev.region}
                              {ev.articleUrl && <> · <a href={ev.articleUrl} target="_blank" rel="noreferrer" style={{ color: "#3E8FFF" }}>view report</a></>}
                              {" · "}<span style={{ color: ev.reviewStatus === "human_reviewed" ? "#8FE8DC" : "#5A7A8A" }}>{ev.reviewStatus === "human_reviewed" ? "Human-reviewed" : "AI-extracted"}</span>
                            </div>
                          </div>
                        ))}
                        {regionalForageState.data.evidence.length > 3 && !regionalForageExpanded && (
                          <button onClick={() => setRegionalForageExpanded(true)} style={{ background: "none", border: "none", color: "#3E8FFF", fontSize: 11, cursor: "pointer", padding: 0 }}>
                            Show more
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : regionalForageState.data && !regionalForageState.data.supported ? (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #2A3F4E" }}>
                    <span style={{ color: "#4A6270", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>REGIONAL FORAGE EVIDENCE</span>
                    <div style={{ color: "#5A7A8A", fontSize: 11, marginTop: 4 }}>Regional forage-report coverage not available yet.</div>
                  </div>
                ) : null}

              </div>
            );
          })()}

          {/* ============ TOP TARGETS — compact list, no card ============ */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
              TOP TARGETS
            </div>
            {liveEntries.length > 0 ? (
              <>
                {speciesOrder
                  .map((sid) => [sid, liveResults[sid]])
                  .filter(([, r]) => r)
                  .sort((a, b) => b[1].score - a[1].score)
                  .slice(0, 3)
                  .map(([sid, result], i) => {
                    const sp = SPECIES.find((s) => s.id === sid);
                    const topFactor = [...(result.factors || [])].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
                    return (
                      <div key={sid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                        <span style={{ color: "#4A6270", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", width: 12 }}>{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: "#DCE8EE", fontSize: 13, fontWeight: 600 }}>{sp.name}</div>
                          {topFactor && <div style={{ color: "#5A7A8A", fontSize: 10 }}>{topFactor.shortLabel}{topFactor.delta >= 0 ? " helping" : " limiting"}</div>}
                        </div>
                        <span style={{ color: scoreColor(result.score), fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{result.score}</span>
                      </div>
                    );
                  })}
                <div style={{ color: "#3E5566", fontSize: 10, marginTop: 4 }}>See Species tab for all {liveEntries.length} live scores.</div>
              </>
            ) : (
              <div style={{ color: "#5A7A8A", fontSize: 12.5 }}>No live tide data right now — see Conditions below.</div>
            )}
            <div style={{ borderBottom: "1px solid #1F3444", marginTop: 14 }} />
          </div>

          {/* ============ CONDITIONS — 4 primary rows, rest behind "+ More" ============ */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
              CONDITIONS
            </div>
            {(() => {
              const topConditionFactor = topSpeciesEntry
                ? [...(topSpeciesEntry[1].factors || [])].filter((f) => ["Tide", "Wave", "Clarity", "Wind"].includes(f.shortLabel)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]
                : null;
              const isKey = (label) => topConditionFactor?.shortLabel === label;
              const Row = ({ icon: Icon, label, value, live, keyRow }) => (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #16232E" }}>
                  <Icon size={13} color={value !== "Not available" ? (keyRow ? "#17D9C4" : "#5A7A8A") : "#3E5566"} />
                  <span style={{ color: keyRow ? "#B7EFE8" : "#7590A0", fontSize: 12.5, flex: 1, fontWeight: keyRow ? 600 : 400 }}>
                    {label} {live && <span style={{ color: "#17D9C4", fontSize: 8.5 }}> ● {live}</span>}
                  </span>
                  <span style={{ color: value !== "Not available" ? "#DCE8EE" : "#5A7A8A", fontSize: 12.5, fontWeight: 500 }}>{value}</span>
                </div>
              );
              return (
                <div>
                  <Row icon={Info} label="Tide" keyRow={isKey("Tide")}
                    live={tideStage ? "LIVE" : null}
                    value={tideStage ? `${tideStage.direction[0].toUpperCase()}${tideStage.direction.slice(1)}, ${Math.round(tideStage.flowStrength * 100)}%` : "Not available"} />
                  <Row icon={Waves} label="Swell" keyRow={isKey("Wave")}
                    live={effectiveBuoy?.waveHeightFt != null ? (effectiveBuoy.waveHeightIsEstimated ? "ESTIMATED" : effectiveBuoy.waveHeightIsRegional ? "REGIONAL" : "LIVE") : null}
                    value={effectiveBuoy?.waveHeightFt != null ? `${effectiveBuoy.waveHeightFt.toFixed(1)} ft${effectiveBuoy.dominantWavePeriodS != null && !effectiveBuoy.waveHeightIsEstimated ? ` @ ${effectiveBuoy.dominantWavePeriodS}s` : ""}` : "Not available"} />
                  <Row icon={Wind} label="Wind" keyRow={isKey("Wind")}
                    live={buoyState.buoy?.windSpeedKt != null ? "LIVE" : null}
                    value={buoyState.buoy?.windSpeedKt != null ? `${Math.round(buoyState.buoy.windSpeedKt)} kt` : "Not available"} />
                  <Row icon={Thermometer} label="Water temp" keyRow={false}
                    live={buoyState.buoy?.waterTempF != null ? "LIVE" : null}
                    value={buoyState.buoy?.waterTempF != null ? `${Math.round(buoyState.buoy.waterTempF)}°F` : "Not available"} />
                </div>
              );
            })()}

            <button
              onClick={() => setShowMoreConditions(!showMoreConditions)}
              style={{ background: "none", border: "none", color: "#3E8FFF", fontSize: 11.5, cursor: "pointer", padding: "8px 0 0", textAlign: "left" }}
            >
              {showMoreConditions ? "− Fewer conditions" : "+ More conditions"}
            </button>

            {showMoreConditions && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #16232E" }}>
                  <Eye size={13} color={clarityEstimate ? "#F5A623" : "#3E5566"} />
                  <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>Clarity {clarityEstimate && <span style={{ color: "#F5A623", fontSize: 8.5 }}> ● ESTIMATED</span>}</span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>{clarityEstimate ? clarityEstimate.label : "Not available"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #16232E" }}>
                  <Waves size={13} color={baitInfo && baitInfo.tier !== "unknown" ? "#F5A623" : "#3E5566"} />
                  <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                    Bait {baitInfo?.tier === "observed" && <span style={{ color: "#17D9C4", fontSize: 8.5 }}> ● OBSERVED</span>}
                    {baitInfo?.tier === "inferred-seasonal" && <span style={{ color: "#F5A623", fontSize: 8.5 }}> ● SEASONAL ESTIMATE</span>}
                  </span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>{baitInfo && baitInfo.tier !== "unknown" ? baitInfo.level : "No current report"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #16232E" }}>
                  <Info size={13} color={buoyState.buoy?.pressureHpa != null ? "#17D9C4" : "#3E5566"} />
                  <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>Pressure {buoyState.buoy?.pressureHpa != null && <span style={{ color: "#17D9C4", fontSize: 8.5 }}> ● LIVE</span>}</span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>
                    {buoyState.buoy?.pressureHpa != null ? `${buoyState.buoy.pressureHpa.toFixed(1)} hPa${buoyState.buoy.pressureTendencyHpa != null ? ` (${buoyState.buoy.pressureTendencyHpa >= 0 ? "+" : ""}${buoyState.buoy.pressureTendencyHpa.toFixed(1)}/3hr)` : ""}` : "Not available"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #16232E" }}>
                  <Moon size={13} color={moonFactor ? "#17D9C4" : "#3E5566"} />
                  <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>Moon {moonFactor && <span style={{ color: "#17D9C4", fontSize: 8.5 }}> ● LIVE</span>}</span>
                  <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>{moonFactor ? `${moonFactor.moonPhase.name} (${Math.round(moonFactor.moonPhase.illumination * 100)}%)` : "Unavailable"}</span>
                </div>

                {clarityEstimate && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ color: "#4A6270", fontSize: 10, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 5 }}>CLARITY BREAKDOWN</div>
                    {clarityEstimate.factors.map((f, i) => (
                      <div key={i} style={{ color: "#8AA6B8", fontSize: 11, marginBottom: 2 }}>{f.delta >= 0 ? "+" : ""}{f.delta} — {f.label}</div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  <div style={{ color: "#4A6270", fontSize: 10, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 5 }}>TIDE, TODAY</div>
                  <NoaaTideDisplay loading={noaaState.loading} bundle={noaaState.bundle} fatalError={noaaState.fatalError} onRetry={refresh} />
                </div>

                <div style={{ color: "#3E5566", fontSize: 9.5, marginTop: 10, lineHeight: 1.4 }}>
                  {hasBuoy
                    ? buoyState.loading
                      ? "Requesting live buoy data from NDBC…"
                      : buoyState.fatalError
                        ? `Buoy data unavailable: ${buoyState.fatalError}`
                        : `Wind/swell/temp/pressure from NDBC buoy ${NDBC_STATIONS[beach.id].stationId} (${NDBC_STATIONS[beach.id].stationName}) — an offshore reading, not measured at the beach itself.${effectiveBuoy?.waveHeightIsRegional ? ` This station has no wave sensor, so swell height is borrowed from the nearest reporting buoy (${effectiveBuoy.waveHeightSourceStationId}).` : effectiveBuoy?.waveHeightIsEstimated ? " This station has no wave sensor and no nearby buoy is reporting waves either, so swell height is ESTIMATED from wind speed (Beaufort scale)." : ""} Water clarity is estimated, not directly measured.`
                    : "No NDBC buoy mapped to this beach yet."}
                </div>
              </div>
            )}
            <div style={{ borderBottom: "1px solid #1F3444", marginTop: 14 }} />
          </div>

          {/* ============ WHY — compact one-liner, expandable ============ */}
          {topSpeciesEntry && (() => {
            const helping = (topSpeciesEntry[1].factors || []).filter((f) => f.delta > 0).sort((a, b) => b.delta - a.delta);
            const hurting = (topSpeciesEntry[1].factors || []).filter((f) => f.delta < 0).sort((a, b) => a.delta - b.delta);
            if (helping.length === 0 && hurting.length === 0) return null;
            const compactTags = [...helping.slice(0, 2).map((f) => ({ ...f, up: true })), ...hurting.slice(0, 1).map((f) => ({ ...f, up: false }))];
            const hasMore = helping.length > 2 || hurting.length > 1;
            return (
              <div style={{ marginBottom: 18 }}>
                <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 6 }}>WHY</div>
                <div style={{ color: "#B7CBD6", fontSize: 12.5 }}>
                  {compactTags.map((f, i) => (
                    <span key={i}>
                      <span style={{ color: f.up ? "#8FE8DC" : "#FFB3AA" }}>{f.up ? "↑" : "↓"} {f.shortLabel}</span>
                      {i < compactTags.length - 1 ? "  ·  " : ""}
                    </span>
                  ))}
                </div>
                {hasMore && (
                  <button onClick={() => setShowAllFactors(!showAllFactors)} style={{ background: "none", border: "none", color: "#3E8FFF", fontSize: 11, cursor: "pointer", padding: "6px 0 0" }}>
                    {showAllFactors ? "Hide" : "See all factors"}
                  </button>
                )}
                {showAllFactors && (
                  <div style={{ marginTop: 8 }}>
                    {helping.length > 0 && (
                      <div style={{ marginBottom: hurting.length > 0 ? 8 : 0 }}>
                        <div style={{ color: "#17D9C4", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 4 }}>HELPING</div>
                        {helping.map((f, i) => <div key={i} style={{ color: "#B7CBD6", fontSize: 11.5, lineHeight: 1.5 }}>• {f.label}</div>)}
                      </div>
                    )}
                    {hurting.length > 0 && (
                      <div>
                        <div style={{ color: "#FF8A8A", fontSize: 9.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 4 }}>HURTING</div>
                        {hurting.map((f, i) => <div key={i} style={{ color: "#B7CBD6", fontSize: 11.5, lineHeight: 1.5 }}>• {f.label}</div>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ============ LOG THIS TRIP — compact secondary action ============ */}
          <button
            onClick={() => { setLogOpen(!logOpen); setLogResult(null); }}
            style={{
              width: "100%", padding: "9px 0", borderRadius: 8, border: "1px solid #3A2F17",
              background: "transparent", color: "#C99A4E", fontSize: 12,
              fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.3, cursor: "pointer", marginBottom: logOpen ? 8 : 4,
            }}
          >
            {logOpen ? "Hide Trip Log" : "Log This Trip"}
          </button>

          {logOpen && (
            <div style={{ background: "#0E1B26", border: "1px solid #F5A623", borderRadius: 10, padding: 14, marginBottom: 8 }}>
              <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 4 }}>
                LOG THIS TRIP
              </div>
              <div style={{ color: "#4A6270", fontSize: 10.5, marginBottom: 10, lineHeight: 1.4 }}>
                Pick when it happened — today autofills from live data, past days reconstruct from real historical tide/buoy/weather data where it exists.
              </div>

              <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 5 }}>DATE</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {[0, 1, 2, 3].map((offset) => {
                  const d = new Date();
                  d.setDate(d.getDate() - offset);
                  const label = d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
                  return (
                    <button key={offset} onClick={() => setLogDateOffset(offset)} style={{
                      padding: "5px 9px", borderRadius: 6, cursor: "pointer",
                      border: `1px solid ${logDateOffset === offset ? "#F5A623" : "#1F3444"}`,
                      background: logDateOffset === offset ? "#3A2A08" : "#070D14",
                      color: logDateOffset === offset ? "#F5A623" : "#8AA6B8", fontSize: 10.5,
                    }}>
                      {label}{offset === 0 ? " (today)" : ""}
                    </button>
                  );
                })}
              </div>

              <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 5 }}>TIME BLOCK</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {TIME_BLOCKS.map((tb) => (
                  <button key={tb.id} onClick={() => setLogTimeBlock(tb.id)} style={{
                    padding: "5px 9px", borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${logTimeBlock === tb.id ? "#F5A623" : "#1F3444"}`,
                    background: logTimeBlock === tb.id ? "#3A2A08" : "#070D14",
                    color: logTimeBlock === tb.id ? "#F5A623" : "#8AA6B8", fontSize: 10.5,
                  }}>
                    {tb.label}
                  </button>
                ))}
              </div>

              {logTimeBlock && logReconLoading && (
                <div style={{ color: "#4A6270", fontSize: 11.5, marginBottom: 12 }}>Reconstructing conditions…</div>
              )}
              {logTimeBlock && logRecon?.error && (
                <div style={{ color: "#FF5D5D", fontSize: 11.5, marginBottom: 12 }}>Couldn't reconstruct: {logRecon.error}</div>
              )}
              {logTimeBlock && logRecon && !logRecon.error && !logReconLoading && (
                <>
                  <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 5 }}>
                    CONDITIONS {logDateOffset === 0 ? <span style={{ color: "#17D9C4" }}>(live)</span> : <span style={{ color: "#3E8FFF" }}>(reconstructed)</span>}
                  </div>
                  <div style={{ background: "#070D14", border: "1px solid #1F3444", borderRadius: 8, padding: "8px 10px", marginBottom: 12, fontSize: 11.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ color: "#7590A0" }}>Wave</span>
                      <span style={{ color: logRecon.waveFt != null ? "#DCE8EE" : "#5A7A8A" }}>{logRecon.waveFt != null ? `${logRecon.waveFt.toFixed(1)} ft` : "unavailable"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ color: "#7590A0" }}>Wind</span>
                      <span style={{ color: logRecon.windKt != null ? "#DCE8EE" : "#5A7A8A" }}>{logRecon.windKt != null ? `${Math.round(logRecon.windKt)} kt` : "unavailable"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ color: "#7590A0" }}>Water temp</span>
                      <span style={{ color: logRecon.waterTempF != null ? "#DCE8EE" : "#5A7A8A" }}>{logRecon.waterTempF != null ? `${Math.round(logRecon.waterTempF)}°F` : "unavailable"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ color: "#7590A0" }}>Clarity (est.)</span>
                      <span style={{ color: logRecon.clarityLabel ? "#DCE8EE" : "#5A7A8A" }}>{logRecon.clarityLabel || "unavailable"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ color: "#7590A0" }}>Tide</span>
                      <span style={{ color: logRecon.tideDirection ? "#DCE8EE" : "#5A7A8A", textTransform: "capitalize" }}>{logRecon.tideDirection ? `${logRecon.tideDirection}, ${logRecon.tideFlowPct}%` : "unavailable"}</span>
                    </div>
                  </div>

                  <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 5 }}>GAMEFISH</div>
                  <div style={{ marginBottom: 12 }}>
                    {SPECIES.map((s) => {
                      const key = `species:${s.id}`;
                      const o = logObs[key] || { sighted: false, bit: false, caught: false, count: "", distance: "" };
                      const active = o.sighted || o.bit || o.caught;
                      return (
                        <div key={s.id} style={{ borderBottom: "1px solid #16232E", padding: "6px 0" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "#DCE8EE", fontSize: 12, flex: 1 }}>{s.name}</span>
                            {["sighted", "bit", "caught"].map((field) => (
                              <button key={field} onClick={() => toggleObsCheck("species", s.id, field)} style={{
                                padding: "3px 7px", borderRadius: 5, cursor: "pointer",
                                border: `1px solid ${o[field] ? "#F5A623" : "#1F3444"}`,
                                background: o[field] ? "#3A2A08" : "#070D14",
                                color: o[field] ? "#F5A623" : "#5A7A8A", fontSize: 9.5, textTransform: "capitalize",
                              }}>
                                {field}
                              </button>
                            ))}
                          </div>
                          {active && (
                            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                              <input type="number" inputMode="numeric" placeholder="count" value={o.count}
                                onChange={(e) => updateObsValue("species", s.id, "count", e.target.value)}
                                style={{ flex: 1, background: "#070D14", border: "1px solid #1F3444", borderRadius: 5, color: "#DCE8EE", padding: "5px 8px", fontSize: 11, boxSizing: "border-box" }} />
                              <input type="number" inputMode="numeric" placeholder="yd out" value={o.distance}
                                onChange={(e) => updateObsValue("species", s.id, "distance", e.target.value)}
                                style={{ flex: 1, background: "#070D14", border: "1px solid #1F3444", borderRadius: 5, color: "#DCE8EE", padding: "5px 8px", fontSize: 11, boxSizing: "border-box" }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 5 }}>BAIT</div>
                  <div style={{ marginBottom: 12 }}>
                    {BAIT_TYPES.map((b) => {
                      const key = `bait:${b.id}`;
                      const o = logObs[key] || { sighted: false, caught: false, count: "" };
                      const active = o.sighted || o.caught;
                      return (
                        <div key={b.id} style={{ borderBottom: "1px solid #16232E", padding: "6px 0" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "#DCE8EE", fontSize: 12, flex: 1 }}>{b.name}</span>
                            {["sighted", "caught"].map((field) => (
                              <button key={field} onClick={() => toggleObsCheck("bait", b.id, field)} style={{
                                padding: "3px 7px", borderRadius: 5, cursor: "pointer",
                                border: `1px solid ${o[field] ? "#F5A623" : "#1F3444"}`,
                                background: o[field] ? "#3A2A08" : "#070D14",
                                color: o[field] ? "#F5A623" : "#5A7A8A", fontSize: 9.5, textTransform: "capitalize",
                              }}>
                                {field}
                              </button>
                            ))}
                          </div>
                          {active && (
                            <input type="number" inputMode="numeric" placeholder="rough count" value={o.count}
                              onChange={(e) => updateObsValue("bait", b.id, "count", e.target.value)}
                              style={{ width: "100%", marginTop: 6, background: "#070D14", border: "1px solid #1F3444", borderRadius: 5, color: "#DCE8EE", padding: "5px 8px", fontSize: 11, boxSizing: "border-box" }} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* ============ Priority 11 Part 7 — optional trip details ============
                      Compact chip-selectors, not a survey form. Every field stays
                      optional; nothing here is required to submit a log. */}
                  <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 5 }}>TRIP DETAILS (optional)</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span style={{ color: "#5A7A8A", fontSize: 11, flexShrink: 0 }}>Fished for</span>
                    <input type="number" inputMode="numeric" placeholder="minutes" value={logEffortMinutes}
                      onChange={(e) => setLogEffortMinutes(e.target.value)}
                      style={{ width: 90, background: "#070D14", border: "1px solid #1F3444", borderRadius: 5, color: "#DCE8EE", padding: "5px 8px", fontSize: 11.5, boxSizing: "border-box" }} />
                    <span style={{ color: "#5A7A8A", fontSize: 11 }}>min</span>
                  </div>
                  {[
                    { label: "Water clarity you saw", state: logObservedClarity, setState: setLogObservedClarity,
                      options: [["clear", "Clear"], ["slightly_stained", "Slightly stained"], ["stained", "Stained"], ["dirty_muddy", "Dirty/muddy"]] },
                    { label: "Method", state: logMethod, setState: setLogMethod,
                      options: [["artificial_lure", "Artificial"], ["live_bait", "Live bait"], ["dead_bait", "Dead bait"], ["fly", "Fly"], ["surf_rig", "Surf rig"], ["other", "Other"]] },
                    { label: "Surf, roughly", state: logObservedSurf, setState: setLogObservedSurf,
                      options: [["calm", "Calm"], ["moderate", "Moderate"], ["rough", "Rough"]] },
                  ].map((field) => (
                    <div key={field.label} style={{ marginBottom: 8 }}>
                      <div style={{ color: "#5A7A8A", fontSize: 10.5, marginBottom: 4 }}>{field.label}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {field.options.map(([val, label]) => (
                          <button key={val} onClick={() => field.setState(field.state === val ? null : val)}
                            style={{
                              padding: "4px 9px", borderRadius: 12, fontSize: 10.5, border: "1px solid",
                              borderColor: field.state === val ? "#F5A623" : "#1F3444",
                              background: field.state === val ? "rgba(245,166,35,0.15)" : "transparent",
                              color: field.state === val ? "#F5A623" : "#7590A0", cursor: "pointer",
                            }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 5 }}>NOTES (optional)</div>
                  <textarea
                    value={logNotes} onChange={(e) => setLogNotes(e.target.value)}
                    placeholder="Anything worth remembering about this trip"
                    rows={2}
                    style={{ width: "100%", background: "#070D14", border: "1px solid #1F3444", borderRadius: 6, color: "#DCE8EE", padding: "7px 9px", fontSize: 12.5, marginBottom: 12, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
                  />

                  <button
                    onClick={submitTripLog}
                    disabled={Object.values(logObs).every((o) => !o.sighted && !o.bit && !o.caught) || logSubmitting}
                    style={{
                      width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
                      background: "#F5A623", color: "#070D14", fontWeight: 700, fontSize: 13,
                      cursor: logSubmitting ? "default" : "pointer",
                      opacity: (Object.values(logObs).every((o) => !o.sighted && !o.bit && !o.caught) || logSubmitting) ? 0.5 : 1,
                    }}
                  >
                    {logSubmitting ? "Saving…" : "Save Trip Log"}
                  </button>

                  {logResult?.ok && (
                    <div style={{ marginTop: 10, color: "#17D9C4", fontSize: 12 }}>Saved — snapshot + all checked observations logged.</div>
                  )}
                  {logResult?.ok === false && (
                    <div style={{ marginTop: 10, color: "#FF5D5D", fontSize: 12 }}>Couldn't save: {logResult.error}</div>
                  )}
                </>
              )}
            </div>
          )}
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

function LogScreen() {
  const [trips, setTrips] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTripsList(null)
      .then((json) => { if (!cancelled) { setTrips(json.trips || []); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const patterns = trips ? computeTripPatterns(trips) : {};
  const subjectsWithData = Object.entries(patterns).filter(([, p]) => p.overallN > 0);
  const subjectsWithPatterns = subjectsWithData.filter(([, p]) => p.patterns.length > 0);

  const nameFor = (subjectId) => SPECIES.find((s) => s.id === subjectId)?.name || BAIT_TYPES.find((b) => b.id === subjectId)?.name || subjectId;

  return (
    <div style={{ padding: "12px 14px 90px" }}>
      <div style={{ color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 4 }}>
        TRIP LOG
      </div>
      <div style={{ color: "#4A6270", fontSize: 11, marginBottom: 14, lineHeight: 1.5 }}>
        Everything here is a raw frequency count from your own logged trips — never a prediction, and never blended into the live scores above. A pattern only shows once at least {PATTERN_MIN_BUCKET_N} trips share that condition AND the rate differs from the overall average by {Math.round(PATTERN_MIN_DIVERGENCE * 100)}+ points. Below that, it stays silent rather than guessing.
      </div>

      {loading && <div style={{ color: "#5A7A8A", fontSize: 13 }}>Loading trip log…</div>}
      {error && <DataUnavailable message={`Couldn't load trip log: ${error}`} />}

      {!loading && !error && (
        <>
          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
            POSSIBLE PATTERNS
          </div>
          {subjectsWithPatterns.length === 0 ? (
            <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 14, marginBottom: 16, color: "#5A7A8A", fontSize: 12.5, lineHeight: 1.5 }}>
              {subjectsWithData.length === 0
                ? "No trips logged yet. Once you've logged a few, real patterns from YOUR data will show up here."
                : `Logged trips so far: ${trips.length}. Nothing has crossed the ${PATTERN_MIN_BUCKET_N}-trip-per-condition threshold yet — keep logging and genuine patterns will start appearing here instead of guesses.`}
            </div>
          ) : (
            subjectsWithPatterns.map(([subjectId, p]) => (
              <div key={subjectId} style={{ background: "#0E1B26", border: "1px solid #3E8FFF55", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ color: "#DCE8EE", fontSize: 13, fontWeight: 600 }}>{nameFor(subjectId)}</span>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}>{p.overallN} logged, {Math.round(p.overallRate * 100)}% overall</span>
                </div>
                {p.patterns.map((pat, i) => (
                  <div key={i} style={{ color: "#B7CBD6", fontSize: 12, marginBottom: 4, lineHeight: 1.4 }}>
                    <span style={{ color: "#3E8FFF" }}>{pat.bucket}</span>: activity in {Math.round(pat.rate * 100)}% of {pat.n} trips ({pat.direction} than the {Math.round(pat.overallRate * 100)}% overall rate)
                  </div>
                ))}
              </div>
            ))
          )}

          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginTop: 8, marginBottom: 8 }}>
            HISTORY {trips.length > 0 && <span style={{ color: "#4A6270" }}>({trips.length})</span>}
          </div>
          {trips.length === 0 ? (
            <div style={{ color: "#5A7A8A", fontSize: 12.5 }}>Nothing logged yet — use "Log This Trip" on any beach's Overview tab.</div>
          ) : (
            [...trips].sort((a, b) => new Date(b.trip_date) - new Date(a.trip_date)).map((trip) => {
              const beach = BEACHES.find((b) => b.id === trip.beach_id);
              const timeBlockLabel = TIME_BLOCKS.find((t) => t.id === trip.time_block)?.label || trip.time_block;
              const active = (trip.observations || []).filter((o) => o.sighted || o.bit || o.caught);
              return (
                <div key={trip.id} style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 600 }}>{beach?.name || trip.beach_id}</span>
                    <span style={{ color: "#4A6270", fontSize: 10.5 }}>{trip.trip_date} · {timeBlockLabel}</span>
                  </div>
                  <div style={{ color: "#7590A0", fontSize: 11, marginBottom: 6 }}>
                    {trip.wave_ft != null ? `${trip.wave_ft.toFixed(1)}ft` : "surf n/a"}
                    {trip.tide_direction ? ` · ${trip.tide_direction}` : ""}
                    {trip.clarity_label ? ` · ${trip.clarity_label}` : ""}
                    {trip.wave_ft_source === "historical" && <span style={{ color: "#3E8FFF" }}> (reconstructed)</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {active.length === 0 ? (
                      <span style={{ fontSize: 10.5, color: "#5A7A8A" }}>No activity checked</span>
                    ) : active.map((o, i) => (
                      <span key={i} style={{ fontSize: 10.5, color: "#F5A623", border: "1px solid #F5A62355", borderRadius: 4, padding: "1px 6px" }}>
                        {nameFor(o.subject_id)} {[o.sighted && "sighted", o.bit && "bit", o.caught && "caught"].filter(Boolean).join("/")}
                      </span>
                    ))}
                  </div>
                  {trip.notes && <div style={{ color: "#8AA6B8", fontSize: 11, marginTop: 6, fontStyle: "italic" }}>{trip.notes}</div>}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}

function ArchitectureScreen() {
  const [calibState, setCalibState] = useState({ status: "idle", data: null, error: null });

  const runCalibrationCheck = async () => {
    setCalibState({ status: "loading", data: null, error: null });
    try {
      const backtest = await runBacktest({}); // no filters — every logged trip, every species
      const global = computeCalibration(backtest, {});
      const discA = computeDiscrimination(backtest, [0, 39], [70, 100], {});
      const discB = computeDiscrimination(backtest, [40, 59], [80, 100], {});
      setCalibState({ status: "done", data: { totalReplayed: backtest.length, global, discA, discB }, error: null });
    } catch (err) {
      setCalibState({ status: "error", data: null, error: err.message });
    }
  };

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

      {/* ============ CALIBRATION DIAGNOSTIC (Priority 7) ============
          Deliberately minimal — a developer/debug check, not a fishing
          feature. The score shown to the user elsewhere in the app is
          NEVER changed by anything here; this only measures, never adjusts. */}
      <div style={{ marginTop: 16, background: "#0E1B26", border: "1px solid #3E8FFF55", borderRadius: 10, padding: 12 }}>
        <div style={{ color: "#3E8FFF", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 6 }}>
          CALIBRATION CHECK (diagnostic)
        </div>
        <div style={{ color: "#7590A0", fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>
          Measures what the existing scores actually correlate with in your logged trips — never adjusts the model. Every rate below requires at least the listed sample size before it's shown as anything but "insufficient data."
        </div>
        <button
          onClick={runCalibrationCheck}
          disabled={calibState.status === "loading"}
          style={{
            padding: "7px 12px", borderRadius: 7, border: "1px solid #3E8FFF", background: "transparent",
            color: "#3E8FFF", fontSize: 11.5, cursor: calibState.status === "loading" ? "default" : "pointer", marginBottom: 10,
          }}
        >
          {calibState.status === "loading" ? "Running…" : "Run Calibration Check"}
        </button>

        {calibState.status === "error" && (
          <div style={{ color: "#FF5D5D", fontSize: 11.5 }}>Couldn't run: {calibState.error}</div>
        )}

        {calibState.status === "done" && (() => {
          const { totalReplayed, global, discA, discB } = calibState.data;
          if (global.error) {
            return <div style={{ color: "#F5A623", fontSize: 11.5, lineHeight: 1.5 }}>{global.error}</div>;
          }
          const nonEmptyBins = global.bins.filter((b) => b.total > 0);
          return (
            <div>
              <div style={{ color: "#5A7A8A", fontSize: 10.5, marginBottom: 8 }}>
                {totalReplayed} predictions replayed · model {global.modelVersion || "—"} · min sample for a reliable rate here: {global.minSample}
              </div>
              {nonEmptyBins.length === 0 ? (
                <div style={{ color: "#5A7A8A", fontSize: 12 }}>No data yet — log some trips first.</div>
              ) : (
                nonEmptyBins.map((b) => (
                  <div key={b.range} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #16232E", fontSize: 11.5 }}>
                    <span style={{ color: "#8AA6B8" }}>{b.range}</span>
                    <span style={{ color: "#5A7A8A" }}>{b.usable} usable ({b.positive}+ / {b.negative}− / {b.unknown}?)</span>
                    <span style={{ color: b.reliable ? "#17D9C4" : "#F5A623", fontWeight: 600 }}>
                      {b.reliable ? `${Math.round(b.observedPositiveRate * 100)}%` : "insufficient data"}
                    </span>
                  </div>
                ))
              )}
              <div style={{ color: "#7590A0", fontSize: 10.5, marginTop: 10, marginBottom: 4 }}>DISCRIMINATION</div>
              {[["0-39 vs 70-100", discA], ["40-59 vs 80-100", discB]].map(([label, d], i) => (
                <div key={i} style={{ fontSize: 11.5, color: "#8AA6B8", marginBottom: 3 }}>
                  {label}: {d.error ? d.error : d.reliable ? (d.higherScoresOutperform ? "higher scores outperform" : "no clear difference observed") : "insufficient data on one or both sides"}
                </div>
              ))}
            </div>
          );
        })()}
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
    { id: "log", label: "Log" },
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
      {screen === "log" && <ErrorBoundary key="log"><LogScreen /></ErrorBoundary>}
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
