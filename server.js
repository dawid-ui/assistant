import express from "express";
import cors from "cors";
import {
  MarketAnalyzer,
  detectPreviousDayLiquidityConfirmation,
  detectDowStructureConfirmation
} from "./tradingRulesEngine.js";
import {
  TRADING_MODE,
  TRADING_MODES,
  ALLOWED_SYMBOLS,
  MAX_TRADES_PER_SESSION
} from "./config.js";
import { riskManager } from "./riskManager.js";
import * as executionManager from "./executionManager.js";
import * as broker from "./brokerAdapter.js";

const app = express();

const port = process.env.PORT || 10000;

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
    limit: "500kb"
  })
);

app.use(
  express.text({
    type: "text/plain",
    limit: "500kb"
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
   CHAT IA
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
  alerte.utilisablePourExecution = alerte.action !== "test";

  if (!alerte.utilisablePourExecution) {
    console.log(
      "Alerte TradingView reçue avec action=test : marquée non-exécutable."
    );
  }

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
   ANALYSE DE MARCHÉ
   AUCUN ORDRE BROKER — ANALYSE UNIQUEMENT
   ============================================================ */

app.post("/api/analyse-marche", (req, res) => {
  try {
    const {
      secret,
      symbol,
      timeframe = "5m",
      candles,
      strategie = "auto",
      entree = null,
      stop = null,
      objectif = null,
      direction = null,
      niveauPourBreakout = null,
      directionPourBreakout = null
    } = req.body;

    const secretAttendu =
      process.env.TRADINGVIEW_WEBHOOK_SECRET;

    if (
      !secretAttendu ||
      secret !== secretAttendu
    ) {
      return res.status(401).json({
        ok: false,
        erreur: "Secret incorrect"
      });
    }

    if (
      !symbol ||
      !Array.isArray(candles) ||
      candles.length < 50
    ) {
      return res.status(400).json({
        ok: false,
        erreur:
          "Il faut un symbole et au moins 50 bougies OHLCV."
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

    const donneesInvalides = bougiesValides.some(
      (candle) =>
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
        erreur:
          "Une ou plusieurs bougies OHLCV sont invalides."
      });
    }

    const analyseur = new MarketAnalyzer(
      bougiesValides,
      symbol,
      timeframe,
      2.0
    );
    analyseur.registerStrategy(
  "previous_day_liquidity",
  detectPreviousDayLiquidityConfirmation
);

analyseur.registerStrategy(
  "dow_structure",
  detectDowStructureConfirmation
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
        niveauPourBreakout !== null
          ? Number(niveauPourBreakout)
          : null,
      directionPourBreakout
    });

    const signal =
      rapport.verdict === "SETUP VALIDÉ"
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
            risqueParUnite:
              rapport.plan.risqueParUnite,
            gainPotentiel:
              rapport.plan.gainPotentiel,
            rr: rapport.plan.rr
          }
        : null,

      avertissement:
        "Analyse éducative uniquement. Aucun gain ni absence de perte ne peut être garanti. Aucun ordre broker n'est envoyé."
    });

  } catch (error) {
    console.error(
      "Erreur analyse marché :",
      error
    );

    return res.status(500).json({
      ok: false,
      erreur: error.message
    });
  }
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

app.get("/api/alpaca-paper-status", async (req, res) => {
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    const baseUrl = process.env.APCA_API_BASE_URL;

    if (!apiKey || !secretKey) {
      return res.status(500).json({
        ok: false,
        erreur: "Clés Alpaca Paper absentes dans Render."
      });
    }

    if (baseUrl !== "https://paper-api.alpaca.markets") {
      return res.status(500).json({
        ok: false,
        erreur: "Sécurité : APCA_API_BASE_URL doit être https://paper-api.alpaca.markets."
      });
    }

    const response = await fetch(`${baseUrl}/v2/account`, {
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": secretKey
      }
    });

    const account = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        erreur: account.message || "Connexion Alpaca refusée."
      });
    }

    return res.json({
      ok: true,
      mode: "paper_only",
      statut: account.status,
      devise: account.currency,
      solde: account.cash,
      valeurPortefeuille: account.portfolio_value,
      pouvoirAchat: account.buying_power
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      erreur: error.message
    });
  }
});

/* ============================================================
PRÉVISUALISATION ALPACA PAPER
AUCUN ORDRE N'EST ENVOYÉ
============================================================ */

app.get("/api/alpaca-paper-preview", (req, res) => {
  const allowedSymbols = ["AAPL", "MSFT", "SPY"];
  const symbol = String(req.query.symbol || "AAPL").toUpperCase();
  const action = String(req.query.action || "buy").toLowerCase();
  const qty = Number(req.query.qty || 1);

  const baseUrl = String(
    process.env.APCA_API_BASE_URL || ""
  ).replace(/\/$/, "");

  const paperUrlsAllowed = [
    "https://paper-api.alpaca.markets",
    "https://paper-api.alpaca.markets/v2"
  ];

  const hasApiKey = Boolean(process.env.ALPACA_API_KEY);
  const hasSecretKey = Boolean(process.env.ALPACA_SECRET_KEY);

  const checks = {
    paperUrl: paperUrlsAllowed.includes(baseUrl),
    apiKeyConfigured: hasApiKey,
    secretConfigured: hasSecretKey,
    symbolAllowed: allowedSymbols.includes(symbol),
    actionAllowed: ["buy", "sell"].includes(action),
    quantityAllowed: Number.isInteger(qty) && qty === 1
  };

  const accepted = Object.values(checks).every(Boolean);

  return res.json({
    ok: accepted,
    mode: "preview_only",
    ordreSeraitEnvoye: false,
    alpacaEndpointConfigure: baseUrl || null,
    ordrePropose: {
      symbol,
      side: action,
      qty,
      type: "market",
      time_in_force: "day"
    },
    controles: checks,
    message: accepted
      ? "Prévisualisation acceptée : aucun ordre n'a été envoyé."
      : "Prévisualisation refusée : vérifie les contrôles."
  });
});

/* ============================================================
   TEST ANALYSE H4 — DONNÉES DE DÉMONSTRATION
   À SUPPRIMER OU PROTÉGER AVANT UTILISATION PUBLIQUE
   ============================================================ */

app.get("/api/test-analyse-h4", (req, res) => {
  try {
    const candles = [];
    const start = new Date("2026-01-01T00:00:00Z").getTime();

    let close = 1.25000;

    for (let i = 0; i < 220; i++) {
      const drift = 0.00008;
      const noise = Math.sin(i / 7) * 0.00035;
      const open = close;
      close = open + drift + noise;

      const high = Math.max(open, close) + 0.00025;
      const low = Math.min(open, close) - 0.00025;

      candles.push({
        timestamp: new Date(
          start + i * 4 * 60 * 60 * 1000
        ).toISOString(),
        open,
        high,
        low,
        close,
        volume: 100 + (i % 25) * 10
      });
    }

   const analyzer = new MarketAnalyzer(
  candles,
  "GBPUSD",
  "4H",
  2.0
);

analyzer.registerStrategy(
  "previous_day_liquidity",
  detectPreviousDayLiquidityConfirmation
);

analyzer.registerStrategy(
  "dow_structure",
  detectDowStructureConfirmation
);

    const lastClose = candles[candles.length - 1].close;

    const plan = analyzer.buildTradePlan(
      "achat",
      lastClose,
      lastClose - 0.00200,
      lastClose + 0.00400
    );

    const report = analyzer.runFullAnalysis({
      strategie: "auto",
      plan
    });

    return res.json({
      ok: true,
      mode: "demo_only",
      symbol: "GBPUSD",
      timeframe: "4H",
      candlesCount: candles.length,
      verdict: report.verdict,
      rapport: report.toText()
    });
  } catch (error) {
    console.error("Erreur test analyse H4 :", error);

    return res.status(500).json({
      ok: false,
      erreur: error.message
    });
  }
});
/*
==============================================================
TEST DÉMO — PREVIOUS DAY LIQUIDITY
Bougies fictives uniquement. Aucun broker. Aucun ordre.
==============================================================
*/
app.get("/api/test-previous-day-liquidity", (req, res) => {
  try {
    const candles = [];
    const start = new Date("2026-01-01T00:00:00Z").getTime();
    let close = 1.25000;

    for (let i = 0; i < 220; i++) {
      const drift = 0.00008;
      const noise = Math.sin(i / 7) * 0.00035;
      const open = close;
      close = open + drift + noise;

      const high = Math.max(open, close) + 0.00025;
      const low = Math.min(open, close) - 0.00025;

      candles.push({
        timestamp: new Date(start + i * 4 * 60 * 60 * 1000).toISOString(),
        open,
        high,
        low,
        close,
        volume: 100 + ((i % 25) * 10)
      });
    }

    const analyzer = new MarketAnalyzer(candles, "GBPUSD", "4H", 2.0);
    analyzer.registerStrategy(
  "previous_day_liquidity",
  detectPreviousDayLiquidityConfirmation
);

analyzer.registerStrategy(
  "dow_structure",
  detectDowStructureConfirmation
);
    const lastClose = candles[candles.length - 1].close;

    const plan = analyzer.buildTradePlan(
      "achat",
      lastClose,
      lastClose - 0.00200,
      lastClose + 0.00400
    );

    const report = analyzer.runFullAnalysis({
      strategie: "previous_day_liquidity",
      plan
    });

    res.setHeader("Content-Type", "application/json; charset=utf-8");

    return res.json({
      ok: true,
      mode: "demo_only",
      strategy: "previous_day_liquidity",
      symbol: "GBPUSD",
      timeframe: "4H",
      candlesCount: candles.length,
      verdict: report.verdict,
      rapport: report.toText()
    });
  } catch (error) {
    console.error("Erreur test previous day liquidity:", error);

    return res.status(500).json({
      ok: false,
      mode: "demo_only",
      strategy: "previous_day_liquidity",
      erreur: error.message
    });
  }
});

/*
==============================================================
TEST DÉMO — DOW STRUCTURE
Bougies fictives uniquement. Aucun broker. Aucun ordre.
==============================================================
*/
app.get("/api/test-dow-structure", (req, res) => {
  try {
    const candles = [];
    const start = new Date("2026-01-01T00:00:00Z").getTime();
    let close = 1.25000;

    for (let i = 0; i < 220; i++) {
      const drift = 0.00008;
      const noise = Math.sin(i / 7) * 0.00035;
      const open = close;
      close = open + drift + noise;

      const high = Math.max(open, close) + 0.00025;
      const low = Math.min(open, close) - 0.00025;

      candles.push({
        timestamp: new Date(start + i * 4 * 60 * 60 * 1000).toISOString(),
        open,
        high,
        low,
        close,
        volume: 100 + ((i % 25) * 10)
      });
    }

    const analyzer = new MarketAnalyzer(candles, "GBPUSD", "4H", 2.0);
    analyzer.registerStrategy(
  "previous_day_liquidity",
  detectPreviousDayLiquidityConfirmation
);

analyzer.registerStrategy(
  "dow_structure",
  detectDowStructureConfirmation
);
    const lastClose = candles[candles.length - 1].close;

    const plan = analyzer.buildTradePlan(
      "achat",
      lastClose,
      lastClose - 0.00200,
      lastClose + 0.00400
    );

    const report = analyzer.runFullAnalysis({
      strategie: "dow_structure",
      plan
    });

    res.setHeader("Content-Type", "application/json; charset=utf-8");

    return res.json({
      ok: true,
      mode: "demo_only",
      strategy: "dow_structure",
      symbol: "GBPUSD",
      timeframe: "4H",
      candlesCount: candles.length,
      verdict: report.verdict,
      rapport: report.toText()
    });

  } catch (error) {
    console.error("Erreur test dow structure:", error);

    return res.status(500).json({
      ok: false,
      mode: "demo_only",
      strategy: "dow_structure",
      erreur: error.message
    });
  }
});
/* ============================================================
   RISK STATUS — lecture seule, aucun ordre
   ============================================================ */

app.get("/api/risk-status", async (req, res) => {
  try {
    const mode = String(req.query.mode || "paper").toLowerCase();
    if (!["paper", "live"].includes(mode)) {
      return res.status(400).json({
        ok: false,
        erreur: 'mode doit être "paper" ou "live".'
      });
    }
    const statut = await riskManager.statut(mode);
    return res.json({ ok: true, ...statut });
  } catch (error) {
    return res.status(500).json({ ok: false, erreur: error.message });
  }
});


/* ============================================================
   STATUT ALPACA LIVE — vérifie uniquement les verrous, n'envoie rien
   ============================================================ */

app.get("/api/alpaca-live-status", (req, res) => {
  const verrous = {
    modeServeurEstLive: TRADING_MODE === TRADING_MODES.LIVE_EXECUTE,
    liveDeverrouille: process.env.LIVE_TRADING_UNLOCKED === "true",
    phraseConfirmationConfiguree: Boolean(
      process.env.LIVE_TRADING_CONFIRMATION_PHRASE
    )
  };

  let credentialsOk = false;
  let credentialsErreur = null;
  try {
    broker.getCredentials("live");
    credentialsOk = true;
  } catch (error) {
    credentialsErreur = error.message;
  }

  verrous.credentialsLiveValides = credentialsOk;

  const pretPourLive = Object.values(verrous).every(Boolean);

  return res.json({
    ok: true,
    pretPourLive,
    verrous,
    erreur: credentialsErreur,
    message: pretPourLive
      ? "Tous les verrous Live sont levés — le mode Live peut être activé volontairement."
      : "Le mode Live reste bloqué (c'est le comportement attendu par défaut)."
  });
});


/* ============================================================
   APERÇU D'ORDRE — étape 1/2, N'ENVOIE JAMAIS D'ORDRE
   ============================================================ */

app.post("/api/trade-preview", async (req, res) => {
  try {
    const {
      secret,
      symbol,
      side,
      qty,
      orderType = "market",
      timeInForce = "day",
      entree = null,
      stop = null,
      objectif = null,
      direction = null,
      strategie = null
    } = req.body || {};

    const secretAttendu = process.env.TRADINGVIEW_WEBHOOK_SECRET;
    if (!secretAttendu || secret !== secretAttendu) {
      return res.status(401).json({ ok: false, erreur: "Secret incorrect" });
    }

    let plan = null;
    if (entree !== null && stop !== null && objectif !== null && direction) {
      const risqueParUnite = Math.abs(Number(entree) - Number(stop));
      const gainPotentiel = Math.abs(Number(objectif) - Number(entree));
      plan = {
        direction,
        entree: Number(entree),
        stop: Number(stop),
        objectif: Number(objectif),
        risqueParUnite,
        rr: risqueParUnite ? round2(gainPotentiel / risqueParUnite) : null
      };
    }

    const apercu = await executionManager.construireApercu({
      symbol,
      side,
      qty: Number(qty),
      orderType,
      timeInForce,
      plan,
      strategie,
      signalKey: `${symbol}-${side}-${strategie || "manuel"}`
    });

    return res.json(apercu);
  } catch (error) {
    console.error("Erreur trade-preview :", error);
    return res.status(500).json({ ok: false, erreur: error.message });
  }
});

function round2(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}


/* ============================================================
   CONFIRMATION D'ORDRE — étape 2/2, SEUL POINT D'ENVOI RÉEL
   ============================================================ */

app.post("/api/trade-confirm", async (req, res) => {
  try {
    const {
      secret,
      confirmationToken,
      confirm,
      liveConfirmationPhrase = null
    } = req.body || {};

    const secretAttendu = process.env.TRADINGVIEW_WEBHOOK_SECRET;
    if (!secretAttendu || secret !== secretAttendu) {
      return res.status(401).json({ ok: false, erreur: "Secret incorrect" });
    }

    const resultat = await executionManager.confirmerEtExecuter({
      confirmationToken,
      confirm,
      liveConfirmationPhrase
    });

    return res.status(resultat.ok ? 200 : 400).json(resultat);
  } catch (error) {
    console.error("Erreur trade-confirm :", error);
    return res.status(500).json({ ok: false, erreur: error.message });
  }
});


/* ============================================================
   TESTS DE PROTECTION — validation uniquement, aucun ordre, aucun
   impact sur l'état de risque persisté (jamais de confirmerEtExecuter)
   ============================================================ */

app.get("/api/test-protections", async (req, res) => {
  const scenarios = [
    {
      nom: "symbole interdit",
      params: { symbol: "TSLA", side: "buy", qty: 1 }
    },
    {
      nom: "side invalide",
      params: { symbol: ALLOWED_SYMBOLS[0], side: "hold", qty: 1 }
    },
    {
      nom: "quantité invalide (0)",
      params: { symbol: ALLOWED_SYMBOLS[0], side: "buy", qty: 0 }
    },
    {
      nom: "quantité invalide (décimale)",
      params: { symbol: ALLOWED_SYMBOLS[0], side: "buy", qty: 1.5 }
    }
  ];

  const resultats = [];
  for (const scenario of scenarios) {
    const apercu = await executionManager.construireApercu(scenario.params);
    resultats.push({
      scenario: scenario.nom,
      refuseCommeAttendu: apercu.accepte === false,
      raisons: apercu.raisons
    });
  }

  const statutPaper = await riskManager.statut("paper");
  const statutLive = await riskManager.statut("live");

  return res.json({
    ok: true,
    message:
      "Ces scénarios doivent tous afficher refuseCommeAttendu = true. " +
      "Le secret incorrect et l'URL broker invalide sont couverts par " +
      "/api/tradingview-alert et /api/alpaca-paper-status / /api/alpaca-live-status.",
    resultats,
    limiteTradesSession: MAX_TRADES_PER_SESSION,
    statutPaper,
    statutLive
  });
});


/* ============================================================
   DÉMARRAGE
   ============================================================ */

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

  console.log(
    `Symboles autorisés : ${ALLOWED_SYMBOLS.join(", ")}`
  );

  console.log(
    `Limite de trades/session : ${MAX_TRADES_PER_SESSION}`
  );
});
