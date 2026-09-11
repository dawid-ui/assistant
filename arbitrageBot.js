/**
 * ==================================================================================
 * ARBITRAGE BOT — COUCHE DE VALIDATION / COHÉRENCE (INDÉPENDANTE DU MOTEUR)
 * ==================================================================================
 *
 * Architecture obligatoire :
 *
 *   TradingView → tradingRulesEngine.js → verdict officiel → arbitrageBot.js
 *   → validation/cohérence → Render
 *
 * Rôle de ce module
 * ------------------
 * Ce bot NE DÉCIDE JAMAIS d'un trade et NE MODIFIE JAMAIS le verdict du
 * moteur (`report.verdict`). Le verdict du moteur (tradingRulesEngine.js)
 * reste SOUVERAIN. Ce bot lit uniquement les rapports déjà produits par
 * `MarketAnalyzer#runArbitratedAnalysis()` (voir tradingRulesEngine.js) et
 * ajoute une couche de VALIDATION et de COHÉRENCE :
 *
 *  - cohérence entre les différents timeframes (M5 → W) ;
 *  - stratégies "certifiées" (celles qui ont réellement voté) ;
 *  - bonus de confiance des stratégies 5 et 7 ;
 *  - contradictions internes ou inter-timeframes.
 *
 * Ce module est volontairement séparé de tradingRulesEngine.js : il ne
 * redéfinit aucune stratégie, ne recalcule rien à partir des bougies, et ne
 * fait que lire les rapports déjà produits par le moteur.
 *
 * Entrée attendue
 * ----------------
 * Un rapport (ou plusieurs, un par timeframe) au format retourné par
 * `MarketAnalyzer#runArbitratedAnalysis()` :
 *   { symbol, timeframe, verdict, raison, stats, votes, bonus, erreurs }
 *
 * Utilisation rapide
 * -------------------
 * import { MarketAnalyzer } from "./tradingRulesEngine.js";
 * import { validateArbitrage, formatArbitrageReport } from "./arbitrageBot.js";
 *
 * const rapportH1 = analyzerH1.runArbitratedAnalysis(); // verdict officiel
 * const rapportM15 = analyzerM15.runArbitratedAnalysis();
 * const rapportH4  = analyzerH4.runArbitratedAnalysis();
 *
 * const validation = validateArbitrage({
 *   officiel: rapportH1,
 *   timeframes: { M15: rapportM15, H1: rapportH1, H4: rapportH4 },
 * });
 *
 * console.log(formatArbitrageReport(validation));
 * // -> envoyer `validation` (et/ou rapportH1) vers Render
 */

/** Ordre canonique des timeframes, de M5 jusqu'à W (utilisé pour l'affichage). */
const TIMEFRAMES_ORDER = ["M5", "M15", "M30", "H1", "H4", "D1", "W"];

// Addition 1 (audit des stratégies du moteur) et Addition 2 (catalogue des
// techniques source vidéo/photo) vivent dans des fichiers séparés pour
// rester indépendantes et facilement testables — voir ces fichiers pour le
// détail de chaque règle et sa traçabilité.
import { auditerMoteur, formatAuditMoteur } from "./arbitrageAuditMoteur.js";
import { CATALOGUE_TECHNIQUES_SOURCE, auditerTechniquesSource, formatTechniquesSource } from "./arbitrageAuditTechniquesSource.js";

/** Verdicts reconnus par le bot — n'importe quelle autre valeur est traitée comme non évaluable. */
const VERDICTS_VALIDES = ["BUY", "SELL", "PAS DE TRADE"];

/** Renvoie le camp opposé à un verdict BUY/SELL, ou null si non applicable. */
function verdictOppose(verdict) {
  if (verdict === "BUY") return "SELL";
  if (verdict === "SELL") return "BUY";
  return null;
}

/**
 * Fait une copie profonde en lecture seule d'un rapport pour garantir que
 * le bot ne peut, à aucun moment, modifier le rapport du moteur (même par
 * erreur d'écriture involontaire) : `report.verdict` reste la propriété
 * exclusive de tradingRulesEngine.js.
 */
function copieProtegee(rapport) {
  if (!rapport || typeof rapport !== "object") return rapport;
  const copie = JSON.parse(JSON.stringify(rapport));
  return Object.freeze(copie);
}

/**
 * Analyse la cohérence entre le verdict officiel et les verdicts des
 * différents timeframes fournis (M5 → W). Ne modifie rien : lecture seule.
 *
 * @param {"BUY"|"SELL"|"PAS DE TRADE"} verdictMoteur
 * @param {Object<string, object>} timeframes  Map { M5: rapport, H1: rapport, ... }
 */
function analyserCoherenceTimeframes(verdictMoteur, timeframes) {
  const details = [];
  let accords = 0;
  let contradictions = 0;
  let neutres = 0;

  const nomsFournis = Object.keys(timeframes || {});
  const nomsOrdonnes = [
    ...TIMEFRAMES_ORDER.filter((tf) => nomsFournis.includes(tf)),
    ...nomsFournis.filter((tf) => !TIMEFRAMES_ORDER.includes(tf)),
  ];

  for (const tf of nomsOrdonnes) {
    const rapportTf = timeframes[tf];
    if (!rapportTf || !VERDICTS_VALIDES.includes(rapportTf.verdict)) {
      details.push({ timeframe: tf, statut: "NON_EVALUABLE", verdict: rapportTf ? rapportTf.verdict : null });
      continue;
    }
    if (verdictMoteur === "PAS DE TRADE") {
      // Rien à confirmer/contredire si le moteur n'a lui-même émis aucun signal.
      details.push({ timeframe: tf, statut: "N/A", verdict: rapportTf.verdict });
      continue;
    }
    if (rapportTf.verdict === verdictMoteur) {
      accords += 1;
      details.push({ timeframe: tf, statut: "ACCORD", verdict: rapportTf.verdict });
    } else if (rapportTf.verdict === verdictOppose(verdictMoteur)) {
      contradictions += 1;
      details.push({ timeframe: tf, statut: "CONTRADICTION", verdict: rapportTf.verdict });
    } else {
      // rapportTf.verdict === "PAS DE TRADE" : ni accord ni contradiction, juste neutre.
      neutres += 1;
      details.push({ timeframe: tf, statut: "NEUTRE", verdict: rapportTf.verdict });
    }
  }

  const comparables = accords + contradictions;
  const pctAccord = comparables > 0 ? Math.round((accords / comparables) * 1000) / 10 : null;

  return {
    accords,
    contradictions,
    neutres,
    pctAccord, // null si aucun timeframe comparable fourni
    details,
  };
}

/**
 * Résume les stratégies "certifiées" d'un rapport, c'est-à-dire celles qui
 * ont réellement produit un vote exploitable (applicable && verdict != null),
 * telles que retournées par `report.votes`.
 */
function resumerStrategiesCertifiees(rapportOfficiel) {
  const votes = Array.isArray(rapportOfficiel?.votes) ? rapportOfficiel.votes : [];
  const certifiees = votes.filter((v) => v.applicable && v.verdict !== null);
  const nonApplicables = votes.filter((v) => !v.applicable || v.verdict === null);

  const contradictionsInternes = rapportOfficiel && VERDICTS_VALIDES.includes(rapportOfficiel.verdict) && rapportOfficiel.verdict !== "PAS DE TRADE"
    ? certifiees.filter((v) => v.verdict === verdictOppose(rapportOfficiel.verdict))
    : [];

  return {
    total: votes.length,
    certifiees: certifiees.map((v) => ({ id: v.id, label: v.label, verdict: v.verdict, reason: v.reason })),
    nonApplicables: nonApplicables.map((v) => ({ id: v.id, label: v.label, reason: v.reason })),
    contradictionsInternes: contradictionsInternes.map((v) => ({ id: v.id, label: v.label, verdict: v.verdict, reason: v.reason })),
  };
}

/**
 * Résume le bonus de confiance (stratégies 5 et 7) sur l'ensemble des
 * rapports fournis (officiel + timeframes), sans jamais l'utiliser pour
 * modifier un verdict — uniquement pour l'afficher.
 */
function resumerBonus(rapportOfficiel, timeframes) {
  const tous = [rapportOfficiel, ...Object.values(timeframes || {})].filter(Boolean);
  let totalBuy = 0;
  let totalSell = 0;
  const details = [];
  for (const r of tous) {
    if (!r || !r.bonus) continue;
    totalBuy += r.bonus.buy || 0;
    totalSell += r.bonus.sell || 0;
    for (const d of r.bonus.details || []) {
      details.push({ timeframe: r.timeframe || null, ...d });
    }
  }
  return { buy: totalBuy, sell: totalSell, details };
}

/**
 * Détermine le statut de validation du bot à partir de la cohérence
 * inter-timeframes et des contradictions internes au rapport officiel.
 *
 * Ce sont des seuils PROPOSÉS, à ajuster ensemble si besoin :
 *  - NON_EVALUABLE : le moteur n'a émis aucun verdict exploitable (PAS DE
 *    TRADE), ou aucune donnée de validation n'est disponible.
 *  - CONFIRME : aucune contradiction (ni interne, ni inter-timeframes).
 *  - NUANCE : au moins une contradiction, mais les accords restent
 *    majoritaires ou égaux.
 *  - CONTREDIT : les contradictions dépassent les accords.
 */
function determinerValidationBot({ verdictMoteur, coherence, strategiesCertifiees }) {
  if (verdictMoteur === "PAS DE TRADE") {
    return "NON_EVALUABLE";
  }
  const contradictionsTotal = coherence.contradictions + strategiesCertifiees.contradictionsInternes.length;
  const accordsTotal = coherence.accords + strategiesCertifiees.certifiees.length;

  if (contradictionsTotal === 0) return "CONFIRME";
  if (contradictionsTotal > accordsTotal) return "CONTREDIT";
  return "NUANCE";
}

/**
 * Fonction principale du bot : valide/challenge le verdict officiel du
 * moteur SANS jamais le modifier.
 *
 * @param {object} params
 * @param {object} params.officiel  Rapport officiel (celui qui fait foi),
 *   produit par `MarketAnalyzer#runArbitratedAnalysis()`.
 * @param {Object<string, object>} [params.timeframes]  Map optionnelle des
 *   rapports par timeframe (ex: { M5, M15, M30, H1, H4, D1, W }), chacun
 *   produit par `MarketAnalyzer#runArbitratedAnalysis()` sur les données de
 *   ce timeframe. Le rapport officiel peut (ou non) figurer aussi dans cette
 *   map ; ce n'est pas obligatoire.
 * @returns {object} Rapport de validation (voir formatArbitrageReport pour
 *   un rendu texte).
 */
function validateArbitrage({ officiel, timeframes = {} } = {}) {
  // Copies protégées en lecture seule : le bot ne peut jamais écrire dans
  // le rapport du moteur, même par accident.
  const rapportOfficiel = copieProtegee(officiel);
  const rapportsTimeframes = {};
  for (const [tf, rapport] of Object.entries(timeframes || {})) {
    rapportsTimeframes[tf] = copieProtegee(rapport);
  }

  if (!rapportOfficiel || !VERDICTS_VALIDES.includes(rapportOfficiel.verdict)) {
    return {
      verdictMoteur: rapportOfficiel ? rapportOfficiel.verdict ?? null : null,
      validationBot: "NON_EVALUABLE",
      coherence: null,
      bonus: null,
      timeframes: null,
      strategiesCertifiees: null,
      raison: "Rapport officiel absent ou invalide — impossible d'évaluer la cohérence.",
    };
  }

  const verdictMoteur = rapportOfficiel.verdict;
  const coherence = analyserCoherenceTimeframes(verdictMoteur, rapportsTimeframes);
  const strategiesCertifiees = resumerStrategiesCertifiees(rapportOfficiel);
  const bonus = resumerBonus(rapportOfficiel, rapportsTimeframes);
  const validationBot = determinerValidationBot({ verdictMoteur, coherence, strategiesCertifiees });

  return {
    verdictMoteur, // jamais modifié, jamais recalculé — lu tel quel depuis le moteur
    validationBot, // "CONFIRME" | "NUANCE" | "CONTREDIT" | "NON_EVALUABLE"
    coherence,
    bonus,
    timeframes: coherence.details,
    strategiesCertifiees,
    raison: rapportOfficiel.raison || null,
  };
}

/**
 * Rendu texte du rapport de validation, dans le format demandé :
 *
 * verdictMoteur: BUY
 * validationBot: CONFIRME
 * coherence: ...
 * bonus: ...
 * timeframes: ...
 */
function formatArbitrageReport(validation) {
  if (!validation) return "Aucune validation disponible.";
  const lignes = [];
  lignes.push(`verdictMoteur: ${validation.verdictMoteur ?? "N/A"}`);
  lignes.push(`validationBot: ${validation.validationBot}`);

  if (validation.coherence) {
    const c = validation.coherence;
    const pct = c.pctAccord === null ? "N/A" : `${c.pctAccord}%`;
    lignes.push(
      `coherence: ${c.accords} accord(s), ${c.contradictions} contradiction(s), ` +
      `${c.neutres} neutre(s) (${pct} d'accord sur les timeframes comparables)`
    );
  } else {
    lignes.push("coherence: non évaluable");
  }

  if (validation.bonus) {
    lignes.push(`bonus: +${validation.bonus.buy} BUY / +${validation.bonus.sell} SELL (informatif)`);
  } else {
    lignes.push("bonus: aucun");
  }

  if (Array.isArray(validation.timeframes) && validation.timeframes.length > 0) {
    const parTf = validation.timeframes
      .map((t) => `${t.timeframe}=${t.verdict ?? "N/A"}(${t.statut})`)
      .join(", ");
    lignes.push(`timeframes: ${parTf}`);
  } else {
    lignes.push("timeframes: aucun timeframe additionnel fourni");
  }

  if (validation.strategiesCertifiees) {
    const s = validation.strategiesCertifiees;
    lignes.push(
      `strategiesCertifiees: ${s.certifiees.length}/${s.total} stratégie(s) ont voté` +
      (s.contradictionsInternes.length > 0
        ? ` — ⚠️ ${s.contradictionsInternes.length} contradiction(s) interne(s) : ` +
          s.contradictionsInternes.map((c) => c.label).join(", ")
        : "")
    );
  }

  return lignes.join("\n");
}

/**
 * Petite classe optionnelle pour un usage orienté-objet, symétrique de
 * `MarketAnalyzer` côté moteur. Reste un simple wrapper : aucune logique
 * supplémentaire, aucune modification du verdict.
 */
class ArbitrageBot {
  /**
   * @param {object} params
   * @param {object} params.officiel
   * @param {Object<string, object>} [params.timeframes]
   */
  constructor({ officiel, timeframes = {} } = {}) {
    this.officiel = officiel;
    this.timeframes = timeframes;
  }
  validate() {
    return validateArbitrage({ officiel: this.officiel, timeframes: this.timeframes });
  }
  toText() {
    return formatArbitrageReport(this.validate());
  }
  /** Addition 1 — audit des stratégies du moteur à partir du rapport officiel. */
  auditMoteur() {
    return auditerMoteur(this.officiel);
  }
  /** Addition 2 — catalogue des techniques source (vidéo/photo), statique. */
  auditTechniquesSource() {
    return auditerTechniquesSource();
  }
}

export {
  TIMEFRAMES_ORDER,
  validateArbitrage,
  formatArbitrageReport,
  ArbitrageBot,
  // Addition 1 — audit des stratégies du moteur (doc "MISSION — COMPLÉTER ET RENFORCER").
  auditerMoteur,
  formatAuditMoteur,
  // Addition 2 — catalogue des techniques source vidéo/photo (doc "DOSSIER TECHNIQUE").
  CATALOGUE_TECHNIQUES_SOURCE,
  auditerTechniquesSource,
  formatTechniquesSource,
};
