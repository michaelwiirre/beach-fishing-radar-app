// SHARED MODEL v2 (corrected closure) — Priority 15 Stage 1
export const NOAA_STATIONS = {
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

export const NDBC_STATIONS = {
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

export const METAR_STATIONS = {
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

export function dateToCompact(d) { return d.toISOString().slice(0, 10).replace(/-/g, ""); }

// Historical backfill — every row NDBC has for that UTC date (up to 45
// days back per NDBC's own retention), converted the same way as the live
// reading. Returns [] rather than throwing when the date is out of range
// or the station has no data for it, so the UI can show an honest gap.

export function pickLatestAvailableRow(rows, predictionTimestamp) {
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

export function scoreBuoyFactor(buoy) {
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

export function estimateWaterClarity(buoy, precip, tideStage, beachId) {
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


// ===========================================================================
// Priority 15 Stage 2 additions — two small field-mapping steps that were
// previously duplicated only in the browser's fetch wrappers (never in the
// Worker, which had no reason to need them before now). Extracted here so
// the Worker's own dataAccess implementation can call these SAME functions
// in-process instead of re-deriving the same unit conversions/field
// renames by hand a second time — directly serves "do not duplicate
// environmental parsing logic merely to satisfy the new interface."
// Both are pure, deterministic, no network/DOM/React.
// ===========================================================================

// Raw NOAA CO-OPS tide predictions come back as {t, v, type} (NOAA's own
// field names). This renames them to the {time, value, tideType}
// intermediate shape normalizeObservations() expects — nothing more.
export function normalizeNoaaTideRows(predictions) {
  return (predictions || []).map((p) => ({
    time: p.t, value: parseFloat(p.v), tideType: p.type === "H" ? "H" : "L",
  }));
}

// Raw NDBC buoy rows (as parsed by the Worker's own parseNdbcAllRows, or
// returned by the Worker's /buoy/history route) are in METRIC units
// (m/s, meters, Celsius) — matching NDBC's own reporting convention. Every
// consumer downstream (scoreBuoyFactor, computeFeeding, tempSuitability)
// expects IMPERIAL units (kt, ft, Fahrenheit). This is that one conversion
// step, done once, shared.
export function convertNdbcRowToImperial(r) {
  return {
    observedAtUtc: r.observedAtUtc,
    windSpeedKt: r.windSpeedMs != null ? r.windSpeedMs * 1.94384 : null,
    windDirDeg: r.windDirDeg,
    waveHeightFt: r.waveHeightM != null ? r.waveHeightM * 3.28084 : null,
    dominantWavePeriodS: r.dominantWavePeriodS,
    pressureHpa: r.pressureHpa,
    pressureTendencyHpa: r.pressureTendencyHpa,
    waterTempF: r.waterTempC != null ? r.waterTempC * 9 / 5 + 32 : null,
  };
}

// Normalizes one NOAA response into rows matching the environmental_observations
// shape from the data architecture: source, source type, observed/retrieved
// timestamps, units, freshness, and a status flag.

export function normalizeObservations({ rows, stationId, stationName, product, parameter, unit, datum, sourceType, reliability, retrievedAt }) {
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

export function computeTideStage(hiloRows, atDate) {
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

export const TEMP_CURVE_POINTS = {
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

export function tempSuitability(species, tempF) {
  // Priority 15-triage fix: temperature unavailable no longer blocks the
  // entire Presence computation. Returns the neutral midpoint (50) instead
  // of null — the SAME missing-input convention computeFeeding already
  // uses for clarity/tide/bait (see claritySub, tideSub, baitSub above).
  // This is not a new formula: it's applying that existing, established
  // pattern to the one place that was inconsistent with it. The seasonal
  // multiplier (which correctly already uses predictionTimestamp's month,
  // not "now") still applies on top of this neutral core, so a future
  // prediction with unavailable water temp still gets a legitimate
  // season-driven Presence instead of null. computeSpeciesConfidence
  // already receives tempKnown = (tempF != null) separately, so the
  // resulting uncertainty is still honestly reflected via confidence —
  // no change needed there.
  if (tempF == null) return 50;
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

export const SEASONAL_MULT = {
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

export const MODEL_VERSION = "BFR_MODEL_V10_4";

export const SPECIES_RULES = {
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

export function computePresence(species, tempF, month, baitInfo) {
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

export function waveSubscore(waveFt, preference) {
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

export function windSubscore(windKt) {
  if (windKt == null) return 50;
  if (windKt <= 10) return 90; if (windKt <= 18) return 55; return 20;
}

// Rough/dirty conditions cap FEEDING specifically, never Presence — a
// blown-out day doesn't mean the fish left, just that they're hard to
// catch. Thresholds now match the same 3ft/4ft boundaries as the wave
// sub-score and clarity estimate — so even rough-water-tolerant species
// (sharks, jack, bluefish) feel a real ceiling by 4ft, not just calm-
// preference species via their wave curve alone.

export function computeFeedingCeiling(waveFt, clarityScore) {
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

export function computeFeeding(species, { tideStage, waveFt, clarityScore, windKt, isNight, lowLight, baitInfo }) {
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

export function effectivePresence(presence) {
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

export const GEAR_RANGE_SCALE = {}; // speciesId -> multiplier; empty = everyone uses 1.0 (surf rod) for now

export function gearScaleFor(speciesId) { return GEAR_RANGE_SCALE[speciesId] || 1.0; }

// Boundary values reconciled where the source table's buckets slightly
// overlap (e.g. 70yd sits at the edge of both the "50-70" and "70-90"
// buckets) — averaged here into one continuous curve instead of a
// discontinuous jump.

export const ACCESS_DISTANCE_CURVE = [[0, 100], [30, 100], [50, 100], [70, 92], [90, 72], [120, 40], [150, 15], [220, 3], [250, 0]];
// Unrounded on purpose — this is the exact evaluator used both for a single
// point and as the building block for averageAccessDistanceScore's exact
// integration below. Rounding happens once, at the final `access` output.

export function accessDistanceScore(yd) {
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

export function averageAccessDistanceScore(minYdRaw, maxYdRaw) {
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

export function accessWindPenalty(windKt) {
  if (windKt == null) return 0;
  if (windKt <= 14) return 0;
  if (windKt <= 19) return 5;
  if (windKt <= 24) return 10;
  return 15;
}
// Conservative on purpose — strong current isn't inherently bad fishing
// (it's often exactly why fish are feeding); this only penalizes the
// ability to hold a presentation in place, not the fishing quality itself.

export function accessCurrentPenalty(flowPct) {
  if (flowPct <= 70) return 0;
  if (flowPct <= 85) return 2;
  if (flowPct <= 95) return 5;
  return 8;
}

export function computeAccess(speciesId, position, windKt, flowStrength) {
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

export function computeFinalActivity(species, presence, feeding, baitInfo, secondaryAdj, access) {
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

export function computeSpeciesConfidence(baitInfo, tempKnown, clarityKnown, buoyKnown) {
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

export function buildSpeciesFactors(species, presence, feedingResult, tempF, month, baitInfo, isNight, tideStage, waveFt, clarityEstimate, windKt) {
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
    // Priority — factor labels now carry the actual predicted value, not
    // just the derived 0-100 sub-score, wherever that real value is
    // available at this call site. Never invents a number that wasn't
    // actually computed (e.g. wave/clarity/wind still say "unknown" if
    // their underlying reading was unavailable, exactly as before).
    if (c.key === "Tide") label = `Tide flow ${Math.round(c.sub)}%${tideStage?.direction ? ` (${tideStage.direction})` : ""}`;
    else if (c.key === "Wave") label = `Offshore wave height ${waveFt != null ? waveFt.toFixed(1) + " ft" : "unknown"}`;
    else if (c.key === "Clarity") label = `Water clarity ${clarityEstimate?.label || "unknown"}${clarityEstimate?.score != null ? ` (${Math.round(clarityEstimate.score)}/100 estimated)` : ""}`;
    else if (c.key === "Wind") label = `Wind ${windKt != null ? Math.round(windKt) + " kt" : "unknown"}`;
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

export function inferBaitActivity(buoy, now) {
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

export const BAIT_TYPE_AFFINITY = {
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

export function baitTypeAffinity(speciesId, baitTypeId) {
  return BAIT_TYPE_AFFINITY[speciesId]?.[baitTypeId] ?? 0.15;
}

// Conservative, coarse tiers — not manufactured precision about bait
// movement rates. "very_old" collapses to effectively unknown rather than
// a small nonzero number, since a multi-day-old sighting says very little
// about forage right now.

export function forageFreshnessTier(hoursAgo) {
  if (hoursAgo == null || hoursAgo < 0) return "unknown"; // negative = would require a future observation; never allowed
  if (hoursAgo <= 6) return "very_recent";
  if (hoursAgo <= 24) return "recent";
  if (hoursAgo <= 72) return "old";
  return "very_old";
}

export function forageFreshnessMultiplier(tier) {
  switch (tier) {
    case "very_recent": return 1.0;
    case "recent": return 0.7;
    case "old": return 0.35;
    default: return 0; // very_old / unknown — falls back to seasonal baseline entirely
  }
}

export function derivePresenceState(obs) {
  if (obs.sighted) return "observed"; // visual sighting, whether or not also caught
  if (obs.caught) return "supported"; // physical evidence only, weaker on its own
  return "unknown";
}
// Coarse, explicitly non-scientific buckets — NOT a biological threshold.
// Absent a count, concentration stays "unknown"; it is never assumed.

export function deriveConcentrationState(count) {
  if (count == null) return "unknown";
  if (count < 25) return "scattered";
  if (count < 200) return "moderate";
  return "heavy";
}

export const CONCENTRATION_MULTIPLIER = { unknown: 0.7, scattered: 0.75, moderate: 1.0, heavy: 1.25 };
// Sighted+caught together is real corroboration and modestly improves
// confidence — but confidence is data-quality, not a score multiplier, so
// this never stacks onto the weight used for scoring.

export function presenceConfidence(presence, corroborated) {
  if (presence === "observed") return corroborated ? "High" : "Moderate";
  if (presence === "supported") return corroborated ? "Moderate" : "Low";
  return "Low";
}

export function resolveForageEvidence(trips, predictionTimestamp) {
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

export function buildEnhancedBaitInfo(seasonalBaitInfo, forage, speciesId) {
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

export const ZONE_NAMES = ["Beach edge", "Shorebreak", "First trough", "First bar", "Second trough", "Second bar", "Beyond second bar"];

export const ZONE_DISTANCES_YD = [[0, 10], [5, 20], [20, 40], [35, 55], [50, 80], [70, 95], [90, 120]];

export function baseZoneFromSurf(waveHeightFt) {
  if (waveHeightFt == null) return null;
  if (waveHeightFt <= 1.0) return 1;
  if (waveHeightFt <= 2.0) return 2;
  if (waveHeightFt <= 3.0) return 2.5;
  if (waveHeightFt <= 4.5) return 3.3;
  if (waveHeightFt <= 6.0) return 4.2;
  return 5.5;
}

export function predictFishPosition(tideStage, buoy, zoneBias, baitInfo, species) {
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

export function computeIsNight(now, lat, lon) {
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

export function computeIsLowLight(now, lat, lon) {
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

export function computeSecondaryAdjustment(species, moonFactor, buoy) {
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

export function scoreSpecies(species, tideStage, moonFactor, buoyFactor, clarityEstimate, isNight, baitInfo, isLowLight, predictionTimestamp) {
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
  const factors = buildSpeciesFactors(species, presence ?? 50, feedingResult, tempF, month, baitInfo, isNight, tideStage, buoy?.waveHeightFt, clarityEstimate, buoy?.windSpeedKt);
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

export const SYNODIC_MONTH_DAYS = 29.53058867;

// Age in days since the last new moon (0 = new moon), plus a fraction-based
// illumination estimate and the conventional phase name.

export function computeMoonPhase(date) {
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

export function scoreMoonFactor(moonPhase) {
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

export function computeSunTimes(dateUTC, lat, lon) {
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

export function parseIso8601DurationMs(dur) {
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

export function findGridpointValueAt(layerValues, targetDate) {
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

export function convertForecastValue(value, uom) {
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

export function resolveForecastInputs(forecastBundle, predictionTimestamp) {
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

export const BAIT_TYPES = [
  { id: "mullet", name: "Mullet" },
  { id: "menhaden", name: "Menhaden" },
  { id: "glass_minnows", name: "Glass minnows" },
  { id: "shrimp", name: "Shrimp" },
  { id: "sand_fleas", name: "Sand fleas" },
];

// Time blocks are relative to that DATE's real sunrise/sunset, not fixed
// clock hours — "dawn" on a December day and a June day are different
// hours, and the model already computes real sun times per date/location.

export const BEACH_SEAWARD_NORMAL = {
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

export function classifyWindRelativeToShore(windDirDeg, beachId) {
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

// Priority 15.1 — resolves Open-Meteo's Marine Weather API response (flat
// hourly arrays: {hourly: {time, wave_height, wave_period}}) to the wave
// value nearest the requested timestamp, converting meters to feet (the
// unit every other wave consumer in this file expects). 90-minute match
// tolerance is half MFWAM's native 3-hourly cadence — close enough to be
// a real match, not so loose that a request outside the fetched window
// silently "matches" something hours away.
export function resolveMarineForecastWave(marineJson, predictionTimestamp) {
  const times = marineJson?.hourly?.time;
  const heights = marineJson?.hourly?.wave_height;
  const periods = marineJson?.hourly?.wave_period;
  if (!times || !heights || times.length === 0) return { waveHeightFt: null, wavePeriodS: null, matchedTime: null };
  const targetMs = predictionTimestamp.getTime();
  let bestIdx = -1, bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  if (bestIdx === -1 || bestDiff > 90 * 60000) return { waveHeightFt: null, wavePeriodS: null, matchedTime: null };
  return {
    waveHeightFt: heights[bestIdx] != null ? heights[bestIdx] * 3.28084 : null,
    wavePeriodS: periods ? (periods[bestIdx] ?? null) : null,
    matchedTime: times[bestIdx],
  };
}

// Priority 15.2 — resolves Open-Meteo's GFS/HRRR forecast response (same
// flat hourly-array shape: {hourly: {time, wind_speed_10m, wind_direction_10m}})
// to the wind reading nearest the requested timestamp. Wind speed arrives
// in km/h (Open-Meteo's metric default) and is converted to knots. HRRR
// itself only reliably covers ~18h (48h for the 0/6/12/18Z runs), so this
// is requested against the "gfs_seamless" model — HRRR whenever it's
// actually available for that hour, GFS filling in the rest — rather than
// pinning to HRRR alone, which would leave real gaps at the longer
// horizons this app uses. 60-minute match tolerance, since this source is
// natively hourly (tighter than the marine resolver's 90-minute tolerance
// for MFWAM's 3-hourly cadence).
export function resolveWindForecastSpeed(windJson, predictionTimestamp) {
  const times = windJson?.hourly?.time;
  const speeds = windJson?.hourly?.wind_speed_10m;
  const dirs = windJson?.hourly?.wind_direction_10m;
  if (!times || !speeds || times.length === 0) return { windSpeedKt: null, windDirDeg: null, matchedTime: null };
  const targetMs = predictionTimestamp.getTime();
  let bestIdx = -1, bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  if (bestIdx === -1 || bestDiff > 60 * 60000) return { windSpeedKt: null, windDirDeg: null, matchedTime: null };
  return {
    windSpeedKt: speeds[bestIdx] != null ? speeds[bestIdx] * 0.539957 : null,
    windDirDeg: dirs ? (dirs[bestIdx] ?? null) : null,
    matchedTime: times[bestIdx],
  };
}

// Priority 16 — satellite water clarity (NOAA CoastWatch VIIRS Kd490 via
// ERDDAP). Deliberately a SUPPLEMENT to estimateWaterClarity above, never
// a replacement: satellite ocean-color retrievals are documented to be
// less reliable specifically in shallow, nearshore/Case-2 water (exactly
// what this app covers), have real gaps from cloud cover, and are
// ~750m-4km per pixel — not guaranteed to represent one specific beach's
// surf zone. This is real, labeled satellite-observed data when a fresh,
// cloud-free reading exists; the wave/wind/precip-based estimate remains
// the reliable fallback and is never overridden by this.
//
// Kd490 -> 0-100 score is a reasonable approximation from general
// oceanographic convention (lower Kd490 = clearer water), NOT a
// precisely calibrated model for this specific coastline — there's no
// published Kd490-to-visual-clarity calibration for Cedar Key/FL Gulf
// coast specifically. Uses the SAME 0-100 scale and "clean"/"stained or
// mixed"/"murky" label thresholds as estimateWaterClarity so the two
// numbers read as directly comparable.
export function kd490ToClarityScore(kd490) {
  if (kd490 == null || kd490 < 0) return null;
  if (kd490 <= 0.1) return 95;
  if (kd490 <= 0.2) return 80;
  if (kd490 <= 0.35) return 65;
  if (kd490 <= 0.5) return 50;
  if (kd490 <= 0.75) return 35;
  if (kd490 <= 1.0) return 20;
  if (kd490 <= 1.5) return 10;
  return 5;
}

// Defensive parsing — this integration could not be live-tested against
// a real ERDDAP response (no network access available while building
// it), so this fails closed (returns null/unavailable) on any shape
// mismatch rather than throwing or fabricating a reading. Takes the
// most recent non-null value in whatever window was fetched, since
// cloud cover can blank out any individual day.
export function resolveSatelliteClarity(erddapJson, requestTimestamp) {
  try {
    const rows = erddapJson?.table?.rows;
    const cols = erddapJson?.table?.columnNames;
    if (!Array.isArray(rows) || !Array.isArray(cols)) return null;
    const timeIdx = cols.indexOf("time");
    const kdIdx = cols.indexOf("kd_490");
    if (timeIdx === -1 || kdIdx === -1) return null;
    let best = null;
    for (const row of rows) {
      const kd = row[kdIdx];
      if (kd == null) continue;
      const t = new Date(row[timeIdx]);
      if (isNaN(t.getTime())) continue;
      if (!best || t.getTime() > best.t.getTime()) best = { t, kd };
    }
    if (!best) return null;
    const score = kd490ToClarityScore(best.kd);
    if (score == null) return null;
    const label = score >= 70 ? "Likely clean" : score >= 45 ? "Likely stained / mixed" : "Likely murky";
    const ageHours = (requestTimestamp.getTime() - best.t.getTime()) / 3600000;
    return { score, label, kd490: best.kd, observedAt: best.t.toISOString(), ageHours: Math.round(ageHours * 10) / 10 };
  } catch {
    return null;
  }
}

export async function predictAsOfTimestamp(beach, speciesId, predictionTimestamp, dataAccess) {
  const dateCompactStr = dateToCompact(predictionTimestamp);
  const noaaStation = NOAA_STATIONS[beach.id]?.stationId;
  const ndbcStation = NDBC_STATIONS[beach.id]?.stationId;
  const metarStation = METAR_STATIONS[beach.id]?.stationId;

  const sourceMeta = { tide: "unavailable", buoy: "unavailable", precip: "unavailable", wave: "unavailable", wind: "unavailable" };
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
      tideRows = await dataAccess.fetchTideHistoryDay(noaaStation, dateCompactStr);
      if (tideRows && tideRows.length > 0) sourceMeta.tide = "deterministic"; // harmonic prediction — same status regardless of past/future, never "forecast"
    } catch {
      // leave tideRows null; sourceMeta stays "unavailable"
    }
  }

  let buoyReading = null;
  let precipReading = null;
  let waterTempSource = null, waterTempAgeHours = null; // Priority 14.2 fix — populated below, exposed in environmentalInputs regardless of path

  if (isFuture) {
    // FUTURE — wind/wave/wavePeriod/precip/pressure come from the verified
    // NWS gridpoint forecast, exactly as before. Water temperature is
    // handled separately below: Priority 10's research found no official
    // structured future coastal water-temperature FORECAST source, and
    // that remains true — this still never fabricates a forecast value.
    try {
      const forecastBundle = await dataAccess.fetchForecastForBeach(beach);
      const forecast = forecastBundle ? resolveForecastInputs(forecastBundle, predictionTimestamp) : null;
      if (forecast) {
        const haveWave = forecast.waveHeightFt.status === "forecast";
        const haveWind = forecast.windSpeedKt.status === "forecast";
        buoyReading = {
          waveHeightFt: forecast.waveHeightFt.value, dominantWavePeriodS: forecast.wavePeriodS.value,
          windSpeedKt: forecast.windSpeedKt.value, windDirDeg: forecast.windDirDeg.value,
          pressureHpa: forecast.pressureHpa.value, pressureTendencyHpa: null,
          waterTempF: null, // set below, separately, if a fresh-enough real observation exists
        };
        if (haveWave || haveWind) sourceMeta.buoy = "forecast";
        sourceMeta.wind = haveWind ? "nws_forecast" : "unavailable";
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
      // leave buoyReading/precipReading null; sourceMeta stays "unavailable" — never fall back to historical/current data for wind/wave/precip on a future timestamp
    }

    // Priority 15.1 — MFWAM (via Open-Meteo's Marine Weather API) is now
    // the PRIMARY wave source for future predictions, overriding whatever
    // NWS's own coastal-waters layer supplied above for wave height/period
    // specifically. Global ~8km coverage means every beach gets a real
    // wave value here, not just the ones with NWS marine-zone coverage.
    // Wind/precip/pressure above are untouched — MFWAM's marine API
    // doesn't cover those, so NWS keeps supplying them.
    try {
      const marineBundle = await dataAccess.fetchMarineForecastForBeach(beach);
      const marine = marineBundle ? resolveMarineForecastWave(marineBundle, predictionTimestamp) : null;
      if (marine && marine.waveHeightFt != null) {
        if (!buoyReading) buoyReading = { waveHeightFt: null, dominantWavePeriodS: null, windSpeedKt: null, windDirDeg: null, pressureHpa: null, pressureTendencyHpa: null, waterTempF: null };
        buoyReading.waveHeightFt = marine.waveHeightFt;
        buoyReading.dominantWavePeriodS = marine.wavePeriodS;
        sourceMeta.wave = "mfwam_forecast";
      }
    } catch {
      // leave sourceMeta.wave "unavailable" — never fabricate a wave reading
    }

    // Priority 15.2 — HRRR/GFS wind fallback (via Open-Meteo's GFS/HRRR
    // Forecast API, gfs_seamless model). Unlike wave/MFWAM above, this is
    // FALLBACK ONLY — NWS stays the primary wind source; this only fills
    // in when NWS genuinely had no wind forecast for this hour
    // (sourceMeta.wind still "unavailable" at this point).
    if (sourceMeta.wind === "unavailable") {
      try {
        const windBundle = await dataAccess.fetchWindForecastForBeach(beach);
        const wind = windBundle ? resolveWindForecastSpeed(windBundle, predictionTimestamp) : null;
        if (wind && wind.windSpeedKt != null) {
          if (!buoyReading) buoyReading = { waveHeightFt: null, dominantWavePeriodS: null, windSpeedKt: null, windDirDeg: null, pressureHpa: null, pressureTendencyHpa: null, waterTempF: null };
          buoyReading.windSpeedKt = wind.windSpeedKt;
          buoyReading.windDirDeg = wind.windDirDeg;
          sourceMeta.wind = "hrrr_gfs_forecast";
        }
      } catch {
        // leave sourceMeta.wind "unavailable" — never fabricate a wind reading
      }
    }

    // Priority 14.2 fix — water temperature is a genuinely slow-moving
    // physical quantity (unlike wind/waves, which can shift within hours),
    // and this app has zero legitimate forecast source for it — those two
    // facts together mean "carry forward the beach's own most recent REAL
    // observed reading, within an explicit bounded freshness window" is
    // architecturally the right category of fix, not a fabricated
    // forecast. This is the SAME pattern (real observation + explicit
    // freshness decay) forageFreshnessTier already uses elsewhere in this
    // file — reused here, not invented fresh. 24h is a reasoned, honestly
    // conservative choice (coastal water temp rarely swings far within a
    // day outside a strong frontal passage), not an empirically-derived
    // one — worth revisiting if real verification data (Priority 15)
    // later shows it's too generous or too strict.
    //
    // Critically: this looks BACKWARD from "now" (when the prediction is
    // being made), never forward from the future target time — there is
    // no real observation at a future timestamp, by definition. Age is
    // then measured against the TARGET timestamp, not against "now" — a
    // reading that's fresh right now but would be 30h old by the time a
    // +24h-out target arrives is correctly treated as stale for that
    // prediction, even though it's current information as of this moment.
    const WATER_TEMP_FRESHNESS_HOURS = 24;
    if (ndbcStation) {
      try {
        const nowCompact = dateToCompact(new Date());
        const prevCompact = dateToCompact(new Date(Date.now() - 86400000));
        const [todayRows, prevRows] = await Promise.all([
          dataAccess.fetchBuoyHistoryDay(ndbcStation, nowCompact),
          dataAccess.fetchBuoyHistoryDay(ndbcStation, prevCompact),
        ]);
        const recent = pickLatestAvailableRow([...(prevRows || []), ...(todayRows || [])], new Date());
        if (recent && recent.waterTempF != null && recent.observedAtUtc) {
          const ageAtTargetHours = (predictionTimestamp.getTime() - new Date(recent.observedAtUtc).getTime()) / 3600000;
          if (ageAtTargetHours >= 0 && ageAtTargetHours <= WATER_TEMP_FRESHNESS_HOURS) {
            if (!buoyReading) buoyReading = { waveHeightFt: null, dominantWavePeriodS: null, windSpeedKt: null, windDirDeg: null, pressureHpa: null, pressureTendencyHpa: null, waterTempF: null };
            buoyReading.waterTempF = recent.waterTempF;
            waterTempSource = "carried-forward-observed";
            waterTempAgeHours = Math.round(ageAtTargetHours * 10) / 10;
          }
          // else: reading exists but would be stale by target time — waterTempF stays null, explicitly unknown, never carried forward past the window
        }
      } catch {
        // leave waterTempF null — a failed lookback is not a fabricated value
      }
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
          dataAccess.fetchBuoyHistoryDay(ndbcStation, dateCompactStr),
          dataAccess.fetchBuoyHistoryDay(ndbcStation, prevDateCompactStr),
        ]);
        buoyReading = pickLatestAvailableRow([...(prevRows || []), ...(todayRows || [])], predictionTimestamp);
        if (buoyReading) {
          sourceMeta.buoy = "historical";
          if (buoyReading.waterTempF != null && buoyReading.observedAtUtc) {
            waterTempSource = "observed";
            waterTempAgeHours = Math.round(((predictionTimestamp.getTime() - new Date(buoyReading.observedAtUtc).getTime()) / 3600000) * 10) / 10;
          }
        }
      } catch {
        // leave buoyReading null; sourceMeta stays "unavailable"
      }
    }
    sourceMeta.wave = buoyReading?.waveHeightFt != null ? "ndbc_observed" : "unavailable";
    if (buoyReading?.waveHeightFt == null) {
      // Priority 15.1 — buoy-outage fallback. The mapped NDBC station is
      // either not reporting wave data right now (offline, maintenance,
      // storm damage — all genuinely common for coastal buoys) or this
      // beach has no station mapped at all. Fall back to MFWAM's current-
      // hour value rather than leaving wave height unavailable. This is
      // still MODEL output (MFWAM's own nowcast), not a physical sensor
      // reading — tagged distinctly from a real NDBC observation, never
      // silently presented as "observed."
      try {
        const marineBundle = await dataAccess.fetchMarineForecastForBeach(beach);
        const marine = marineBundle ? resolveMarineForecastWave(marineBundle, predictionTimestamp) : null;
        if (marine && marine.waveHeightFt != null) {
          if (!buoyReading) buoyReading = { waveHeightFt: null, dominantWavePeriodS: null, windSpeedKt: null, windDirDeg: null, pressureHpa: null, pressureTendencyHpa: null, waterTempF: null };
          buoyReading.waveHeightFt = marine.waveHeightFt;
          buoyReading.dominantWavePeriodS = marine.wavePeriodS;
          sourceMeta.wave = "mfwam_fallback";
        }
      } catch {
        // leave sourceMeta.wave "unavailable"
      }
    }
    sourceMeta.wind = buoyReading?.windSpeedKt != null ? "ndbc_observed" : "unavailable";
    if (buoyReading?.windSpeedKt == null) {
      // Priority 15.2 — same buoy-outage fallback pattern as wave above,
      // for wind specifically. HRRR/GFS via Open-Meteo's gfs_seamless
      // model, tagged distinctly from a real NDBC observation.
      try {
        const windBundle = await dataAccess.fetchWindForecastForBeach(beach);
        const wind = windBundle ? resolveWindForecastSpeed(windBundle, predictionTimestamp) : null;
        if (wind && wind.windSpeedKt != null) {
          if (!buoyReading) buoyReading = { waveHeightFt: null, dominantWavePeriodS: null, windSpeedKt: null, windDirDeg: null, pressureHpa: null, pressureTendencyHpa: null, waterTempF: null };
          buoyReading.windSpeedKt = wind.windSpeedKt;
          buoyReading.windDirDeg = wind.windDirDeg;
          sourceMeta.wind = "hrrr_gfs_fallback";
        }
      } catch {
        // leave sourceMeta.wind "unavailable"
      }
    }
    if (metarStation) {
      try {
        const prevDateCompactStr = dateToCompact(new Date(predictionTimestamp.getTime() - 86400000));
        const [todayRows, prevRows] = await Promise.all([
          dataAccess.fetchWeatherHistoryDay(metarStation, dateCompactStr),
          dataAccess.fetchWeatherHistoryDay(metarStation, prevDateCompactStr),
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

  // Priority 16 — satellite clarity, a pure supplement. Never overrides
  // clarityEstimate above; wrapped defensively so a failure here can
  // never break the prediction (same pattern as the trip-log bait
  // upgrade below). null/unavailable is the correct, honest result
  // whenever no fresh cloud-free satellite pass exists for this beach.
  let satelliteClarity = null;
  try {
    const erddapJson = await dataAccess.fetchSatelliteClarityForBeach(beach);
    satelliteClarity = erddapJson ? resolveSatelliteClarity(erddapJson, predictionTimestamp) : null;
  } catch {
    satelliteClarity = null;
  }

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
    const { trips } = await dataAccess.fetchTripsList(beach.id);
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
      waterTempSource, waterTempAgeHours, // Priority 14.2 — null/null when genuinely unavailable, never silently omitted
      clarityScore: clarityEstimate?.score ?? null, clarityLabel: clarityEstimate?.label ?? null,
      satelliteClarity, // Priority 16 — null when no fresh cloud-free satellite pass exists; never overrides clarityScore/clarityLabel above
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

export const MODEL_IMPLEMENTATION_FINGERPRINT = "0faae34045db7e82";
