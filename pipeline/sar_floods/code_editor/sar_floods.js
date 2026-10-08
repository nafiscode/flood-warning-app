/*
 * Jaga S2: Sentinel-1 flood extent for ONE pass, for checking by eye in the Earth Engine Code Editor.
 *
 * Same chain as pipeline/sar_floods (ee_ops.py + threshold.py), function for function:
 *   scenes -> swath-edge trim -> focal median -> change vs the dry reference of the same orbit
 *   -> masks (JRC water, slope, HAND, layover/shadow) -> histogram per 0.1 deg tile
 *   -> Otsu if bimodal enough, else the fixed drop -> small patches removed -> extent codes.
 *
 * Use: paste into code.earthengine.google.com, set VIEW below, Run. The Console lists the passes of
 * the event; copy a pass id into VIEW.passId and Run again to look at another one. Zoom in before
 * judging: the small-patch filter and the 30 m terrain masks depend on the map scale when zoomed out.
 *
 * It does not export and does not build the per-event maximum (that needs one histogram request per
 * pass; the Python package does it). Look at exported rasters in QGIS.
 *
 * NOT YET RUN (written 2026-10-05 without Earth Engine access). The functions between PURE-BEGIN and
 * PURE-END were checked in Node against the Python tests' histograms.
 */

// ---------------------------------------------------------------- what to look at
var VIEW = {
  start: '2024-11-01',   // event window, Bangkok dates, inclusive
  end: '2024-12-31',
  passId: null           // e.g. '20241128T2318Z_S1A_D091'; null = the first pass of the window
};

// ---------------------------------------------------------------- parameters (keep equal to config.yaml)
var P = {
  collection: 'COPERNICUS/S1_GRD',
  instrumentMode: 'IW',
  polarisations: ['VV', 'VH'],
  resolutionMeters: 10,
  incidenceAngleDeg: [30.64, 45.24],
  seasonStart: [10, 1],                 // a season is named by the year it starts in
  reference: {start: [2, 1], end: [4, 30], yearOffsets: [0], minPasses: 4},
  speckle: {filter: 'focal_median', radiusM: 30, kernel: 'circle'},
  tileSizeDeg: 0.1,
  histogram: {minDb: -20, maxDb: 10, binDb: 0.2, scaleM: 50},
  bimodality: {minPixels: 2000, minClassFraction: 0.05, smoothBins: 5, maxValleyRatio: 0.7,
               minModeSeparationDb: 3.0},
  otsuRangeDb: [-12, -2],
  fallbackDropDb: {VV: -3, VH: -3},
  floodRule: 'vv',
  minConnectedPixels: 8,          // min_connected_area_m2 800 at the 10 m this script shows
  water: {asset: 'JRC/GSW1_4/GlobalSurfaceWater', band: 'occurrence', minOccurrencePct: 80},
  slope: {demAsset: 'projects/sat-io/open-datasets/FABDEM', demBand: 'b1', demIsCollection: true, maxDeg: 5, minHandM: 5},
  hand: {asset: 'MERIT/Hydro/v1_0_1', band: 'hnd', maxM: 15},
  layoverShadow: {enabled: true, shadowLiaDeg: 85, bufferM: 100},
  crs: 'EPSG:32647'
};

// AOI-BEGIN (written by `python -m sar_floods aoi`; do not edit)
var AOI_GEOJSON = {"type":"Polygon","coordinates":[[[100.0542,7.143],[100.1011,7.1722],[100.1229,7.1763],[100.1436,7.1619],[100.1549,7.1625],[100.1716,7.1847],[100.2774,7.2206],[100.2996,7.2198],[100.3071,7.2363],[100.3302,7.2539],[100.3321,7.2786],[100.3478,7.2877],[100.3505,7.3063],[100.3711,7.3212],[100.3873,7.3179],[100.394,7.2813],[100.4012,7.2772],[100.4166,7.2873],[100.4185,7.3063],[100.4012,7.3365],[100.3895,7.3969],[100.3727,7.4235],[100.377,7.5055],[100.3556,7.5166],[100.2992,7.486],[100.2586,7.4868],[100.228,7.5347],[100.207,7.726],[100.1676,7.8752],[100.1758,7.8866],[100.2284,7.8923],[100.2612,7.9235],[100.2973,7.9258],[100.3062,7.9444],[100.3323,7.9477],[100.3464,7.9338],[100.4472,7.5059],[100.5004,7.3564],[100.5404,7.2822],[100.5709,7.248],[100.586,7.2404],[100.5782,7.2666],[100.5893,7.2743],[100.5992,7.27],[100.5994,7.2488],[100.6084,7.2347],[100.602,7.2239],[100.6968,7.0852],[100.7691,6.9955],[100.8146,6.9638],[100.8543,6.9704],[100.9401,6.8982],[101.0164,6.8636],[101.1822,6.8746],[101.2196,6.8861],[101.2512,6.9145],[101.2897,6.8997],[101.2943,6.89],[101.3102,6.8964],[101.3281,6.8864],[101.3316,6.9004],[101.2904,6.9284],[101.2685,6.9327],[101.2399,6.9168],[101.2279,6.9217],[101.2394,6.9497],[101.2809,6.9621],[101.3154,6.9486],[101.3659,6.9113],[101.5313,6.8737],[101.5485,6.8559],[101.5659,6.851],[101.728,6.5901],[101.8161,6.4676],[101.853,6.4406],[101.8806,6.4325],[101.9619,6.3441],[102.0972,6.2506],[102.1017,6.2341],[102.0911,6.2224],[102.088,6.1922],[102.1021,6.142],[102.0616,6.0736],[101.9954,6.0295],[101.9822,6.0154],[101.9808,6.0],[101.9568,5.9774],[101.9538,5.951],[101.9418,5.9391],[101.9362,5.9178],[101.9531,5.8743],[101.946,5.8565],[101.9223,5.8344],[101.8886,5.8252],[101.8894,5.8061],[101.8728,5.7836],[101.8434,5.7793],[101.8324,5.7581],[101.8363,5.7316],[101.816,5.7231],[101.7749,5.7542],[101.756,5.7859],[101.7429,5.7733],[101.7264,5.7712],[101.7112,5.7462],[101.6844,5.7479],[101.6797,5.7714],[101.661,5.7845],[101.6482,5.8092],[101.6462,5.8612],[101.6165,5.8694],[101.6046,5.9034],[101.5926,5.9034],[101.5793,5.9184],[101.5446,5.9091],[101.4888,5.861],[101.3993,5.8633],[101.3816,5.8265],[101.3578,5.8191],[101.3493,5.7998],[101.3264,5.8023],[101.3125,5.7924],[101.2882,5.8046],[101.2792,5.8004],[101.2613,5.7615],[101.2708,5.7168],[101.2567,5.6906],[101.2314,5.678],[101.2198,5.6531],[101.1997,5.6404],[101.1782,5.6381],[101.1482,5.6059],[101.1278,5.6053],[101.1036,5.6737],[101.0729,5.7039],[101.0701,5.7161],[101.0569,5.7183],[101.0501,5.73],[101.0287,5.7297],[101.0091,5.7597],[100.9825,5.7765],[100.9734,5.8078],[100.9993,5.8397],[100.9993,5.8764],[101.0194,5.9206],[101.0353,5.9276],[101.078,5.9279],[101.0867,5.9561],[101.1095,5.9759],[101.0972,5.9883],[101.1009,6.0369],[101.0902,6.051],[101.1131,6.103],[101.0993,6.1059],[101.0849,6.1243],[101.0538,6.1328],[101.0484,6.1424],[101.0693,6.1791],[101.112,6.1941],[101.0969,6.2457],[101.0132,6.2373],[100.9758,6.2694],[100.9569,6.2556],[100.9471,6.2338],[100.9189,6.2352],[100.9008,6.2237],[100.8797,6.2424],[100.8717,6.2295],[100.8492,6.2228],[100.8254,6.2836],[100.8348,6.3142],[100.8117,6.3544],[100.8126,6.4064],[100.803,6.4349],[100.7471,6.4502],[100.7299,6.4852],[100.7168,6.464],[100.6947,6.4553],[100.69,6.4456],[100.6507,6.4331],[100.5593,6.4831],[100.5486,6.4753],[100.5143,6.4803],[100.4942,6.4932],[100.4824,6.5132],[100.4441,6.5165],[100.4215,6.5077],[100.3763,6.5324],[100.3605,6.5317],[100.3435,6.5613],[100.2961,6.601],[100.298,6.6174],[100.3133,6.6244],[100.3062,6.6361],[100.3098,6.6567],[100.2868,6.6737],[100.2804,6.6966],[100.2263,6.6835],[100.1959,6.7178],[100.1975,6.7502],[100.2047,6.7598],[100.1838,6.784],[100.1813,6.8104],[100.2087,6.8737],[100.1892,6.9002],[100.1645,6.9023],[100.1446,6.9146],[100.1173,6.9149],[100.0893,6.9544],[100.0709,6.9574],[100.0722,6.9961],[100.0538,7.0145],[100.0614,7.0412],[100.0453,7.0989],[100.0542,7.143]]]};
// AOI-END
var aoi = ee.Geometry(AOI_GEOJSON);

// PURE-BEGIN  (plain JavaScript, no Earth Engine: a line-by-line port of threshold.py and plan.py)

function binEdges(minDb, maxDb, nBins) {
  var edges = [];
  for (var i = 0; i <= nBins; i++) edges.push(minDb + i * (maxDb - minDb) / nBins);
  edges[nBins] = maxDb;
  return edges;
}

// Otsu's threshold for a histogram: {threshold, lowFraction, eta}. A run of tied edges (an empty gap
// between two classes) returns the middle of the gap.
function otsu(counts, edges) {
  var n = counts.length, total = 0, sum = 0, i, centers = [];
  for (i = 0; i < n; i++) {
    centers.push((edges[i] + edges[i + 1]) / 2);
    total += counts[i];
    sum += counts[i] * centers[i];
  }
  var between = [], w0 = 0, s0 = 0, best = 0;
  for (i = 0; i < n - 1; i++) {
    w0 += counts[i];
    s0 += counts[i] * centers[i];
    var w1 = total - w0, b = 0;
    if (w0 > 0 && w1 > 0) {
      var d = s0 / w0 - (sum - s0) / w1;
      b = w0 * w1 * d * d / (total * total);
    }
    between.push(b);
    if (b > best) best = b;
  }
  var first = -1, last = -1;
  for (i = 0; i < n - 1; i++) {
    if (between[i] >= best * (1 - 1e-9)) {
      if (first < 0) { first = i; last = i; }
      else if (i === last + 1) last = i;
      else break;
    }
  }
  var low = 0;
  for (i = 0; i <= first; i++) low += counts[i];
  var mean = sum / total, variance = 0;
  for (i = 0; i < n; i++) variance += counts[i] * (centers[i] - mean) * (centers[i] - mean);
  variance /= total;
  return {threshold: (edges[first + 1] + edges[last + 1]) / 2, lowFraction: low / total,
          eta: variance > 0 ? best / variance : 0};
}

// Centred moving average over `width` bins (odd), zero padding at both ends.
function smooth(counts, width) {
  if (width <= 1) return counts.slice();
  var half = (width - 1) / 2, out = [];
  for (var i = 0; i < counts.length; i++) {
    var s = 0;
    for (var j = i - half; j <= i + half; j++) if (j >= 0 && j < counts.length) s += counts[j];
    out.push(s / width);
  }
  return out;
}

function argmax(values, from, to) {
  var best = from;
  for (var i = from; i < to; i++) if (values[i] > values[best]) best = i;
  return best;
}

// Choose a tile's threshold: Otsu if the histogram is bimodal enough, else the fixed drop.
// Tests and reasons are those of threshold.decide.
function decide(counts, edges, o) {
  var pixels = 0, nonEmpty = 0, i;
  for (i = 0; i < counts.length; i++) { pixels += counts[i]; if (counts[i] > 0) nonEmpty++; }
  function fallback(reason, stats) {
    var d = stats || {};
    d.method = 'fallback'; d.thresholdDb = o.fallbackDb; d.reason = reason; d.pixels = pixels;
    return d;
  }
  if (pixels < o.minPixels || nonEmpty < 2) return fallback('too_few_pixels');
  var r = otsu(counts, edges);
  var stats = {otsuDb: r.threshold, lowFraction: r.lowFraction, eta: r.eta};
  if (Math.min(r.lowFraction, 1 - r.lowFraction) < o.minClassFraction) return fallback('class_too_small', stats);
  var sm = smooth(counts, o.smoothBins);
  var split = -1;
  for (i = 0; i < edges.length; i++) if (edges[i] <= r.threshold) split = i;
  split = Math.min(Math.max(split, 1), counts.length - 1);
  var lo = argmax(sm, 0, split), hi = argmax(sm, split, counts.length);
  var valley = sm[lo];
  for (i = lo; i <= hi; i++) if (sm[i] < valley) valley = sm[i];
  stats.modeLowDb = (edges[lo] + edges[lo + 1]) / 2;
  stats.modeHighDb = (edges[hi] + edges[hi + 1]) / 2;
  stats.valleyRatio = valley / Math.min(sm[lo], sm[hi]);
  if (stats.valleyRatio > o.maxValleyRatio) return fallback('no_valley', stats);
  if (stats.modeHighDb - stats.modeLowDb < o.minModeSeparationDb) return fallback('modes_too_close', stats);
  if (r.threshold < o.otsuRangeDb[0] || r.threshold > o.otsuRangeDb[1]) return fallback('out_of_range', stats);
  stats.method = 'otsu'; stats.thresholdDb = r.threshold; stats.reason = 'bimodal'; stats.pixels = pixels;
  return stats;
}

function pad(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

// Group slices into passes (same platform and absolute orbit), ordered by time.
// Pass id: UTC start time, platform, direction + relative orbit, e.g. 20241128T2318Z_S1A_D091.
function groupPasses(scenes) {
  var groups = {};
  scenes.forEach(function (s) {
    var key = s.platform + '_' + s.absolute_orbit;
    (groups[key] = groups[key] || []).push(s);
  });
  var passes = Object.keys(groups).map(function (key) {
    var g = groups[key].sort(function (a, b) { return a.time_start - b.time_start; });
    var t = new Date(g[0].time_start);
    var orbit = g[0].direction.charAt(0) + pad(g[0].relative_orbit, 3);
    return {
      passId: t.getUTCFullYear() + pad(t.getUTCMonth() + 1, 2) + pad(t.getUTCDate(), 2) + 'T' +
              pad(t.getUTCHours(), 2) + pad(t.getUTCMinutes(), 2) + 'Z_S1' + g[0].platform + '_' + orbit,
      orbit: orbit, relativeOrbit: g[0].relative_orbit, direction: g[0].direction,
      time: g[0].time_start, sceneIds: g.map(function (s) { return s.id; })
    };
  });
  return passes.sort(function (a, b) { return a.time - b.time; });
}

// [start 00:00 Bangkok, the day after end 00:00 Bangkok) as UTC milliseconds. Dates are 'YYYY-MM-DD'.
function utcMillis(start, end) {
  function midnightBangkok(text, addDays) {
    var p = text.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2] + addDays) - 7 * 3600 * 1000;
  }
  return [midnightBangkok(start, 0), midnightBangkok(end, 1)];
}

// The season a Bangkok date belongs to, and the dry windows that feed its reference.
function referenceWindows(start, seasonStart, ref) {
  var p = start.split('-'), year = +p[0];
  if (+p[1] < seasonStart[0] || (+p[1] === seasonStart[0] && +p[2] < seasonStart[1])) year -= 1;
  return ref.yearOffsets.map(function (o) {
    var y = year + o;
    return [y + '-' + pad(ref.start[0], 2) + '-' + pad(ref.start[1], 2),
            y + '-' + pad(ref.end[0], 2) + '-' + pad(ref.end[1], 2)];
  });
}

// PURE-END
if (typeof module !== 'undefined') {   // lets Node load the pure functions for a check; ignored in the Code Editor
  module.exports = {binEdges: binEdges, otsu: otsu, smooth: smooth, decide: decide, groupPasses: groupPasses,
                    utcMillis: utcMillis, referenceWindows: referenceWindows};
}

// ---------------------------------------------------------------- Earth Engine functions (ee_ops.py)

function s1Collection(startMs, endMs) {
  var col = ee.ImageCollection(P.collection)
      .filterBounds(aoi)
      .filterDate(startMs, endMs)
      .filter(ee.Filter.eq('instrumentMode', P.instrumentMode))
      .filter(ee.Filter.eq('resolution_meters', P.resolutionMeters));
  P.polarisations.forEach(function (pol) {
    col = col.filter(ee.Filter.listContains('transmitterReceiverPolarisation', pol));
  });
  return col;
}

function describe(img) {
  return ee.Feature(null, {
    id: img.get('system:index'),
    time_start: img.get('system:time_start'),
    platform: img.get('platform_number'),
    relative_orbit: img.get('relativeOrbitNumber_start'),
    absolute_orbit: img.get('orbitNumber_start'),
    direction: img.get('orbitProperties_pass')
  });
}

// Polarisation bands plus 'angle', swath edges trimmed.
function prepare(img) {
  var angle = img.select('angle');
  return img.select(P.polarisations.concat(['angle']))
      .updateMask(angle.gt(P.incidenceAngleDeg[0]).and(angle.lt(P.incidenceAngleDeg[1])));
}

function despeckle(img) {
  if (P.speckle.filter === 'none') return img;
  return img.focalMedian(P.speckle.radiusM, P.speckle.kernel, 'meters').updateMask(img.mask());
}

function staticMasks() {
  // Painted onto a constant: JRC occurrence has a partial mask that unmask() would keep (see ee_ops.py).
  var water = ee.Image.constant(0).where(ee.Image(P.water.asset).select(P.water.band).gt(P.water.minOccurrencePct), 1);
  var dem, demProjection;
  if (P.slope.demIsCollection) {
    var tiles = ee.ImageCollection(P.slope.demAsset).select(P.slope.demBand);
    demProjection = tiles.first().projection();
    dem = tiles.mosaic().setDefaultProjection(demProjection);
  } else {
    dem = ee.Image(P.slope.demAsset).select(P.slope.demBand);
    demProjection = dem.projection();
  }
  // Forced onto the DEM's own grid; otherwise slope is computed on the map's pixels (see ee_ops.py).
  var slope = ee.Terrain.slope(dem).reproject(demProjection);
  var aspect = ee.Terrain.aspect(dem).reproject(demProjection);
  var hand = ee.Image(P.hand.asset).select(P.hand.band).unmask(0);
  // Steep ground counts only above minHandM: in the floodplain the slope rule cut out banks and levees.
  var steep = slope.unmask(0).gt(P.slope.maxDeg).and(hand.gt(P.slope.minHandM));
  var high = hand.gt(P.hand.maxM);
  return {water: water, terrain: steep.or(high), steep: steep, high: high, slope: slope, aspect: aspect};
}

// 1 = layover or shadow for this orbit (Vollrath et al. 2020 angular model; limits in METHODS.md).
// Direction from the ground towards the satellite: a plane fitted to the incidence angle
// (angle ~ a + b*east + c*north); the angle falls towards the satellite. Untrimmed scenes, area plus
// 100 km. Not ee.Terrain.aspect: the angle band is a ~16 km grid (see ee_ops.look_direction).
function lookDirection(refCollection) {
  var angle = refCollection.select('angle').median();
  var stack = ee.Image.constant(1)
      .addBands(ee.Image.pixelCoordinates(ee.Projection(P.crs)).select(['x', 'y']))
      .addBands(angle).updateMask(angle.mask());
  var region = aoi.bounds(1).buffer(100000, 1000).bounds(1);
  var coef = ee.Array(stack.reduceRegion({reducer: ee.Reducer.linearRegression(3, 1), geometry: region,
    crs: P.crs, scale: 5000, maxPixels: 1e9}).get('coefficients'));
  var east = ee.Number(coef.get([1, 0])).multiply(-1);
  var north = ee.Number(coef.get([2, 0])).multiply(-1);
  return north.atan2(east).multiply(180 / Math.PI).add(360).mod(360);   // bearing, clockwise from north
}

function layoverShadow(refAngle, towardsRadar, masks) {
  if (!P.layoverShadow.enabled) return ee.Image.constant(0);
  var rad = Math.PI / 180;
  var phiR = ee.Image.constant(towardsRadar).subtract(masks.aspect).multiply(rad);
  var alphaS = masks.slope.multiply(rad);
  var theta = refAngle.multiply(rad);
  var alphaR = alphaS.tan().multiply(phiR.cos()).atan();
  var alphaAz = alphaS.tan().multiply(phiR.sin()).atan();
  var lia = alphaAz.cos().multiply(theta.subtract(alphaR).cos()).acos();
  var bad = alphaR.gte(theta).or(lia.gte(P.layoverShadow.shadowLiaDeg * rad)).unmask(0);
  if (P.layoverShadow.bufferM > 0) bad = bad.focalMax(P.layoverShadow.bufferM, 'circle', 'meters');
  return bad.rename('layover_shadow');
}

function tileIndexImage(lattice) {
  var lonlat = ee.Image.pixelLonLat();
  var col = lonlat.select('longitude').subtract(lattice.lon0).divide(lattice.size).floor();
  var row = lonlat.select('latitude').subtract(lattice.lat0).divide(lattice.size).floor();
  return row.multiply(lattice.ncols).add(col).toInt().rename('tile');
}

// The lattice of grid.tile_lattice: 0.1 deg tiles, index = row * ncols + col from the south-west.
function tileLattice(bounds, size) {
  var eps = 1e-9;
  var c0 = Math.floor(bounds[0] / size + eps), r0 = Math.floor(bounds[1] / size + eps);
  var c1 = Math.ceil(bounds[2] / size - eps), r1 = Math.ceil(bounds[3] / size - eps);
  function r6(v) { return Math.round(v * 1e6) / 1e6; }
  return {lon0: r6(c0 * size), lat0: r6(r0 * size), size: size, ncols: c1 - c0, nrows: r1 - r0};
}

// [west, south, east, north] of a GeoJSON geometry.
function geojsonBounds(geometry) {
  var b = [Infinity, Infinity, -Infinity, -Infinity];
  (function walk(node) {
    if (typeof node[0] === 'number') {
      b = [Math.min(b[0], node[0]), Math.min(b[1], node[1]), Math.max(b[2], node[0]), Math.max(b[3], node[1])];
    } else {
      node.forEach(walk);
    }
  })(geometry.coordinates);
  return b;
}

function thresholdImage(tileIndex, decisions, pol) {
  var from = [], to = [];
  Object.keys(decisions).forEach(function (tile) {
    if (decisions[tile].method === 'otsu') {
      from.push(+tile);
      to.push(Math.round(decisions[tile].thresholdDb * 100));
    }
  });
  if (from.length === 0) return ee.Image.constant(P.fallbackDropDb[pol]);
  return tileIndex.remap(from, to, Math.round(P.fallbackDropDb[pol] * 100)).divide(100);
}

function removeSmall(flood) {
  if (P.minConnectedPixels <= 1) return flood;
  var size = flood.selfMask().connectedPixelCount(P.minConnectedPixels + 1, true);
  return flood.where(size.lt(P.minConnectedPixels), 0);
}

// ---------------------------------------------------------------- run

var window_ = utcMillis(VIEW.start, VIEW.end);
var eventCollection = s1Collection(window_[0], window_[1]);
Map.centerObject(aoi, 9);
Map.addLayer(ee.Image().byte().paint(aoi, 1, 2), {palette: ['1D3B53']}, 'processing area', true);

ee.FeatureCollection(eventCollection.map(describe)).evaluate(function (result, error) {
  if (error) { print('Listing scenes failed: ' + error); return; }
  var passes = groupPasses(result.features.map(function (f) { return f.properties; }));
  print('Passes in ' + VIEW.start + ' to ' + VIEW.end + ' (Bangkok dates):',
        passes.map(function (p) { return p.passId + '  (' + p.sceneIds.length + ' scenes)'; }));
  if (passes.length === 0) return;
  var chosen = passes[0];
  if (VIEW.passId) {
    chosen = passes.filter(function (p) { return p.passId === VIEW.passId; })[0];
    if (!chosen) { print('No pass ' + VIEW.passId + ' in this window.'); return; }
  }
  showPass(chosen);
});

function showPass(pass) {
  print('Showing ' + pass.passId, pass.sceneIds);

  // Dry reference: same relative orbit and direction, median over the dry window(s).
  var windows = referenceWindows(VIEW.start, P.seasonStart, P.reference);
  var refCollection = null;
  windows.forEach(function (w) {
    var ms = utcMillis(w[0], w[1]);
    var c = s1Collection(ms[0], ms[1])
        .filter(ee.Filter.eq('relativeOrbitNumber_start', pass.relativeOrbit))
        .filter(ee.Filter.eq('orbitProperties_pass', pass.direction));
    refCollection = refCollection ? refCollection.merge(c) : c;
  });
  print('Reference windows', windows, 'reference passes (need ' + P.reference.minPasses + '):',
        refCollection.aggregate_array('orbitNumber_start').distinct().size());
  var refMedian = refCollection.map(prepare).median();
  var reference = despeckle(refMedian.select(P.polarisations));
  var refAngle = refMedian.select('angle');

  var event = ee.ImageCollection(pass.sceneIds.map(function (id) { return ee.Image(P.collection + '/' + id); }))
      .map(prepare).mosaic().select(P.polarisations);
  var eventFiltered = despeckle(event);
  var change = eventFiltered.subtract(reference);

  var masks = staticMasks();
  var layover = layoverShadow(refAngle, lookDirection(refCollection), masks);
  var observed = change.mask().reduce(ee.Reducer.min()).gt(0).unmask(0, false);
  var valid = observed.and(masks.water.or(masks.terrain).or(layover).not()).unmask(0, false);

  // Histograms per tile, valid pixels inside the area only; values clamped into the histogram range.
  var h = P.histogram;
  var nBins = Math.round((h.maxDb - h.minDb) / h.binDb);
  var lattice = tileLattice(geojsonBounds(AOI_GEOJSON), P.tileSizeDeg);
  var tiles = [];
  for (var i = 0; i < lattice.ncols * lattice.nrows; i++) {
    var row = Math.floor(i / lattice.ncols), col = i % lattice.ncols;
    tiles.push(ee.Feature(ee.Geometry.Rectangle(
        [lattice.lon0 + col * lattice.size, lattice.lat0 + row * lattice.size,
         lattice.lon0 + (col + 1) * lattice.size, lattice.lat0 + (row + 1) * lattice.size], null, false),
        {tile: i}));
  }
  var regions = ee.FeatureCollection(tiles).filterBounds(aoi);
  var clamped = change.updateMask(valid).clip(aoi).max(h.minDb).min(h.maxDb - h.binDb / 2);
  var reduced = clamped.reduceRegions({
    collection: regions, reducer: ee.Reducer.fixedHistogram(h.minDb, h.maxDb, nBins),
    scale: h.scaleM, crs: P.crs, tileScale: 2});

  Map.addLayer(eventFiltered.select('VV'), {min: -25, max: 0}, 'event VV (dB, filtered)', false);
  Map.addLayer(reference.select('VV'), {min: -25, max: 0}, 'reference VV (dB)', false);
  Map.addLayer(change.select('VV'), {min: -8, max: 8, palette: ['08306b', 'f7f7f7', '7f2704']},
               'change VV (dB)', true);
  if (P.polarisations.indexOf('VH') >= 0) {
    Map.addLayer(change.select('VH'), {min: -8, max: 8, palette: ['08306b', 'f7f7f7', '7f2704']},
                 'change VH (dB)', false);
  }
  Map.addLayer(masks.steep.selfMask(), {palette: ['8c6d31']}, 'mask: slope', false);
  Map.addLayer(masks.high.selfMask(), {palette: ['bd9e39']}, 'mask: HAND', false);
  Map.addLayer(layover.selfMask(), {palette: ['d6616b']}, 'mask: layover/shadow', false);
  Map.addLayer(masks.water.selfMask(), {palette: ['3182bd']}, 'mask: permanent water', false);

  reduced.evaluate(function (result, error) {
    if (error) { print('Histograms failed: ' + error); return; }
    var features = result.features;
    var edges = binEdges(h.minDb, h.maxDb, nBins);
    var decisions = {}, flood = {}, table = [];
    P.polarisations.forEach(function (pol) {
      decisions[pol] = {};
      features.forEach(function (f) {
        var rows = f.properties[pol] || (P.polarisations.length === 1 ? f.properties.histogram : null);
        if (!rows) return;
        var counts = rows.map(function (r) { return r[1]; });
        if (counts.reduce(function (a, b) { return a + b; }, 0) <= 0) return;
        var d = decide(counts, edges, {
          fallbackDb: P.fallbackDropDb[pol], minPixels: P.bimodality.minPixels,
          minClassFraction: P.bimodality.minClassFraction, smoothBins: P.bimodality.smoothBins,
          maxValleyRatio: P.bimodality.maxValleyRatio,
          minModeSeparationDb: P.bimodality.minModeSeparationDb, otsuRangeDb: P.otsuRangeDb});
        decisions[pol][f.properties.tile] = d;
        table.push(pol + ' tile ' + f.properties.tile + ': ' + d.method + ' ' + d.thresholdDb.toFixed(1) +
                   ' dB (' + d.reason + ', ' + Math.round(d.pixels) + ' px)');
      });
      var tileIndex = tileIndexImage(lattice);
      var threshold = thresholdImage(tileIndex, decisions[pol], pol);
      flood[pol] = removeSmall(change.select(pol).lt(threshold).unmask(0, false).and(valid)).rename(pol.toLowerCase());
      Map.addLayer(threshold.updateMask(valid), {min: -12, max: -2, palette: ['54278f', 'f2f0f7']},
                   'threshold ' + pol + ' (dB)', false);
    });
    print('Threshold per tile (tile index = row * ' + lattice.ncols + ' + col, from the south-west)', table);

    // Extent codes as in naming.CODES: 1 VV, 2 VH, 3 both, 250 terrain/layover, 251 water, 255 no data.
    var zero = ee.Image.constant(0);
    var code = (flood.VV || zero).add((flood.VH || zero).multiply(2))
        .where(valid.not(), 255)
        .where(observed.and(masks.terrain.or(layover)), 250)
        .where(observed.and(masks.water), 251)
        .toUint8().rename('extent').clip(aoi);
    Map.addLayer(code.updateMask(code.gte(250).and(code.lt(255))), {min: 250, max: 251, palette: ['bdbdbd', '3182bd']},
                 'masked (grey terrain, blue water)', false);
    Map.addLayer(code.updateMask(code.gte(1).and(code.lte(3))), {min: 1, max: 3, palette: ['e6550d', 'fdae6b', 'a63603']},
                 'flood: VV only / VH only / both', true);
    Map.addLayer(ee.Image().byte().paint(regions, 1, 1), {palette: ['969696']}, 'threshold tiles', false);
  });
}
