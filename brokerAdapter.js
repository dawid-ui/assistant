import { ALPACA_PAPER_BASE_URL, ALPACA_LIVE_BASE_URL } from "./config.js";

/**
 * ==================================================================================
 * BROKER ADAPTER — Alpaca
 * ==================================================================================
 * SÉPARATION STRICTE : "paper" et "live" lisent des variables d'environnement
 * DIFFÉRENTES. Il n'existe aucun chemin de code où une clé Live pourrait être
 * utilisée pour un ordre "paper", ni l'inverse.
 *
 *   PAPER → ALPACA_API_KEY / ALPACA_SECRET_KEY / APCA_API_BASE_URL
 *   LIVE  → ALPACA_LIVE_API_KEY / ALPACA_LIVE_SECRET_KEY / APCA_LIVE_API_BASE_URL
 *
 * Aucune clé n'est jamais retournée, loggée, ou incluse dans une réponse HTTP.
 */

class BrokerConfigError extends Error {}

export function getCredentials(mode) {
  if (mode === "paper") {
    const apiKey = process.env.ALPACA_API_KEY;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    const baseUrl = String(process.env.APCA_API_BASE_URL || "").replace(
      /\/$/,
      ""
    );

    if (!apiKey || !secretKey) {
      throw new BrokerConfigError("Clés Alpaca Paper absentes.");
    }
    if (
      baseUrl !== ALPACA_PAPER_BASE_URL &&
      baseUrl !== `${ALPACA_PAPER_BASE_URL}/v2`
    ) {
      throw new BrokerConfigError(
        `APCA_API_BASE_URL doit être ${ALPACA_PAPER_BASE_URL} (valeur actuelle refusée pour raison de sécurité).`
      );
    }
    return { apiKey, secretKey, baseUrl: ALPACA_PAPER_BASE_URL };
  }

  if (mode === "live") {
    const apiKey = process.env.ALPACA_LIVE_API_KEY;
    const secretKey = process.env.ALPACA_LIVE_SECRET_KEY;
    const baseUrl = String(
      process.env.APCA_LIVE_API_BASE_URL || ""
    ).replace(/\/$/, "");

    if (!apiKey || !secretKey) {
      throw new BrokerConfigError("Clés Alpaca Live absentes.");
    }
    if (
      baseUrl !== ALPACA_LIVE_BASE_URL &&
      baseUrl !== `${ALPACA_LIVE_BASE_URL}/v2`
    ) {
      throw new BrokerConfigError(
        `APCA_LIVE_API_BASE_URL doit être ${ALPACA_LIVE_BASE_URL} (valeur actuelle refusée pour raison de sécurité).`
      );
    }
    return { apiKey, secretKey, baseUrl: ALPACA_LIVE_BASE_URL };
  }

  throw new BrokerConfigError(`Mode broker inconnu : ${mode}`);
}

function headers(creds) {
  return {
    "APCA-API-KEY-ID": creds.apiKey,
    "APCA-API-SECRET-KEY": creds.secretKey,
    "Content-Type": "application/json"
  };
}

export async function getAccount(mode) {
  const creds = getCredentials(mode);
  const res = await fetch(`${creds.baseUrl}/v2/account`, {
    headers: headers(creds)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Erreur compte Alpaca (${mode})`);
  }
  return data;
}

export async function getOpenPositions(mode) {
  const creds = getCredentials(mode);
  const res = await fetch(`${creds.baseUrl}/v2/positions`, {
    headers: headers(creds)
  });
  if (res.status === 404) return [];
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Erreur positions Alpaca (${mode})`);
  }
  return data;
}

/**
 * Envoie réellement un ordre au broker. N'est appelé QUE par executionManager
 * après validation complète (mode, risque, confirmation explicite).
 * @param {"paper"|"live"} mode
 * @param {{symbol:string, side:"buy"|"sell", qty:number, type:string, time_in_force:string, client_order_id:string, stop_loss?:object, take_profit?:object}} ordre
 */
export async function envoyerOrdre(mode, ordre) {
  const creds = getCredentials(mode);

  const res = await fetch(`${creds.baseUrl}/v2/orders`, {
    method: "POST",
    headers: headers(creds),
    body: JSON.stringify(ordre)
  });

  const data = await res.json();

  if (!res.ok) {
    const error = new Error(data.message || `Ordre Alpaca refusé (${mode})`);
    error.alpacaResponse = data;
    throw error;
  }

  return data;
}

export { BrokerConfigError };
