import crypto from "node:crypto";
import {
  TRADING_MODE,
  TRADING_MODES,
  ALLOWED_SYMBOLS,
  LIVE_TRADING_UNLOCKED,
  LIVE_TRADING_CONFIRMATION_PHRASE,
  CONFIRMATION_TOKEN_TTL_MS
} from "./config.js";
import { riskManager } from "./riskManager.js";
import * as broker from "./brokerAdapter.js";

/**
 * ==================================================================================
 * EXECUTION MANAGER
 * ==================================================================================
 * L'ANALYSE (tradingRulesEngine.mjs) ne décide jamais d'envoyer un ordre.
 * Ce module est le SEUL endroit du projet qui peut appeler broker.envoyerOrdre().
 *
 * Flux obligatoire :
 *   1. construireApercu()   → calcule et affiche tout, ENVOIE RIEN
 *   2. confirmerEtExecuter() → ne fonctionne que si un aperçu valide existe
 *                              et que le jeton de confirmation est fourni
 */

const apercusEnAttente = new Map(); // token -> { ...donnees, expireA }

function nettoyerApercusExpires() {
  const maintenant = Date.now();
  for (const [token, apercu] of apercusEnAttente) {
    if (apercu.expireA < maintenant) apercusEnAttente.delete(token);
  }
}

function modeBrokerDepuis(modeDemande) {
  // "paper_execute" -> "paper", "live_execute" -> "live"
  if (modeDemande === TRADING_MODES.PAPER_EXECUTE) return "paper";
  if (modeDemande === TRADING_MODES.LIVE_EXECUTE) return "live";
  return null;
}

/**
 * Étape 1 — construit un aperçu complet, ne touche jamais au broker en écriture.
 */
export async function construireApercu({
  symbol,
  side,
  qty,
  orderType = "market",
  timeInForce = "day",
  plan = null,
  strategie = null,
  signalKey = null
}) {
  nettoyerApercusExpires();

  const symbolUpper = String(symbol || "").toUpperCase();
  const sideLower = String(side || "").toLowerCase();
  const controles = {};
  const raisons = [];

  // 1. Le mode global du serveur doit permettre une exécution
  controles.modeAutoriseExecution =
    TRADING_MODE === TRADING_MODES.PAPER_EXECUTE ||
    TRADING_MODE === TRADING_MODES.LIVE_EXECUTE;
  if (!controles.modeAutoriseExecution) {
    raisons.push(
      `TRADING_MODE actuel = "${TRADING_MODE}" : aucune exécution n'est autorisée (analyse uniquement).`
    );
  }

  const modeBroker = modeBrokerDepuis(TRADING_MODE);

  // 2. Verrous supplémentaires si Live
  if (TRADING_MODE === TRADING_MODES.LIVE_EXECUTE) {
    controles.liveDeverrouille = LIVE_TRADING_UNLOCKED === true;
    controles.livePhraseConfiguree = Boolean(
      LIVE_TRADING_CONFIRMATION_PHRASE
    );
    if (!controles.liveDeverrouille) {
      raisons.push(
        "LIVE_TRADING_UNLOCKED n'est pas défini à \"true\" dans les variables d'environnement."
      );
    }
    if (!controles.livePhraseConfiguree) {
      raisons.push(
        "LIVE_TRADING_CONFIRMATION_PHRASE n'est pas configurée côté serveur."
      );
    }
    try {
      broker.getCredentials("live");
      controles.credentialsLiveValides = true;
    } catch (error) {
      controles.credentialsLiveValides = false;
      raisons.push(error.message);
    }
  } else if (TRADING_MODE === TRADING_MODES.PAPER_EXECUTE) {
    try {
      broker.getCredentials("paper");
      controles.credentialsPaperValides = true;
    } catch (error) {
      controles.credentialsPaperValides = false;
      raisons.push(error.message);
    }
  }

  // 3. Symbole, side, quantité
  controles.symboleAutorise = ALLOWED_SYMBOLS.includes(symbolUpper);
  if (!controles.symboleAutorise) {
    raisons.push(
      `Symbole "${symbolUpper}" absent de la liste autorisée (${ALLOWED_SYMBOLS.join(", ")}).`
    );
  }

  controles.sideAutorise = ["buy", "sell"].includes(sideLower);
  if (!controles.sideAutorise) {
    raisons.push('side doit être "buy" ou "sell".');
  }

  const qtyNombre = Number(qty);
  controles.quantiteValide = Number.isInteger(qtyNombre) && qtyNombre > 0;
  if (!controles.quantiteValide) {
    raisons.push("qty doit être un entier positif.");
  }

  // 4. Risque (sans comptabiliser encore le trade)
  let verifRisque = null;
  if (modeBroker) {
    verifRisque = await riskManager.verifier(modeBroker, {
      symbol: symbolUpper,
      side: sideLower,
      qty: qtyNombre,
      plan,
      signalKey: signalKey || `${symbolUpper}-${sideLower}-${Date.now()}`
    });
    controles.risqueAutorise = verifRisque.autorise;
    if (!verifRisque.autorise) raisons.push(...verifRisque.raisons);
  }

  const accepte = raisons.length === 0;

  const token = crypto.randomUUID();
  const apercu = {
    token,
    accepte,
    raisons,
    controles,
    modeGlobal: TRADING_MODE,
    modeBroker,
    ordrePropose: {
      symbol: symbolUpper,
      side: sideLower,
      qty: qtyNombre,
      type: orderType,
      time_in_force: timeInForce
    },
    plan,
    strategie,
    signalKey,
    tradesSession: verifRisque
      ? `${verifRisque.tradesUtilisesAujourdhui}/${verifRisque.limiteJournaliere}`
      : null,
    creeA: Date.now(),
    expireA: Date.now() + CONFIRMATION_TOKEN_TTL_MS
  };

  if (accepte) {
    apercusEnAttente.set(token, apercu);
  }

  return {
    accepte,
    raisons,
    confirmationToken: accepte ? token : null,
    expireDansMs: accepte ? CONFIRMATION_TOKEN_TTL_MS : null,
    affichage: {
      BROKER: modeBroker ? `Alpaca (${modeBroker})` : "aucun",
      MODE: TRADING_MODE,
      SYMBOLE: symbolUpper,
      ACTION: sideLower,
      "QUANTITÉ": qtyNombre,
      TYPE: orderType,
      STOP: plan?.stop ?? null,
      OBJECTIF: plan?.objectif ?? null,
      RISQUE: plan?.risqueParUnite ?? null,
      "NOMBRE DE TRADES SESSION": verifRisque
        ? `${verifRisque.tradesUtilisesAujourdhui}/${verifRisque.limiteJournaliere}`
        : "n/d"
    }
  };
}

/**
 * Étape 2 — exécute réellement l'ordre, UNIQUEMENT si :
 *  - le token correspond à un aperçu valide et non expiré
 *  - confirm === true a été fourni explicitement par l'appelant
 *  - (Live seulement) la phrase de confirmation exacte est fournie
 */
export async function confirmerEtExecuter({
  confirmationToken,
  confirm,
  liveConfirmationPhrase = null
}) {
  nettoyerApercusExpires();

  if (confirm !== true) {
    return { ok: false, erreur: "confirm doit valoir explicitement true." };
  }

  const apercu = apercusEnAttente.get(confirmationToken);
  if (!apercu) {
    return {
      ok: false,
      erreur: "Jeton de confirmation invalide, déjà utilisé ou expiré."
    };
  }

  apercusEnAttente.delete(confirmationToken); // usage unique

  if (apercu.modeGlobal === TRADING_MODES.LIVE_EXECUTE) {
    if (
      !LIVE_TRADING_CONFIRMATION_PHRASE ||
      liveConfirmationPhrase !== LIVE_TRADING_CONFIRMATION_PHRASE
    ) {
      return {
        ok: false,
        erreur: "Phrase de confirmation Live manquante ou incorrecte."
      };
    }
  }

  // Re-vérification du risque au moment T (l'état a pu changer depuis l'aperçu)
  const revalidation = await riskManager.verifier(apercu.modeBroker, {
    symbol: apercu.ordrePropose.symbol,
    side: apercu.ordrePropose.side,
    qty: apercu.ordrePropose.qty,
    plan: apercu.plan,
    signalKey: apercu.signalKey
  });

  if (!revalidation.autorise) {
    return {
      ok: false,
      erreur: "Refusé lors de la revérification du risque.",
      raisons: revalidation.raisons
    };
  }

  const clientOrderId = `bot-${apercu.modeBroker}-${crypto.randomUUID()}`;

  const ordre = {
    symbol: apercu.ordrePropose.symbol,
    side: apercu.ordrePropose.side,
    qty: apercu.ordrePropose.qty,
    type: apercu.ordrePropose.type,
    time_in_force: apercu.ordrePropose.time_in_force,
    client_order_id: clientOrderId
  };

  console.log(
    "ExecutionManager : envoi ordre",
    JSON.stringify({
      mode: apercu.modeBroker,
      symbol: ordre.symbol,
      side: ordre.side,
      qty: ordre.qty,
      clientOrderId
    })
  );

  let reponseBroker;
  try {
    reponseBroker = await broker.envoyerOrdre(apercu.modeBroker, ordre);
  } catch (error) {
    console.error(
      "ExecutionManager : ordre refusé par le broker :",
      error.message
    );
    return { ok: false, erreur: error.message };
  }

  const enregistrement = await riskManager.enregistrerTrade(
    apercu.modeBroker,
    {
      id: reponseBroker.id,
      clientOrderId,
      symbol: ordre.symbol,
      side: ordre.side,
      qty: ordre.qty,
      statut: reponseBroker.status
    },
    { signalKey: apercu.signalKey }
  );

  return {
    ok: true,
    mode: apercu.modeBroker,
    ordreId: reponseBroker.id,
    clientOrderId,
    statut: reponseBroker.status,
    symbol: ordre.symbol,
    side: ordre.side,
    qty: ordre.qty,
    horodatage: new Date().toISOString(),
    tradesExecutesAujourdhui: enregistrement.tradesExecutes
  };
}

export function _debugApercusEnAttente() {
  return apercusEnAttente.size;
}
