import React, { useState, useMemo, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from "recharts";
import { ChevronLeft, ChevronDown, Waves, Moon, Wind, Thermometer, Eye, Fish, AlertTriangle, TrendingUp, Info, RefreshCw, WifiOff } from "lucide-react";
// Priority 15 Stage 1 — the pure prediction/model chain (scoreSpecies and
// everything under it) plus the predictAsOfTimestamp orchestration function
// now live in shared-model.js, the same file the Cloudflare Worker will
// eventually import too (Stage 2+). Nothing in this import list was
// rewritten during the move — verified byte-for-byte against the pre-move
// app via the regression suite (see Priority 15 Stage 1 report).
import {
  MODEL_VERSION, SPECIES_RULES, TEMP_CURVE_POINTS, SEASONAL_MULT, GEAR_RANGE_SCALE, BAIT_TYPES,
  BAIT_TYPE_AFFINITY, ACCESS_DISTANCE_CURVE, ZONE_NAMES, ZONE_DISTANCES_YD, CONCENTRATION_MULTIPLIER,
  SYNODIC_MONTH_DAYS, BEACH_SEAWARD_NORMAL, NOAA_STATIONS, NDBC_STATIONS, METAR_STATIONS,
  MODEL_IMPLEMENTATION_FINGERPRINT,
  dateToCompact, pickLatestAvailableRow, scoreBuoyFactor, estimateWaterClarity, normalizeObservations,
  normalizeNoaaTideRows, convertNdbcRowToImperial,
  computeTideStage, tempSuitability, computePresence, waveSubscore, windSubscore, computeFeedingCeiling,
  computeFeeding, effectivePresence, gearScaleFor, accessDistanceScore, averageAccessDistanceScore,
  accessWindPenalty, accessCurrentPenalty, computeAccess, computeFinalActivity, computeSpeciesConfidence,
  buildSpeciesFactors, inferBaitActivity, baitTypeAffinity, forageFreshnessTier, forageFreshnessMultiplier,
  derivePresenceState, deriveConcentrationState, presenceConfidence, resolveForageEvidence,
  buildEnhancedBaitInfo, baseZoneFromSurf, predictFishPosition, computeIsNight, computeIsLowLight,
  computeSecondaryAdjustment, scoreSpecies, computeMoonPhase, scoreMoonFactor, computeSunTimes,
  parseIso8601DurationMs, findGridpointValueAt, convertForecastValue, resolveForecastInputs,
  classifyWindRelativeToShore, predictAsOfTimestamp,
} from "./shared-model.js";

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

async function fetchBuoyHistoryDay(stationId, dateCompactStr, { force = false } = {}) {
  return cachedFetch(`buoy-history:${stationId}:${dateCompactStr}`, async () => {
    const json = await fetchViaProxy("/buoy/history", stationId, { date: dateCompactStr });
    return (json.rows || []).map(convertNdbcRowToImperial); // Priority 15 Stage 2 — now the shared helper, not an inline duplicate
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
    const rows = normalizeNoaaTideRows(json.predictions); // Priority 15 Stage 2 — shared helper, not an inline duplicate
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
        envelope = await predictAsOfTimestamp(beach, sid, predictionTimestamp, browserDataAccess);
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
    BEACHES.map((beach) => predictAsOfTimestamp(beach, speciesId, predictionTimestamp, browserDataAccess))
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
    try { envelope = await predictAsOfTimestamp(beach, speciesId, ts, browserDataAccess); } catch { continue; }
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
    // Minimum-width display guard — a genuinely sharp, isolated peak can
    // legitimately fail the threshold test on both neighbors, collapsing
    // to a single sample. That's a real detection, but rendering it as an
    // exact-minute range (e.g. "5:04-5:04") reads as broken rather than
    // "narrow." Widen by one step on whichever side(s) remain in bounds —
    // this changes only the DISPLAYED range; the peak sample, its score,
    // and this window's quality/ranking are untouched.
    if (startIdx === endIdx) {
      if (startIdx > 0) startIdx--;
      if (endIdx < samples.length - 1) endIdx++;
    }
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

  // Maximum actionable width — a "best bite" should read as a real
  // recommendation, not "basically the whole day." On a genuinely flat
  // score curve, the adaptive threshold can legitimately widen (and
  // merge) a window across most of the sampled range — mathematically
  // correct, but useless as guidance. Cap at 4 hours, centered on the
  // actual peak (shifted toward whichever side has room if the peak sits
  // near an edge of the range), applied AFTER merge so two already-capped
  // windows can't silently re-combine into something large again. This
  // changes only which SAMPLES are included in the displayed window —
  // the peak sample, its score, and quality ranking are untouched.
  const maxWindowSteps = Math.max(1, Math.round(240 / stepMinutes)); // 4 hours
  for (const w of merged) {
    if (w.endIdx - w.startIdx > maxWindowSteps) {
      const half = Math.floor(maxWindowSteps / 2);
      let newStart = Math.max(0, w.peakIdx - half);
      let newEnd = Math.min(samples.length - 1, w.peakIdx + half);
      if (newEnd - newStart < maxWindowSteps) {
        if (newStart === 0) newEnd = Math.min(samples.length - 1, newStart + maxWindowSteps);
        else if (newEnd === samples.length - 1) newStart = Math.max(0, newEnd - maxWindowSteps);
      }
      w.startIdx = newStart;
      w.endIdx = newEnd;
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

// Priority 15 Stage 1 — the browser's implementation of the dataAccess
// interface shared-model.js's predictAsOfTimestamp now expects. These are
// the SAME five functions the app always used (unchanged bodies, still
// going through cachedFetch/fetchViaProxy/PROXY_BASE_URL exactly as
// before) — this object just packages them into the shape the shared,
// injectable orchestration function requires. The Worker's eventual
// implementation of this same interface (Stage 2, not built yet) will call
// its own in-process handler logic directly instead of doing a self-HTTP
// round trip through this same set of function names.
const browserDataAccess = {
  fetchTideHistoryDay, fetchBuoyHistoryDay, fetchWeatherHistoryDay, fetchForecastForBeach, fetchTripsList,
  fetchMarineForecastForBeach, fetchWindForecastForBeach,
};

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

// Priority 15.1 — MFWAM wave forecast (via Open-Meteo Marine API, routed
// through the Worker's own /marine/forecast). Mirrors fetchForecastForBeach
// exactly: same caching pattern, same null-on-no-beach guard.
async function fetchMarineForecastForBeach(beach, { force = false } = {}) {
  if (!beach) return null;
  return cachedFetch(`marine:${beach.id}`, async () => {
    return fetchViaProxy("/marine/forecast", null, { lat: beach.lat, lon: beach.lon });
  }, { force });
}

// Priority 15.2 — HRRR/GFS wind fallback (via Open-Meteo GFS/HRRR API,
// routed through the Worker's own /wind/forecast). Mirrors
// fetchMarineForecastForBeach exactly.
async function fetchWindForecastForBeach(beach, { force = false } = {}) {
  if (!beach) return null;
  return cachedFetch(`wind:${beach.id}`, async () => {
    return fetchViaProxy("/wind/forecast", null, { lat: beach.lat, lon: beach.lon });
  }, { force });
}

// NWS validTime is "2026-09-17T06:00:00+00:00/PT2H" — an ISO 8601 start
// time plus an ISO 8601 duration. Durations from this API are always some
// combination of days/hours/minutes (e.g. "PT2H", "P1DT6H") — no seconds,
// no invented sub-hour precision beyond what NWS itself reports.
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
  const [clarityState, setClarityState] = useState({ status: "idle", data: null, error: null });

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

  // Species-independent, so it's its own opt-in trigger rather than tied
  // to a species button — same reasoning as BEST BEACH RIGHT NOW above:
  // this is a 24-beach live check, so it's button-triggered, not run on
  // page load.
  const runClarityRanking = async () => {
    setClarityState({ status: "loading", data: null, error: null });
    try {
      const res = await rankBeachesByClarity(new Date());
      setClarityState({ status: "done", data: res, error: null });
    } catch (err) {
      setClarityState({ status: "error", data: null, error: err.message });
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

      {/* ============ CLEANEST WATER RIGHT NOW — species-independent,
          same button-triggered pattern as BEST BEACH above (24-beach
          live check, not auto-run on page load). ============ */}
      <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: clarityState.status === "idle" ? 0 : 8 }}>
          <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>
            CLEANEST WATER RIGHT NOW
          </div>
          {clarityState.status !== "loading" && (
            <button onClick={runClarityRanking} style={{ background: "none", border: "none", color: "#3E8FFF", fontSize: 11, cursor: "pointer", padding: 0 }}>
              {clarityState.status === "idle" ? "Check" : "Refresh"}
            </button>
          )}
        </div>
        {clarityState.status === "loading" && <div style={{ color: "#5A7A8A", fontSize: 12 }}>Checking all 24 beaches…</div>}
        {clarityState.status === "error" && <div style={{ color: "#FF5D5D", fontSize: 12 }}>Couldn't check: {clarityState.error}</div>}
        {clarityState.status === "done" && (() => {
          const { beaches, unavailableBeaches } = clarityState.data;
          if (beaches.length === 0) {
            return <div style={{ color: "#5A7A8A", fontSize: 12 }}>No clarity estimate available right now.</div>;
          }
          return (
            <div>
              {beaches.slice(0, 5).map((b, i) => (
                <button key={b.beachId} onClick={() => onSelectBeach(b.beachId)} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "7px 0",
                  borderBottom: i < Math.min(beaches.length, 5) - 1 ? "1px solid #16232E" : "none",
                  background: "none", border: "none", cursor: "pointer", textAlign: "left",
                }}>
                  <span style={{ color: "#4A6270", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", width: 14 }}>{i + 1}</span>
                  <span style={{ color: "#DCE8EE", fontSize: 13, flex: 1 }}>{b.beachName}</span>
                  <span style={{ color: i === 0 ? "#17D9C4" : "#8AA6B8", fontSize: 13, fontWeight: 600 }}>{b.clarityLabel}</span>
                </button>
              ))}
              {unavailableBeaches.length > 0 && (
                <div style={{ color: "#3E5566", fontSize: 10, marginTop: 8 }}>{unavailableBeaches.length} beach{unavailableBeaches.length !== 1 ? "es" : ""} skipped — no clarity estimate available right now.</div>
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
  // The REAL bug (found via the debug instrumentation): fmtWindowTime only
  // formats hour:minute, with no date. A window that genuinely spans close
  // to 24 hours (start index 0, end index 48 — the full sampled range) has
  // a start and end ~24h apart, which lands on the SAME clock time the
  // next day — "10:26 PM" both times, even though they're a full day
  // apart. The earlier "swap if out of order" version was actively wrong:
  // it would have silently relabeled a real ~23h window as if it were
  // tiny, hiding the problem instead of showing it. This is day-aware
  // instead, using the same date-comparison convention already
  // established in generateBestBeachHourOptions (Priority 14).
  const windowDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const fmtWindowRange = (start, end) => {
    const startLabel = fmtWindowTime(start);
    const endLabel = fmtWindowTime(end);
    const crossesDay = windowDateFmt.format(start) !== windowDateFmt.format(end);
    return crossesDay ? `${startLabel} – ${endLabel} (+1 day)` : `${startLabel}–${endLabel}`;
  };

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
        {["overview", "activity"].map((k) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #1F3444",
            background: tab === k ? "#142633" : "transparent", color: tab === k ? "#17D9C4" : "#7590A0",
            fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, cursor: "pointer",
          }}>
            {k === "overview" ? "FISHING PLAN" : "ACTIVITY"}
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
                {topSpeciesEntry && (
                  <div style={{ color: "#7590A0", fontSize: 11.5, marginTop: 2 }}>
                    Presence {topSpeciesEntry[1].presence ?? "—"} · Feeding {topSpeciesEntry[1].feeding ?? "—"} · Access {topSpeciesEntry[1].access ?? "—"}
                  </div>
                )}
                {bestBiteState.loading ? (
                  <div style={{ color: "#5A7A8A", fontSize: 12.5, marginTop: 2 }}>Finding best bite window…</div>
                ) : bestWindow ? (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ color: "#8AA6B8", fontSize: 10, letterSpacing: 0.4, fontFamily: "'Space Grotesk', sans-serif" }}>BEST BITE</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ color: "#E7EFF3", fontSize: 13.5, fontWeight: 600 }}>{fmtWindowRange(bestWindow.windowStart, bestWindow.windowEnd)}</span>
                      <span style={{ color: scoreColor(bestWindow.score), fontSize: 13.5, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{bestWindow.score}</span>
                    </div>
                    {bestWindow.whyLabels?.length > 0 && (
                      <div style={{ color: "#7590A0", fontSize: 11, marginTop: 1 }}>{bestWindow.whyLabels.join(" + ")}</div>
                    )}
                    {secondaryWindow && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ color: "#5A7A8A", fontSize: 10.5, letterSpacing: 0.4, fontFamily: "'Space Grotesk', sans-serif" }}>ALSO STRONG</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ color: "#B7CBD6", fontSize: 12 }}>{fmtWindowRange(secondaryWindow.windowStart, secondaryWindow.windowEnd)}</span>
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
                    <span style={{ color: usingFutureWindow ? "#8FE8DC" : "#5A7A8A", fontSize: 10, marginLeft: 6, fontWeight: 400 }}>
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
                    <div style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>TARGET</div>
                    <div style={{ color: "#DCE8EE", fontSize: 14, fontWeight: 600 }}>{SPECIES.find((s) => s.id === sid)?.name} — {result.score}</div>
                  </div>
                  <div>
                    <div style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>TIME</div>
                    <div style={{ color: "#DCE8EE", fontSize: 14, fontWeight: 600 }}>
                      {bestWindow ? fmtWindowRange(bestWindow.windowStart, bestWindow.windowEnd) : "Now"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>WHERE (est.)</div>
                    <div style={{ color: "#DCE8EE", fontSize: 14, fontWeight: 600 }}>{position ? `${position.primaryZone} · ${position.distanceYd[0]}–${position.distanceYd[1]} yd` : "—"}</div>
                  </div>
                  <div>
                    <div style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 2 }}>ACCESS</div>
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
                <div style={{ color: "#3E5566", fontSize: 10.5, marginTop: 8, lineHeight: 1.3 }}>
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
                      <div style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 5 }}>FORAGE</div>
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
                    <span style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>REGIONAL FORAGE EVIDENCE</span>
                    <div style={{ color: "#5A7A8A", fontSize: 11, marginTop: 4 }}>Checking regional reports…</div>
                  </div>
                ) : regionalForageState.error ? (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #2A3F4E" }}>
                    <span style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>REGIONAL FORAGE EVIDENCE</span>
                    <div style={{ color: "#5A7A8A", fontSize: 11, marginTop: 4 }}>Regional forage reports temporarily unavailable.</div>
                  </div>
                ) : regionalForageState.data?.supported ? (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #2A3F4E" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                      <span style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>REGIONAL FORAGE EVIDENCE</span>
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
                            <div style={{ color: "#4A6270", fontSize: 10.5, marginTop: 2 }}>
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
                    <span style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>REGIONAL FORAGE EVIDENCE</span>
                    <div style={{ color: "#5A7A8A", fontSize: 11, marginTop: 4 }}>Regional forage-report coverage not available yet.</div>
                  </div>
                ) : null}

              </div>
            );
          })()}

          {/* ============ SPECIES — merged canonical breakdown (was two
              separate lists: "Top Targets" here and "Species Scores, Why
              They Differ" on a since-removed Evidence tab). One ranked
              list, every live species, collapsed to score + top factors;
              tap any row for the full delta-sorted breakdown plus
              position/casting-distance — the "Why This Score" deep-dive
              for whichever species you're looking at. ============ */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: "#7590A0", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 8 }}>
              SPECIES <span style={{ color: "#4A6270", fontSize: 10, fontWeight: 400 }}>(tap for full breakdown)</span>
            </div>
            {liveEntries.length === 0 ? (
              <div style={{ color: "#5A7A8A", fontSize: 12.5 }}>No live tide data right now — see Conditions below.</div>
            ) : (
              liveEntries
                .sort((a, b) => b[1].score - a[1].score)
                .map(([sid, result], i) => {
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
                        background: isOpen ? "#0E1B26" : "transparent", border: `1px solid ${isOpen ? "#17D9C4" : "transparent"}`,
                        borderBottom: isOpen ? undefined : "1px solid #16232E",
                        borderRadius: isOpen ? 10 : 0, padding: isOpen ? "10px 12px" : "8px 2px", marginBottom: isOpen ? 8 : 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ color: "#4A6270", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", width: 12, flexShrink: 0 }}>{i + 1}</span>
                        <span style={{ color: "#DCE8EE", fontSize: 13, fontWeight: 600, flex: 1 }}>{sp.name}</span>
                        <span style={{ color: scoreColor(result.score), fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{result.score}</span>
                      </div>

                      {!isOpen ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4, paddingLeft: 22 }}>
                          {result.factors.map((f, fi) => (
                            <span key={fi} style={{
                              fontSize: 10.5, color: f.delta >= 0 ? "#17D9C4" : "#FF8A8A",
                              border: `1px solid ${f.delta >= 0 ? "#17D9C4" : "#FF5D5D"}40`, borderRadius: 4, padding: "1px 6px",
                            }}>
                              {f.shortLabel || f.label} {f.delta >= 0 ? "+" : ""}{f.delta}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ color: "#8AA6B8", fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
                            {sp.name} landed at {result.score} mainly because of {topFactor.shortLabel.toLowerCase()} ({topFactor.delta >= 0 ? "+" : ""}{topFactor.delta}) — here's the full breakdown, biggest driver first:
                          </div>
                          {sortedFactors.map((f, fi) => (
                            <div key={fi} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
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
                                  <div style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>POSITION</div>
                                  <div style={{ color: "#DCE8EE", fontSize: 12 }}>{pos.primaryZone}</div>
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ color: "#4A6270", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>CAST</div>
                                  <div style={{ color: "#DCE8EE", fontSize: 12 }}>{pos.distanceYd[0]}–{pos.distanceYd[1]} yd</div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </button>
                  );
                })
            )}
            <div style={{ color: "#3E5566", fontSize: 10, marginTop: 8, lineHeight: 1.4 }}>
              Every species starts from the same live inputs, weighted differently per species by real behavior (e.g. sharks barely react to water clarity; whiting barely react to bait presence). Position and casting distance are inferred from surf height + tide, not measured structure.
            </div>
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

                <div style={{ color: "#3E5566", fontSize: 10.5, marginTop: 10, lineHeight: 1.4 }}>
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
                        <div style={{ color: "#17D9C4", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 4 }}>HELPING</div>
                        {helping.map((f, i) => <div key={i} style={{ color: "#B7CBD6", fontSize: 11.5, lineHeight: 1.5 }}>• {f.label}</div>)}
                      </div>
                    )}
                    {hurting.length > 0 && (
                      <div>
                        <div style={{ color: "#FF8A8A", fontSize: 10.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4, marginBottom: 4 }}>HURTING</div>
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
                                color: o[field] ? "#F5A623" : "#5A7A8A", fontSize: 10.5, textTransform: "capitalize",
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
                                color: o[field] ? "#F5A623" : "#5A7A8A", fontSize: 10.5, textTransform: "capitalize",
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

// ===========================================================================
// PRIORITY 14 reliability pass — data coverage & comparison quality.
// Pure, deterministic functions derived ONLY from fields predictAsOfTimestamp
// already returns (sourceMeta, environmentalInputs) — never touches
// scoreSpecies, never affects finalScore or ranking order. A missing field
// always reads as false/unavailable; nothing here ever infers or fabricates
// availability. Verified against constructed test envelopes (see report).
// ===========================================================================
function computeDataCoverage(envelope) {
  const ei = envelope.environmentalInputs || {};
  const sm = envelope.sourceMeta || {};
  return {
    tide: sm.tide !== "unavailable",
    wind: ei.windKt != null,
    waves: ei.waveFt != null,
    wavePeriod: ei.wavePeriodS != null,
    precip: sm.precip !== "unavailable",
    clarity: ei.clarityScore != null,
    waterTemp: ei.waterTempF != null, // tracked but never counted toward quality below — expected-missing on future predictions, must not by itself disqualify
    bait: ei.baitTier || "unknown",
  };
}
function computeComparisonQuality(coverage) {
  // Deliberately excludes waterTemp (expected-missing) and bait (always
  // resolves to at least a seasonal estimate, never truly "unavailable")
  // from the objective count — only fields that can genuinely be missing
  // and materially change what the model had to work with.
  const fields = [coverage.tide, coverage.wind, coverage.waves, coverage.wavePeriod, coverage.precip, coverage.clarity];
  const n = fields.filter(Boolean).length;
  if (n >= 6) return "strong";
  if (n >= 4) return "partial";
  return "weak";
}
const COMPARISON_QUALITY_RANK = { strong: 2, partial: 1, weak: 0 };

// ===========================================================================
// PRIORITY 14 — BEST BEACH RANKING. Loops the EXISTING predictAsOfTimestamp
// engine (unchanged) across every beach for one fixed species+timestamp.
// This function never computes a score itself — it only calls the same
// function every other prediction surface in the app already uses, so
// ranking output is structurally guaranteed identical to what the beach
// detail / heat-window views would show for that same beach/species/moment.
// Zero scoring-model changes; this is purely a new way of calling the
// existing engine.
// ===========================================================================
async function rankBeachesForTime(speciesId, predictionTimestamp) {
  const settled = await Promise.all(BEACHES.map(async (beach) => {
    let envelope;
    try { envelope = await predictAsOfTimestamp(beach, speciesId, predictionTimestamp, browserDataAccess); }
    catch { return { beach, available: false, reason: "Prediction failed for this beach/time." }; }
    if (!envelope.result) return { beach, available: false, reason: "Insufficient data (e.g. no tide coverage) at this time." }; // never fabricate a score — matches predictAsOfTimestamp's own contract
    return { beach, available: true, envelope };
  }));

  const beaches = settled.filter((r) => r.available)
    .sort((a, b) => b.envelope.result.scoreRaw - a.envelope.result.scoreRaw) // scoreRaw, not rounded — same precision rankFutureSpeciesWindows already uses, avoids manufacturing ties
    .map((r) => {
      const dataCoverage = computeDataCoverage(r.envelope);
      return {
        beachId: r.beach.id, beachName: r.beach.name,
        finalScore: r.envelope.result.score, finalScoreRaw: r.envelope.result.scoreRaw,
        presence: r.envelope.result.presence, feeding: r.envelope.result.feeding, access: r.envelope.result.access,
        confidence: r.envelope.result.confidence, environmentalInputs: r.envelope.environmentalInputs,
        isFuture: r.envelope.isFuture, sourceMeta: r.envelope.sourceMeta,
        dataCoverage, comparisonQuality: computeComparisonQuality(dataCoverage),
        result: r.envelope.result, beach: r.beach,
      };
    });
  const unavailableBeaches = settled.filter((r) => !r.available)
    .map((r) => ({ beachId: r.beach.id, beachName: r.beach.name, reason: r.reason }));

  return { speciesId, predictionTimestamp, beaches, bestBeach: beaches[0] || null, unavailableBeaches };
}

// "Cleanest water" ranking — every beach sorted by estimated water clarity
// at a given time. Clarity doesn't depend on species at all, but the
// underlying environmental resolution (tide/buoy/forecast fetching, the
// MFWAM fallback, everything) is the SAME work predictAsOfTimestamp
// already does for any species call — this reuses rankBeachesForTime with
// a fixed anchor species (its own score is discarded, never shown) rather
// than re-deriving that whole environmental pipeline a second time.
// Species choice can't change which beaches appear here: scoreSpecies
// only returns null (excluding a beach) when tide data is unavailable,
// never for a species-specific reason, so any anchor species produces the
// same beach set.
async function rankBeachesByClarity(predictionTimestamp) {
  const anchor = await rankBeachesForTime("snook", predictionTimestamp);
  const withClarity = anchor.beaches.filter((b) => b.environmentalInputs?.clarityScore != null);
  const withoutClarity = anchor.beaches.filter((b) => b.environmentalInputs?.clarityScore == null);
  const ranked = [...withClarity].sort((a, b) => b.environmentalInputs.clarityScore - a.environmentalInputs.clarityScore);
  return {
    predictionTimestamp,
    beaches: ranked.map((b) => ({
      beachId: b.beachId, beachName: b.beachName,
      clarityScore: b.environmentalInputs.clarityScore, clarityLabel: b.environmentalInputs.clarityLabel,
      isFuture: b.isFuture, sourceMeta: b.sourceMeta,
    })),
    unavailableBeaches: [
      ...anchor.unavailableBeaches,
      ...withoutClarity.map((b) => ({ beachId: b.beachId, beachName: b.beachName, reason: "Clarity estimate unavailable at this time." })),
    ],
  };
}

// Deterministic, template-based explanation built ONLY from real numeric
// model outputs already computed by scoreSpecies (presence/feeding/access/
// factors) — never an LLM asked to narrate after seeing the scores.
//
// Deliberately does NOT produce an itemized point-by-point breakdown that
// sums exactly to the score difference (e.g. "tide +4, clarity +3, access
// +2"). computeFinalActivity combines presence+feeding additively but then
// MULTIPLIES by accessMultiplier (access scales the whole sum, it doesn't
// add to it), applies a conditional +8 "opportunistic" bonus, and clamps
// twice — that combination is not cleanly decomposable into independent
// per-factor point values. Fabricating exact-summing deltas here would be
// fake precision. Instead: identify which of Presence/Feeding/Access is
// the dominant real driver of the gap, and cite each beach's own actual
// named factor (from buildSpeciesFactors) — both are genuinely true
// without overclaiming exact attribution.
function buildComparativeExplanation(winner, runnerUp) {
  const w = winner.result, r = runnerUp.result;
  const scoreDiff = Math.round(w.scoreRaw - r.scoreRaw);
  const drivers = [
    { key: "presence", label: "Presence", diff: w.presence - r.presence },
    { key: "feeding", label: "Feeding", diff: w.feeding - r.feeding },
    { key: "access", label: "Access", diff: w.access - r.access },
  ].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const topDriver = drivers[0];

  const essentiallyTied = scoreDiff <= 2;
  let text = essentiallyTied
    ? `${winner.beachName} ${w.score} · ${runnerUp.beachName} ${r.score} — essentially tied. Conditions are very similar between the two beaches.`
    : scoreDiff <= 5
    ? `${winner.beachName} narrowly leads ${runnerUp.beachName} (${w.score} vs ${r.score}).`
    : `${winner.beachName} leads ${runnerUp.beachName} by ${scoreDiff} points (${w.score} vs ${r.score}).`;

  if (Math.abs(topDriver.diff) >= 2) {
    text += ` The largest model difference is ${topDriver.label} (${w[topDriver.key]} vs ${r[topDriver.key]}).`;
  }

  const winnerTopFactor = [...(w.factors || [])].sort((a, b) => b.delta - a.delta)[0];
  const runnerUpLimitingFactor = [...(r.factors || [])].sort((a, b) => a.delta - b.delta)[0];
  if (winnerTopFactor && winnerTopFactor.delta > 0) text += ` ${winner.beachName}'s strongest factor: ${winnerTopFactor.label}.`;
  if (runnerUpLimitingFactor && runnerUpLimitingFactor.delta < 0) text += ` ${runnerUp.beachName}'s main limiting factor: ${runnerUpLimitingFactor.label}.`;
  return text;
}

// Hour options from "Now" through +24h, in Florida's actual local time
// (all mapped beaches are Eastern) — never fixed clock offsets like "+5h".
// Any option that falls on a different calendar date than "now" (Eastern)
// is labeled "tomorrow", satisfying the explicit after-midnight requirement.
function generateBestBeachHourOptions(nowDate) {
  const hourFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true, timeZone: "America/New_York" });
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const todayStr = dateFmt.format(nowDate);
  const opts = [{ label: "Now", date: new Date(nowDate) }];
  const start = new Date(nowDate);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  for (let i = 0; i < 24; i++) {
    const t = new Date(start.getTime() + i * 3600000);
    const isTomorrow = dateFmt.format(t) !== todayStr;
    opts.push({ label: `${hourFmt.format(t)}${isTomorrow ? " tomorrow" : ""}`, date: t });
  }
  return opts;
}

function BestBeachComparatorScreen({ onSelectBeach }) {
  const [speciesId, setSpeciesId] = useState("tarpon");
  const [hourOptions] = useState(() => generateBestBeachHourOptions(new Date()));
  const [selectedHourIdx, setSelectedHourIdx] = useState(0);
  const [ranking, setRanking] = useState({ loading: true, beaches: [], bestBeach: null, unavailableBeaches: [] });
  const [expandedBeachId, setExpandedBeachId] = useState(null);
  const [clarityRanking, setClarityRanking] = useState({ loading: true, beaches: [], unavailableBeaches: [] });
  const [clarityExpanded, setClarityExpanded] = useState(false);

  const selectedTime = hourOptions[selectedHourIdx]?.date ?? new Date();

  // Step 9 — debounce rapid hour-selector scrubbing. Per-beach forecast/
  // tide fetches are already deduped by cachedFetch (both cached results
  // and in-flight requests), so scrubbing quickly never causes duplicate
  // NOAA/NWS network calls regardless of this debounce — this debounce
  // exists purely to avoid firing many redundant rounds of the (cheap but
  // not free) 24-beach scoring loop while the user is still scrubbing.
  useEffect(() => {
    let cancelled = false;
    setRanking((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      rankBeachesForTime(speciesId, selectedTime)
        .then((res) => { if (!cancelled) setRanking({ loading: false, ...res }); })
        .catch(() => { if (!cancelled) setRanking({ loading: false, beaches: [], bestBeach: null, unavailableBeaches: [] }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speciesId, selectedHourIdx]);

  // Cleanest-water ranking uses the SAME selected hour as the species
  // ranking above — species-independent, so it doesn't need its own hour
  // picker; switching hours updates both together.
  useEffect(() => {
    let cancelled = false;
    setClarityRanking((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      rankBeachesByClarity(selectedTime)
        .then((res) => { if (!cancelled) setClarityRanking({ loading: false, ...res }); })
        .catch(() => { if (!cancelled) setClarityRanking({ loading: false, beaches: [], unavailableBeaches: [] }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHourIdx]);

  const winner = ranking.bestBeach;
  const runnerUp = ranking.beaches[1];
  const explanation = winner && runnerUp ? buildComparativeExplanation(winner, runnerUp) : null;
  const speciesName = SPECIES.find((s) => s.id === speciesId)?.name;

  return (
    <div style={{ padding: "12px 14px 90px" }}>
      <div style={{ color: "#7590A0", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5, marginBottom: 10 }}>
        BEST BEACH <span style={{ color: "#4A6270" }}>(species + hour → top beach)</span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {SPECIES.map((s) => (
          <button key={s.id} onClick={() => setSpeciesId(s.id)} style={{
            padding: "6px 10px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${speciesId === s.id ? "#17D9C4" : "#1F3444"}`,
            background: speciesId === s.id ? "#0F2B28" : "#0E1B26",
            color: speciesId === s.id ? "#17D9C4" : "#8AA6B8", fontSize: 11.5,
          }}>{s.name}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 14 }}>
        {hourOptions.map((h, i) => (
          <button key={i} onClick={() => setSelectedHourIdx(i)} style={{
            flexShrink: 0, padding: "6px 10px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
            border: `1px solid ${selectedHourIdx === i ? "#17D9C4" : "#1F3444"}`,
            background: selectedHourIdx === i ? "#0F2B28" : "#0E1B26",
            color: selectedHourIdx === i ? "#17D9C4" : "#8AA6B8", fontSize: 11,
          }}>{h.label}</button>
        ))}
      </div>

      {ranking.loading ? (
        <div style={{ color: "#5A7A8A", fontSize: 12 }}>Evaluating every beach…</div>
      ) : !winner ? (
        <div style={{ color: "#5A7A8A", fontSize: 12 }}>No beach has sufficient data for {speciesName} at this time.</div>
      ) : (
        <>
          <div style={{ background: "#0E1B26", border: "1px solid #17D9C4", borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 2 }}>Best predicted beach for {speciesName}</div>
                <div style={{ color: "#4A6270", fontSize: 10.5 }}>{hourOptions[selectedHourIdx].label}</div>
              </div>
              {/* Step 7 — forecast provenance never presented as current observation */}
              <span style={{ color: winner.isFuture ? "#F5A623" : "#5A7A8A", fontSize: 8.5, border: "1px solid #2A3F4E", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" }}>
                {winner.isFuture ? `${hourOptions[selectedHourIdx].label} forecast` : "Current observations"}
              </span>
            </div>
            {/* Winner made visually dominant with a large ScoreRing (the same
                component every other score-anchor in the app already uses) —
                this is the one screen whose whole point is "give me THE
                answer," so the #1 result needs to read at a glance, not be
                inferred from a list position. */}
            <div onClick={() => onSelectBeach(winner.beachId)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
              <ScoreRing score={winner.finalScore} size={64} />
              <div style={{ flex: 1 }}>
                <div style={{ color: "#E7EFF3", fontSize: 20, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.2 }}>
                  {winner.beachName}
                </div>
                <div style={{ color: "#8AA6B8", fontSize: 11.5, marginTop: 3 }}>
                  Presence {winner.presence} · Feeding {winner.feeding} · Access {winner.access} · <span style={{ color: "#B7EFE8", fontWeight: 600 }}>{winner.confidence} confidence</span>
                </div>
                <div style={{ color: "#7590A0", fontSize: 11, marginTop: 4 }}>
                  <Waves size={11} color="#5A7A8A" style={{ verticalAlign: -1, marginRight: 4 }} />
                  {winner.environmentalInputs?.waveFt != null
                    ? `${winner.environmentalInputs.waveFt.toFixed(1)} ft${winner.environmentalInputs.wavePeriodS != null ? ` @ ${winner.environmentalInputs.wavePeriodS}s` : ""}`
                    : "Wave height not available"}
                </div>
              </div>
            </div>
            {runnerUp && (
              <div style={{ color: "#17D9C4", fontSize: 11, marginTop: 10 }}>
                {Math.round(winner.finalScoreRaw - runnerUp.finalScoreRaw) <= 2
                  ? `Essentially tied with ${runnerUp.beachName} (${runnerUp.finalScore})`
                  : `+${Math.round(winner.finalScoreRaw - runnerUp.finalScoreRaw)} vs ${runnerUp.beachName}`}
              </div>
            )}
            {/* Item 3 — ranking-uncertainty warning. Never reorders beaches;
                purely a caveat when #1's objective input coverage is a full
                tier worse than #2's (strong/partial/weak), so a close score
                gap isn't mistaken for equally-informed conditions. */}
            {runnerUp && COMPARISON_QUALITY_RANK[winner.comparisonQuality] < COMPARISON_QUALITY_RANK[runnerUp.comparisonQuality] && (
              <div style={{ color: "#F5A623", fontSize: 10.5, marginTop: 6 }}>
                Ranking uncertainty: {winner.beachName} has less complete forecast data than {runnerUp.beachName}.
              </div>
            )}
          </div>

          {explanation && (
            <div style={{ background: "#0E1B26", border: "1px solid #1F3444", borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 4, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>
                WHY {winner.beachName.toUpperCase()} LEADS
              </div>
              <div style={{ color: "#DCE8EE", fontSize: 12, lineHeight: 1.5 }}>{explanation}</div>
            </div>
          )}

          <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 6, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>
            RANKED BEACHES <span style={{ color: "#4A6270", fontWeight: 400 }}>(#2 and #3 for comparison)</span>
          </div>
          {ranking.beaches.slice(0, 8).map((b, i) => {
            const isExpanded = expandedBeachId === b.beachId;
            const qualityColor = b.comparisonQuality === "strong" ? "#17D9C4" : b.comparisonQuality === "partial" ? "#F5A623" : "#FF6B6B";
            if (i === 0) return null; // #1 is now the dominant card above — never shown twice
            return (
              <div key={b.beachId} style={{ marginBottom: 4, borderRadius: 8, background: "#0E1B26", border: "1px solid #1F3444", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", cursor: "pointer" }}
                     onClick={() => setExpandedBeachId(isExpanded ? null : b.beachId)}>
                  <div>
                    <span style={{ color: "#5A7A8A", fontSize: 11, marginRight: 6 }}>{i + 1}.</span>
                    <span style={{ color: "#DCE8EE", fontSize: 12.5 }} onClick={(e) => { e.stopPropagation(); onSelectBeach(b.beachId); }}>{b.beachName}</span>
                    <span style={{ color: qualityColor, fontSize: 8.5, marginLeft: 6, border: `1px solid ${qualityColor}`, borderRadius: 3, padding: "0 4px" }}>{b.comparisonQuality}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "#7590A0", fontSize: 10.5 }}>P{b.presence} F{b.feeding} A{b.access}</span>
                    <span style={{ color: i === 0 ? "#17D9C4" : "#DCE8EE", fontSize: 14, fontWeight: 700 }}>{b.finalScore}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ padding: "0 10px 10px" }}>
                    <div style={{ color: "#4A6270", fontSize: 10.5, marginBottom: 4 }}>
                      {b.confidence} confidence · {b.isFuture ? `${hourOptions[selectedHourIdx].label} forecast` : "current observations"}
                    </div>
                    <div style={{ color: "#4A6270", fontSize: 10.5, marginBottom: 6 }}>
                      Coverage: tide {b.dataCoverage.tide ? "✓" : "✗"} · wind {b.dataCoverage.wind ? "✓" : "✗"} · waves {b.dataCoverage.waves ? "✓" : "✗"} · wave period {b.dataCoverage.wavePeriod ? "✓" : "✗"} · precip {b.dataCoverage.precip ? "✓" : "✗"} · clarity {b.dataCoverage.clarity ? "✓" : "✗"} · water temp {b.dataCoverage.waterTemp ? "✓" : "✗ (expected)"} · bait: {b.dataCoverage.bait}
                    </div>
                    {(b.result.factors || []).slice(0, 5).map((f, fi) => (
                      <div key={fi} style={{ color: "#8AA6B8", fontSize: 10.5, marginBottom: 2 }}>{f.label}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {ranking.unavailableBeaches.length > 0 && (
            <div style={{ color: "#4A6270", fontSize: 10, marginTop: 10 }}>
              {ranking.unavailableBeaches.length} beach{ranking.unavailableBeaches.length > 1 ? "es" : ""} excluded — insufficient data at this time.
            </div>
          )}

          {/* ============ CLEANEST WATER — species-independent, same
              selected hour as the ranking above. Collapsed to top 3 by
              default; expand for the full list. ============ */}
          <div style={{ marginTop: 20 }}>
            <div style={{ color: "#7590A0", fontSize: 10, marginBottom: 6, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.4 }}>
              CLEANEST WATER <span style={{ color: "#4A6270", fontWeight: 400 }}>({hourOptions[selectedHourIdx].label})</span>
            </div>
            {clarityRanking.loading ? (
              <div style={{ color: "#5A7A8A", fontSize: 12 }}>Checking water clarity…</div>
            ) : clarityRanking.beaches.length === 0 ? (
              <div style={{ color: "#5A7A8A", fontSize: 12 }}>No clarity estimate available for this time.</div>
            ) : (
              <>
                {clarityRanking.beaches.slice(0, clarityExpanded ? 24 : 3).map((b, i) => (
                  <div key={b.beachId} onClick={() => onSelectBeach(b.beachId)} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "7px 10px", borderRadius: 8, background: i === 0 ? "#0F2B28" : "#0E1B26",
                    border: "1px solid #1F3444", marginBottom: 4, cursor: "pointer",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#4A6270", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", width: 12 }}>{i + 1}</span>
                      <span style={{ color: "#DCE8EE", fontSize: 12.5 }}>{b.beachName}</span>
                    </div>
                    <span style={{ color: i === 0 ? "#17D9C4" : "#8AA6B8", fontSize: 12, fontWeight: 600 }}>{b.clarityLabel}</span>
                  </div>
                ))}
                {clarityRanking.beaches.length > 3 && (
                  <button onClick={() => setClarityExpanded(!clarityExpanded)} style={{ background: "none", border: "none", color: "#3E8FFF", fontSize: 11, cursor: "pointer", padding: "4px 0" }}>
                    {clarityExpanded ? "Show fewer" : `Show all ${clarityRanking.beaches.length}`}
                  </button>
                )}
                {clarityRanking.unavailableBeaches.length > 0 && (
                  <div style={{ color: "#4A6270", fontSize: 10, marginTop: 6 }}>
                    {clarityRanking.unavailableBeaches.length} beach{clarityRanking.unavailableBeaches.length > 1 ? "es" : ""} excluded — no clarity estimate at this time.
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
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
    { id: "bestBeach", label: "Best" },
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
      {screen === "bestBeach" && (
        <ErrorBoundary key="bestBeach"><BestBeachComparatorScreen onSelectBeach={openBeach} /></ErrorBoundary>
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
