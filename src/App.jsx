import React, { useState, useMemo, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from "recharts";
import { ChevronLeft, ChevronDown, Waves, Moon, Wind, Thermometer, Eye, Droplets, Fish, AlertTriangle, TrendingUp, Info, RefreshCw, WifiOff } from "lucide-react";

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

// All 24 beaches now mapped to their nearest official NOAA CO-OPS station.
// Several beaches share a station with a close neighbor where no dedicated
// oceanfront gauge exists (noted below) — tide timing is still accurate,
// but "nearest station" isn't always "station right on that beach."
const NOAA_STATIONS = {
  "fort-pierce": { stationId: "8722212", stationName: "Fort Pierce, South Jetty, FL" },
  "bathtub-beach": { stationId: "8722357", stationName: "Stuart, St. Lucie River, FL (nearest \u2014 ICWW, not oceanfront)" },
  "stuart-beach": { stationId: "8722357", stationName: "Stuart, St. Lucie River, FL (nearest \u2014 ICWW, not oceanfront)" },
  "amelia-island": { stationId: "8720030", stationName: "Fernandina Beach, FL" },
  "jacksonville-beach": { stationId: "8720291", stationName: "Jacksonville Beach, FL" },
  "ponte-vedra-beach": { stationId: "8720291", stationName: "Jacksonville Beach, FL (nearest station)" },
  "st-augustine-beach": { stationId: "8720587", stationName: "St. Augustine Beach, FL" },
  "vilano-beach": { stationId: "8720587", stationName: "St. Augustine Beach, FL (nearest station)" },
  "flagler-beach": { stationId: "8720833", stationName: "Smith Creek, Flagler Beach, FL (nearest \u2014 ICWW, not oceanfront)" },
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
  "juno-beach": { stationId: "41068", stationName: "Fort Pierce, FL (nearest buoy, ~45mi \u2014 not local)" },
  "jupiter-beach": { stationId: "41068", stationName: "Fort Pierce, FL (nearest buoy, ~40mi \u2014 not local)" },
  "palm-beach": { stationId: "41122", stationName: "Hollywood Beach, FL (nearest buoy, ~45mi \u2014 not local)" },
  "fort-lauderdale-beach": { stationId: "41122", stationName: "Hollywood Beach, FL" },
  "hollywood-beach": { stationId: "41122", stationName: "Hollywood Beach, FL" },
  "haulover-beach": { stationId: "41122", stationName: "Hollywood Beach, FL (nearest buoy, ~15mi)" },
  "south-beach": { stationId: "41122", stationName: "Hollywood Beach, FL (nearest buoy, ~15mi)" },
  "key-biscayne": { stationId: "41122", stationName: "Hollywood Beach, FL (nearest buoy, ~20mi)" },
};

// Fetches and normalizes the latest NDBC buoy reading via the proxy. NDBC
// text is parsed server-side in the Worker; this just wraps the result and
// converts units (m\u2192ft, m/s\u2192kt) for display.
async function fetchLatestBuoy(stationId) {
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
}

// Scores the environmental bonus from live buoy data. Calm-to-moderate surf
// is favored (per documented preference for "semi calm clean water");
// falling barometric pressure gets a bonus (classic pre-frontal feeding
// push), sharply rising pressure gets a penalty (post-frontal lull). Only
// contributes what data is actually present \u2014 missing wave or pressure
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
    factors.push({ label: `Offshore wave height ${buoy.waveHeightFt.toFixed(1)} ft`, delta: waveBonus });
  }

  if (buoy.pressureTendencyHpa != null) {
    let pBonus;
    if (buoy.pressureTendencyHpa <= -1) pBonus = 8;
    else if (buoy.pressureTendencyHpa < 0) pBonus = 3;
    else if (buoy.pressureTendencyHpa <= 1) pBonus = 0;
    else pBonus = -6;
    bonus += pBonus;
    factors.push({ label: `Barometric pressure ${buoy.pressureTendencyHpa >= 0 ? "+" : ""}${buoy.pressureTendencyHpa.toFixed(1)} hPa (3-hr trend)`, delta: pBonus });
  }

  if (factors.length === 0) return null; // buoy reachable but no usable fields
  return { bonus, factors, buoy };
}


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
// SCORING \u2014 pompano, tide-only model (first real, non-demo score in the app)
//
// This deliberately only uses genuinely live data. Wave height/period, wind,
// and water temp are not wired in yet (that's the NDBC step), so this does
// NOT try to fake those axes \u2014 it produces a partial but honest score
// based purely on tide dynamics, and every other species stays demo until
// its own rule is built.
// ===========================================================================

// Finds the two tide events bracketing `atDate` and returns how far through
// that swing we are, which direction, and a flow-strength estimate (0 at
// slack/the tide extremes, close to 1 near the midpoint of the swing \u2014
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
function scorePompanoFromTide(tideStage, moonFactor, buoyFactor) {
  if (!tideStage) return null;
  const flowBonus = Math.round(tideStage.flowStrength * 30); // 0-30
  const incomingBonus = tideStage.direction === "incoming" ? 8 : 0;
  const moonBonus = moonFactor ? moonFactor.bonus : 0;
  const buoyBonus = buoyFactor ? buoyFactor.bonus : 0;
  const score = Math.max(5, Math.min(95, 50 + flowBonus + incomingBonus + moonBonus + buoyBonus));
  const factors = [
    { label: `${tideStage.direction === "incoming" ? "Incoming" : "Outgoing"} tide, ${Math.round(tideStage.flowStrength * 100)}% of peak flow strength`, delta: flowBonus },
  ];
  if (incomingBonus) factors.push({ label: "Incoming tide historically favored for pompano", delta: incomingBonus });
  if (moonFactor) factors.push({ label: `${moonFactor.moonPhase.name}, ${Math.round(moonFactor.intensity * 100)}% solunar intensity`, delta: moonBonus });
  if (buoyFactor) factors.push(...buoyFactor.factors);
  return { score, factors, tideStage };
}

// ===========================================================================
// SPECIES PROFILES \u2014 the other 8 species used to share one identical
// formula, which meant they always landed on the same score (a real bug,
// not just a look). Real predators don't behave alike: bull sharks push
// into murky/rough water, tarpon are calm-water and heavily moon-driven,
// jack crevalle feed aggressively in almost anything, cobia want calm water
// and barely care about tide. Each profile below weights the SAME real
// inputs (tide, moon, buoy) differently per species \u2014 these weights are
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
  // "tolerant" \u2014 generalist, flatter curve, only extreme chop hurts
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

function scoreSpeciesFromProfile(tideStage, moonFactor, buoyFactor, profile) {
  if (!tideStage) return null;
  const factors = [];

  const flowBonus = Math.round(tideStage.flowStrength * profile.flowWeight);
  factors.push({
    label: `${tideStage.direction === "incoming" ? "Incoming" : "Outgoing"} tide, ${Math.round(tideStage.flowStrength * 100)}% of peak flow strength${profile.bidirectional ? " \u2014 both directions count for this species" : ""}`,
    delta: flowBonus,
  });

  let directionBonus = 0;
  if (profile.favoredDirection && tideStage.direction === profile.favoredDirection) {
    directionBonus = profile.directionBonus;
    factors.push({ label: profile.directionLabel, delta: directionBonus });
  }

  let moonBonus = 0;
  if (moonFactor) {
    moonBonus = Math.round(moonFactor.bonus * profile.moonWeight);
    factors.push({ label: `${moonFactor.moonPhase.name}, ${Math.round(moonFactor.intensity * 100)}% solunar intensity`, delta: moonBonus });
  }

  let waveBonus = 0;
  let pressureBonus = 0;
  if (buoyFactor?.buoy) {
    const wb = waveBonusForProfile(buoyFactor.buoy.waveHeightFt, profile.wavePreference);
    if (wb != null) {
      waveBonus = Math.round(wb * profile.waveWeight);
      factors.push({ label: `Offshore wave height ${buoyFactor.buoy.waveHeightFt.toFixed(1)} ft (${profile.wavePreference}-water species)`, delta: waveBonus });
    }
    const pb = pressureBonusBase(buoyFactor.buoy.pressureTendencyHpa);
    if (pb != null) {
      pressureBonus = Math.round(pb * profile.pressureWeight);
      factors.push({ label: `Barometric pressure ${buoyFactor.buoy.pressureTendencyHpa >= 0 ? "+" : ""}${buoyFactor.buoy.pressureTendencyHpa.toFixed(1)} hPa (3-hr trend)`, delta: pressureBonus });
    }
  }

  const score = Math.max(5, Math.min(95, profile.base + flowBonus + directionBonus + moonBonus + waveBonus + pressureBonus));
  return { score, factors, tideStage };
}

const SPECIES_PROFILES = {
  blacktip: { base: 48, flowWeight: 35, bidirectional: true, moonWeight: 1.0, wavePreference: "rough", waveWeight: 1.0, pressureWeight: 1.1 },
  spinner: { base: 46, flowWeight: 32, bidirectional: true, moonWeight: 1.0, wavePreference: "tolerant", waveWeight: 0.9, pressureWeight: 0.9 },
  bull: { base: 50, flowWeight: 38, bidirectional: true, moonWeight: 0.9, wavePreference: "rough", waveWeight: 1.1, pressureWeight: 1.0 },
  tarpon: { base: 42, flowWeight: 22, bidirectional: true, moonWeight: 1.3, wavePreference: "calm", waveWeight: 1.0, pressureWeight: 0.7 },
  snook: { base: 40, flowWeight: 28, bidirectional: false, favoredDirection: "incoming", directionBonus: 6, directionLabel: "Incoming tide favored \u2014 ambushes bait at structure on the push", moonWeight: 1.0, wavePreference: "calm", waveWeight: 1.1, pressureWeight: 0.9 },
  jack: { base: 55, flowWeight: 28, bidirectional: true, moonWeight: 0.5, wavePreference: "tolerant", waveWeight: 0.6, pressureWeight: 0.6 },
  cobia: { base: 38, flowWeight: 18, bidirectional: true, moonWeight: 1.0, wavePreference: "calm", waveWeight: 1.2, pressureWeight: 0.9 },
  mackerel: { base: 45, flowWeight: 33, bidirectional: true, moonWeight: 0.8, wavePreference: "calm", waveWeight: 1.2, pressureWeight: 0.9 },
};

// Maps each species to its live scoring rule. Only species listed here can
// ever show a LIVE badge; anything missing (none currently) stays demo.
const TIDE_MODELS = {
  pompano: scorePompanoFromTide,
  blacktip: (t, m, b) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.blacktip),
  spinner: (t, m, b) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.spinner),
  bull: (t, m, b) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.bull),
  tarpon: (t, m, b) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.tarpon),
  snook: (t, m, b) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.snook),
  jack: (t, m, b) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.jack),
  cobia: (t, m, b) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.cobia),
  mackerel: (t, m, b) => scoreSpeciesFromProfile(t, m, b, SPECIES_PROFILES.mackerel),
};


// ===========================================================================
// MOON \u2014 pure astronomical calculation, not a live feed. Reliable and
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
// in the model \u2014 real, but folklore-grade, not measured-grade like tide.
function scoreMoonFactor(moonPhase) {
  const intensity = Math.abs(Math.cos((moonPhase.age / SYNODIC_MONTH_DAYS) * 2 * Math.PI));
  const bonus = Math.round(intensity * 10);
  return { bonus, intensity, moonPhase };
}

// Calls one of our proxy's three routes. The proxy validates `station` itself
// and returns either NOAA's raw JSON (success) or {error, noaa} with a
// non-200 status (failure) — never silently substituted data.
async function fetchViaProxy(path, stationId) {
  const url = `${PROXY_BASE_URL}${path}?station=${encodeURIComponent(stationId)}`;
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
async function fetchNoaaBundleForBeach(beachId) {
  const station = NOAA_STATIONS[beachId];
  if (!station) {
    return { connected: false, reason: "No NOAA station has been mapped to this beach yet." };
  }
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

const BEACHES = [
  {
    id: "fort-pierce",
    name: "Fort Pierce Inlet",
    zone: "North jetty",
    coast: "Treasure Coast",
    overall: 88,
    confidence: "High",
    freshness: "Live data 12 min ago",
    bestWindow: "6:15 PM \u2013 8:05 PM",
    tideWindow: "Last 2h of incoming tide",
    conditions: {
      wind: "SE 8 kt", swell: "2 ft @ 9s SE", waterTemp: "79\u00b0F",
      clarity: "Clean, greenish", tide: "Incoming, +1.4 ft", moon: "Waxing gibbous (78%)",
    },
    species: {
      pompano: 92, blacktip: 87, spinner: 61, bull: 44, tarpon: 74,
      snook: 38, jack: 55, cobia: 29, mackerel: 66,
    },
    evidence: [
      { type: "live", label: "Wave buoy reading, station 41114-adjacent (mock)", detail: "2 ft @ 9s, SE swell", reliability: 92, time: "12 min ago" },
      { type: "live", label: "Tide station reading (mock)", detail: "Incoming tide, +1.4 ft and rising", reliability: 95, time: "18 min ago" },
      { type: "historical", label: "5-season pattern match", detail: "Pompano bite strong in this wind/swell/temp combo 71% of past occurrences", reliability: 80, time: "aggregate" },
      { type: "report", label: "Local bait shop report", detail: "\u201cPompano showing on sand fleas past 2 days\u201d", reliability: 55, time: "9 hr ago" },
      { type: "user", label: "Your last logged trip", detail: "2 pompano, 1 jack \u2014 similar tide stage", reliability: 70, time: "6 days ago" },
      { type: "social", label: "Public social post (unverified)", detail: "Angler photo tagged near inlet, species unconfirmed", reliability: 25, time: "3 hr ago" },
    ],
    factorsFor: ["Clean, low-turbidity water", "Moderate wave energy stirring sand fleas", "Favorable incoming tide stage", "Water temp in pompano's preferred band", "Recent corroborating shop report"],
    factorsAgainst: ["Falling barometric pressure overnight", "Bull shark score suppressed by warm, calm surf preference mismatch"],
  },
  {
    id: "bathtub-beach",
    name: "Bathtub Beach",
    zone: "Sandbar cut",
    coast: "Treasure Coast",
    overall: 64,
    confidence: "Medium",
    freshness: "Live data 41 min ago",
    bestWindow: "5:40 AM \u2013 7:10 AM",
    tideWindow: "First 2h of outgoing tide",
    conditions: {
      wind: "NE 14 kt", swell: "3.5 ft @ 7s NE", waterTemp: "76\u00b0F",
      clarity: "Stained, tannic", tide: "Outgoing, -0.6 ft", moon: "Waxing gibbous (78%)",
    },
    species: {
      pompano: 48, blacktip: 71, spinner: 58, bull: 62, tarpon: 39,
      snook: 51, jack: 60, cobia: 22, mackerel: 34,
    },
    evidence: [
      { type: "live", label: "Nearshore weather reading (mock)", detail: "NE wind 14 kt, choppy", reliability: 88, time: "41 min ago" },
      { type: "historical", label: "Baseline seasonal average", detail: "Shark activity typically elevated in stained water this month", reliability: 75, time: "aggregate" },
      { type: "social", label: "Public social post (unverified)", detail: "Mentions \u201csharks cruising the trough\u201d", reliability: 22, time: "1 day ago" },
    ],
    factorsFor: ["Stained water favors ambush-feeding sharks", "Elevated wind chop increasing turbidity"],
    factorsAgainst: ["Reduced sight-feeding conditions hurt pompano and mackerel", "No recent user or shop reports to corroborate"],
  },
  {
    id: "stuart-beach",
    name: "Stuart Beach",
    zone: "Main lifeguard stand",
    coast: "Treasure Coast",
    overall: 55,
    confidence: "Low",
    freshness: "Live data 2 hr ago (stale)",
    bestWindow: "No strong window identified",
    tideWindow: "Insufficient data",
    conditions: {
      wind: "E 10 kt", swell: "1.5 ft @ 8s E", waterTemp: "78\u00b0F",
      clarity: "Unknown \u2014 no recent clarity data", tide: "Slack, turning", moon: "Waxing gibbous (78%)",
    },
    species: {
      pompano: 41, blacktip: 33, spinner: 30, bull: 20, tarpon: 45,
      snook: 47, jack: 42, cobia: 35, mackerel: 40,
    },
    evidence: [
      { type: "live", label: "Weather reading (mock, stale)", detail: "Last refreshed 2 hr ago", reliability: 60, time: "2 hr ago" },
      { type: "historical", label: "Baseline seasonal average only", detail: "No standout historical pattern for current conditions", reliability: 65, time: "aggregate" },
    ],
    factorsFor: ["Mild surf, comfortable wading conditions"],
    factorsAgainst: ["No fresh clarity data", "No recent reports or user observations", "Slack tide historically weak for most target species here"],
  },
];

// Shorthand for the Jacksonville-to-Miami expansion beaches below — same
// environmental_observations shape as the fully-authored beaches above, just
// with a lighter, templated evidence list since these are demo-only for now.
function demoBeach({ id, name, zone, coast, overall, confidence, freshness, bestWindow, tideWindow, conditions, species, factorsFor, factorsAgainst }) {
  return {
    id, name, zone, coast, overall, confidence,
    freshness: freshness || "Demo data \u2014 no live source connected",
    bestWindow, tideWindow, conditions, species,
    evidence: [
      { type: "historical", label: "5-season seasonal baseline", detail: `Pattern match for current wind/swell/temp combo at ${name}`, reliability: 78, time: "aggregate" },
      { type: "social", label: "Public social post (unverified)", detail: "Recent angler photo tagged nearby, species unconfirmed", reliability: 24, time: "1 day ago" },
    ],
    factorsFor, factorsAgainst,
  };
}

BEACHES.push(
  demoBeach({
    id: "amelia-island", name: "Amelia Island", zone: "Main Beach access", coast: "First Coast",
    overall: 70, confidence: "Medium", bestWindow: "6:40 AM \u2013 8:20 AM", tideWindow: "First 2h of incoming tide",
    conditions: { wind: "NE 9 kt", swell: "2.5 ft @ 8s NE", waterTemp: "77\u00b0F", clarity: "Moderately clean", tide: "Incoming, +0.8 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 68, blacktip: 74, spinner: 52, bull: 38, tarpon: 45, snook: 22, jack: 58, cobia: 41, mackerel: 55 },
    factorsFor: ["Baitfish schools reported along the shoreline", "Favorable incoming tide stage"],
    factorsAgainst: ["Fewer recent reports than more heavily fished Treasure Coast spots"],
  }),
  demoBeach({
    id: "jacksonville-beach", name: "Jacksonville Beach", zone: "Beach Blvd access", coast: "First Coast",
    overall: 61, confidence: "Medium", bestWindow: "7:10 AM \u2013 9:00 AM", tideWindow: "Last 2h of outgoing tide",
    conditions: { wind: "E 12 kt", swell: "3 ft @ 8s E", waterTemp: "77\u00b0F", clarity: "Slightly stained", tide: "Outgoing, -0.4 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 55, blacktip: 63, spinner: 48, bull: 35, tarpon: 40, snook: 20, jack: 60, cobia: 33, mackerel: 50 },
    factorsFor: ["Consistent surf, popular pier for jack crevalle runs"],
    factorsAgainst: ["Heavier beach traffic can reduce close-in bite windows"],
  }),
  demoBeach({
    id: "ponte-vedra-beach", name: "Ponte Vedra Beach", zone: "Guana Preserve access", coast: "First Coast",
    overall: 66, confidence: "Medium", bestWindow: "6:00 AM \u2013 7:45 AM", tideWindow: "First 2h of incoming tide",
    conditions: { wind: "NE 7 kt", swell: "2 ft @ 9s NE", waterTemp: "78\u00b0F", clarity: "Clean", tide: "Incoming, +1.0 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 72, blacktip: 58, spinner: 40, bull: 28, tarpon: 50, snook: 25, jack: 45, cobia: 44, mackerel: 60 },
    factorsFor: ["Clean water, low fishing pressure", "Good pompano history in similar swell"],
    factorsAgainst: ["Limited public beach access points"],
  }),
  demoBeach({
    id: "st-augustine-beach", name: "St. Augustine Beach", zone: "St. Johns County Pier", coast: "First Coast",
    overall: 69, confidence: "Medium", bestWindow: "5:50 PM \u2013 7:30 PM", tideWindow: "Last 2h of incoming tide",
    conditions: { wind: "SE 10 kt", swell: "2.5 ft @ 8s SE", waterTemp: "78\u00b0F", clarity: "Moderately clean", tide: "Incoming, +1.2 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 64, blacktip: 70, spinner: 55, bull: 42, tarpon: 58, snook: 30, jack: 55, cobia: 38, mackerel: 62 },
    factorsFor: ["Pier structure historically strong for mackerel and blacktip"],
    factorsAgainst: ["Moderate crowding around the pier reduces casting room"],
  }),
  demoBeach({
    id: "vilano-beach", name: "Vilano Beach", zone: "Vilano Bridge, north side", coast: "First Coast",
    overall: 58, confidence: "Low", bestWindow: "No strong window identified", tideWindow: "Insufficient data",
    conditions: { wind: "SE 13 kt", swell: "3 ft @ 7s SE", waterTemp: "78\u00b0F", clarity: "Stained near inlet", tide: "Slack, turning", moon: "Waxing gibbous (78%)" },
    species: { pompano: 40, blacktip: 60, spinner: 46, bull: 44, tarpon: 48, snook: 33, jack: 50, cobia: 30, mackerel: 42 },
    factorsFor: ["Inlet proximity favors shark and snook activity"],
    factorsAgainst: ["No recent reports to corroborate current conditions"],
  }),
  demoBeach({
    id: "flagler-beach", name: "Flagler Beach", zone: "Flagler Beach Pier", coast: "Flagler / Volusia Coast",
    overall: 73, confidence: "High", bestWindow: "6:30 PM \u2013 8:15 PM", tideWindow: "Last 2h of incoming tide",
    conditions: { wind: "E 8 kt", swell: "2 ft @ 9s E", waterTemp: "79\u00b0F", clarity: "Clean", tide: "Incoming, +1.3 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 80, blacktip: 65, spinner: 44, bull: 30, tarpon: 52, snook: 28, jack: 48, cobia: 46, mackerel: 68 },
    factorsFor: ["Strong recent pompano reports off the pier", "Clean water, gentle surf"],
    factorsAgainst: ["Pier fishing pressure can spook fish during peak hours"],
  }),
  demoBeach({
    id: "playalinda-beach", name: "Playalinda Beach", zone: "Canaveral National Seashore", coast: "Space Coast",
    overall: 76, confidence: "Medium", bestWindow: "6:20 AM \u2013 8:00 AM", tideWindow: "First 2h of incoming tide",
    conditions: { wind: "NE 9 kt", swell: "2.5 ft @ 9s NE", waterTemp: "79\u00b0F", clarity: "Clean, low pressure area", tide: "Incoming, +1.1 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 74, blacktip: 82, spinner: 66, bull: 48, tarpon: 55, snook: 24, jack: 60, cobia: 50, mackerel: 58 },
    factorsFor: ["Remote, low-pressure beach with strong shark history", "Clean water off the National Seashore"],
    factorsAgainst: ["No pier/structure reports \u2014 harder to corroborate close-in activity"],
  }),
  demoBeach({
    id: "new-smyrna-beach", name: "New Smyrna Beach", zone: "27th Ave approach", coast: "Flagler / Volusia Coast",
    overall: 64, confidence: "Medium", bestWindow: "7:00 AM \u2013 8:40 AM", tideWindow: "First 2h of outgoing tide",
    conditions: { wind: "E 11 kt", swell: "3 ft @ 8s E", waterTemp: "79\u00b0F", clarity: "Moderately clean", tide: "Outgoing, -0.5 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 58, blacktip: 76, spinner: 60, bull: 40, tarpon: 46, snook: 26, jack: 56, cobia: 36, mackerel: 52 },
    factorsFor: ["Well known inlet-adjacent shark activity"],
    factorsAgainst: ["Very high angler and surfer density can limit clean windows"],
  }),
  demoBeach({
    id: "daytona-beach", name: "Daytona Beach", zone: "Sun Splash Park access", coast: "Flagler / Volusia Coast",
    overall: 52, confidence: "Low", bestWindow: "No strong window identified", tideWindow: "Insufficient data",
    conditions: { wind: "E 14 kt", swell: "3.5 ft @ 7s E", waterTemp: "79\u00b0F", clarity: "Stained, wind-chopped", tide: "Slack, turning", moon: "Waxing gibbous (78%)" },
    species: { pompano: 38, blacktip: 55, spinner: 42, bull: 36, tarpon: 40, snook: 20, jack: 48, cobia: 24, mackerel: 35 },
    factorsFor: ["Mild wading conditions at low tide"],
    factorsAgainst: ["Heavy beach-driving traffic disturbs shallow water", "No fresh reports"],
  }),
  demoBeach({
    id: "cocoa-beach", name: "Cocoa Beach", zone: "Cocoa Beach Pier", coast: "Space Coast",
    overall: 71, confidence: "Medium", bestWindow: "6:10 PM \u2013 7:50 PM", tideWindow: "Last 2h of incoming tide",
    conditions: { wind: "E 9 kt", swell: "2.5 ft @ 9s E", waterTemp: "79\u00b0F", clarity: "Clean", tide: "Incoming, +1.0 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 70, blacktip: 68, spinner: 50, bull: 34, tarpon: 60, snook: 32, jack: 52, cobia: 48, mackerel: 66 },
    factorsFor: ["Pier structure historically strong for tarpon and mackerel"],
    factorsAgainst: ["Popular tourist beach \u2014 higher daytime foot traffic"],
  }),
  demoBeach({
    id: "melbourne-beach", name: "Melbourne Beach", zone: "Spessard Holland Park", coast: "Space Coast",
    overall: 68, confidence: "Medium", bestWindow: "6:35 AM \u2013 8:15 AM", tideWindow: "First 2h of incoming tide",
    conditions: { wind: "NE 8 kt", swell: "2 ft @ 9s NE", waterTemp: "79\u00b0F", clarity: "Clean", tide: "Incoming, +0.9 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 75, blacktip: 60, spinner: 42, bull: 28, tarpon: 48, snook: 26, jack: 46, cobia: 42, mackerel: 58 },
    factorsFor: ["Quiet county park beach, low fishing pressure"],
    factorsAgainst: ["Fewer recent reports than nearby Cocoa Beach"],
  }),
  demoBeach({
    id: "vero-beach", name: "Vero Beach", zone: "South Beach Park", coast: "Treasure Coast",
    overall: 72, confidence: "Medium", bestWindow: "5:55 PM \u2013 7:40 PM", tideWindow: "Last 2h of incoming tide",
    conditions: { wind: "SE 9 kt", swell: "2 ft @ 9s SE", waterTemp: "79\u00b0F", clarity: "Clean", tide: "Incoming, +1.2 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 78, blacktip: 66, spinner: 46, bull: 30, tarpon: 54, snook: 30, jack: 50, cobia: 45, mackerel: 62 },
    factorsFor: ["Strong pompano history in similar tide/swell combos", "Clean water"],
    factorsAgainst: ["No recent user-logged trips at this specific beach yet"],
  }),
  demoBeach({
    id: "jensen-beach", name: "Jensen Beach", zone: "Jensen Beach Park", coast: "Treasure Coast",
    overall: 60, confidence: "Low", bestWindow: "No strong window identified", tideWindow: "Insufficient data",
    conditions: { wind: "SE 12 kt", swell: "2.5 ft @ 8s SE", waterTemp: "79\u00b0F", clarity: "Moderately clean", tide: "Slack, turning", moon: "Waxing gibbous (78%)" },
    species: { pompano: 50, blacktip: 58, spinner: 44, bull: 32, tarpon: 42, snook: 28, jack: 46, cobia: 30, mackerel: 44 },
    factorsFor: ["Sheltered stretch, comfortable wading"],
    factorsAgainst: ["No fresh reports or observations logged"],
  }),
  demoBeach({
    id: "juno-beach", name: "Juno Beach", zone: "Juno Beach Pier", coast: "Palm Beaches",
    overall: 74, confidence: "High", bestWindow: "6:45 AM \u2013 8:25 AM", tideWindow: "First 2h of incoming tide",
    conditions: { wind: "E 8 kt", swell: "2 ft @ 10s E", waterTemp: "80\u00b0F", clarity: "Very clean", tide: "Incoming, +1.3 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 72, blacktip: 78, spinner: 58, bull: 40, tarpon: 62, snook: 34, jack: 55, cobia: 52, mackerel: 65 },
    factorsFor: ["Consistently clean Gulf Stream-influenced water", "Strong pier reports for blacktip and cobia"],
    factorsAgainst: ["Popular spot \u2014 pier can get crowded on weekends"],
  }),
  demoBeach({
    id: "jupiter-beach", name: "Jupiter Beach", zone: "Jupiter Inlet", coast: "Palm Beaches",
    overall: 77, confidence: "High", bestWindow: "6:20 PM \u2013 8:00 PM", tideWindow: "Last 2h of outgoing tide",
    conditions: { wind: "E 10 kt", swell: "2.5 ft @ 9s E", waterTemp: "80\u00b0F", clarity: "Clean near inlet", tide: "Outgoing, -0.6 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 62, blacktip: 84, spinner: 68, bull: 52, tarpon: 66, snook: 44, jack: 58, cobia: 48, mackerel: 55 },
    factorsFor: ["Inlet outflow concentrates baitfish on the outgoing tide", "Strong historical shark and snook activity"],
    factorsAgainst: ["Strong current near the inlet mouth can complicate casting"],
  }),
  demoBeach({
    id: "palm-beach", name: "Palm Beach", zone: "Midtown Beach", coast: "Palm Beaches",
    overall: 63, confidence: "Medium", bestWindow: "7:00 AM \u2013 8:35 AM", tideWindow: "First 2h of incoming tide",
    conditions: { wind: "E 9 kt", swell: "2 ft @ 9s E", waterTemp: "80\u00b0F", clarity: "Clean", tide: "Incoming, +1.0 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 65, blacktip: 55, spinner: 38, bull: 25, tarpon: 50, snook: 28, jack: 44, cobia: 40, mackerel: 58 },
    factorsFor: ["Consistently clean water year-round"],
    factorsAgainst: ["Limited public access and lower angler report volume"],
  }),
  demoBeach({
    id: "fort-lauderdale-beach", name: "Fort Lauderdale Beach", zone: "Las Olas Blvd access", coast: "Broward",
    overall: 59, confidence: "Medium", bestWindow: "6:50 AM \u2013 8:30 AM", tideWindow: "First 2h of incoming tide",
    conditions: { wind: "E 11 kt", swell: "2 ft @ 8s E", waterTemp: "81\u00b0F", clarity: "Moderately clean", tide: "Incoming, +0.9 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 54, blacktip: 58, spinner: 40, bull: 30, tarpon: 48, snook: 32, jack: 50, cobia: 38, mackerel: 56 },
    factorsFor: ["Warm water supports year-round mackerel activity"],
    factorsAgainst: ["Very high beach traffic reduces early/late window reliability"],
  }),
  demoBeach({
    id: "hollywood-beach", name: "Hollywood Beach", zone: "Hollywood Broadwalk", coast: "Broward",
    overall: 55, confidence: "Low", bestWindow: "No strong window identified", tideWindow: "Insufficient data",
    conditions: { wind: "E 12 kt", swell: "2 ft @ 8s E", waterTemp: "81\u00b0F", clarity: "Moderately clean", tide: "Slack, turning", moon: "Waxing gibbous (78%)" },
    species: { pompano: 48, blacktip: 50, spinner: 36, bull: 28, tarpon: 42, snook: 26, jack: 45, cobia: 30, mackerel: 46 },
    factorsFor: ["Warm, stable water temperature"],
    factorsAgainst: ["No recent reports or observations logged"],
  }),
  demoBeach({
    id: "haulover-beach", name: "Haulover Beach", zone: "Haulover Inlet", coast: "Miami-Dade",
    overall: 79, confidence: "High", bestWindow: "6:10 PM \u2013 7:55 PM", tideWindow: "Last 2h of outgoing tide",
    conditions: { wind: "E 10 kt", swell: "2 ft @ 9s E", waterTemp: "81\u00b0F", clarity: "Clean near inlet", tide: "Outgoing, -0.7 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 60, blacktip: 86, spinner: 70, bull: 55, tarpon: 68, snook: 40, jack: 62, cobia: 54, mackerel: 58 },
    factorsFor: ["Well-documented inlet shark activity on outgoing tide", "Strong recent reports from a heavily fished, well-monitored inlet"],
    factorsAgainst: ["Heavy boat traffic through the inlet during the day"],
  }),
  demoBeach({
    id: "south-beach", name: "South Beach", zone: "5th St access", coast: "Miami-Dade",
    overall: 51, confidence: "Low", bestWindow: "No strong window identified", tideWindow: "Insufficient data",
    conditions: { wind: "E 9 kt", swell: "1.5 ft @ 8s E", waterTemp: "82\u00b0F", clarity: "Clean but very high boat traffic", tide: "Slack, turning", moon: "Waxing gibbous (78%)" },
    species: { pompano: 44, blacktip: 42, spinner: 30, bull: 22, tarpon: 38, snook: 24, jack: 40, cobia: 26, mackerel: 40 },
    factorsFor: ["Consistently warm water"],
    factorsAgainst: ["Extremely high recreational activity suppresses fish activity", "No recent angler reports"],
  }),
  demoBeach({
    id: "key-biscayne", name: "Key Biscayne", zone: "Crandon Park", coast: "Miami-Dade",
    overall: 67, confidence: "Medium", bestWindow: "6:30 AM \u2013 8:10 AM", tideWindow: "First 2h of incoming tide",
    conditions: { wind: "E 8 kt", swell: "1.5 ft @ 9s E", waterTemp: "82\u00b0F", clarity: "Clean, sheltered by the key", tide: "Incoming, +1.0 ft", moon: "Waxing gibbous (78%)" },
    species: { pompano: 58, blacktip: 62, spinner: 44, bull: 32, tarpon: 56, snook: 38, jack: 48, cobia: 40, mackerel: 50 },
    factorsFor: ["Sheltered water column, good early-morning clarity"],
    factorsAgainst: ["Southernmost beach in the set \u2014 fewer historical reports on file"],
  }),
);

const TIDE_CURVE = [
  { t: "3a", ft: 0.9 }, { t: "5a", ft: 1.6 }, { t: "7a", ft: 1.9 }, { t: "9a", ft: 1.4 },
  { t: "11a", ft: 0.6 }, { t: "1p", ft: -0.1 }, { t: "3p", ft: 0.3 }, { t: "5p", ft: 1.1 },
  { t: "7p", ft: 1.7 }, { t: "9p", ft: 1.5 }, { t: "11p", ft: 0.8 },
];

const TRENDS = [
  { id: 1, text: "Mullet concentrations appear to be moving south along the Treasure Coast.", basis: "Derived from 3 days of user-logged bait sightings (demo)", confidence: "Low sample size" },
  { id: 2, text: "Water clarity has improved noticeably at Fort Pierce Inlet over the last 24 hours.", basis: "Comparison of two mock clarity observations", confidence: "Medium" },
  { id: 3, text: "Blacktip activity trending higher at beaches with stained, wind-chopped water this week.", basis: "Pattern across 3 demo beach records", confidence: "Low sample size" },
];

const EVIDENCE_STYLE = {
  live: { label: "Live data", color: "#17D9C4" },
  historical: { label: "Historical pattern", color: "#8AA6B8" },
  report: { label: "Fishing report", color: "#F5A623" },
  user: { label: "Your observation", color: "#3E8FFF" },
  social: { label: "Social observation", color: "#FF5D5D" },
};

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

function DemoBadge({ small }) {
  return (
    <span style={{
      background: "#3A1F14", color: "#FFB37A", border: "1px solid #6B3B1E",
      borderRadius: 4, padding: small ? "1px 6px" : "3px 9px", fontSize: small ? 9.5 : 11,
      fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.6, whiteSpace: "nowrap",
    }}>
      DEMO DATA
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
      LIVE \u00b7 NOAA CO-OPS
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
function useLiveSpeciesScores(beachId, active) {
  const isLive = active && !!NOAA_STATIONS[beachId];
  const hasBuoy = active && !!NDBC_STATIONS[beachId];

  const [noaaState, setNoaaState] = useState({ loading: isLive, bundle: null, fatalError: null });
  const [buoyState, setBuoyState] = useState({ loading: hasBuoy, buoy: null, fatalError: null });

  const loadNoaa = useCallback(() => {
    if (!isLive) { setNoaaState({ loading: false, bundle: null, fatalError: null }); return; }
    setNoaaState({ loading: true, bundle: null, fatalError: null });
    fetchNoaaBundleForBeach(beachId)
      .then((bundle) => setNoaaState({ loading: false, bundle, fatalError: null }))
      .catch((err) => setNoaaState({ loading: false, bundle: null, fatalError: err.message }));
  }, [beachId, isLive]);

  const loadBuoy = useCallback(() => {
    if (!hasBuoy) { setBuoyState({ loading: false, buoy: null, fatalError: null }); return; }
    setBuoyState({ loading: true, buoy: null, fatalError: null });
    fetchLatestBuoy(NDBC_STATIONS[beachId].stationId)
      .then((buoy) => setBuoyState({ loading: false, buoy, fatalError: null }))
      .catch((err) => setBuoyState({ loading: false, buoy: null, fatalError: err.message }));
  }, [beachId, hasBuoy]);

  useEffect(() => { loadNoaa(); }, [loadNoaa]);
  useEffect(() => { loadBuoy(); }, [loadBuoy]);

  const tideStage = (isLive && noaaState.bundle?.hilo?.ok)
    ? computeTideStage(noaaState.bundle.hilo.data, new Date())
    : null;
  const moonFactor = isLive ? scoreMoonFactor(computeMoonPhase(new Date())) : null;
  const buoyFactor = buoyState.buoy ? scoreBuoyFactor(buoyState.buoy) : null;

  const liveResults = {}; // speciesId -> { score, factors, tideStage }
  if (tideStage) {
    for (const [sid, modelFn] of Object.entries(TIDE_MODELS)) {
      const result = modelFn(tideStage, moonFactor, buoyFactor);
      if (result) liveResults[sid] = result;
    }
  }

  return {
    isLive, hasBuoy, noaaState, buoyState, tideStage, moonFactor, buoyFactor,
    liveResults, loadNoaa, loadBuoy,
    loading: isLive && (noaaState.loading || buoyState.loading),
  };
}

function BeachRadarCard({ beach, mode, onSelectBeach }) {
  const { isLive, liveResults, loading } = useLiveSpeciesScores(beach.id, mode === "live");

  const liveEntries = Object.entries(liveResults);
  const liveOverall = liveEntries.length > 0
    ? Math.round(liveEntries.reduce((sum, [, r]) => sum + r.score, 0) / liveEntries.length)
    : null;

  const topSpecies = liveEntries.length > 0
    ? liveEntries.sort((a, b) => b[1].score - a[1].score).slice(0, 3).map(([sid, r]) => [sid, r.score])
    : Object.entries(beach.species).sort((x, y) => y[1] - x[1]).slice(0, 3);

  return (
    <button
      onClick={() => onSelectBeach(beach.id)}
      style={{
        width: "100%", textAlign: "left", background: "#0E1B26", border: "1px solid #1F3444",
        borderRadius: 10, padding: "12px 14px", marginBottom: 10, display: "flex",
        alignItems: "center", gap: 12, cursor: "pointer",
      }}
    >
      {isLive && loading ? (
        <div style={{ width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <RefreshCw size={16} color="#5A7A8A" style={{ animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
        </div>
      ) : (
        <ScoreRing score={liveOverall != null ? liveOverall : beach.overall} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#E7EFF3", fontSize: 15, fontWeight: 600 }}>
          {beach.name} {isLive && liveOverall != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>\u25cf LIVE</span>}
        </div>
        <div style={{ color: "#5A7A8A", fontSize: 11.5, marginBottom: 6 }}>{beach.zone}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {isLive && loading ? (
            <span style={{ fontSize: 10.5, color: "#4A6270" }}>Loading live scores\u2026</span>
          ) : (
            topSpecies.map(([sid, sc]) => {
              const sp = SPECIES.find((s) => s.id === sid);
              return (
                <span key={sid} style={{
                  fontSize: 10.5, color: scoreColor(sc), border: `1px solid ${scoreColor(sc)}55`,
                  borderRadius: 4, padding: "1px 6px",
                }}>
                  {sp.name} {sc}
                </span>
              );
            })
          )}
        </div>
      </div>
      <ChevronDown size={16} color="#3E5566" style={{ transform: "rotate(-90deg)" }} />
    </button>
  );
}

function RadarScreen({ onSelectBeach, mode }) {
  const sorted = [...BEACHES].sort((a, b) => b.overall - a.overall);
  return (
    <div style={{ padding: "12px 14px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
          JACKSONVILLE \u2192 MIAMI \u2014 RANKED NOW
        </div>
        {mode === "live" ? <LiveBadge small /> : <DemoBadge small />}
      </div>
      <div style={{ color: "#4A6270", fontSize: 11, marginBottom: 14 }}>
        {mode === "live"
          ? "Order reflects demo baseline; badges and ring show live tide/moon/buoy scores where a beach has a mapped station."
          : "Sample data for prototyping only. No live buoys or tide feeds connected yet."}
      </div>
      {sorted.map((b) => (
        <BeachRadarCard key={b.id} beach={b} mode={mode} onSelectBeach={onSelectBeach} />
      ))}

      <div style={{ marginTop: 22, color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 10 }}>
        DETECTED TRENDS <span style={{ color: "#4A6270" }}>(demo)</span>
      </div>
      {TRENDS.map((t) => (
        <div key={t.id} style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <TrendingUp size={14} color="#17D9C4" style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ color: "#DCE8EE", fontSize: 13 }}>{t.text}</div>
              <div style={{ color: "#4A6270", fontSize: 10.5, marginTop: 4 }}>{t.basis} \u00b7 {t.confidence}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

}

function NoaaTideDisplay({ loading, bundle, fatalError, onRetry }) {
  if (loading) {
    return (
      <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 16, marginBottom: 16, textAlign: "center" }}>
        <RefreshCw size={16} color="#5A7A8A" style={{ animation: "spin 1s linear infinite" }} />
        <div style={{ color: "#5A7A8A", fontSize: 12, marginTop: 6 }}>Requesting live data from NOAA CO-OPS\u2026</div>
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
          NOAA CO-OPS \u00b7 Station {stationId}
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
            Observed {liveLevel.data.observedAt} local \u00b7 {freshnessLabel(liveLevel.data.observedAt, now)}
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
              <div style={{ color: "#DCE8EE", fontSize: 13 }}>{p.observedAt.slice(11, 16)} \u00b7 {p.value.toFixed(2)} {p.unit}</div>
            </div>
          ))}
        </div>
      ) : (
        <DataUnavailable message={`High/low predictions: ${hilo.error}`} />
      )}

      <div style={{ color: "#4A6270", fontSize: 10, marginTop: 8, lineHeight: 1.4 }}>
        Predictions are harmonic calculations, always available regardless of sensor status. The observed water level above comes from the station's live sensor and can itself go DATA UNAVAILABLE during an outage \u2014 predictions are never used to paper over that.
      </div>
    </div>
  );
}

function BeachDetailScreen({ beach, onBack, tab, setTab, mode }) {
  const {
    isLive, hasBuoy, noaaState, buoyState, tideStage, moonFactor, buoyFactor,
    liveResults, loadNoaa, loadBuoy,
  } = useLiveSpeciesScores(beach.id, mode === "live");

  const livePompano = liveResults.pompano || null; // kept for the tide box above

  const displaySpecies = { ...beach.species };
  const liveSpeciesIds = [];
  for (const [sid, result] of Object.entries(liveResults)) {
    displaySpecies[sid] = result.score;
    liveSpeciesIds.push(sid);
  }
  const speciesSorted = Object.entries(displaySpecies).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 4px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", padding: 4, cursor: "pointer" }}>
          <ChevronLeft size={20} color="#DCE8EE" />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#E7EFF3", fontSize: 17, fontWeight: 600 }}>{beach.name}</div>
          <div style={{ color: "#5A7A8A", fontSize: 11.5 }}>{beach.zone} \u00b7 {beach.coast}</div>
        </div>
        <ScoreRing score={beach.overall} size={48} />
      </div>

      <div style={{ display: "flex", gap: 8, padding: "10px 14px", alignItems: "center", flexWrap: "wrap" }}>
        <ConfidenceBadge level={beach.confidence} />
        {isLive ? <LiveBadge small /> : <DemoBadge small />}
        <span style={{ color: "#4A6270", fontSize: 11 }}>{isLive ? "Tide data below is live \u2014 rest of this screen is still demo" : beach.freshness}</span>
      </div>

      <div style={{ padding: "0 14px 6px", display: "flex", gap: 6 }}>
        {["overview", "evidence"].map((k) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #1F3444",
            background: tab === k ? "#142633" : "transparent", color: tab === k ? "#17D9C4" : "#7590A0",
            fontSize: 12.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, cursor: "pointer",
          }}>
            {k === "overview" ? "OVERVIEW" : "EVIDENCE"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div style={{ padding: "8px 14px" }}>
          <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 6 }}>
              {isLive ? "TIDE RIGHT NOW (live)" : "BEST BITE WINDOW"}
            </div>
            {isLive ? (
              tideStage ? (
                <>
                  <div style={{ color: "#E7EFF3", fontSize: 20, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", textTransform: "capitalize" }}>
                    {tideStage.direction}, {Math.round(tideStage.flowStrength * 100)}% flow
                  </div>
                  <div style={{ color: "#5A7A8A", fontSize: 12, marginTop: 2 }}>
                    Next {tideStage.next.tideType === "H" ? "high" : "low"} at {tideStage.next.observedAt.slice(11, 16)} \u00b7 {tideStage.next.value.toFixed(2)} ft
                  </div>
                </>
              ) : (
                <div style={{ color: "#5A7A8A", fontSize: 14 }}>
                  {noaaState.loading ? "Loading live tide status\u2026" : "Live tide status unavailable \u2014 see below"}
                </div>
              )
            ) : (
              <>
                <div style={{ color: "#E7EFF3", fontSize: 20, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>{beach.bestWindow}</div>
                <div style={{ color: "#5A7A8A", fontSize: 12, marginTop: 2 }}>{beach.tideWindow}</div>
              </>
            )}
          </div>

          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
            SPECIES PROBABILITY {liveSpeciesIds.length > 0 && <span style={{ color: "#17D9C4" }}>({liveSpeciesIds.length} live)</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            {speciesSorted.map(([sid, sc]) => {
              const sp = SPECIES.find((s) => s.id === sid);
              const isLiveScore = liveSpeciesIds.includes(sid);
              return (
                <div key={sid} style={{ background: "#0E1B26", border: isLiveScore ? "1px solid #17D9C455" : "1px solid #1F3444", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>
                      {sp.name} {isLiveScore && <span style={{ color: "#17D9C4", fontSize: 9 }}>\u25cf LIVE</span>}
                    </span>
                    <span style={{ color: scoreColor(sc), fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{sc}</span>
                  </div>
                  <div style={{ background: "#16232E", height: 4, borderRadius: 2, marginTop: 6 }}>
                    <div style={{ background: scoreColor(sc), width: `${sc}%`, height: 4, borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
          </div>
          {liveSpeciesIds.length > 0 && (
            <div style={{ color: "#4A6270", fontSize: 10.5, marginTop: -10, marginBottom: 16, lineHeight: 1.4 }}>
              Live scores are computed from tide dynamics only \u2014 water clarity, calm/chop, and bait presence all matter in practice but aren't wired in yet (no live wave/wind or bait-tracking source). These are honest partial scores, not full predictions.
            </div>
          )}


          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
            TIDE, TODAY {isLive ? <span style={{ color: "#17D9C4" }}>(live \u2014 NOAA CO-OPS)</span> : <span style={{ color: "#4A6270" }}>(demo curve)</span>}
          </div>
          {isLive ? (
            <NoaaTideDisplay loading={noaaState.loading} bundle={noaaState.bundle} fatalError={noaaState.fatalError} onRetry={loadNoaa} />
          ) : (
            <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 4px 4px", marginBottom: 16, height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={TIDE_CURVE} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#17D9C4" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#17D9C4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" tick={{ fill: "#4A6270", fontSize: 9 }} axisLine={{ stroke: "#1F3444" }} tickLine={false} />
                  <YAxis hide domain={["dataMin - 0.3", "dataMax + 0.3"]} />
                  <ReferenceLine y={0} stroke="#2B3F4D" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="ft" stroke="#17D9C4" strokeWidth={2} fill="url(#tideFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
            CURRENT CONDITIONS {isLive && <span style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif" }}>(moon + buoy live where available, rest demo)</span>}
          </div>
          <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "2px 12px", marginBottom: isLive ? 4 : 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
              <Wind size={14} color={buoyState.buoy?.windSpeedKt != null ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Wind {buoyState.buoy?.windSpeedKt != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>\u25cf LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {buoyState.buoy?.windSpeedKt != null
                  ? `${Math.round(buoyState.buoy.windSpeedKt)} kt${buoyState.buoy.windDirDeg != null ? ` @ ${Math.round(buoyState.buoy.windDirDeg)}\u00b0` : ""}`
                  : beach.conditions.wind}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
              <Waves size={14} color={buoyState.buoy?.waveHeightFt != null ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Swell (offshore) {buoyState.buoy?.waveHeightFt != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>\u25cf LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {buoyState.buoy?.waveHeightFt != null
                  ? `${buoyState.buoy.waveHeightFt.toFixed(1)} ft${buoyState.buoy.dominantWavePeriodS != null ? ` @ ${buoyState.buoy.dominantWavePeriodS}s` : ""}`
                  : beach.conditions.swell}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
              <Thermometer size={14} color={buoyState.buoy?.waterTempF != null ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Water temp {buoyState.buoy?.waterTempF != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>\u25cf LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {buoyState.buoy?.waterTempF != null ? `${Math.round(buoyState.buoy.waterTempF)}\u00b0F` : beach.conditions.waterTemp}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #16232E" }}>
              <Info size={14} color={buoyState.buoy?.pressureHpa != null ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Pressure {buoyState.buoy?.pressureHpa != null && <span style={{ color: "#17D9C4", fontSize: 9 }}>\u25cf LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {buoyState.buoy?.pressureHpa != null
                  ? `${buoyState.buoy.pressureHpa.toFixed(1)} hPa${buoyState.buoy.pressureTendencyHpa != null ? ` (${buoyState.buoy.pressureTendencyHpa >= 0 ? "+" : ""}${buoyState.buoy.pressureTendencyHpa.toFixed(1)}/3hr)` : ""}`
                  : "Not connected yet"}
              </span>
            </div>
            <ConditionRow icon={Eye} label="Clarity" value={beach.conditions.clarity} />
            <ConditionRow icon={Droplets} label="Tide" value={beach.conditions.tide} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0" }}>
              <Moon size={14} color={isLive && moonFactor ? "#17D9C4" : "#5A7A8A"} />
              <span style={{ color: "#7590A0", fontSize: 12.5, flex: 1 }}>
                Moon {isLive && moonFactor && <span style={{ color: "#17D9C4", fontSize: 9 }}>\u25cf LIVE</span>}
              </span>
              <span style={{ color: "#DCE8EE", fontSize: 12.5, fontWeight: 500 }}>
                {isLive && moonFactor
                  ? `${moonFactor.moonPhase.name} (${Math.round(moonFactor.moonPhase.illumination * 100)}% illum.)`
                  : beach.conditions.moon}
              </span>
            </div>
          </div>
          {isLive && (
            <div style={{ color: "#4A6270", fontSize: 10, marginBottom: 16, lineHeight: 1.4 }}>
              {hasBuoy
                ? buoyState.loading
                  ? "Requesting live buoy data from NDBC\u2026"
                  : buoyState.fatalError
                    ? `Buoy data unavailable: ${buoyState.fatalError}`
                    : `Wind/swell/pressure from NDBC buoy ${NDBC_STATIONS[beach.id].stationId} (${NDBC_STATIONS[beach.id].stationName}) \u2014 an offshore reading, not measured at the beach itself. Water clarity and bait presence still aren't connected.`
                : "No NDBC buoy mapped to this beach yet."}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1, background: "#0E1B26", border: "1px solid #17D9C455", borderRadius: 10, padding: 12 }}>
              <div style={{ color: "#17D9C4", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 6 }}>SUPPORTING</div>
              {beach.factorsFor.map((f, i) => (
                <div key={i} style={{ color: "#B7CBD6", fontSize: 12, marginBottom: 5, lineHeight: 1.4 }}>+ {f}</div>
              ))}
            </div>
            <div style={{ flex: 1, background: "#0E1B26", border: "1px solid #FF5D5D55", borderRadius: 10, padding: 12 }}>
              <div style={{ color: "#FF5D5D", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 6 }}>HURTING</div>
              {beach.factorsAgainst.map((f, i) => (
                <div key={i} style={{ color: "#B7CBD6", fontSize: 12, marginBottom: 5, lineHeight: 1.4 }}>\u2013 {f}</div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "8px 14px" }}>
          {Object.entries(liveResults).map(([sid, result]) => {
            const sp = SPECIES.find((s) => s.id === sid);
            return (
              <div key={sid} style={{ background: "#0E1B26", border: "1px solid #17D9C4", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ color: "#17D9C4", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>
                    LIVE MODEL \u00b7 {sp.name.toUpperCase()}
                  </span>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}>just now</span>
                </div>
                <div style={{ color: "#DCE8EE", fontSize: 13, marginBottom: 6 }}>
                  Computed score: {result.score}/100
                </div>
                {result.factors.map((f, i) => (
                  <div key={i} style={{ color: "#8AA6B8", fontSize: 12, marginBottom: 3 }}>
                    {f.delta >= 0 ? "+" : ""}{f.delta} \u2014 {f.label}
                  </div>
                ))}
              </div>
            );
          })}
          {liveSpeciesIds.length > 0 && (
            <div style={{ color: "#4A6270", fontSize: 10.5, marginBottom: 10, lineHeight: 1.4 }}>
              All live scores are built from tide, moon, and (where the buoy reaches) wave/pressure. Water clarity and bait presence are still not connected.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#1A1408", border: "1px solid #6B3B1E", borderRadius: 10, padding: 10, marginBottom: 14 }}>
            <AlertTriangle size={14} color="#FFB37A" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ color: "#E0C6A8", fontSize: 11.5, lineHeight: 1.4 }}>
              {liveSpeciesIds.length > 0
                ? "Everything below is still fabricated demo evidence \u2014 only the live model cards above are real, computed scores."
                : "All items below are fabricated demo evidence for UI prototyping \u2014 no real buoys, reports, or user logs are wired in yet."}
            </div>
          </div>
          {beach.evidence.map((e, i) => {
            const style = EVIDENCE_STYLE[e.type];
            return (
              <div key={i} style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ color: style.color, fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>
                    {style.label.toUpperCase()}
                  </span>
                  <span style={{ color: "#4A6270", fontSize: 10.5 }}>{e.time}</span>
                </div>
                <div style={{ color: "#DCE8EE", fontSize: 13, marginBottom: 3 }}>{e.label}</div>
                <div style={{ color: "#8AA6B8", fontSize: 12, marginBottom: 8 }}>{e.detail}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#4A6270", fontSize: 10.5, flexShrink: 0 }}>Reliability</span>
                  <div style={{ background: "#16232E", height: 4, borderRadius: 2, flex: 1 }}>
                    <div style={{ background: style.color, width: `${e.reliability}%`, height: 4, borderRadius: 2 }} />
                  </div>
                  <span style={{ color: "#DCE8EE", fontSize: 10.5, width: 24, textAlign: "right" }}>{e.reliability}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SpeciesScreen({ selectedSpecies, setSelectedSpecies, onSelectBeach }) {
  const ranked = [...BEACHES].sort((a, b) => b.species[selectedSpecies] - a.species[selectedSpecies]);
  return (
    <div style={{ padding: "12px 14px 90px" }}>
      <div style={{ color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 10 }}>
        RANK BEACHES BY SPECIES
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
      {ranked.map((b, i) => (
        <button key={b.id} onClick={() => onSelectBeach(b.id)} style={{
          width: "100%", textAlign: "left", background: "#0E1B26", border: "1px solid #1F3444",
          borderRadius: 10, padding: "12px 14px", marginBottom: 10, display: "flex",
          alignItems: "center", gap: 12, cursor: "pointer",
        }}>
          <div style={{ color: "#4A6270", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", width: 18 }}>{i + 1}</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#E7EFF3", fontSize: 14.5, fontWeight: 600 }}>{b.name}</div>
            <div style={{ color: "#5A7A8A", fontSize: 11 }}>{b.zone}</div>
          </div>
          <div style={{ color: scoreColor(b.species[selectedSpecies]), fontSize: 22, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
            {b.species[selectedSpecies]}
          </div>
        </button>
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
    // permissive CORS headers \u2014 if this fails, the problem is the
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
        {test.status === "ok" && <span style={{ color: "#17D9C4" }}>\u2713</span>}
        {test.status === "fail" && <span style={{ color: "#FF5D5D" }}>\u2715</span>}
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
        If the first row fails too, this Artifact sandbox can't reach external domains at all \u2014 that's a platform limit, not a Worker problem. If only the second row fails, the Worker itself needs attention.
      </div>
    </div>
  );
}

function ArchitectureScreen() {
  const rows = [
    ["beaches / beach_zones", "Location hierarchy \u2014 name, coordinates, structure type"],
    ["species", "One row per target species; holds per-species model weights"],
    ["environmental_observations", "Wind, swell, tide, temp, clarity \u2014 tagged by source + time"],
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
        Not connected to any live source yet. This is the schema the prototype's mock data is shaped to match, so wiring in real feeds later doesn't require restructuring the app.
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
          NOAA/NDBC buoy data, NOAA CO-OPS tides, a marine weather API, and a source for mullet/baitfish activity (likely starts as manual logging). Social-media ingestion needs a per-platform ToS review before anything is built there.
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
  const [mode, setMode] = useState("demo"); // "demo" | "live"

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
          <div style={{ fontSize: 10.5, color: "#4A6270" }}>Jacksonville \u2192 Miami prototype</div>
        </div>
        <button
          onClick={() => setMode(mode === "demo" ? "live" : "demo")}
          style={{
            display: "flex", alignItems: "center", gap: 6, background: "#0E1B26", border: "1px solid #1F3444",
            borderRadius: 20, padding: "4px 10px 4px 4px", cursor: "pointer",
          }}
        >
          <span style={{
            width: 30, height: 16, borderRadius: 9, background: mode === "live" ? "#0F2B28" : "#16232E",
            position: "relative", flexShrink: 0,
          }}>
            <span style={{
              position: "absolute", top: 2, left: mode === "live" ? 16 : 2, width: 12, height: 12, borderRadius: "50%",
              background: mode === "live" ? "#17D9C4" : "#5A7A8A", transition: "left 0.15s",
            }} />
          </span>
          <span style={{
            fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4,
            color: mode === "live" ? "#17D9C4" : "#7590A0",
          }}>
            {mode === "live" ? "LIVE" : "DEMO"}
          </span>
        </button>
      </div>

      {screen === "radar" && <RadarScreen onSelectBeach={openBeach} mode={mode} />}
      {screen === "beachDetail" && selectedBeach && (
        <BeachDetailScreen beach={selectedBeach} onBack={() => setScreen("radar")} tab={detailTab} setTab={setDetailTab} mode={mode} />
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
