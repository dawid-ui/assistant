import { fileURLToPath } from "node:url";
/**
* ==================================================================================
* MOTEUR D'ANALYSE MÃCANIQUE â VWAP / BREAK & RETEST / ORDER BLOCKS
* ==================================================================================
*
* But de ce module
* -----------------
* Traduire en code les rÃ¨gles dÃ©crites dans le prompt de l'assistant (VWAP,
* Break & Retest, Order Blocks Ã  5 Ã©toiles, gestion du risque) afin que
* l'application applique ces rÃ¨gles de faÃ§on MÃCANIQUE, IDENTIQUE Ã  chaque
* analyse, sans "improviser" une confirmation qui n'existe pas dans les donnÃ©es.
*
* Ce module NE PRÃDIT RIEN. Il :
* 1. lit des donnÃ©es de marchÃ© (OHLCV) que tu lui fournis,
* 2. calcule les indicateurs nÃ©cessaires (VWAP, swings, imbalance...),
* 3. dÃ©tecte les configurations dÃ©crites dans le prompt,
* 4. calcule un score objectif (ex: Order Block 5 Ã©toiles),
* 5. calcule le R:R si un stop et un objectif existent,
* 6. rend un VERDICT parmi les 3 seuls possibles :
* "SETUP VALIDÃ" / "ATTENDRE CONFIRMATION" / "PAS DE TRADE"
*
* Si les donnÃ©es ne permettent pas de confirmer un critÃ¨re, le moteur renvoie
* explicitement `null` / "NON VALIDÃ" plutÃ´t que d'inventer une confirmation.
* C'est la traduction directe de la "RÃGLE ABSOLUE" du prompt.
*
* DÃ©pendances : aucune (uniquement le Node.js standard â pas de pandas/numpy,
* les opÃ©rations vectorielles sont rÃ©implÃ©mentÃ©es Ã  la main sur des tableaux
* d'objets simples).
*
* EntrÃ©e attendue
* ---------------
* Un tableau d'objets (Ã©quivalent d'un DataFrame pandas) avec au minimum les
* clÃ©s : timestamp (Date ou string convertible), open, high, low, close, volume
*
* Utilisation rapide
* -------------------
* import { MarketAnalyzer } from "./tradingRulesEngine.mjs";
*
* const analyzer = new MarketAnalyzer(rows, "EURUSD", "5m");
* const report = analyzer.runFullAnalysis();
* console.log(report.toText());
*/
// ==================================================================================
// UTILITAIRES NUMÃRIQUES (Ã©quivalents "Ã  la main" de pandas/numpy)
// ==================================================================================
/** Arrondit une valeur Ã  `digits` dÃ©cimales ; propage `null`. */
function round(value, digits) {
if (value === null || value === undefined || Number.isNaN(value)) return null;
const factor = 10 ** digits;
return Math.round(value * factor) / factor;
}
/**
* Moyenne mobile glissante (Ã©quivalent de `Series.rolling(period).mean()`).
* Retourne `null` tant que la fenÃªtre n'est pas complÃ¨te, ou si la fenÃªtre
* contient une valeur `null` (propagation faÃ§on NaN de pandas).
*/
function rollingMean(arr, period) {
const out = new Array(arr.length).fill(null);
for (let i = period - 1; i < arr.length; i++) {
let sum = 0;
let valid = true;
for (let j = i - period + 1; j <= i; j++) {
const v = arr[j];
if (v === null || v === undefined || Number.isNaN(v)) {
valid = false;
break;
}
sum += v;
}
out[i] = valid ? sum / period : null;
}
return out;
}
/** Ãcart-type mobile (Ã©chantillon, ddof=1, comme `Series.rolling(period).std()`). */
function rollingStd(arr, period) {
const out = new Array(arr.length).fill(null);
for (let i = period - 1; i < arr.length; i++) {
const window = arr.slice(i - period + 1, i + 1);
if (window.some((v) => v === null || v === undefined || Number.isNaN(v))) continue;
const mean = window.reduce((a, b) => a + b, 0) / period;
const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (period - 1);
out[i] = Math.sqrt(variance);
}
return out;
}
/** Variation en pourcentage sur `period` pas (Ã©quivalent `Series.pct_change(period)`). */
function pctChange(arr, period) {
const out = new Array(arr.length).fill(null);
for (let i = period; i < arr.length; i++) {
out[i] = (arr[i] - arr[i - period]) / arr[i - period];
}
return out;
}
// ==================================================================================
// STRUCTURES DE DONNÃES
// ==================================================================================
class OrderBlock {
/**
* @param {number} index Index (position) de la bougie de l'Order Block
* @param {"haussier"|"baissier"} direction
* @param {number} high
* @param {number} low
* @param {number} open_
* @param {number} close
*/
constructor(index, direction, high, low, open_, close) {
this.index = index;
this.direction = direction;
this.high = high;
this.low = low;
this.open = open_;
this.close = close;
// Les 5 Ã©toiles â chacune est true / false / null (indÃ©terminable)
this.imbalanceValidee = null;
this.contexteDirectionnelValide = null;
this.liquiditeFavorable = null;
this.niveauVierge = null;
this.premiumDiscountValide = null;
}
/** Nombre de critÃ¨res VALIDÃS parmi les 5 (null compte comme non validÃ©). */
score() {
const criteres = [
this.imbalanceValidee,
this.contexteDirectionnelValide,
this.liquiditeFavorable,
this.niveauVierge,
this.premiumDiscountValide,
];
return criteres.filter((c) => c === true).length;
}
/**
* RÃ¨gle stricte du prompt : l'imbalance est le critÃ¨re OBLIGATOIRE.
* Sans lui, l'Order Block n'est JAMAIS prÃ©sentÃ© comme un setup valide,
* mÃªme si le score total est Ã©levÃ©.
*/
estUtilisableSelonLaMethode() {
return this.imbalanceValidee === true;
}
}
class TradePlan {
/**
* @param {object} params
* @param {number|null} [params.entree]
* @param {number|null} [params.stop]
* @param {number|null} [params.objectif]
* @param {"achat"|"vente"|null} [params.direction]
*/
constructor({ entree = null, stop = null, objectif = null, direction = null } = {}) {
this.entree = entree;
this.stop = stop;
this.objectif = objectif;
this.direction = direction;
}
get risqueParUnite() {
if (this.entree === null || this.stop === null) return null;
return Math.abs(this.entree - this.stop);
}
get gainPotentiel() {
if (this.entree === null || this.objectif === null) return null;
return Math.abs(this.objectif - this.entree);
}
/** R:R = Gain potentiel / Risque potentiel â jamais inventÃ© si donnÃ©es manquantes. */
get rr() {
const risque = this.risqueParUnite;
const gain = this.gainPotentiel;
if (!risque || !gain || risque === 0) return null;
return round(gain / risque, 2);
}
estComplet() {
return this.entree !== null && this.stop !== null && this.objectif !== null;
}
}
class AnalysisReport {
/** Structure exacte du FORMAT DE RÃPONSE dÃ©fini dans le prompt. */
constructor(symbol, timeframe) {
this.symbol = symbol;
this.timeframe = timeframe;
this.contexte = "";
this.setupIdentifie = "Aucun setup identifiÃ©";
this.validation = [];
this.liquidite = [];
this.invalidation = "";
/** @type {TradePlan|null} */
this.plan = null;
/** @type {"SETUP VALIDÃ"|"ATTENDRE CONFIRMATION"|"PAS DE TRADE"} */
this.verdict = "PAS DE TRADE";
this.limitesDonnees = [];
}
toText() {
const lines = [];
lines.push(`ð CONTEXTE (${this.symbol} â ${this.timeframe})`);
lines.push(this.contexte || "Je ne peux pas confirmer ce point avec les donnÃ©es actuellement disponibles.");
lines.push("");
lines.push("ð¯ SETUP IDENTIFIÃ");
lines.push(this.setupIdentifie);
lines.push("");
lines.push("ð§  VALIDATION");
lines.push(...(this.validation.length ? this.validation : ["Aucun critÃ¨re validÃ© sur les donnÃ©es fournies."]));
lines.push("");
lines.push("ð§ LIQUIDITÃ");
lines.push(...(this.liquidite.length ? this.liquidite : ["Aucune zone de liquiditÃ© significative dÃ©tectÃ©e."]));
lines.push("");
lines.push("â ï¸ INVALIDATION");
lines.push(this.invalidation || "Non dÃ©terminable avec les donnÃ©es actuelles.");
lines.push("");
lines.push("ð PLAN");
if (this.plan && this.plan.estComplet()) {
const p = this.plan;
lines.push(`Direction : ${p.direction}`);
lines.push(`EntrÃ©e : ${p.entree}`);
lines.push(`Stop : ${p.stop} (risque/unitÃ© : ${p.risqueParUnite})`);
lines.push(`Objectif : ${p.objectif} (gain potentiel : ${p.gainPotentiel})`);
lines.push(`R:R : ${p.rr}`);
} else {
lines.push("Je ne peux pas confirmer ce point avec les donnÃ©es actuellement disponibles.");
}
if (this.limitesDonnees.length) {
lines.push("");
lines.push("Limites signalÃ©es :");
lines.push(...this.limitesDonnees.map((l) => `- ${l}`));
}
lines.push("");
lines.push(`ð VERDICT : ${this.verdict}`);
return lines.join("\n");
}
}
// ==================================================================================
// MOTEUR PRINCIPAL
// ==================================================================================
// ============================================================================
// CANDLESTICK INTELLIGENCE — ANALYSE OBJECTIVE DES BOUGIES
// ============================================================================

function analyzeCandle(candle, previousCandles = []) {
  if (!candle) return null;

  const { open, high, low, close, volume } = candle;

  const range = Math.max(high - low, Number.EPSILON);
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  const bullish = close > open;
  const bearish = close < open;
  const bodyPct = body / range;
  const upperWickPct = upperWick / range;
  const lowerWickPct = lowerWick / range;

  const patterns = [];

  // --- DOJI ---
  if (bodyPct <= 0.10) {
    patterns.push({
      name: "Doji",
      meaning: "Indécision : aucune direction n'est confirmée par cette bougie seule."
    });
  }

  // --- MARUBOZU ---
  if (bodyPct >= 0.90 && upperWickPct <= 0.05 && lowerWickPct <= 0.05) {
    patterns.push({
      name: bullish ? "Marubozu haussier" : "Marubozu baissier",
      meaning: "Forte domination directionnelle pendant cette période."
    });
  }

  // --- HAMMER / SHOOTING STAR ---
  if (bodyPct <= 0.40 && lowerWick >= body * 2 && upperWick <= body * 0.75) {
    patterns.push({
      name: bullish ? "Hammer potentiel" : "Hanging Man potentiel",
      meaning: "Rejet des prix bas. La confirmation dépend du contexte et des bougies suivantes."
    });
  }

  if (bodyPct <= 0.40 && upperWick >= body * 2 && lowerWick <= body * 0.75) {
    patterns.push({
      name: bullish ? "Inverted Hammer potentiel" : "Shooting Star potentiel",
      meaning: "Rejet des prix hauts. La confirmation dépend du contexte et des bougies suivantes."
    });
  }

  // --- TENDANCE RÉCENTE ---
  let trend = "indéterminée";

  if (previousCandles.length >= 3) {
    const closes = previousCandles.slice(-5).map((c) => c.close);
    const first = closes[0];
    const last = closes[closes.length - 1];

    if (last > first) trend = "haussière";
    else if (last < first) trend = "baissière";
    else trend = "range";
  }

  // --- VOLUME RELATIF ---
  let volumeContext = "volume indisponible";

  if (
    Number.isFinite(volume) &&
    previousCandles.length >= 5
  ) {
    const volumes = previousCandles
      .slice(-20)
      .map((c) => c.volume)
      .filter(Number.isFinite);

    if (volumes.length) {
      const avgVolume =
        volumes.reduce((sum, v) => sum + v, 0) / volumes.length;

      if (volume >= avgVolume * 1.5) {
        volumeContext = "volume nettement supérieur à la moyenne récente";
      } else if (volume <= avgVolume * 0.6) {
        volumeContext = "volume inférieur à la moyenne récente";
      } else {
        volumeContext = "volume proche de la moyenne récente";
      }
    }
  }

  return {
    direction: bullish ? "haussière" : bearish ? "baissière" : "neutre",
    open,
    high,
    low,
    close,
    range,
    body,
    upperWick,
    lowerWick,
    bodyPct,
    patterns,
    trendBeforeCandle: trend,
    volumeContext,
    limitation:
      "Une forme de bougie seule ne constitue pas une prédiction ni une confirmation de trade."
  };
}


// ============================================================================
// PATTERNS À PLUSIEURS BOUGIES
// ============================================================================

function detectCandlestickPatterns(candles) {
  if (!Array.isArray(candles) || candles.length < 2) {
    return [];
  }

  const patterns = [];
  const a = candles[candles.length - 2];
  const b = candles[candles.length - 1];

  const aBull = a.close > a.open;
  const aBear = a.close < a.open;
  const bBull = b.close > b.open;
  const bBear = b.close < b.open;

  // ENGULFING HAUSSIER
  if (
    aBear &&
    bBull &&
    b.open <= a.close &&
    b.close >= a.open
  ) {
    patterns.push({
      name: "Bullish Engulfing",
      direction: "haussière",
      confirmationRequired: true,
      meaning:
        "Le corps haussier recouvre le corps baissier précédent. Son importance dépend du contexte."
    });
  }

  // ENGULFING BAISSIER
  if (
    aBull &&
    bBear &&
    b.open >= a.close &&
    b.close <= a.open
  ) {
    patterns.push({
      name: "Bearish Engulfing",
      direction: "baissière",
      confirmationRequired: true,
      meaning:
        "Le corps baissier recouvre le corps haussier précédent. Son importance dépend du contexte."
    });
  }

  // INSIDE BAR
  if (b.high < a.high && b.low > a.low) {
    patterns.push({
      name: "Inside Bar",
      direction: "neutre",
      confirmationRequired: true,
      meaning:
        "Compression de volatilité. La direction de la sortie n'est pas connue à l'avance."
    });
  }

  // OUTSIDE BAR
  if (b.high > a.high && b.low < a.low) {
    patterns.push({
      name: "Outside Bar",
      direction: bBull ? "haussière" : bBear ? "baissière" : "neutre",
      confirmationRequired: true,
      meaning:
        "Expansion de volatilité et prise des extrêmes de la bougie précédente."
    });
  }

  return patterns;
}
// ============================================================================
// CHART PATTERN INTELLIGENCE
// Détection objective de patterns graphiques à partir de données OHLCV.
//
// Principe :
// - DETECTED = critères suffisamment remplis
// - POSSIBLE = structure ressemblante mais incomplète
// - NON DETECTE = aucun pattern ne satisfait les critères
//
// Ce module ne prédit pas le futur et ne génère aucun ordre.
// ============================================================================


// ============================================================================
// OUTILS
// ============================================================================

function average(values) {
  if (!values || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentageDifference(a, b) {
  const denominator = Math.max(Math.abs(a), Math.abs(b), Number.EPSILON);
  return Math.abs(a - b) / denominator;
}

function isBullish(candle) {
  return candle.close > candle.open;
}

function isBearish(candle) {
  return candle.close < candle.open;
}


// ============================================================================
// DÉTECTION DES SWINGS
// ============================================================================

function findSwingPoints(candles, lookback = 3) {
  if (!Array.isArray(candles) || candles.length < lookback * 2 + 1) {
    return { highs: [], lows: [] };
  }

  const highs = [];
  const lows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const candle = candles[i];

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;

      if (candles[j].high >= candle.high) isSwingHigh = false;
      if (candles[j].low <= candle.low) isSwingLow = false;
    }

    if (isSwingHigh) {
      highs.push({
        index: i,
        price: candle.high
      });
    }

    if (isSwingLow) {
      lows.push({
        index: i,
        price: candle.low
      });
    }
  }

  return { highs, lows };
}


// ============================================================================
// DOUBLE TOP / DOUBLE BOTTOM
// ============================================================================

function detectDoubleTop(swings) {
  if (swings.highs.length < 2) return null;

  const points = swings.highs.slice(-2);
  const [first, second] = points;

  const similarity = percentageDifference(first.price, second.price);

  if (similarity <= 0.015) {
    return {
      name: "Double Top",
      family: "Reversal",
      direction: "baissière potentielle",
      status: "POSSIBLE",
      confidence: "structure détectée",
      confirmation:
        "Une cassure confirmée du creux situé entre les deux sommets est nécessaire.",
      invalidation:
        "Retour durable au-dessus des sommets du pattern.",
      points
    };
  }

  return null;
}

function detectDoubleBottom(swings) {
  if (swings.lows.length < 2) return null;

  const points = swings.lows.slice(-2);
  const [first, second] = points;

  const similarity = percentageDifference(first.price, second.price);

  if (similarity <= 0.015) {
    return {
      name: "Double Bottom",
      family: "Reversal",
      direction: "haussière potentielle",
      status: "POSSIBLE",
      confidence: "structure détectée",
      confirmation:
        "Une cassure confirmée du sommet situé entre les deux creux est nécessaire.",
      invalidation:
        "Retour durable sous les creux du pattern.",
      points
    };
  }

  return null;
}


// ============================================================================
// TRIPLE TOP / TRIPLE BOTTOM
// ============================================================================

function detectTripleBottom(swings) {
  if (swings.lows.length < 3) return null;

  const points = swings.lows.slice(-3);
  const prices = points.map((point) => point.price);

  const max = Math.max(...prices);
  const min = Math.min(...prices);

  if (percentageDifference(max, min) <= 0.02) {
    return {
      name: "Triple Bottom",
      family: "Reversal",
      direction: "haussière potentielle",
      status: "POSSIBLE",
      confirmation: "Cassure confirmée de la résistance du pattern.",
      invalidation: "Cassure durable sous les trois zones de creux.",
      points
    };
  }

  return null;
}

function detectTripleTop(swings) {
  if (swings.highs.length < 3) return null;

  const points = swings.highs.slice(-3);
  const prices = points.map((point) => point.price);

  const max = Math.max(...prices);
  const min = Math.min(...prices);

  if (percentageDifference(max, min) <= 0.02) {
    return {
      name: "Triple Top",
      family: "Reversal",
      direction: "baissière potentielle",
      status: "POSSIBLE",
      confirmation: "Cassure confirmée du support du pattern.",
      invalidation: "Cassure durable au-dessus des sommets.",
      points
    };
  }

  return null;
}


// ============================================================================
// HEAD & SHOULDERS / INVERSE HEAD & SHOULDERS
// ============================================================================

function detectHeadAndShoulders(swings) {
  if (swings.highs.length < 3) return null;

  const [left, head, right] = swings.highs.slice(-3);

  const shouldersSimilar =
    percentageDifference(left.price, right.price) <= 0.03;

  const headHigher =
    head.price > left.price && head.price > right.price;

  if (shouldersSimilar && headHigher) {
    return {
      name: "Head & Shoulders",
      family: "Reversal",
      direction: "baissière potentielle",
      status: "POSSIBLE",
      confirmation: "Cassure confirmée de la neckline.",
      invalidation: "Retour durable au-dessus du sommet de la tête.",
      points: [left, head, right]
    };
  }

  return null;
}

function detectInverseHeadAndShoulders(swings) {
  if (swings.lows.length < 3) return null;

  const [left, head, right] = swings.lows.slice(-3);

  const shouldersSimilar =
    percentageDifference(left.price, right.price) <= 0.03;

  const headLower =
    head.price < left.price && head.price < right.price;

  if (shouldersSimilar && headLower) {
    return {
      name: "Inverse Head & Shoulders",
      family: "Reversal",
      direction: "haussière potentielle",
      status: "POSSIBLE",
      confirmation: "Cassure confirmée de la neckline.",
      invalidation: "Retour durable sous le creux de la tête.",
      points: [left, head, right]
    };
  }

  return null;
}


// ============================================================================
// TRIANGLES
// ============================================================================

function getSlope(first, last) {
  const distance = last.index - first.index;
  if (distance === 0) return 0;

  return (last.price - first.price) / distance;
}

function detectTriangles(swings) {
  const results = [];

  if (swings.highs.length < 2 || swings.lows.length < 2) {
    return results;
  }

  const highs = swings.highs.slice(-3);
  const lows = swings.lows.slice(-3);

  const highSlope = getSlope(highs[0], highs[highs.length - 1]);
  const lowSlope = getSlope(lows[0], lows[lows.length - 1]);

  const highPrices = highs.map((point) => point.price);
  const lowPrices = lows.map((point) => point.price);

  const highFlat =
    percentageDifference(Math.max(...highPrices), Math.min(...highPrices)) <= 0.015;

  const lowFlat =
    percentageDifference(Math.max(...lowPrices), Math.min(...lowPrices)) <= 0.015;

  // Ascending Triangle
  if (highFlat && lowSlope > 0) {
    results.push({
      name: "Ascending Triangle",
      family: "Continuation / Breakout",
      direction: "haussière potentielle",
      status: "POSSIBLE",
      confirmation: "Cassure confirmée au-dessus de la résistance.",
      invalidation: "Rupture durable sous la structure ascendante."
    });
  }

  // Descending Triangle
  if (lowFlat && highSlope < 0) {
    results.push({
      name: "Descending Triangle",
      family: "Continuation / Breakout",
      direction: "baissière potentielle",
      status: "POSSIBLE",
      confirmation: "Cassure confirmée sous le support.",
      invalidation: "Rupture durable au-dessus de la structure descendante."
    });
  }

  // Symmetrical Triangle
  if (highSlope < 0 && lowSlope > 0) {
    results.push({
      name: "Symmetrical Triangle",
      family: "Continuation / Breakout",
      direction: "neutre avant confirmation",
      status: "POSSIBLE",
      confirmation: "La direction doit être déterminée par une cassure confirmée.",
      invalidation: "Expansion de la structure dans le sens opposé."
    });
  }

  return results;
}


// ============================================================================
// RECTANGLE / RANGE
// ============================================================================

function detectRectangle(swings) {
  if (swings.highs.length < 2 || swings.lows.length < 2) {
    return null;
  }

  const highs = swings.highs.slice(-4).map((point) => point.price);
  const lows = swings.lows.slice(-4).map((point) => point.price);

  const highVariation =
    percentageDifference(Math.max(...highs), Math.min(...highs));

  const lowVariation =
    percentageDifference(Math.max(...lows), Math.min(...lows));

  if (highVariation <= 0.02 && lowVariation <= 0.02) {
    return {
      name: "Rectangle / Range",
      family: "Consolidation",
      direction: "neutre avant breakout",
      status: "DETECTED",
      confirmation:
        "La direction future reste inconnue tant qu'une sortie confirmée n'a pas lieu.",
      invalidation:
        "Le pattern cesse d'être valide si les bornes ne contiennent plus le prix."
    };
  }

  return null;
}


// ============================================================================
// CHANNELS
// ============================================================================

function detectChannels(swings) {
  const results = [];

  if (swings.highs.length < 2 || swings.lows.length < 2) {
    return results;
  }

  const highs = swings.highs.slice(-3);
  const lows = swings.lows.slice(-3);

  const highSlope = getSlope(highs[0], highs[highs.length - 1]);
  const lowSlope = getSlope(lows[0], lows[lows.length - 1]);

  // Les pentes doivent avoir la même direction.
  if (highSlope > 0 && lowSlope > 0) {
    results.push({
      name: "Ascending Channel",
      family: "Trend Channel",
      direction: "haussière structurelle",
      status: "POSSIBLE",
      confirmation: "Plusieurs contacts cohérents avec les deux bornes.",
      invalidation: "Cassure durable de la structure du canal."
    });
  }

  if (highSlope < 0 && lowSlope < 0) {
    results.push({
      name: "Descending Channel",
      family: "Trend Channel",
      direction: "baissière structurelle",
      status: "POSSIBLE",
      confirmation: "Plusieurs contacts cohérents avec les deux bornes.",
      invalidation: "Cassure durable de la structure du canal."
    });
  }

  return results;
}


// ============================================================================
// WEDGES
// ============================================================================

function detectWedges(swings) {
  const results = [];

  if (swings.highs.length < 2 || swings.lows.length < 2) {
    return results;
  }

  const highs = swings.highs.slice(-3);
  const lows = swings.lows.slice(-3);

  const highSlope = getSlope(highs[0], highs[highs.length - 1]);
  const lowSlope = getSlope(lows[0], lows[lows.length - 1]);

  // Rising Wedge : deux lignes montantes qui convergent.
  if (highSlope > 0 && lowSlope > 0 && lowSlope > highSlope) {
    results.push({
      name: "Rising Wedge",
      family: "Wedge",
      direction: "à confirmer",
      status: "POSSIBLE",
      confirmation: "La direction dépend de la sortie confirmée du wedge.",
      invalidation: "Perte de la géométrie convergente."
    });
  }

  // Falling Wedge : deux lignes descendantes qui convergent.
  if (highSlope < 0 && lowSlope < 0 && highSlope > lowSlope) {
    results.push({
      name: "Falling Wedge",
      family: "Wedge",
      direction: "à confirmer",
      status: "POSSIBLE",
      confirmation: "La direction dépend de la sortie confirmée du wedge.",
      invalidation: "Perte de la géométrie convergente."
    });
  }

  return results;
}


// ============================================================================
// BIBLIOTHÈQUE DES PATTERNS PRIS EN CHARGE / À ÉTENDRE
// ============================================================================

const CHART_PATTERN_LIBRARY = {
  implemented: [
    "Double Top",
    "Double Bottom",
    "Triple Top",
    "Triple Bottom",
    "Head & Shoulders",
    "Inverse Head & Shoulders",
    "Ascending Triangle",
    "Descending Triangle",
    "Symmetrical Triangle",
    "Rectangle",
    "Ascending Channel",
    "Descending Channel",
    "Rising Wedge",
    "Falling Wedge"
  ],

  // Ces patterns sont prévus pour une extension spécialisée.
  // Ils ne doivent PAS être déclarés détectés tant que leur détecteur
  // mathématique spécifique n'est pas ajouté.
  planned: [
    "Bull Flag",
    "Bear Flag",
    "Bullish Pennant",
    "Bearish Pennant",
    "Megaphone / Broadening Formation",
    "Three Drives",
    "AB=CD",
    "Adam & Eve",
    "Quasimodo",
    "Dragon Pattern",
    "Bump and Run",
    "Cup and Handle",
    "Harmonic Patterns"
  ]
};


// ============================================================================
// ANALYSE PRINCIPALE DES PATTERNS
// ============================================================================

function detectChartPatterns(candles) {
  if (!Array.isArray(candles) || candles.length < 10) {
    return {
      status: "INSUFFICIENT_DATA",
      patterns: [],
      message:
        "Données insuffisantes pour analyser les patterns graphiques."
    };
  }

  const swings = findSwingPoints(candles);
  const detectedPatterns = [];

  const detectors = [
    detectDoubleTop(swings),
    detectDoubleBottom(swings),
    detectTripleTop(swings),
    detectTripleBottom(swings),
    detectHeadAndShoulders(swings),
    detectInverseHeadAndShoulders(swings),
    detectRectangle(swings)
  ];

  for (const result of detectors) {
    if (result) detectedPatterns.push(result);
  }

  detectedPatterns.push(...detectTriangles(swings));
  detectedPatterns.push(...detectChannels(swings));
  detectedPatterns.push(...detectWedges(swings));

  // Évite les doublons éventuels.
  const uniquePatterns = [
    ...new Map(
      detectedPatterns.map((pattern) => [pattern.name, pattern])
    ).values()
  ];

  if (uniquePatterns.length === 0) {
    return {
      status: "NO_PATTERN_DETECTED",
      patterns: [],
      message:
        "Pattern non détecté : aucune structure disponible ne satisfait suffisamment les critères de la bibliothèque actuelle.",
      availableLibrary: CHART_PATTERN_LIBRARY.implemented
    };
  }

  return {
    status: "PATTERN_FOUND",
    patterns: uniquePatterns,
    swings,
    limitation:
      "Un pattern détecté représente une structure observée, pas une prédiction garantie. Une confirmation contextuelle et des données suffisantes restent nécessaires."
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

export {
  analyzeCandle,
  detectCandlestickPatterns,
  detectChartPatterns,
  findSwingPoints,
  CHART_PATTERN_LIBRARY
};
class MarketAnalyzer {
static REQUIRED_COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"];
static STRATEGIES_DISPONIBLES = [
"market_structure", "support_resistance", "vwap", "breakout_retest",
"liquidity_sweep", "amd", "trend_momentum", "mean_reversion",
"fair_value_gap", "liquidity_run_sweep", "orb", "double_top_bottom",
"rsi_divergence", "auto",
];
/**
* @param {Array<object>} rows Tableau d'objets OHLCV (Ã©quivalent du DataFrame pandas)
* @param {string} symbol
* @param {string} timeframe
* @param {number} [rrMinimum=1.8]
*/
constructor(rows, symbol, timeframe, rrMinimum = 1.8) {
if (!Array.isArray(rows) || rows.length === 0) {
throw new Error("`rows` doit Ãªtre un tableau non vide d'objets OHLCV.");
}
const missing = MarketAnalyzer.REQUIRED_COLUMNS.filter((col) => !(col in rows[0]));
if (missing.length) {
throw new Error(`Colonnes manquantes dans les donnÃ©es : ${missing.join(", ")}`);
}
// Copie triÃ©e par timestamp croissant (Ã©quivalent de
// df.sort_values("timestamp").reset_index(drop=True))
this.df = rows
.map((r) => ({ ...r }))
.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
this.symbol = symbol;
this.timeframe = timeframe;
this.rrMinimum = rrMinimum;
this._computeVwap();
// Registre des stratÃ©gies ajoutÃ©es par l'utilisateur (voir section
// "ESPACE LIBRE" tout en bas du fichier). ClÃ© = nom de la stratÃ©gie,
// valeur = fonction(analyzer) -> objet avec au minimum les clÃ©s
// {setupIdentifie, details, confirme}.
this.customStrategies = new Map();
}
/**
* Enregistre une stratÃ©gie personnalisÃ©e pour qu'elle soit utilisable
* via runFullAnalysis({strategie: name}). `func` doit prendre uniquement
* l'analyzer et retourner un objet avec au minimum :
* {setupIdentifie: string, details: string[], confirme: boolean}
* Voir la section "ESPACE LIBRE POUR TES PROPRES STRATÃGIES" en bas du
* fichier pour un exemple complet prÃªt Ã  copier-coller.
*/
registerStrategy(name, func) {
this.customStrategies.set(name, func);
}
// ------------------------------------------------------------------ VWAP ----
/** VWAP intraday cumulatif (remis Ã  zÃ©ro si la clÃ© 'session' existe). */
_computeVwap() {
const df = this.df;
if (df.length === 0) return;
const hasSession = Object.prototype.hasOwnProperty.call(df[0], "session");
if (hasSession) {
const cumPv = {};
const cumVol = {};
for (const r of df) {
const typicalPrice = (r.high + r.low + r.close) / 3;
const key = r.session;
cumPv[key] = (cumPv[key] || 0) + typicalPrice * r.volume;
cumVol[key] = (cumVol[key] || 0) + r.volume;
r.vwap = cumPv[key] / cumVol[key];
}
} else {
let cumPv = 0;
let cumVol = 0;
for (const r of df) {
const typicalPrice = (r.high + r.low + r.close) / 3;
cumPv += typicalPrice * r.volume;
cumVol += r.volume;
r.vwap = cumPv / cumVol;
}
}
}
// ------------------------------------------------------------ STRUCTURE ----
/**
* DÃ©tecte les swing highs / swing lows locaux (pivot simple), utilisÃ©s
* pour la liquiditÃ©, l'invalidation et les niveaux de S/R.
*/
_swingPoints(lookback = 3) {
const df = this.df;
const highs = [];
const lows = [];
for (let i = lookback; i < df.length - lookback; i++) {
const windowH = df.slice(i - lookback, i + lookback + 1).map((r) => r.high);
const windowL = df.slice(i - lookback, i + lookback + 1).map((r) => r.low);
if (df[i].high === Math.max(...windowH)) highs.push(i);
if (df[i].low === Math.min(...windowL)) lows.push(i);
}
const points = [
...highs.map((i) => ({ index: i, type: "swing_high" })),
...lows.map((i) => ({ index: i, type: "swing_low" })),
];
points.sort((a, b) => a.index - b.index);
return points;
}
/** DÃ©tecte les equal highs / equal lows (poches de liquiditÃ© classiques). */
_equalLevels(points, tolerancePct = 0.001) {
const results = [];
for (const kind of ["swing_high", "swing_low"]) {
const col = kind === "swing_high" ? "high" : "low";
const idxs = points.filter((p) => p.type === kind).map((p) => p.index);
const used = new Set();
for (let i = 0; i < idxs.length; i++) {
if (used.has(idxs[i])) continue;
const cluster = [idxs[i]];
const base = this.df[idxs[i]][col];
for (let j = i + 1; j < idxs.length; j++) {
const val = this.df[idxs[j]][col];
if (Math.abs(val - base) / base <= tolerancePct) {
cluster.push(idxs[j]);
used.add(idxs[j]);
}
}
if (cluster.length > 1) {
const level = cluster.reduce((s, idx) => s + this.df[idx][col], 0) / cluster.length;
results.push({ type: `equal_${kind}`, indices: cluster, level });
}
}
}
return results;
}
// ----------------------------------------------------------- VWAP SETUPS ----
/**
* Cherche, sur les derniÃ¨res bougies, un Bounce, un Reject ou un
* Break & Retest du VWAP. Retourne un objet dÃ©crivant ce qui a Ã©tÃ©
* OBSERVÃ (jamais une extrapolation).
*/
detectVwapSetup(reactionWindow = 3, minWickRatio = 0.3) {
const df = this.df;
const last = df.slice(-reactionWindow);
const vwapNow = df[df.length - 1].vwap;
const priceNow = df[df.length - 1].close;
const touchedVwap = last.some((r) => r.low <= r.vwap && r.high >= r.vwap);
const closedAboveBefore = df.length > reactionWindow
? df[df.length - reactionWindow - 1].close > df[df.length - reactionWindow - 1].vwap
: null;
const candle = last[last.length - 1];
const fullRange = candle.high - candle.low;
const upperWick = candle.high - Math.max(candle.close, candle.open);
const lowerWick = Math.min(candle.close, candle.open) - candle.low;
const wickRatioUp = fullRange ? upperWick / fullRange : 0;
const wickRatioDown = fullRange ? lowerWick / fullRange : 0;
const setup = { type: null, direction: null, details: [], confirme: false };
if (!touchedVwap) {
setup.details.push(
"Le prix n'a pas touchÃ© le VWAP sur la fenÃªtre observÃ©e â aucune configuration VWAP Ã  signaler."
);
return setup;
}
// REJECT : mÃ¨che marquÃ©e dans la direction opposÃ©e au franchissement + clÃ´ture qui s'Ã©loigne
if (closedAboveBefore === true && priceNow < vwapNow && wickRatioUp >= minWickRatio) {
setup.type = "VWAP Reject";
setup.direction = "baissier";
setup.confirme = true;
setup.details.push(
"Le prix Ã©tait au-dessus du VWAP, a tentÃ© de le retraverser Ã  la baisse, une mÃ¨che " +
"significative marque un rejet, et la clÃ´ture reste sous le niveau."
);
} else if (closedAboveBefore === false && priceNow > vwapNow && wickRatioDown >= minWickRatio) {
setup.type = "VWAP Reject";
setup.direction = "haussier";
setup.confirme = true;
setup.details.push(
"Le prix Ã©tait sous le VWAP, a tentÃ© de le retraverser Ã  la hausse, une mÃ¨che " +
"significative marque un rejet, et la clÃ´ture repasse au-dessus du niveau."
);
} else if (closedAboveBefore === true && priceNow > vwapNow) {
// BOUNCE : le prix revient au VWAP et repart dans le sens de la tendance prÃ©cÃ©dente
setup.type = "VWAP Bounce";
setup.direction = "haussier";
setup.confirme = true;
setup.details.push(
"Le prix est revenu vers le VWAP, le niveau a tenu, et le prix a rebondi en clÃ´turant au-dessus."
);
} else if (closedAboveBefore === false && priceNow < vwapNow) {
setup.type = "VWAP Bounce";
setup.direction = "baissier";
setup.confirme = true;
setup.details.push(
"Le prix est revenu vers le VWAP, le niveau a tenu Ã  la baisse, et le prix a rebondi " +
"en clÃ´turant sous le niveau."
);
} else {
setup.details.push(
"Contact avec le VWAP observÃ©, mais la rÃ©action du prix n'est pas assez nette pour " +
"confirmer un Bounce ou un Reject selon les critÃ¨res dÃ©finis."
);
}
return setup;
}
// ---------------------------------------------------- BREAK & RETEST -----
/**
* VÃ©rifie, pour un niveau de S/R donnÃ©, si :
* 1. une clÃ´ture a validÃ© la cassure (pas seulement une mÃ¨che),
* 2. un retour vers la zone a eu lieu,
* 3. le comportement du prix confirme la dÃ©fense du niveau dans la
* nouvelle direction.
* Ne retourne "confirme": true QUE si les 3 conditions sont observÃ©es.
*/
detectBreakAndRetest(level, direction, retestTolerancePct = 0.0015) {
const df = this.df;
const result = {
level,
direction,
cassureConfirmee: false,
retestObserve: false,
confirmationPression: false,
confirme: false,
details: [],
};
let breakIdx = -1;
for (let i = 0; i < df.length; i++) {
if (
(direction === "haussier" && df[i].close > level) ||
(direction === "baissier" && df[i].close < level)
) {
breakIdx = i;
break;
}
}
if (breakIdx === -1) {
result.details.push(
"Aucune clÃ´ture n'a validÃ© la cassure de ce niveau â pas de Break & Retest possible."
);
return result;
}
result.cassureConfirmee = true;
result.details.push(`Cassure confirmÃ©e par clÃ´ture Ã  l'index ${breakIdx}.`);
const tol = level * retestTolerancePct;
let retestIdx = -1;
for (let i = breakIdx + 1; i < df.length; i++) {
if (df[i].low <= level + tol && df[i].high >= level - tol) {
retestIdx = i;
}
}
if (retestIdx === -1) {
result.details.push(
"Pas encore de retour observÃ© sur la zone â retest non confirmÃ© pour le moment."
);
return result;
}
result.retestObserve = true;
const afterRetest = df.slice(retestIdx);
if (afterRetest.length < 2) {
result.details.push(
"Retest observÃ© mais pas encore de bougie suivante permettant de juger la pression."
);
return result;
}
const confirmCandle = afterRetest[1];
if (direction === "haussier" && confirmCandle.close > level) {
result.confirmationPression = true;
} else if (direction === "baissier" && confirmCandle.close < level) {
result.confirmationPression = true;
}
result.confirme = result.cassureConfirmee && result.retestObserve && result.confirmationPression;
if (result.confirme) {
result.details.push("Le prix dÃ©fend le niveau aprÃ¨s le retest â continuation validÃ©e par le prix.");
} else {
result.details.push(
"Retest observÃ© mais la bougie suivante ne confirme pas la pression attendue."
);
}
return result;
}
// ------------------------------------------------------------ ORDER BLOCKS ----
/**
* Identifie les Order Blocks selon la dÃ©finition opÃ©rationnelle du prompt :
* - OB haussier = derniÃ¨re bougie baissiÃ¨re avant un mouvement haussier fort
* - OB baissier = derniÃ¨re bougie haussiÃ¨re avant un mouvement baissier fort
* Puis score chaque OB sur les 5 Ã©toiles, SANS jamais deviner un critÃ¨re
* que les donnÃ©es ne permettent pas de vÃ©rifier.
*/
detectOrderBlocks(impulseMinAtrMult = 1.5, fibLookback = 50, atrPeriod = 14) {
const df = this.df;
const atr = this._atr(atrPeriod);
const blocks = [];
for (let i = 1; i < df.length - 1; i++) {
const candle = df[i];
const nxt = df[i + 1];
const impulseRange = Math.abs(nxt.close - nxt.open);
const isStrongImpulse = atr[i] !== null && impulseRange >= impulseMinAtrMult * atr[i];
if (!isStrongImpulse) continue;
// OB haussier : bougie i baissiÃ¨re suivie d'un mouvement haussier fort
if (candle.close < candle.open && nxt.close > nxt.open) {
const ob = new OrderBlock(i, "haussier", candle.high, candle.low, candle.open, candle.close);
this._scoreOrderBlock(ob, fibLookback);
blocks.push(ob);
} else if (candle.close > candle.open && nxt.close < nxt.open) {
// OB baissier : bougie i haussiÃ¨re suivie d'un mouvement baissier fort
const ob = new OrderBlock(i, "baissier", candle.high, candle.low, candle.open, candle.close);
this._scoreOrderBlock(ob, fibLookback);
blocks.push(ob);
}
}
return blocks;
}
_atr(period) {
const df = this.df;
const tr = df.map((r, i) => {
const prevClose = i > 0 ? df[i - 1].close : null;
const hl = r.high - r.low;
if (prevClose === null) return hl;
const hc = Math.abs(r.high - prevClose);
const lc = Math.abs(r.low - prevClose);
return Math.max(hl, hc, lc);
});
return rollingMean(tr, period);
}
_scoreOrderBlock(ob, fibLookback) {
const df = this.df;
const i = ob.index;
// â­1 Imbalance obligatoire : y a-t-il un gap / une inefficience entre
// la bougie prÃ©cÃ©dente et la bougie suivant l'OB (proxy simple de FVG) ?
if (i + 2 < df.length && i - 1 >= 0) {
const prevCandle = df[i - 1];
if (ob.direction === "haussier") {
ob.imbalanceValidee = df[i + 1].low > prevCandle.high;
} else {
ob.imbalanceValidee = df[i + 1].high < prevCandle.low;
}
} else {
ob.imbalanceValidee = null; // indÃ©terminable, jamais devinÃ©
}
// â­2 Contexte directionnel : tendance locale sur fibLookback bougies
// via une simple pente de prix de clÃ´ture (proxy transparent, documentÃ©).
const start = Math.max(0, i - fibLookback);
const segment = df.slice(start, i + 1).map((r) => r.close);
if (segment.length >= 2) {
const slope = segment[segment.length - 1] - segment[0];
ob.contexteDirectionnelValide = ob.direction === "haussier" ? slope > 0 : slope < 0;
} else {
ob.contexteDirectionnelValide = null;
}
// â­3 LiquiditÃ© : y a-t-il un swing high/low entre l'OB et le prix actuel
// (risque de sweep) ? SignalÃ© comme risque plutÃ´t que devinÃ© favorable.
const swings = this._swingPoints();
const between = swings.filter((s) => s.index > i && s.index < df.length - 1);
ob.liquiditeFavorable = between.length === 0; // pas de swing "au milieu" = pas de sweep visible
// â­4 Niveau vierge : le prix est-il dÃ©jÃ  revenu toucher la zone de l'OB
// depuis sa formation ?
const after = df.slice(i + 2);
if (after.length === 0) {
ob.niveauVierge = true;
} else {
const touched = after.some((r) => r.low <= ob.high && r.high >= ob.low);
ob.niveauVierge = !touched;
}
// â­5 Premium / Discount : position de l'OB par rapport au 0.5 fib
// du swing range rÃ©cent (fibLookback bougies).
const seg = df.slice(start, i + 1);
if (seg.length >= 2) {
const rangeHigh = Math.max(...seg.map((r) => r.high));
const rangeLow = Math.min(...seg.map((r) => r.low));
const midpoint = (rangeHigh + rangeLow) / 2;
const obMid = (ob.high + ob.low) / 2;
if (ob.direction === "haussier") {
ob.premiumDiscountValide = obMid <= midpoint; // discount pour un achat
} else {
ob.premiumDiscountValide = obMid >= midpoint; // premium pour une vente
}
} else {
ob.premiumDiscountValide = null;
}
}
// ------------------------------------------------------ MARKET STRUCTURE ----
/**
* Lit la sÃ©quence des swing highs / swing lows sur `lookback` bougies et
* en dÃ©duit :
* - la structure ("haussier" = HH/HL, "baissier" = LH/LL, "range" = mixte)
* - le dernier BOS (Break of Structure) = cassure d'un swing dans le sens
* de la tendance en cours
* - le dernier CHoCH (Change of Character) = cassure d'un swing Ã 
* CONTRE-sens de la tendance en cours, signal de retournement potentiel
* Rien n'est dÃ©duit au-delÃ  de ce que montrent les swings dÃ©tectÃ©s.
*/
detectMarketStructure(lookback = 60) {
const df = this.df;
let swings = this._swingPoints();
const minIndex = Math.max(0, df.length - lookback);
swings = swings.filter((s) => s.index >= minIndex);
const result = { structure: "range", sequence: [], bos: null, choch: null, details: [] };
if (swings.length < 4) {
result.details.push(
"Pas assez de swings dÃ©tectÃ©s sur la fenÃªtre pour Ã©tablir une structure fiable."
);
return result;
}
const seq = swings.map((s) => {
const price = s.type === "swing_high" ? df[s.index].high : df[s.index].low;
return { type: s.type, price: round(price, 5), index: s.index };
});
result.sequence = seq;
const highs = seq.filter((s) => s.type === "swing_high").map((s) => s.price);
const lows = seq.filter((s) => s.type === "swing_low").map((s) => s.price);
const isRising = (arr) => arr.length >= 2 && arr.every((v, idx) => idx === 0 || arr[idx - 1] < v);
const isFalling = (arr) => arr.length >= 2 && arr.every((v, idx) => idx === 0 || arr[idx - 1] > v);
const highsRising = isRising(highs);
const lowsRising = isRising(lows);
const highsFalling = isFalling(highs);
const lowsFalling = isFalling(lows);
if (highsRising && lowsRising) {
result.structure = "haussier";
result.details.push("SÃ©quence de plus hauts et plus bas croissants (HH/HL) confirmÃ©e.");
} else if (highsFalling && lowsFalling) {
result.structure = "baissier";
result.details.push("SÃ©quence de plus hauts et plus bas dÃ©croissants (LH/LL) confirmÃ©e.");
} else {
result.details.push("SÃ©quence de swings mixte â pas de structure directionnelle claire (range).");
}
// BOS / CHoCH : comparer le dernier swing de mÃªme type au prÃ©cÃ©dent
const lastClose = df[df.length - 1].close;
if (result.structure === "haussier" && highs.length) {
const lastHigh = highs[highs.length - 1];
if (lastClose > lastHigh) {
result.bos = `BOS haussier confirmÃ© au-delÃ  de ${lastHigh}.`;
} else if (lows.length && lastClose < lows[lows.length - 1]) {
result.choch = `CHoCH potentiel : clÃ´ture sous le dernier swing low ${lows[lows.length - 1]} en structure haussiÃ¨re.`;
}
} else if (result.structure === "baissier" && lows.length) {
const lastLow = lows[lows.length - 1];
if (lastClose < lastLow) {
result.bos = `BOS baissier confirmÃ© sous ${lastLow}.`;
} else if (highs.length && lastClose > highs[highs.length - 1]) {
result.choch = `CHoCH potentiel : clÃ´ture au-dessus du dernier swing high ${highs[highs.length - 1]} en structure baissiÃ¨re.`;
}
}
return result;
}
// ------------------------------------------------------- SUPPORT / RESISTANCE ----
/**
* Regroupe les swing highs/lows proches en ZONES (pas en lignes parfaites,
* conformÃ©ment Ã  la rÃ¨gle du prompt) et ne retient que les zones touchÃ©es
* au moins `minTouches` fois.
*/
detectSupportResistance(clusterTolerancePct = 0.0015, minTouches = 2) {
const swings = this._swingPoints();
const df = this.df;
const zones = [];
for (const [kind, col] of [["resistance", "high"], ["support", "low"]]) {
const typeFilter = kind === "resistance" ? "swing_high" : "swing_low";
const idxs = swings.filter((s) => s.type === typeFilter).map((s) => s.index);
const used = new Set();
for (const i of idxs) {
if (used.has(i)) continue;
const base = df[i][col];
const cluster = [i];
for (const j of idxs) {
if (j === i || used.has(j)) continue;
if (Math.abs(df[j][col] - base) / base <= clusterTolerancePct) {
cluster.push(j);
used.add(j);
}
}
if (cluster.length >= minTouches) {
const zoneLevel = cluster.reduce((s, idx) => s + df[idx][col], 0) / cluster.length;
zones.push({ type: kind, level: round(zoneLevel, 5), touches: cluster.length, indices: cluster });
}
used.add(i);
}
}
zones.sort((a, b) => a.level - b.level);
return zones;
}
 // ------------------------------------------------------------ DISPLACEMENT ----
/**
 * Détecte un déplacement directionnel mesurable.
 *
 * Un displacement n'est pas simplement une grande bougie. Le moteur recherche :
 * 1. un corps supérieur à la volatilité normale (ATR),
 * 2. une clôture directionnelle nette,
 * 3. une progression récente cohérente.
 *
 * Le résultat décrit uniquement ce qui est observable dans les données.
 */
detectDisplacement({
  atrPeriod = 14,
  bodyAtrMult = 1.0,
  bodyRangeMin = 0.60,
  lookbackBars = 3
} = {}) {
  const df = this.df;

  const result = {
    detecte: false,
    direction: null,
    index: null,
    body: null,
    atr: null,
    details: []
  };

  if (df.length < atrPeriod + 2) {
    result.details.push(
      "Historique insuffisant pour mesurer le displacement avec l'ATR."
    );
    return result;
  }

  const atr = this._atr(atrPeriod);
  const start = Math.max(0, df.length - lookbackBars);

  let bestCandidate = null;

  for (let i = start; i < df.length; i++) {
    const candle = df[i];
    const candleAtr = atr[i];

    if (candleAtr === null || candleAtr <= 0) continue;

    const range = candle.high - candle.low;
    const body = Math.abs(candle.close - candle.open);

    if (range <= 0) continue;

    const bodyRatio = body / range;
    const direction =
      candle.close > candle.open
        ? "haussier"
        : candle.close < candle.open
          ? "baissier"
          : null;

    if (!direction) continue;

    const bodyLargeEnough = body >= candleAtr * bodyAtrMult;
    const bodyDominant = bodyRatio >= bodyRangeMin;

    if (bodyLargeEnough && bodyDominant) {
      const strength = body / candleAtr;

      if (!bestCandidate || strength > bestCandidate.strength) {
        bestCandidate = {
          index: i,
          direction,
          body,
          atr: candleAtr,
          bodyRatio,
          strength
        };
      }
    }
  }

  if (!bestCandidate) {
    result.details.push(
      "Aucun displacement suffisamment fort et directionnel n'est confirmé selon les critères ATR et corps/range."
    );
    return result;
  }

  result.detecte = true;
  result.direction = bestCandidate.direction;
  result.index = bestCandidate.index;
  result.body = bestCandidate.body;
  result.atr = bestCandidate.atr;

  result.details.push(
    `Displacement ${bestCandidate.direction} détecté : corps de ${round(bestCandidate.body, 5)}, ` +
    `soit ${round(bestCandidate.strength, 2)}× l'ATR, avec ${round(bestCandidate.bodyRatio * 100, 1)}% de la bougie représenté par le corps.`
  );

  return result;
} 
// ------------------------------------------------------------ LIQUIDITY SWEEP ----
/**
* Cherche un sweep de liquiditÃ© : le prix dÃ©passe briÃ¨vement un equal
* high/low (ou un swing marquant) PUIS clÃ´ture de nouveau Ã  l'intÃ©rieur,
* ce qui signale une chasse aux stops plutÃ´t qu'une vraie cassure.
* Ne confirme le sweep que si un retour net Ã  l'intÃ©rieur est observÃ©.
*/
detectLiquiditySweep(tolerancePct = 0.0008, confirmBars = 2) {
const df = this.df;
const swings = this._swingPoints();
const equalLevels = this._equalLevels(swings, tolerancePct);
const result = { sweepDetecte: false, niveau: null, direction: null, details: [] };
if (equalLevels.length === 0) {
result.details.push("Aucune poche de liquiditÃ© (equal highs/lows) identifiÃ©e Ã  sweeper.");
return result;
}
const lastBars = df.slice(-(confirmBars + 1));
for (const lvl of equalLevels) {
const level = lvl.level;
if (lvl.type === "equal_swing_high") {
const exceeded = lastBars.some((r) => r.high > level);
const closedBackInside = lastBars[lastBars.length - 1].close < level;
if (exceeded && closedBackInside) {
result.sweepDetecte = true;
result.niveau = level;
result.direction = "baissier";
result.details.push(
`Le prix a dÃ©passÃ© la zone de liquiditÃ© haute (${round(level, 5)}) puis a clÃ´turÃ© Ã  ` +
"nouveau en dessous â sweep haussier suivi d'un rejet, biais baissier possible."
);
return result;
}
} else {
// equal_swing_low
const exceeded = lastBars.some((r) => r.low < level);
const closedBackInside = lastBars[lastBars.length - 1].close > level;
if (exceeded && closedBackInside) {
result.sweepDetecte = true;
result.niveau = level;
result.direction = "haussier";
result.details.push(
`Le prix a dÃ©passÃ© la zone de liquiditÃ© basse (${round(level, 5)}) puis a clÃ´turÃ© Ã  ` +
"nouveau au-dessus â sweep baissier suivi d'un rejet, biais haussier possible."
);
return result;
}
}
}
result.details.push("Des poches de liquiditÃ© existent mais aucun sweep confirmÃ© par un retour Ã  l'intÃ©rieur.");
return result;
}

// ⬇️ COLLE TOUT LE BLOC detectDisplacement() ICI ⬇️

detectDisplacement({
  atrPeriod = 14,
  bodyAtrMult = 1.0,
  bodyRangeMin = 0.60,
  lookbackBars = 3
} = {}) {
  // ... tout le code du module ...
}

// ------------------------------------------------------------------------ AMD ----
detectAmd(...) {
// ------------------------------------------------------------------------ AMD ----
/**
* DÃ©tecte le cycle Accumulation â Manipulation â Distribution :
* A) Accumulation : range serrÃ© (compression) sur `rangeWindow` bougies
* M) Manipulation : un sweep au-delÃ  de ce range (liquidity grab)
* D) Distribution : mouvement directionnel fort aprÃ¨s le sweep
* Chaque phase doit Ãªtre objectivement observÃ©e ; sinon la phase est
* marquÃ©e comme "non confirmÃ©e".
*/
detectAmd(rangeWindow = 30, compressionMaxPct = 0.006) {
const df = this.df;
const window = df.slice(-rangeWindow);
const rangeHigh = Math.max(...window.map((r) => r.high));
const rangeLow = Math.min(...window.map((r) => r.low));
const rangePct = rangeLow ? (rangeHigh - rangeLow) / rangeLow : Infinity;
const result = { accumulation: false, manipulation: null, distribution: null, details: [] };
if (rangePct <= compressionMaxPct) {
result.accumulation = true;
result.details.push(
`Compression dÃ©tectÃ©e sur ${rangeWindow} bougies (range de ${round(rangePct * 100, 2)}%) â ` +
"phase d'accumulation plausible."
);
} else {
result.details.push("Pas de compression suffisante dÃ©tectÃ©e â phase d'accumulation non confirmÃ©e.");
return result; // sans accumulation confirmÃ©e, inutile de spÃ©culer sur M et D
}
const sweep = this.detectLiquiditySweep();
if (sweep.sweepDetecte) {
result.manipulation = sweep.direction;
result.details.push(`Manipulation confirmÃ©e : ${sweep.details[0]}`);
} else {
result.details.push("Aucune manipulation (sweep) confirmÃ©e pour l'instant.");
return result;
}
const lastCandles = df.slice(-3);
const move = lastCandles[lastCandles.length - 1].close - lastCandles[0].close;
const atrArr = this._atr(14);
const atr = atrArr[atrArr.length - 1];
if (atr && Math.abs(move) >= atr) {
result.distribution = move > 0 ? "haussier" : "baissier";
result.details.push(
"Mouvement directionnel fort observÃ© aprÃ¨s la manipulation " +
`(${move > 0 ? "haussier" : "baissier"}) â phase de distribution en cours.`
);
} else {
result.details.push("Manipulation confirmÃ©e mais pas encore de distribution nette.");
}
return result;
}
// -------------------------------------------------- TREND FOLLOWING / MOMENTUM ----
/**
* Combine :
* - croisement de moyennes mobiles (fast vs slow) pour la direction,
* - Rate of Change (ROC) pour la force du mouvement,
* - volume relatif (volume actuel / moyenne) pour confirmer l'intÃ©rÃªt rÃ©el.
* Ne conclut Ã  un momentum confirmÃ© que si les 3 pointent dans le mÃªme sens.
*/
detectTrendMomentum(fast = 9, slow = 21, rocPeriod = 10, relVolumePeriod = 20) {
const df = this.df;
const closes = df.map((r) => r.close);
const volumes = df.map((r) => r.volume);
const maFast = rollingMean(closes, fast);
const maSlow = rollingMean(closes, slow);
const roc = pctChange(closes, rocPeriod).map((v) => (v === null ? null : v * 100));
const volMean = rollingMean(volumes, relVolumePeriod);
const relVolume = volumes.map((v, i) => (volMean[i] === null || volMean[i] === 0 ? null : v / volMean[i]));
const result = { direction: null, confirme: false, details: [] };
const n = df.length;
if (maFast[n - 1] === null || maFast[n - 2] === null || maSlow[n - 1] === null || maSlow[n - 2] === null) {
result.details.push("Historique insuffisant pour calculer les moyennes mobiles.");
return result;
}
const maCrossUp = maFast[n - 1] > maSlow[n - 1];
const rocNow = roc[n - 1];
const rvolNow = relVolume[n - 1];
if (maCrossUp && rocNow > 0 && rvolNow >= 1.2) {
result.direction = "haussier";
result.confirme = true;
result.details.push(
`MM${fast} > MM${slow}, ROC positif (${round(rocNow, 2)}%), volume relatif Ã©levÃ© ` +
`(${round(rvolNow, 2)}x) â momentum haussier confirmÃ© sur ces critÃ¨res.`
);
} else if (!maCrossUp && rocNow < 0 && rvolNow >= 1.2) {
result.direction = "baissier";
result.confirme = true;
result.details.push(
`MM${fast} < MM${slow}, ROC nÃ©gatif (${round(rocNow, 2)}%), volume relatif Ã©levÃ© ` +
`(${round(rvolNow, 2)}x) â momentum baissier confirmÃ© sur ces critÃ¨res.`
);
} else {
result.details.push(
"Les critÃ¨res de tendance, de ROC et de volume relatif ne convergent pas â pas de momentum " +
"confirmÃ© selon cette mÃ©thode."
);
}
return result;
}
// ------------------------------------------------------------ MEAN REVERSION ----
/**
* Calcule un z-score du prix par rapport Ã  une moyenne mobile et un Ã©cart-type
* glissant (proxy de bandes de Bollinger). Ne signale une opportunitÃ© de
* retour Ã  la moyenne que si le prix est rÃ©ellement en dehors des bandes
* ET montre un dÃ©but de rÃ©action (mÃ¨che ou clÃ´ture qui revient vers la MM).
*/
detectMeanReversion(maPeriod = 20, bandMult = 2.0) {
const df = this.df;
const closes = df.map((r) => r.close);
const ma = rollingMean(closes, maPeriod);
const std = rollingStd(closes, maPeriod);
const result = { direction: null, confirme: false, zScore: null, details: [] };
const n = df.length;
if (ma[n - 1] === null || std[n - 1] === null || std[n - 1] === 0) {
result.details.push("Historique insuffisant pour calculer la moyenne et l'Ã©cart-type.");
return result;
}
const price = closes[n - 1];
const z = (price - ma[n - 1]) / std[n - 1];
result.zScore = round(z, 2);
const prevPrice = closes[n - 2];
const prevZ = std[n - 2] ? (prevPrice - ma[n - 2]) / std[n - 2] : 0;
if (z <= -bandMult && z > prevZ) {
result.direction = "haussier";
result.confirme = true;
result.details.push(
`Prix Ã©tirÃ© sous la bande basse (z-score ${result.zScore}) avec un dÃ©but de retour vers ` +
"la moyenne â configuration de mean reversion haussiÃ¨re."
);
} else if (z >= bandMult && z < prevZ) {
result.direction = "baissier";
result.confirme = true;
result.details.push(
`Prix Ã©tirÃ© au-dessus de la bande haute (z-score ${result.zScore}) avec un dÃ©but de retour ` +
"vers la moyenne â configuration de mean reversion baissiÃ¨re."
);
} else {
result.details.push(
`Prix non Ã©tirÃ© de faÃ§on significative (z-score ${result.zScore}) ou pas encore de retour ` +
"observÃ© â pas de setup de mean reversion confirmÃ©."
);
}
return result;
}
// ---------------------------------------------------- FAIR VALUE GAP (FVG) ----
/**
* DÃ©tecte les Fair Value Gaps (= la "liquiditÃ© interne" / imbalance des
* transcripts ICT/SMC) : sur 3 bougies consÃ©cutives, un dÃ©sÃ©quilibre
* existe quand le haut de la bougie 1 ne touche pas le bas de la bougie 3
* (FVG haussier), ou l'inverse (FVG baissier). C'est la mÃªme logique
* que l'Ã©toile 1 des Order Blocks, mais gÃ©nÃ©ralisÃ©e Ã  tout le graphique
* pour servir de "carburant" de liquiditÃ© interne (cf. transcript SMC).
*/
detectFairValueGaps(minGapPct = 0.0) {
const df = this.df;
const gaps = [];
for (let i = 1; i < df.length - 1; i++) {
const c1 = df[i - 1];
const c3 = df[i + 1];
if (c3.low > c1.high) {
const gapPct = (c3.low - c1.high) / c1.high;
if (gapPct >= minGapPct) {
gaps.push({ index: i, direction: "haussier", haut: c3.low, bas: c1.high, comble: false });
}
} else if (c3.high < c1.low) {
const gapPct = (c1.low - c3.high) / c1.low;
if (gapPct >= minGapPct) {
gaps.push({ index: i, direction: "baissier", haut: c1.low, bas: c3.high, comble: false });
}
}
}
// Marquer les FVG dÃ©jÃ  comblÃ©s (le prix est revenu dedans depuis)
for (const gap of gaps) {
const after = df.slice(gap.index + 2);
if (after.length === 0) continue;
const touched = after.some((r) => r.low <= gap.haut && r.high >= gap.bas);
gap.comble = touched;
}
return gaps;
}
// ---------------------------------------------------- LIQUIDITY RUN vs SWEEP ----
/**
* Distingue, pour un niveau de liquiditÃ© externe donnÃ© (swing high/low,
* equal high/low) :
* - un RUN : le prix clÃ´ture au-delÃ  du niveau -> continuation probable
* - un SWEEP : le prix dÃ©passe le niveau en mÃ¨che mais clÃ´ture Ã 
* l'intÃ©rieur -> rejet / retournement probable
* C'est la distinction centrale des transcripts SMC : ne jamais rÃ©agir
* Ã  un simple contact sans savoir lequel des deux s'est produit.
*/
detectLiquidityRunOrSweep(level, confirmBars = 2) {
const df = this.df;
const recent = df.slice(-confirmBars);
const touchedHigh = recent.some((r) => r.high >= level);
const touchedLow = recent.some((r) => r.low <= level);
const result = { level, type: null, details: [] };
if (touchedHigh) {
const closedBeyond = recent[recent.length - 1].close > level;
result.type = closedBeyond ? "run_haussier" : "sweep_baissier";
result.details.push(
closedBeyond
? "ClÃ´ture au-delÃ  du niveau -> liquidity run (continuation probable)."
: "MÃ¨che au-delÃ  du niveau mais clÃ´ture en dessous -> liquidity sweep (rejet, " +
"retournement possible Ã  la baisse)."
);
} else if (touchedLow) {
const closedBeyond = recent[recent.length - 1].close < level;
result.type = closedBeyond ? "run_baissier" : "sweep_haussier";
result.details.push(
closedBeyond
? "ClÃ´ture au-delÃ  du niveau -> liquidity run (continuation probable)."
: "MÃ¨che au-delÃ  du niveau mais clÃ´ture au-dessus -> liquidity sweep (rejet, " +
"retournement possible Ã  la hausse)."
);
} else {
result.details.push("Le niveau n'a pas encore Ã©tÃ© attaquÃ© sur la fenÃªtre observÃ©e.");
}
return result;
}
// ---------------------------------------------------- OPENING RANGE BREAKOUT ----
/**
* ORB : dÃ©finit le high/low des `openingBars` premiÃ¨res bougies de la
* sÃ©rie comme le "range d'ouverture", puis vÃ©rifie s'il y a eu cassure +
* retest de ce range, exactement comme un Break & Retest classique mais
* appliquÃ© spÃ©cifiquement Ã  la range d'ouverture de session.
* Suppose que le tableau commence bien au dÃ©but de la session voulue.
*/
detectOpeningRangeBreakout(openingBars = 30) {
const df = this.df;
if (df.length <= openingBars + 2) {
return { confirme: false, details: ["Pas assez de bougies aprÃ¨s la range d'ouverture."] };
}
const opening = df.slice(0, openingBars);
const rangeHigh = Math.max(...opening.map((r) => r.high));
const rangeLow = Math.min(...opening.map((r) => r.low));
const breakoutUp = this.detectBreakAndRetest(rangeHigh, "haussier");
const breakoutDown = this.detectBreakAndRetest(rangeLow, "baissier");
const result = {
rangeHigh,
rangeLow,
breakoutHaussier: breakoutUp,
breakoutBaissier: breakoutDown,
confirme: breakoutUp.confirme || breakoutDown.confirme,
details: [],
};
if (breakoutUp.confirme) result.details.push(`ORB haussier confirmÃ© au-dessus de ${rangeHigh}.`);
if (breakoutDown.confirme) result.details.push(`ORB baissier confirmÃ© sous ${rangeLow}.`);
if (!result.confirme) {
result.details.push("Pas de cassure + retest confirmÃ© de la range d'ouverture pour l'instant.");
}
return result;
}
// ------------------------------------------------------ CHART PATTERNS ----
/**
* DÃ©tecte un double top / double bottom : deux swings de mÃªme type et de
* niveau quasi identique (tolÃ©rance donnÃ©e), sÃ©parÃ©s par un swing
* intermÃ©diaire opposÃ© qui sert de "neckline". Ne confirme le pattern
* que si le prix a effectivement clÃ´turÃ© au-delÃ  de la neckline.
*/
detectDoubleTopBottom(tolerancePct = 0.002, necklineLookback = 30) {
const df = this.df;
const swings = this._swingPoints();
const result = { pattern: null, confirme: false, details: [] };
for (const [, typeFilter] of [["double_top", "swing_high"], ["double_bottom", "swing_low"]]) {
const idxs = swings.filter((s) => s.type === typeFilter).map((s) => s.index);
if (idxs.length < 2) continue;
const i1 = idxs[idxs.length - 2];
const i2 = idxs[idxs.length - 1];
const col = typeFilter === "swing_high" ? "high" : "low";
const p1 = df[i1][col];
const p2 = df[i2][col];
if (Math.abs(p1 - p2) / p1 > tolerancePct) continue;
const between = swings.filter((s) => s.index > i1 && s.index < i2);
const oppositeType = typeFilter === "swing_high" ? "swing_low" : "swing_high";
const necklineCandidates = between.filter((s) => s.type === oppositeType);
if (necklineCandidates.length === 0) continue;
const necklineCol = typeFilter === "swing_high" ? "low" : "high";
const necklineIdx = necklineCandidates[0].index;
const neckline = df[necklineIdx][necklineCol];
const lastClose = df[df.length - 1].close;
if (typeFilter === "swing_high" && lastClose < neckline) {
result.pattern = "double_top";
result.confirme = true;
result.details.push(
`Double top dÃ©tectÃ© (${round(p1, 5)} / ${round(p2, 5)}) avec clÃ´ture sous la neckline ` +
`(${round(neckline, 5)}) â pattern confirmÃ©, biais baissier.`
);
} else if (typeFilter === "swing_low" && lastClose > neckline) {
result.pattern = "double_bottom";
result.confirme = true;
result.details.push(
`Double bottom dÃ©tectÃ© (${round(p1, 5)} / ${round(p2, 5)}) avec clÃ´ture au-dessus de la ` +
`neckline (${round(neckline, 5)}) â pattern confirmÃ©, biais haussier.`
);
} else {
result.details.push(
`${typeFilter === "swing_high" ? "Double top" : "Double bottom"} potentiel repÃ©rÃ© mais la ` +
`neckline (${round(neckline, 5)}) n'est pas encore cassÃ©e.`
);
}
}
if (result.details.length === 0) {
result.details.push("Aucun double top / double bottom net dÃ©tectÃ© sur la fenÃªtre analysÃ©e.");
}
return result;
}
// ------------------------------------------------------- RSI + DIVERGENCE ----
_rsi(period = 14) {
const closes = this.df.map((r) => r.close);
const delta = closes.map((c, i) => (i === 0 ? null : c - closes[i - 1]));
const gain = delta.map((d) => (d === null ? null : Math.max(d, 0)));
const loss = delta.map((d) => (d === null ? null : Math.max(-d, 0)));
const avgGain = rollingMean(gain, period);
const avgLoss = rollingMean(loss, period);
return avgGain.map((g, i) => {
const l = avgLoss[i];
if (g === null || l === null || l === 0) return null;
const rs = g / l;
return 100 - 100 / (1 + rs);
});
}
/**
* Compare les deux derniers swing highs (ou lows) du PRIX Ã  ceux du RSI
* sur la mÃªme fenÃªtre. Une divergence n'est confirmÃ©e que si le prix et
* le RSI vont objectivement dans des sens opposÃ©s sur les mÃªmes points.
*/
detectRsiDivergence(period = 14, lookback = 60) {
const df = this.df;
const rsi = this._rsi(period);
let swings = this._swingPoints();
const minIndex = Math.max(0, df.length - lookback);
swings = swings.filter((s) => s.index >= minIndex);
const result = { type: null, confirme: false, details: [] };
for (const [typeFilter, comp] of [["swing_high", "bearish"], ["swing_low", "bullish"]]) {
const idxs = swings.filter((s) => s.type === typeFilter).map((s) => s.index);
if (idxs.length < 2) continue;
const i1 = idxs[idxs.length - 2];
const i2 = idxs[idxs.length - 1];
const priceCol = typeFilter === "swing_high" ? "high" : "low";
const price1 = df[i1][priceCol];
const price2 = df[i2][priceCol];
const rsi1 = rsi[i1];
const rsi2 = rsi[i2];
if (rsi1 === null || rsi2 === null) continue;
if (comp === "bearish" && price2 > price1 && rsi2 < rsi1) {
result.type = "baissier";
result.confirme = true;
result.details.push(
`Le prix forme un plus haut (${round(price1, 5)} -> ${round(price2, 5)}) alors que le RSI ` +
`forme un plus bas (${round(rsi1, 2)} -> ${round(rsi2, 2)}) â divergence baissiÃ¨re confirmÃ©e.`
);
} else if (comp === "bullish" && price2 < price1 && rsi2 > rsi1) {
result.type = "haussier";
result.confirme = true;
result.details.push(
`Le prix forme un plus bas (${round(price1, 5)} -> ${round(price2, 5)}) alors que le RSI ` +
`forme un plus haut (${round(rsi1, 2)} -> ${round(rsi2, 2)}) â divergence haussiÃ¨re confirmÃ©e.`
);
}
}
if (result.details.length === 0) {
result.details.push("Pas assez de swings comparables pour confirmer une divergence RSI.");
}
return result;
}
// --------------------------------------------------------- RISQUE / R:R ----
buildTradePlan(direction, entree, stop, objectif) {
return new TradePlan({ entree, stop, objectif, direction });
}
/**
* Applique mÃ©caniquement la logique du prompt :
* - pas de setup confirmÃ© -> PAS DE TRADE
* - setup confirmÃ© mais plan incomplet -> ATTENDRE CONFIRMATION
* - setup confirmÃ© + plan complet mais R:R < minimum -> PAS DE TRADE
* - setup confirmÃ© + plan complet + R:R >= minimum -> SETUP VALIDÃ
*/
verdictFromRr(plan, setupConfirme) {
if (!setupConfirme) return "PAS DE TRADE";
if (plan === null || plan === undefined || !plan.estComplet()) return "ATTENDRE CONFIRMATION";
if (plan.rr === null || plan.rr < this.rrMinimum) return "PAS DE TRADE";
return "SETUP VALIDÃ";
}
// --------------------------------------------------------- RAPPORT FINAL ----
/**
* ExÃ©cute les 7 Ã©tapes du PROCESSUS D'ANALYSE OBLIGATOIRE et rend un
* AnalysisReport respectant strictement le FORMAT DE RÃPONSE du prompt.
*
* `strategie` permet de choisir explicitement le module Ã  appliquer :
* "market_structure", "support_resistance", "vwap", "breakout_retest",
* "liquidity_sweep", "amd", "trend_momentum", "mean_reversion", ...
* ou "auto" (comportement par dÃ©faut : VWAP puis Order Block, comme avant).
*
* Note : chaque stratÃ©gie a sa propre logique (le prompt le rappelle
* explicitement â un bon marchÃ© pour une stratÃ©gie n'est pas
* automatiquement un bon marchÃ© pour une autre). Ce paramÃ¨tre ne mÃ©lange
* jamais deux mÃ©thodologies sans le dire.
*
* @param {object} [options]
* @param {TradePlan|null} [options.plan]
* @param {string} [options.strategie="auto"]
* @param {number|null} [options.niveauPourBreakout]
* @param {"haussier"|"baissier"|null} [options.directionPourBreakout]
*/
runFullAnalysis({ plan = null, strategie = "auto", niveauPourBreakout = null, directionPourBreakout = null } = {}) {
if (!MarketAnalyzer.STRATEGIES_DISPONIBLES.includes(strategie) && !this.customStrategies.has(strategie)) {
throw new Error(
`StratÃ©gie inconnue : ${strategie}. Choix intÃ©grÃ©s : ${MarketAnalyzer.STRATEGIES_DISPONIBLES.join(", ")}. ` +
`StratÃ©gies personnalisÃ©es enregistrÃ©es : ${[...this.customStrategies.keys()].join(", ")}`
);
}
const report = new AnalysisReport(this.symbol, this.timeframe);
const displacement = this.detectDisplacement();  
  // ================================================================
// 🕯️ INTELLIGENCE DES BOUGIES & PATTERNS GRAPHIQUES
// ================================================================

const latestCandle = this.df[this.df.length - 1];
const previousCandles = this.df.slice(0, -1);

const candleAnalysis = analyzeCandle(
  latestCandle,
  previousCandles
);

const candlestickPatterns = detectCandlestickPatterns(this.df);
const chartPatternAnalysis = detectChartPatterns(this.df);
// ÃTAPE 1 â CONTEXTE
const lastClose = this.df[this.df.length - 1].close;
const vwapNow = this.df[this.df.length - 1].vwap;
const trendHint = lastClose > vwapNow ? "au-dessus du VWAP" : "sous le VWAP";
report.contexte =
`DerniÃ¨re clÃ´ture : ${lastClose}. Le prix Ã©volue actuellement ${trendHint} ` +
`(VWAP = ${round(vwapNow, 5)}).`;
  // ÉTAPE 1B — BOUGIES & PATTERNS

if (candleAnalysis) {
  const candleNames = candleAnalysis.patterns
    .map((pattern) => pattern.name);

  if (candleNames.length > 0) {
    report.validation.push(
      `🕯️ Bougie détectée : ${candleNames.join(", ")}.`
    );
  } else {
    report.validation.push(
      `🕯️ Dernière bougie : ${candleAnalysis.direction}, sans pattern de bougie spécifique détecté.`
    );
  }

  report.validation.push(
    `Contexte avant la bougie : ${candleAnalysis.trendBeforeCandle}.`
  );

  if (candleAnalysis.volumeContext) {
    report.validation.push(
      `Volume : ${candleAnalysis.volumeContext}.`
    );
  }
}

if (candlestickPatterns.length > 0) {
  for (const pattern of candlestickPatterns) {
    report.validation.push(
      `🕯️ Pattern de bougies : ${pattern.name} — ${pattern.meaning}`
    );
  }
}

if (chartPatternAnalysis.status === "PATTERN_FOUND") {
  for (const pattern of chartPatternAnalysis.patterns) {
    report.validation.push(
      `📐 Pattern graphique : ${pattern.name} (${pattern.status}) — ${pattern.direction}.`
    );
  }
} else if (chartPatternAnalysis.status === "NO_PATTERN_DETECTED") {
  report.validation.push(
    "📐 Pattern graphique : non détecté dans la bibliothèque actuelle."
  );
} else if (chartPatternAnalysis.status === "INSUFFICIENT_DATA") {
  report.limitesDonnees.push(
    "📐 Données insuffisantes pour analyser correctement les patterns graphiques."
  );
}
// ÃTAPE 2 â LIQUIDITÃ
const swings = this._swingPoints();
const equalLevels = this._equalLevels(swings);
if (equalLevels.length > 0) {
for (const lvl of equalLevels.slice(-3)) {
report.liquidite.push(`${lvl.type} dÃ©tectÃ©s autour de ${round(lvl.level, 5)}.`);
}
} else {
report.liquidite.push("Aucune poche de liquiditÃ© (equal highs/lows) clairement dÃ©tectÃ©e.");
}
// ÃTAPE 3 â SETUP (selon la stratÃ©gie choisie, jamais mÃ©langÃ©e sans le dire)
let setupConfirme = false;
const noSetup = (nomStrategie, details) => {
report.setupIdentifie = `Aucun setup ${nomStrategie} ne respecte les rÃ¨gles sur la fenÃªtre analysÃ©e.`;
report.validation.push(...details);
report.limitesDonnees.push(
"Je ne peux pas confirmer de setup avec les donnÃ©es actuellement disponibles."
);
};
if (strategie === "vwap") {
const vwapSetup = this.detectVwapSetup();
if (vwapSetup.type && vwapSetup.confirme) {
report.setupIdentifie = `${vwapSetup.type} (${vwapSetup.direction})`;
report.validation.push(...vwapSetup.details);
setupConfirme = true;
} else {
noSetup("VWAP", vwapSetup.details);
}
} else if (strategie === "market_structure") {
const ms = this.detectMarketStructure();
report.setupIdentifie = `Market Structure : ${ms.structure}`;
report.validation.push(...ms.details);
if (ms.bos) {
report.validation.push(ms.bos);
setupConfirme = true;
}
if (ms.choch) {
report.validation.push(ms.choch);
}
if (!ms.bos && !ms.choch) {
report.limitesDonnees.push("Ni BOS ni CHoCH confirmÃ© sur la fenÃªtre analysÃ©e.");
}
} else if (strategie === "support_resistance") {
const zones = this.detectSupportResistance();
if (zones.length > 0) {
report.setupIdentifie = `${zones.length} zone(s) de support/rÃ©sistance validÃ©es (â¥2 touches)`;
for (const z of zones.slice(-5)) {
report.validation.push(`${z.type} Ã  ${z.level} (${z.touches} touches).`);
}
setupConfirme = true;
} else {
noSetup("Support/RÃ©sistance", ["Aucune zone avec au moins 2 touches dÃ©tectÃ©e."]);
}
} else if (strategie === "breakout_retest") {
if (niveauPourBreakout === null || directionPourBreakout === null) {
report.setupIdentifie = "Breakout & Retest â niveau non fourni";
report.limitesDonnees.push(
"Je ne peux pas confirmer ce point avec les donnÃ©es actuellement disponibles : fournir " +
"`niveauPourBreakout` et `directionPourBreakout` pour Ã©valuer ce setup."
);
} else {
const br = this.detectBreakAndRetest(niveauPourBreakout, directionPourBreakout);
report.setupIdentifie = `Breakout & Retest (${directionPourBreakout}) sur ${niveauPourBreakout}`;
report.validation.push(...br.details);
setupConfirme = br.confirme;
}
} else if (strategie === "liquidity_sweep") {
const ls = this.detectLiquiditySweep();
report.setupIdentifie = ls.sweepDetecte ? "Liquidity Sweep" : "Aucun sweep confirmÃ©";
report.validation.push(...ls.details);
setupConfirme = ls.sweepDetecte;
} else if (strategie === "amd") {
const amd = this.detectAmd();
const phases = [];
if (amd.accumulation) phases.push("Accumulation");
if (amd.manipulation) phases.push(`Manipulation (${amd.manipulation})`);
if (amd.distribution) phases.push(`Distribution (${amd.distribution})`);
report.setupIdentifie = "AMD : " + (phases.length ? phases.join(" â ") : "cycle non confirmÃ©");
report.validation.push(...amd.details);
setupConfirme = amd.distribution !== null;
} else if (strategie === "trend_momentum") {
const tm = this.detectTrendMomentum();
report.setupIdentifie = tm.confirme ? `Trend/Momentum (${tm.direction})` : "Momentum non confirmÃ©";
report.validation.push(...tm.details);
setupConfirme = tm.confirme;
} else if (strategie === "mean_reversion") {
const mr = this.detectMeanReversion();
report.setupIdentifie = mr.confirme ? `Mean Reversion (${mr.direction})` : "Mean Reversion non confirmÃ©e";
report.validation.push(...mr.details);
setupConfirme = mr.confirme;
} else if (strategie === "fair_value_gap") {
const gaps = this.detectFairValueGaps();
const ouverts = gaps.filter((g) => !g.comble);
if (ouverts.length > 0) {
report.setupIdentifie = `${ouverts.length} Fair Value Gap(s) non comblÃ©(s)`;
for (const g of ouverts.slice(-3)) {
report.validation.push(`FVG ${g.direction} entre ${round(g.bas, 5)} et ${round(g.haut, 5)} (non comblÃ©).`);
}
setupConfirme = true;
} else {
noSetup("Fair Value Gap", ["Aucun FVG ouvert (non comblÃ©) dÃ©tectÃ© sur la fenÃªtre analysÃ©e."]);
}
} else if (strategie === "liquidity_run_sweep") {
if (niveauPourBreakout === null) {
report.setupIdentifie = "Liquidity Run/Sweep â niveau non fourni";
report.limitesDonnees.push("Fournir `niveauPourBreakout` (le niveau de liquiditÃ© externe Ã  Ã©valuer).");
} else {
const lrs = this.detectLiquidityRunOrSweep(niveauPourBreakout);
report.setupIdentifie = lrs.type ? `Liquidity ${lrs.type}` : "Niveau non encore attaquÃ©";
report.validation.push(...lrs.details);
setupConfirme = lrs.type !== null && lrs.type.includes("sweep");
}
} else if (strategie === "orb") {
const orb = this.detectOpeningRangeBreakout();
report.setupIdentifie = orb.confirme ? "Opening Range Breakout" : "ORB non confirmÃ©";
report.validation.push(...orb.details);
setupConfirme = orb.confirme;
} else if (strategie === "double_top_bottom") {
const dtb = this.detectDoubleTopBottom();
report.setupIdentifie = dtb.pattern || "Aucun double top/bottom confirmÃ©";
report.validation.push(...dtb.details);
setupConfirme = dtb.confirme;
} else if (strategie === "rsi_divergence") {
const rd = this.detectRsiDivergence();
report.setupIdentifie = rd.confirme ? `Divergence RSI ${rd.type}` : "Pas de divergence RSI confirmÃ©e";
report.validation.push(...rd.details);
setupConfirme = rd.confirme;
} else {
// "auto" â comportement historique : VWAP en prioritÃ©, puis Order Blocks filtrÃ©s
// (ou une stratÃ©gie personnalisÃ©e enregistrÃ©e sous ce nom)
if (this.customStrategies.has(strategie)) {
const customResult = this.customStrategies.get(strategie)(this);
report.setupIdentifie = customResult.setupIdentifie || strategie;
report.validation.push(...(customResult.details || []));
setupConfirme = Boolean(customResult.confirme);
} else {
const vwapSetup = this.detectVwapSetup();
const obs = this.detectOrderBlocks();
const obsValides = obs.filter((ob) => ob.estUtilisableSelonLaMethode());
if (vwapSetup.type && vwapSetup.confirme) {
report.setupIdentifie = `${vwapSetup.type} (${vwapSetup.direction})`;
report.validation.push(...vwapSetup.details);
setupConfirme = true;
} else if (obsValides.length > 0) {
const meilleur = obsValides.reduce((best, ob) => (ob.score() > best.score() ? ob : best));
report.setupIdentifie = `Order Block ${meilleur.direction} (score ${meilleur.score()}/5)`;
report.validation.push(`â­ Imbalance : ${meilleur.imbalanceValidee ? "VALIDÃ" : "NON VALIDÃ"}`);
report.validation.push(
`â­ Contexte directionnel : ${meilleur.contexteDirectionnelValide ? "VALIDÃ" : "NON VALIDÃ"}`
);
report.validation.push(`â­ LiquiditÃ© : ${meilleur.liquiditeFavorable ? "FAVORABLE" : "RISQUE IDENTIFIÃ"}`);
report.validation.push(`â­ Niveau vierge : ${meilleur.niveauVierge ? "OUI" : "NON"}`);
report.validation.push(
`â­ Premium/Discount : ${meilleur.premiumDiscountValide ? "VALIDÃ" : "NON VALIDÃ"}`
);
setupConfirme = true;
} else {
noSetup("VWAP ni Order Block", ["Aucune configuration VWAP ni Order Block filtrÃ© n'a Ã©tÃ© confirmÃ©e."]);
}
}
}
// ÃTAPE 5 â INVALIDATION (basÃ©e sur le dernier swing pertinent)
if (swings.length > 0) {
const lastSwing = swings[swings.length - 1];
const levelVal = lastSwing.type === "swing_high" ? this.df[lastSwing.index].high : this.df[lastSwing.index].low;
report.invalidation =
`Le scÃ©nario est invalidÃ© si le prix clÃ´ture au-delÃ  du dernier ` +
`${lastSwing.type} (${round(levelVal, 5)}).`;
}
// ÃTAPE 6 â PLAN / R:R
report.plan = plan;
// ÃTAPE 7 â VERDICT
report.verdict = this.verdictFromRr(plan, setupConfirme);
return report;
}
}
// ==================================================================================
// ESPACE LIBRE POUR TES PROPRES STRATÃGIES
// ==================================================================================
// C'est ICI que tu ajoutes du code au fil du temps pour rendre l'assistant
// "plus savant", sans jamais toucher au reste du moteur.
//
// Marche Ã  suivre :
// 1. Ãcris une fonction qui prend `analyzer` (l'instance de MarketAnalyzer)
// et retourne un objet avec au minimum :
// {setupIdentifie: string, details: string[], confirme: boolean}
// 2. Enregistre-la avec analyzer.registerStrategy("nom_choisi", ta_fonction)
// 3. Utilise-la comme les autres : analyzer.runFullAnalysis({strategie: "nom_choisi"})
//
// Exemple concret : un dÃ©tecteur simple de pattern Head & Shoulders,
// construit sur le mÃªme principe que detectDoubleTopBottom.
// Copie ce squelette pour tes prochains ajouts (Elliott Wave, patterns
// harmoniques, tes propres indicateurs, scanners de small-caps, etc.).
// ==================================================================================
/**
* Exemple de stratÃ©gie ajoutÃ©e manuellement : Head & Shoulders trÃ¨s simplifiÃ©.
* Cherche 3 swing highs consÃ©cutifs oÃ¹ le milieu est le plus haut ("tÃªte")
* et les deux cÃ´tÃ©s ("Ã©paules") sont proches en niveau, puis vÃ©rifie la
* cassure de la neckline (le plus bas entre les deux creux).
*
* @param {MarketAnalyzer} analyzer
*/
function exempleDetecteurHeadAndShoulders(analyzer) {
const df = analyzer.df;
const swings = analyzer._swingPoints();
const highsIdx = swings.filter((s) => s.type === "swing_high").map((s) => s.index);
const result = { setupIdentifie: "Head & Shoulders non dÃ©tectÃ©", details: [], confirme: false };
if (highsIdx.length < 3) {
result.details.push("Pas assez de swing highs pour Ã©valuer un Head & Shoulders.");
return result;
}
const iEpaule1 = highsIdx[highsIdx.length - 3];
const iTete = highsIdx[highsIdx.length - 2];
const iEpaule2 = highsIdx[highsIdx.length - 1];
const epaule1 = df[iEpaule1].high;
const tete = df[iTete].high;
const epaule2 = df[iEpaule2].high;
const epaulesSimilaires = Math.abs(epaule1 - epaule2) / epaule1 < 0.003;
const teteLaPlusHaute = tete > epaule1 && tete > epaule2;
if (epaulesSimilaires && teteLaPlusHaute) {
const lowsBetween = df.slice(iEpaule1, iEpaule2 + 1).map((r) => r.low);
const neckline = Math.min(...lowsBetween);
const lastClose = df[df.length - 1].close;
if (lastClose < neckline) {
result.setupIdentifie = "Head & Shoulders confirmÃ© (cassure de neckline)";
result.confirme = true;
result.details.push(
`Ãpaules similaires (${round(epaule1, 5)} / ${round(epaule2, 5)}), tÃªte Ã  ${round(tete, 5)}, ` +
`clÃ´ture sous la neckline (${round(neckline, 5)}) â pattern confirmÃ©, biais baissier.`
);
} else {
result.details.push(
`Structure Head & Shoulders repÃ©rÃ©e mais neckline (${round(neckline, 5)}) pas encore cassÃ©e.`
);
}
} else {
result.details.push("Pas de structure Ã©paule-tÃªte-Ã©paule valide sur les derniers swings.");
}
return result;
}
// Pour activer l'exemple ci-dessus sur un analyzer donnÃ© :
// analyzer.registerStrategy("head_and_shoulders", exempleDetecteurHeadAndShoulders);
// analyzer.runFullAnalysis({strategie: "head_and_shoulders"});
//
// Ajoute tes prochaines fonctions juste en dessous de celle-ci, dans ce mÃªme
// style, puis enregistre-les oÃ¹ tu construis ton `analyzer`.
// ==================================================================================
// EXEMPLE D'UTILISATION (Ã  adapter Ã  ta source de donnÃ©es rÃ©elle)
// ==================================================================================
/** GÃ©nÃ¨re des donnÃ©es OHLCV factices UNIQUEMENT pour montrer le fonctionnement. */
function _genererDonneesDemo(periods = 120) {
const rows = [];
const start = new Date("2026-08-25T09:30:00Z");
let close = 100;
for (let i = 0; i < periods; i++) {
close += (Math.random() - 0.5) * 0.1;
const high = close + Math.random() * 0.1;
const low = close - Math.random() * 0.1;
const open = close + (Math.random() - 0.5) * 0.06;
const volume = Math.floor(100 + Math.random() * 900);
const timestamp = new Date(start.getTime() + i * 60000);
rows.push({ timestamp, open, high, low, close, volume });
}
return rows;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
// Remplace ceci par tes vraies donnÃ©es (CSV, API broker, etc.).
const dfDemo = _genererDonneesDemo(120);
const analyzer = new MarketAnalyzer(dfDemo, "DEMO", "1m");
const lastClose = dfDemo[dfDemo.length - 1].close;
const planDemo = analyzer.buildTradePlan("achat", lastClose, lastClose - 0.3, lastClose + 0.6);
const rapport = analyzer.runFullAnalysis({ plan: planDemo });
console.log(rapport.toText());
}
export {
round,
rollingMean,
rollingStd,
pctChange,
OrderBlock,
TradePlan,
AnalysisReport,
MarketAnalyzer,
exempleDetecteurHeadAndShoulders,
};
