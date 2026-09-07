// ===== AJOUT : granularités réellement acceptées par chaque source =====
// OANDA n'accepte QUE ces granularités exactes (v20 REST API). Un nombre de
// minutes arbitraire (ex: M7, M60, M240) est refusé par OANDA avec une
// erreur HTTP 400 générique — on le détecte AVANT l'appel réseau.
const OANDA_GRANULARITES_VALIDES = new Set([
  "S5", "S10", "S15", "S30",
  "M1", "M2", "M4", "M5", "M10", "M15", "M30",
  "H1", "H2", "H3", "H4", "H6", "H8", "H12",
  "D", "W", "M"
]);

// Alpaca accepte un format <multiplicateur><unité> plus souple, mais pas
// n'importe quel multiplicateur (ex: pas de "90Min", pas de "2Day").
function estAlpacaTimeframeValide(tf) {
  const m = /^(\d+)(Min|Hour|Day|Week|Month)$/.exec(tf);
  if (!m) return false;
  const n = Number(m[1]);
  switch (m[2]) {
    case "Min": return n >= 1 && n <= 59;
    case "Hour": return n >= 1 && n <= 23;
    case "Day": return n === 1;
    case "Week": return n === 1;
    case "Month": return [1, 2, 3, 4, 6, 12].includes(n);
    default: return false;
  }
}

// Granularités "step" (en secondes) acceptées par l'endpoint public OHLC de Bitstamp.
const BITSTAMP_STEPS_VALIDES = new Set([
  60, 180, 300, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 259200
]);
// ===== FIN AJOUT =====


function normaliserTimeframe(timeframe) {
  const tf = String(timeframe || "").trim().toUpperCase();

  if (/^\d+$/.test(tf)) {
    const n = Number(tf);
    return {
      alpaca: `${tf}Min`,
      oanda: `M${tf}`,
      bitstamp: n * 60
    };
  }

  if (/^\d+M$/.test(tf)) {
    const n = Number(tf.slice(0, -1));
    return {
      alpaca: `${n}Min`,
      oanda: `M${n}`,
      bitstamp: n * 60
    };
  }

  // ===== AJOUT : format "5MIN" (TradingView envoie parfois "5min") =====
  if (/^\d+MIN$/.test(tf)) {
    const n = Number(tf.slice(0, -3));
    return {
      alpaca: `${n}Min`,
      oanda: `M${n}`,
      bitstamp: n * 60
    };
  }
  // ===== FIN AJOUT =====

  if (/^\d+H$/.test(tf)) {
    const n = Number(tf.slice(0, -1));
    return {
      alpaca: `${n}Hour`,
      oanda: `H${n}`,
      bitstamp: n * 3600
    };
  }

  // ===== AJOUT : format "1HOUR" =====
  if (/^\d+HOUR$/.test(tf)) {
    const n = Number(tf.slice(0, -4));
    return {
      alpaca: `${n}Hour`,
      oanda: `H${n}`,
      bitstamp: n * 3600
    };
  }
  // ===== FIN AJOUT =====

  if (tf === "D" || tf === "1D") {
    return {
      alpaca: "1Day",
      oanda: "D",
      bitstamp: 86400
    };
  }

  // ===== AJOUT : variantes "DAY" / "DAILY" =====
  if (tf === "DAY" || tf === "DAILY") {
    return {
      alpaca: "1Day",
      oanda: "D",
      bitstamp: 86400
    };
  }
  // ===== FIN AJOUT =====

  if (tf === "W" || tf === "1W") {
    return {
      alpaca: "1Week",
      oanda: "W",
      bitstamp: 604800
    };
  }

  // ===== AJOUT : variante "WEEK" =====
  if (tf === "WEEK") {
    return {
      alpaca: "1Week",
      oanda: "W",
      bitstamp: 604800
    };
  }
  // ===== FIN AJOUT =====

  throw new Error(`Timeframe non supporté : ${timeframe}`);
}


// ===== AJOUT : fonction de normalisation d'une bougie =====
// Garantit le format uniforme attendu par le moteur :
// { timestamp: Date, open: Number, high: Number, low: Number, close: Number, volume: Number }
// Accepte les deux formats de noms de champs (Alpaca court ET long).
function normaliserBar(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  // Accepte les noms courts (t, o, h, l, c, v) ET longs (timestamp, open, ...)
  const tsSource = raw.timestamp ?? raw.t;
  const open = raw.open ?? raw.o;
  const high = raw.high ?? raw.h;
  const low = raw.low ?? raw.l;
  const close = raw.close ?? raw.c;
  const volume = raw.volume ?? raw.v;

  // Conversion du timestamp en objet Date
  let timestamp;
  if (tsSource instanceof Date) {
    timestamp = tsSource;
  } else if (typeof tsSource === "string") {
    timestamp = new Date(tsSource);
  } else if (typeof tsSource === "number") {
    // Unix timestamp : si > 1e12 c'est des millisecondes, sinon des secondes
    timestamp = new Date(tsSource > 1e12 ? tsSource : tsSource * 1000);
  } else {
    return null;
  }

  if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
    return null;
  }

  const o = Number(open);
  const h = Number(high);
  const l = Number(low);
  const c = Number(close);
  const v = Number(volume);

  if (
    !Number.isFinite(o) ||
    !Number.isFinite(h) ||
    !Number.isFinite(l) ||
    !Number.isFinite(c) ||
    !Number.isFinite(v)
  ) {
    return null;
  }

  return {
    timestamp,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v
  };
}
// ===== FIN AJOUT =====


// ===== AJOUT : lecture sécurisée d'une réponse API =====
// Lit le texte brut d'abord, puis tente le parse JSON.
// Inclut le corps de l'erreur dans le message pour faciliter le débogage.
async function lireJsonApi(response, source) {
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `${source} : réponse non-JSON (HTTP ${response.status}) : ${text.slice(0, 200)}`
    );
  }

  if (!response.ok) {
    const msg =
      data.message ||
      data.error ||
      data.errorMessage ||
      text.slice(0, 200);
    throw new Error(
      `${source} HTTP ${response.status} : ${msg}`
    );
  }

  return data;
}
// ===== FIN AJOUT =====


async function getAlpacaBars(symbol, timeframe, limit = 100) {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error("Identifiants Alpaca Market Data absents.");
  }

  const tf = normaliserTimeframe(timeframe).alpaca;

  // ===== AJOUT : rejet explicite si le timeframe n'est pas supporté par Alpaca =====
  if (!estAlpacaTimeframeValide(tf)) {
    throw new Error(
      `Timeframe non supporté par Alpaca : ${timeframe} (converti en ${tf}).`
    );
  }
  // ===== FIN AJOUT =====

  const url = new URL(
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars`
  );

  url.searchParams.set("timeframe", tf);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("feed", "iex");
  url.searchParams.set("sort", "asc");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": secretKey
    }
  });

  // ===== MODIFICATION : utilisation de lireJsonApi au lieu de response.json() =====
  const data = await lireJsonApi(response, "Alpaca Market Data");
  // ===== FIN MODIFICATION =====

  const bars = (data.bars || [])
    // ===== MODIFICATION : normaliserBar au lieu du mapping manuel =====
    .map((bar) => normaliserBar(bar))
    .filter(Boolean)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    // ===== FIN MODIFICATION =====

  if (bars.length < 50) {
    throw new Error(
      `Alpaca a retourné seulement ${bars.length} bougies valides.`
    );
  }

  return bars;
}


function convertirInstrumentOanda(symbol) {
  const propre = String(symbol || "")
    .replace(/^OANDA:/i, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();

  if (propre.length === 6) {
    return `${propre.slice(0, 3)}_${propre.slice(3)}`;
  }

  // ===== MODIFICATION : retourner le symbole nettoyé sans le préfixe OANDA: =====
  // Ancien code : return String(symbol || "").toUpperCase();
  // Cela renvoyait "OANDA:..." dans le fallback, ce qui cassait l'URL OANDA.
  return propre || String(symbol || "").toUpperCase();
  // ===== FIN MODIFICATION =====
}


async function getOandaBars(symbol, timeframe, limit = 100) {
  const token = process.env.OANDA_API_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;

  if (!token || !accountId) {
    throw new Error(
      "OANDA_API_TOKEN ou OANDA_ACCOUNT_ID absent."
    );
  }

  const environment =
    String(process.env.OANDA_ENVIRONMENT || "practice").toLowerCase();

  const baseUrl =
    environment === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";

  const granularity = normaliserTimeframe(timeframe).oanda;

  // ===== AJOUT : rejet explicite si la granularité n'existe pas chez OANDA =====
  // C'est ici que se produisait "OANDA Market Data HTTP 400" : un timeframe
  // comme "7" ou "60" (minutes) donnait "M7" / "M60", qui n'existent pas
  // dans l'API OANDA (seules M1, M2, M4, M5, M10, M15, M30, H1... existent).
  if (!OANDA_GRANULARITES_VALIDES.has(granularity)) {
    throw new Error(
      `Timeframe non supporté par OANDA : ${timeframe} (converti en ${granularity}). ` +
      `Granularités valides : ${[...OANDA_GRANULARITES_VALIDES].join(", ")}.`
    );
  }
  // ===== FIN AJOUT =====

  const instrument = convertirInstrumentOanda(symbol);

  const url = new URL(
    `${baseUrl}/v3/accounts/${encodeURIComponent(accountId)}/instruments/${encodeURIComponent(instrument)}/candles`
  );

  url.searchParams.set("price", "M");
  url.searchParams.set("granularity", granularity);
  url.searchParams.set("count", String(Math.min(limit, 5000)));

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  // ===== MODIFICATION : utilisation de lireJsonApi au lieu de response.json() =====
  const data = await lireJsonApi(response, "OANDA Market Data");
  // ===== FIN MODIFICATION =====

  const bars = (data.candles || [])
    .filter((candle) => candle.complete)
    // ===== MODIFICATION : normaliserBar au lieu du mapping manuel =====
    .map((candle) =>
      normaliserBar({
        timestamp: candle.time,
        open: candle.mid?.o,
        high: candle.mid?.h,
        low: candle.mid?.l,
        close: candle.mid?.c,
        volume: candle.volume
      })
    )
    .filter(Boolean)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    // ===== FIN MODIFICATION =====

  if (bars.length < 50) {
    throw new Error(
      `OANDA a retourné seulement ${bars.length} bougies valides.`
    );
  }

  return bars;
}


// ===== AJOUT : extension Bitstamp (endpoint OHLC public, sans clé API) =====
function convertirMarketBitstamp(symbol) {
  return String(symbol || "")
    .replace(/^BITSTAMP:/i, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toLowerCase();
}


async function getBitstampBars(symbol, timeframe, limit = 100) {
  const market = convertirMarketBitstamp(symbol);
  const step = normaliserTimeframe(timeframe).bitstamp;

  if (!market) {
    throw new Error("Symbole Bitstamp absent.");
  }

  // ===== MODIFICATION : liste blanche exacte au lieu d'un simple test >0 =====
  if (!BITSTAMP_STEPS_VALIDES.has(step)) {
    throw new Error(
      `Timeframe non supporté par Bitstamp : ${timeframe} (converti en ${step}s). ` +
      `Steps valides (secondes) : ${[...BITSTAMP_STEPS_VALIDES].join(", ")}.`
    );
  }
  // ===== FIN MODIFICATION =====

  const url = new URL(
    `https://www.bitstamp.net/api/v2/ohlc/${encodeURIComponent(market)}/`
  );

  url.searchParams.set("step", String(step));
  url.searchParams.set("limit", String(Math.min(limit, 1000)));
  url.searchParams.set("exclude_current_candle", "true");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const data = await lireJsonApi(response, "Bitstamp Market Data");

  const bars = (data.data?.ohlc || [])
    .map((bar) =>
      normaliserBar({
        timestamp: Number(bar.timestamp),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      })
    )
    .filter(Boolean)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (bars.length < 50) {
    throw new Error(
      `Bitstamp a retourné seulement ${bars.length} bougies valides.`
    );
  }

  return bars;
}
// ===== FIN AJOUT =====


export async function getMarketBars({
  symbol,
  exchange,
  timeframe,
  limit = 100
}) {
  const exchangeName = String(exchange || "").toUpperCase();

  if (exchangeName === "OANDA") {
    return getOandaBars(symbol, timeframe, limit);
  }

  // ===== AJOUT : branche Bitstamp =====
  if (exchangeName === "BITSTAMP") {
    return getBitstampBars(symbol, timeframe, limit);
  }
  // ===== FIN AJOUT =====

  const exchangesUS = [
    "NASDAQ",
    "NYSE",
    "AMEX",
    "ARCA",
    "BATS",
    "CBOE",
    "IEX",
    "OTC"
  ];

  if (exchangesUS.includes(exchangeName)) {
    return getAlpacaBars(symbol, timeframe, limit);
  }

  throw new Error(
    `Aucune source de données configurée pour ${exchange}:${symbol}.`
  );
}
