/**
 * ==================================================================================
 * CONFIGURATION CENTRALE
 * ==================================================================================
 * Un seul endroit pour tous les paramètres sensibles au mode / au risque.
 * Ne contient AUCUNE clé API — uniquement des noms de variables d'environnement
 * et des valeurs par défaut sûres.
 */

// ------------------------------------------------------------------
// MODES
// ------------------------------------------------------------------
export const TRADING_MODES = Object.freeze({
  ANALYSIS_ONLY: "analysis_only",
  PAPER_EXECUTE: "paper_execute",
  LIVE_EXECUTE: "live_execute"
});

export const TRADING_MODE = (
  process.env.TRADING_MODE || TRADING_MODES.ANALYSIS_ONLY
).trim();

export function modeEstValide(mode) {
  return Object.values(TRADING_MODES).includes(mode);
}

// ------------------------------------------------------------------
// BROKER — SÉPARATION STRICTE PAPER / LIVE
// ------------------------------------------------------------------
// Paper et Live utilisent des NOMS DE VARIABLES D'ENVIRONNEMENT DIFFÉRENTS.
// Impossible que le code "paper" lise accidentellement une clé Live :
// la fonction getAlpacaCredentials() ci-dessous (dans brokerAdapter.mjs)
// n'accède jamais aux variables Live quand mode === "paper".

export const ALPACA_PAPER_BASE_URL = "https://paper-api.alpaca.markets";
export const ALPACA_LIVE_BASE_URL = "https://api.alpaca.markets";

// ------------------------------------------------------------------
// SYMBOLES AUTORISÉS (whitelist stricte — modifiable via env, virgule-séparée)
// ------------------------------------------------------------------
export const ALLOWED_SYMBOLS = (
  process.env.ALLOWED_SYMBOLS || "AAPL,MSFT,SPY"
)
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

// ------------------------------------------------------------------
// RISQUE
// ------------------------------------------------------------------
export const MAX_TRADES_PER_SESSION = Math.max(
  1,
  Number.parseInt(process.env.MAX_TRADES_PER_SESSION || "7", 10)
);

export const MAX_QTY_PAR_ORDRE = Math.max(
  1,
  Number.parseInt(process.env.MAX_QTY_PAR_ORDRE || "10", 10)
);

export const MAX_PERTE_QUOTIDIENNE_USD = Number.parseFloat(
  process.env.MAX_PERTE_QUOTIDIENNE_USD || "1000"
);

export const RR_MINIMUM = Number.parseFloat(
  process.env.RR_MINIMUM || "1.5"
);

// ------------------------------------------------------------------
// VERROUS LIVE — plusieurs protections indépendantes, TOUTES requises
// ------------------------------------------------------------------
// 1. TRADING_MODE doit valoir "live_execute"
// 2. LIVE_TRADING_UNLOCKED doit valoir exactement "true"
// 3. LIVE_TRADING_CONFIRMATION_PHRASE (définie par toi dans Render) doit être
//    fournie mot pour mot dans le corps de la requête d'exécution Live.
// 4. Les clés ALPACA_LIVE_API_KEY / ALPACA_LIVE_SECRET_KEY doivent exister.
// 5. APCA_LIVE_API_BASE_URL doit être strictement égale à l'endpoint Live.
export const LIVE_TRADING_UNLOCKED =
  process.env.LIVE_TRADING_UNLOCKED === "true";

export const LIVE_TRADING_CONFIRMATION_PHRASE =
  process.env.LIVE_TRADING_CONFIRMATION_PHRASE || null;

// ------------------------------------------------------------------
// CONFIRMATION MANUELLE AVANT ENVOI D'ORDRE (paper ET live)
// ------------------------------------------------------------------
export const CONFIRMATION_TOKEN_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ------------------------------------------------------------------
// PERSISTANCE
// ------------------------------------------------------------------
// ⚠️ IMPORTANT : le disque de Render est éphémère par défaut (il peut être
// réinitialisé à chaque déploiement). Le fichier ci-dessous protège contre un
// simple redémarrage du process (crash, sommeil), mais PAS contre un nouveau
// déploiement, sauf si tu attaches un "Persistent Disk" Render et pointes
// RISK_STATE_FILE dessus (ex: /data/risk-state.json). Pour une fiabilité
// totale, une base externe (Postgres, Upstash Redis...) reste préférable —
// riskManager.mjs est écrit pour qu'on puisse brancher un autre backend plus
// tard sans changer le reste du code.
export const RISK_STATE_FILE =
  process.env.RISK_STATE_FILE || "./risk-state.json";
