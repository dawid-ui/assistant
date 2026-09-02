import { promises as fs } from "node:fs";
import {
  MAX_TRADES_PER_SESSION,
  MAX_QTY_PAR_ORDRE,
  MAX_PERTE_QUOTIDIENNE_USD,
  RR_MINIMUM,
  RISK_STATE_FILE
} from "./config.js";

/**
 * ==================================================================================
 * RISK MANAGER
 * ==================================================================================
 * Point de passage OBLIGATOIRE avant tout ordre. Ne connaît rien du broker :
 * il dit seulement "autorisé" / "refusé" avec une raison claire.
 *
 * Persistance : fichier JSON local, un compteur par (mode, journée UTC).
 * Voir la note sur RISK_STATE_FILE dans config.mjs (disque éphémère Render).
 */

function cleJour(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function lireEtat() {
  try {
    const contenu = await fs.readFile(RISK_STATE_FILE, "utf-8");
    return JSON.parse(contenu);
  } catch {
    return { jours: {} };
  }
}

async function ecrireEtat(etat) {
  try {
    await fs.writeFile(
      RISK_STATE_FILE,
      JSON.stringify(etat, null, 2),
      "utf-8"
    );
    return true;
  } catch (error) {
    console.error(
      "RiskManager : échec écriture de l'état persistant :",
      error.message
    );
    return false;
  }
}

function etatDuJour(etat, mode, jour) {
  if (!etat.jours[jour]) etat.jours[jour] = {};
  if (!etat.jours[jour][mode]) {
    etat.jours[jour][mode] = {
      tradesExecutes: 0,
      pnlRealise: 0,
      ordres: [],
      signauxRecents: []
    };
  }
  return etat.jours[jour][mode];
}

export class RiskManager {
  constructor() {
    this._verrou = Promise.resolve(); // sérialise les accès concurrents au fichier
  }

  async _avecVerrou(fn) {
    const executer = this._verrou.then(fn, fn);
    this._verrou = executer.catch(() => {});
    return executer;
  }

  /**
   * Vérifie si un nouveau trade est autorisé, SANS le comptabiliser.
   * @param {"paper"|"live"} mode
   * @param {{symbol:string, side:string, qty:number, plan:object|null, signalKey:string}} demande
   */
  async verifier(mode, demande) {
    return this._avecVerrou(async () => {
      const etat = await lireEtat();
      const jour = cleJour();
      const jourMode = etatDuJour(etat, mode, jour);

      const raisons = [];

      if (jourMode.tradesExecutes >= MAX_TRADES_PER_SESSION) {
        raisons.push(
          `Limite de ${MAX_TRADES_PER_SESSION} trades atteinte pour aujourd'hui (${mode}).`
        );
      }

      if (!Number.isInteger(demande.qty) || demande.qty <= 0) {
        raisons.push("Quantité invalide : doit être un entier positif.");
      } else if (demande.qty > MAX_QTY_PAR_ORDRE) {
        raisons.push(
          `Quantité ${demande.qty} supérieure à la limite autorisée (${MAX_QTY_PAR_ORDRE}).`
        );
      }

      if (
        MAX_PERTE_QUOTIDIENNE_USD > 0 &&
        jourMode.pnlRealise <= -Math.abs(MAX_PERTE_QUOTIDIENNE_USD)
      ) {
        raisons.push(
          `Perte quotidienne maximale atteinte (${jourMode.pnlRealise} $ / limite ${MAX_PERTE_QUOTIDIENNE_USD} $).`
        );
      }

      if (demande.plan && demande.plan.rr !== null && demande.plan.rr !== undefined) {
        if (demande.plan.rr < RR_MINIMUM) {
          raisons.push(
            `R:R (${demande.plan.rr}) inférieur au minimum requis (${RR_MINIMUM}).`
          );
        }
      }

      const positionDejaOuverte = jourMode.ordres.some(
        (o) =>
          o.symbol === demande.symbol &&
          o.side === demande.side &&
          o.statut !== "closed"
      );
      if (positionDejaOuverte) {
        raisons.push(
          `Une position ${demande.side} sur ${demande.symbol} est déjà suivie aujourd'hui (protection anti-doublon).`
        );
      }

      const signalRecent = jourMode.signauxRecents.find(
        (s) => s.cle === demande.signalKey
      );
      if (signalRecent) {
        const ageSecondes = (Date.now() - signalRecent.horodatage) / 1000;
        if (ageSecondes < 30) {
          raisons.push(
            "Signal identique déjà traité il y a moins de 30 secondes (anti-doublon signal)."
          );
        }
      }

      return {
        autorise: raisons.length === 0,
        raisons,
        tradesUtilisesAujourdhui: jourMode.tradesExecutes,
        tradesRestants: Math.max(
          0,
          MAX_TRADES_PER_SESSION - jourMode.tradesExecutes
        ),
        limiteJournaliere: MAX_TRADES_PER_SESSION
      };
    });
  }

  /**
   * Enregistre un trade réellement exécuté (après réponse OK du broker).
   */
  async enregistrerTrade(mode, ordreInfo, demande) {
    return this._avecVerrou(async () => {
      const etat = await lireEtat();
      const jour = cleJour();
      const jourMode = etatDuJour(etat, mode, jour);

      jourMode.tradesExecutes += 1;
      jourMode.ordres.push({
        id: ordreInfo.id,
        clientOrderId: ordreInfo.clientOrderId,
        symbol: ordreInfo.symbol,
        side: ordreInfo.side,
        qty: ordreInfo.qty,
        statut: ordreInfo.statut || "open",
        horodatage: Date.now()
      });
      jourMode.signauxRecents.push({
        cle: demande.signalKey,
        horodatage: Date.now()
      });
      // on garde seulement les 50 derniers signaux pour ne pas grossir indéfiniment
      jourMode.signauxRecents = jourMode.signauxRecents.slice(-50);

      const ecrit = await ecrireEtat(etat);
      return { persiste: ecrit, tradesExecutes: jourMode.tradesExecutes };
    });
  }

  async statut(mode) {
    const etat = await lireEtat();
    const jour = cleJour();
    const jourMode = etatDuJour(etat, mode, jour);
    return {
      mode,
      jour,
      tradesExecutes: jourMode.tradesExecutes,
      tradesRestants: Math.max(
        0,
        MAX_TRADES_PER_SESSION - jourMode.tradesExecutes
      ),
      limiteJournaliere: MAX_TRADES_PER_SESSION,
      pnlRealise: jourMode.pnlRealise,
      ordresDuJour: jourMode.ordres
    };
  }
}

export const riskManager = new RiskManager();
