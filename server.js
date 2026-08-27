import express from "express";
import cors from "cors";
import MarketAnalyzer from "./tradingRulesEngine.mjs";

const app = express();

const port = process.env.PORT || 10000;

const TRADING_MODE =
  process.env.TRADING_MODE || "analysis_only";

const ALERT_MEMORY_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.ALERT_MEMORY_LIMIT || "100", 10)
);

const ALERT_DEDUPLICATION_SECONDS = Math.max(
  0,
  Number.parseInt(
    process.env.ALERT_DEDUPLICATION_SECONDS || "30",
    10
  )
);

app.use(cors());

app.use(
  express.json({
    limit: "50kb"
  })
);

app.use(
  express.text({
    type: "text/plain",
    limit: "50kb"
  })
);


/* ============================================================
   MÉMOIRE TEMPORAIRE TRADINGVIEW
   ============================================================ */

const alertesTradingView = [];


/* ============================================================
   OUTILS
   ============================================================ */

function normaliserBody(body) {
  if (typeof body === "object" && body !== null) {
    return body;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  return null;
}

function creerAlerte(body) {
  return {
    symbol: body.symbol ?? null,
    exchange: body.exchange ?? null,
    timeframe: body.timeframe ?? null,
    action: body.action ?? null,
    close: body.close ?? null,
    volume: body.volume ?? null,
    event: body.event ?? null,
    time: body.time ?? null,
    receivedAt: new Date().toISOString()
  };
}

function ajouterAlerte(alerte) {
  alertesTradingView.push(alerte);

  while (alertesTradingView.length > ALERT_MEMORY_LIMIT) {
    alertesTradingView.shift();
  }
}

function estDoublon(alerte) {
  if (ALERT_DEDUPLICATION_SECONDS <= 0) {
    return false;
  }

  const maintenant = Date.now();

  return alertesTradingView.some((ancienne) => {
    const dateAncienne = new Date(
      ancienne.receivedAt
    ).getTime();

    const difference =
      (maintenant - dateAncienne) / 1000;

    if (difference > ALERT_DEDUPLICATION_SECONDS) {
      return false;
    }

    return (
      ancienne.symbol === alerte.symbol &&
      ancienne.exchange === alerte.exchange &&
      ancienne.timeframe === alerte.timeframe &&
      ancienne.action === alerte.action &&
      String(ancienne.close) === String(alerte.close) &&
      String(ancienne.volume) === String(alerte.volume) &&
      ancienne.event === alerte.event &&
      ancienne.time === alerte.time
    );
  });
}


/* ============================================================
   CHAT IA — À CONSERVER
   ============================================================ */

app.post("/api/chat", async (req, res) => {
  try {
    const {
      modele,
      promptSysteme,
      messages
    } = req.body;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${process.env.GROQ_API_KEY}`
        },

        body: JSON.stringify({
          model:
            modele || "openai/gpt-oss-120b",

          messages: [
            {
              role: "system",
              content:
                promptSysteme ||
                "Tu es un assistant utile."
            },

            ...(messages || []).map((message) => ({
              role: message.role,
              content: message.contenu
            }))
          ]
        })
      }
    );

    if (!response.ok) {
      const detail = await response.text();

      return res.status(response.status).json({
        erreur: detail
      });
    }

    const data = await response.json();

    return res.json({
      reponse:
        data.choices?.[0]?.message?.content ||
        "Réponse vide."
    });

  } catch (error) {
    return res.status(500).json({
      erreur: error.message
    });
  }
});


/* ============================================================
   HEALTH CHECK
   ============================================================ */

app.get("/health", (req, res) => {
  return res.json({
    ok: true,
    groqConfigured: Boolean(
      process.env.GROQ_API_KEY
    ),
    tradingViewConfigured: Boolean(
      process.env.TRADINGVIEW_WEBHOOK_SECRET
    )
  });
});


/* ============================================================
   WEBHOOK TRADINGVIEW
   ============================================================ */

app.post("/api/tradingview-alert", (req, res) => {
  const body = normaliserBody(req.body);

  if (!body) {
    return res.status(400).json({
      ok: false,
      erreur: "JSON TradingView invalide"
    });
  }

  const secretRecu = body.secret;
  const secretAttendu =
    process.env.TRADINGVIEW_WEBHOOK_SECRET;

  if (
    !secretAttendu ||
    secretRecu !== secretAttendu
  ) {
    return res.status(401).json({
      ok: false,
      erreur: "Secret TradingView incorrect"
    });
  }

  const alerte = creerAlerte(body);

  if (estDoublon(alerte)) {
    return res.status(200).json({
      ok: true,
      message: "Alerte TradingView déjà reçue"
    });
  }

  ajouterAlerte(alerte);

  console.log(
    "Alerte TradingView reçue :",
    alerte
  );

  return res.status(200).json({
    ok: true,
    message: "Alerte TradingView reçue"
  });
});


/* ============================================================
   LISTE DES ALERTES
   ============================================================ */

app.get("/api/tradingview-alerts", (req, res) => {
  return res.json({
    ok: true,
    alertes: [...alertesTradingView].reverse()
  });
});


/* ============================================================
   STATUT
   ============================================================ */

app.get("/api/status", (req, res) => {
  const derniereAlerte =
    alertesTradingView.length > 0
      ? alertesTradingView[
          alertesTradingView.length - 1
        ]
      : null;

  return res.json({
    mode: TRADING_MODE,
    alertesRecues: alertesTradingView.length,
    derniereAlerte,
    brokerConnected: false
  });
});


/* ============================================================
   RACINE
   ============================================================ */

app.get("/", (req, res) => {
  return res.send(
    "Relais assistant IA actif — mode analyse uniquement."
  );
});

app.get("/health", (req, res) => {
  return res.json({
    ok: true,
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    tradingViewConfigured: Boolean(
      process.env.TRADINGVIEW_WEBHOOK_SECRET
    )
  });
});

/* ============================================================
   DÉMARRAGE
   ============================================================ */

// ANALYSE DE MARCHE — AUCUN ORDRE BROKER, ANALYSE UNIQUEMENT app.post("/api/analyse-marche", (req, res) => { try { const { secret, symbol, timeframe = "5m", candles, strategie = "auto", entree = null, stop = null, objectif = null, direction = null, niveauPourBreakout = null, directionPourBreakout = null } = req.body;
const secretAttendu = process.env.TRADINGVIEW_WEBHOOK_SECRET;

if (!secretAttendu || secret !== secretAttendu) {
  return res.status(401).json({
    ok: false,
    erreur: "Secret incorrect"
  });
}

if (!symbol || !Array.isArray(candles) || candles.length < 50) {
  return res.status(400).json({
    ok: false,
    erreur: "Il faut un symbole et au moins 50 bougies OHLCV."
  });
}

const bougiesValides = candles.map((candle) => ({
  timestamp: candle.timestamp,
  open: Number(candle.open),
  high: Number(candle.high),
  low: Number(candle.low),
  close: Number(candle.close),
  volume: Number(candle.volume)
}));

const donneesInvalides = bougiesValides.some((candle) =>
  !candle.timestamp ||
  !Number.isFinite(candle.open) ||
  !Number.isFinite(candle.high) ||
  !Number.isFinite(candle.low) ||
  !Number.isFinite(candle.close) ||
  !Number.isFinite(candle.volume)
);

if (donneesInvalides) {
  return res.status(400).json({
    ok: false,
    erreur: "Une ou plusieurs bougies OHLCV sont invalides."
  });
}

const analyseur = new MarketAnalyzer(
  bougiesValides,
  symbol,
  timeframe,
  2.0
);

const plan =
  entree !== null &&
  stop !== null &&
  objectif !== null &&
  direction
    ? analyseur.buildTradePlan(
        direction,
        Number(entree),
        Number(stop),
        Number(objectif)
      )
    : null;

const rapport = analyseur.runFullAnalysis({
  strategie,
  plan,
  niveauPourBreakout:
    niveauPourBreakout !== null ? Number(niveauPourBreakout) : null,
  directionPourBreakout
});

const signal =
  rapport.verdict === "SETUP VALID"
    ? rapport.plan?.direction === "achat"
      ? "BUY POTENTIEL"
      : "SELL POTENTIEL"
    : rapport.verdict === "ATTENDRE CONFIRMATION"
      ? "ATTENDRE CONFIRMATION"
      : "PAS DE TRADE";

return res.json({
  ok: true,
  mode: "analysis_only",
  signal,
  verdict: rapport.verdict,
  symbole: symbol,
  timeframe,
  rapport: rapport.toText(),
  plan: rapport.plan
    ? {
        direction: rapport.plan.direction,
        entree: rapport.plan.entree,
        stop: rapport.plan.stop,
        objectif: rapport.plan.objectif,
        risqueParUnite: rapport.plan.risqueParUnite,
        gainPotentiel: rapport.plan.gainPotentiel,
        rr: rapport.plan.rr
      }
    : null,
  avertissement:
    "Analyse éducative uniquement. Aucun gain ni absence de perte ne peut être garanti. Aucun ordre broker n'est envoyé."
});
} catch (error) { console.error("Erreur analyse marché :", error);
return res.status(500).json({
  ok: false,
  erreur: error.message
});
} });
app.listen(port, "0.0.0.0", () => {
  console.log(
    `Relais actif sur le port ${port}`
  );

  console.log(
    `Mode trading : ${TRADING_MODE}`
  );

  console.log(
    `Mémoire alertes : ${ALERT_MEMORY_LIMIT}`
  );

  console.log(
    `Déduplication : ${ALERT_DEDUPLICATION_SECONDS}s`
  );
});
