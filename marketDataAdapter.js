function normaliserTimeframe(timeframe) {
  const tf = String(timeframe || "").trim().toUpperCase();

  if (/^\d+$/.test(tf)) {
    return {
      alpaca: `${tf}Min`,
      oanda: `M${tf}`
    };
  }

  if (/^\d+M$/.test(tf)) {
    const n = tf.slice(0, -1);
    return {
      alpaca: `${n}Min`,
      oanda: `M${n}`
    };
  }

  if (/^\d+H$/.test(tf)) {
    const n = tf.slice(0, -1);
    return {
      alpaca: `${n}Hour`,
      oanda: `H${n}`
    };
  }

  if (tf === "D" || tf === "1D") {
    return {
      alpaca: "1Day",
      oanda: "D"
    };
  }

  if (tf === "W" || tf === "1W") {
    return {
      alpaca: "1Week",
      oanda: "W"
    };
  }

  throw new Error(`Timeframe non supporté : ${timeframe}`);
}


async function getAlpacaBars(symbol, timeframe, limit = 100) {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error("Identifiants Alpaca Market Data absents.");
  }

  const tf = normaliserTimeframe(timeframe).alpaca;

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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Alpaca Market Data HTTP ${response.status}`);
  }

  const bars = (data.bars || [])
    .map((bar) => ({
      timestamp: bar.t,
      open: Number(bar.o),
      high: Number(bar.h),
      low: Number(bar.l),
      close: Number(bar.c),
      volume: Number(bar.v)
    }))
    .filter((bar) =>
      bar.timestamp &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      Number.isFinite(bar.volume)
    );

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

  return String(symbol || "").toUpperCase();
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`OANDA Market Data HTTP ${response.status}`);
  }

  const bars = (data.candles || [])
    .filter((candle) => candle.complete)
    .map((candle) => ({
      timestamp: candle.time,
      open: Number(candle.mid?.o),
      high: Number(candle.mid?.h),
      low: Number(candle.mid?.l),
      close: Number(candle.mid?.c),
      volume: Number(candle.volume)
    }))
    .filter((bar) =>
      bar.timestamp &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      Number.isFinite(bar.volume)
    );

  if (bars.length < 50) {
    throw new Error(
      `OANDA a retourné seulement ${bars.length} bougies valides.`
    );
  }

  return bars;
}


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
