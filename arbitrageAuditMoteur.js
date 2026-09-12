/**
 * ==================================================================================
 * AUDIT DES STRATÉGIES DU MOTEUR — MODULE INDÉPENDANT (ADDITION 1)
 * ==================================================================================
 *
 * Rôle : vérifier que chaque stratégie de tradingRulesEngine.js dispose bien
 * de toutes les conditions nécessaires avant d'être considérée exploitable,
 * SANS jamais inventer de règle et SANS jamais modifier report.verdict.
 *
 * Principe de fonctionnement :
 * - Ce module ne recalcule RIEN à partir des bougies. Il lit uniquement les
 *   champs déjà produits par `MarketAnalyzer#runArbitratedAnalysis()`
 *   (report.votes[].raw, report.observations, report.strategiesExclusDuVote).
 * - Le "CATALOGUE" ci-dessous décrit, pour chaque stratégie, ce que le CODE
 *   EXISTANT (tradingRulesEngine.js) vérifie réellement. Chaque entrée est
 *   sourcée `EXISTING_ENGINE` car aucun dossier de règles externe ne couvre
 *   ces stratégies mécaniques (VWAP, market structure, breakout/retest,
 *   liquidity sweep, AMD, trend/momentum, mean reversion, FVG classique,
 *   liquidity run/sweep, ORB, double top/bottom, divergence RSI, order
 *   blocks, displacement). Voir arbitrageAuditTechniquesSource.js pour les
 *   concepts qui, eux, proviennent du dossier vidéo/photo externe.
 *
 * IMPORTANT — sémantique du statut "COMPLETE" ici :
 *   COMPLETE signifie que la chaîne d'identification + confirmation +
 *   direction de la stratégie a pu être évaluée mécaniquement jusqu'au bout
 *   (qu'un setup soit présent ou non). Cela NE SIGNIFIE PAS "prêt à
 *   exécuter" : aucune stratégie de `runArbitratedAnalysis()` ne calcule
 *   d'entrée/stop/take-profit (voir le bloc entry/stopLoss/takeProfit/rr,
 *   toujours `defined:false` ici — ce calcul reste dans `buildTradePlan()` /
 *   `runFullAnalysis()`, séparé et inchangé).
 */

const STATUTS = ["COMPLETE", "PARTIAL", "NON_EVALUABLE_MECANIQUEMENT", "CONTRADICTORY"];

/**
 * Catalogue des 14 stratégies incluses dans le vote d'arbitrage.
 * Toutes sourcées EXISTING_ENGINE : dérivées de la lecture directe du code
 * de tradingRulesEngine.js (fonctions detectXxx correspondantes).
 */
const CATALOGUE_MOTEUR = {
  vwap: {
    fonction: "detectVwapSetup()",
    principles: [
      "Identifie un Bounce ou un Reject du prix sur le VWAP de session.",
    ],
    requiredConditions: [
      "Un type de setup VWAP a été identifié (raw.type non nul).",
      "Le détecteur confirme explicitement le setup (raw.confirme === true).",
      "Une direction est déterminée (raw.direction 'haussier' ou 'baissier').",
    ],
    confirmations: ["raw.confirme === true (logique interne au détecteur)."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie dans tradingRulesEngine.js.",
    timeframeRequirements: ["Timeframe unique de l'instance MarketAnalyzer — aucune combinaison multi-timeframe interne."],
    dataRequirements: ["Bougies de la session en cours pour calculer le VWAP."],
  },
  market_structure: {
    fonction: "detectMarketStructure()",
    principles: [
      "Détecte un Break of Structure (BOS). Un simple Change of Character (CHoCH) reste une alerte, pas un vote (choix explicite du moteur).",
    ],
    requiredConditions: [
      "Un BOS est confirmé (raw.bos non nul).",
      "La structure a une direction ('haussier' ou 'baissier').",
    ],
    confirmations: ["Présence de raw.bos (le CHoCH seul ne suffit pas — décision explicite du moteur)."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Historique de swing points suffisant."],
  },
  breakout_retest: {
    fonction: "detectBreakAndRetest(niveau, direction)",
    principles: ["Vérifie la cassure d'un niveau externe puis son retest."],
    requiredConditions: [
      "Un niveau externe (niveauPourBreakout) est fourni par l'appelant.",
      "Une direction externe (directionPourBreakout) est fournie par l'appelant.",
      "Le détecteur confirme le retest (raw.confirme === true).",
    ],
    confirmations: ["raw.confirme === true."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Niveau et direction externes obligatoires — jamais devinés par le moteur."],
  },
  liquidity_sweep: {
    fonction: "detectLiquiditySweep()",
    principles: ["Détecte un sweep de liquidité (mèche au-delà d'un extrême récent puis rejet)."],
    requiredConditions: [
      "Un sweep est détecté (raw.sweepDetecte === true).",
      "Une direction est déterminée (raw.direction).",
    ],
    confirmations: ["raw.sweepDetecte === true."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Historique de prix récent suffisant pour identifier l'extrême balayé."],
  },
  amd: {
    fonction: "detectAmd()",
    principles: ["Modèle Accumulation / Manipulation / Distribution — seule la phase de distribution vote."],
    requiredConditions: [
      "Une phase de distribution est identifiée (raw.distribution non nul).",
    ],
    confirmations: ["raw.distribution non nul."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée. Les phases accumulation/manipulation ne votent jamais (choix explicite du moteur).",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Historique suffisant pour identifier les 3 phases."],
  },
  trend_momentum: {
    fonction: "detectTrendMomentum()",
    principles: ["Confirme une tendance/momentum directionnel."],
    requiredConditions: [
      "Le détecteur confirme (raw.confirme === true).",
      "Une direction est déterminée (raw.direction).",
    ],
    confirmations: ["raw.confirme === true."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Historique suffisant pour calculer l'indicateur de tendance."],
  },
  mean_reversion: {
    fonction: "detectMeanReversion()",
    principles: ["Détecte un écart statistique (z-score) par rapport à la moyenne, avec retour attendu."],
    requiredConditions: [
      "Le détecteur confirme (raw.confirme === true).",
      "Une direction est déterminée (raw.direction).",
    ],
    confirmations: ["raw.confirme === true (basé sur le z-score interne)."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Historique suffisant pour calculer la moyenne et l'écart-type."],
  },
  fair_value_gap: {
    fonction: "detectFairValueGaps()",
    principles: ["FVG classique (3 bougies) — le vote utilise le FVG ouvert (non comblé) le plus récent."],
    requiredConditions: [
      "Au moins un FVG ouvert existe (raw.dernier non nul).",
      "Ce FVG a une direction (raw.dernier.direction).",
    ],
    confirmations: ["Le gap n'est pas comblé (comble === false)."],
    invalidations: ["Le gap est comblé (comble devient true) — mais ceci n'est pas réévalué en direct par le vote, seulement au moment de l'analyse."],
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Au moins 3 bougies consécutives pour former un gap."],
  },
  liquidity_run_sweep: {
    fonction: "detectLiquidityRunOrSweep(niveau)",
    principles: ["Distingue un 'run' (continuation au-delà d'un niveau) d'un 'sweep' (rejet)."],
    requiredConditions: [
      "Un niveau externe (niveauPourBreakout) est fourni par l'appelant.",
      "Un type est déterminé (raw.type non nul), direction dérivée du suffixe du type.",
    ],
    confirmations: ["raw.type non nul."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Niveau externe obligatoire — jamais deviné."],
  },
  orb: {
    fonction: "detectOpeningRangeBreakout()",
    principles: ["Range d'ouverture, avec breakout haussier et/ou baissier évalués séparément."],
    requiredConditions: [
      "Le range d'ouverture est confirmé (raw.confirme === true).",
      "Exactement un des deux côtés (haussier XOR baissier) est confirmé.",
    ],
    confirmations: ["raw.breakoutHaussier.confirme ou raw.breakoutBaissier.confirme (exclusif)."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique — la session d'ouverture doit être présente dans les données."],
    dataRequirements: ["Bougies couvrant la période d'ouverture définie par le moteur."],
    casSpecial: "contradictoire_si_double_confirme",
  },
  double_top_bottom: {
    fonction: "detectDoubleTopBottom()",
    principles: ["Détecte un double top (baissier) ou un double bottom (haussier)."],
    requiredConditions: [
      "Le détecteur confirme (raw.confirme === true).",
      "Un pattern est identifié (raw.pattern 'double_top' ou 'double_bottom').",
    ],
    confirmations: ["raw.confirme === true."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Suffisamment de swing points pour former 2 sommets/creux comparables."],
  },
  rsi_divergence: {
    fonction: "detectRsiDivergence()",
    principles: ["Divergence entre le prix et le RSI."],
    requiredConditions: [
      "Le détecteur confirme (raw.confirme === true).",
      "Un type de divergence est déterminé (raw.type 'haussier'/'baissier').",
    ],
    confirmations: ["raw.confirme === true."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Historique suffisant pour calculer le RSI et comparer aux extrêmes de prix."],
  },
  order_blocks: {
    fonction: "detectOrderBlocks()",
    principles: ["Order Block '5 étoiles' — imbalance obligatoire pour être utilisable (estUtilisableSelonLaMethode())."],
    requiredConditions: [
      "Au moins un Order Block valide existe (imbalance validée).",
      "Une direction est déterminée par le meilleur bloc (score le plus élevé).",
    ],
    confirmations: ["ob.estUtilisableSelonLaMethode() === true pour au moins un bloc."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie (au-delà de l'exigence d'imbalance).",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Historique suffisant pour identifier les blocs et leur imbalance associée."],
  },
  displacement: {
    fonction: "detectDisplacement()",
    principles: ["Détecte un mouvement de range/ATR anormalement large (displacement)."],
    requiredConditions: [
      "Un displacement est détecté (raw.detecte === true).",
      "Une direction est déterminée (raw.direction).",
    ],
    confirmations: ["raw.detecte === true."],
    invalidations: [],
    invalidationsNote: "Aucune invalidation mécanique explicite codée pour cette stratégie.",
    timeframeRequirements: ["Timeframe unique."],
    dataRequirements: ["Historique suffisant pour calculer l'ATR de référence."],
  },
};

/** Bloc entry/stopLoss/takeProfit/rr — IDENTIQUE pour les 14 stratégies ci-dessus :
 * `runArbitratedAnalysis()` ne calcule aucun plan de risque. Ce n'est pas une
 * lacune détectée par l'audit, c'est le périmètre assumé de cette méthode
 * (le plan de risque reste dans `buildTradePlan()` / `runFullAnalysis()`).
 */
function blocRisqueNonCalcule() {
  return {
    entry: { defined: false, validated: false },
    stopLoss: { defined: false, validated: false },
    takeProfit: { defined: false, validated: false },
    rr: { defined: false, validated: false, value: null },
    note: "Non calculé par runArbitratedAnalysis() — hors périmètre (voir buildTradePlan()/runFullAnalysis(), séparés et inchangés).",
  };
}

/**
 * Audite une stratégie du vote principal (les 14 ci-dessus) à partir de
 * l'entrée `votes[]` correspondante du rapport officiel.
 */
function auditerStrategieVotee(id, voteEntry, rapportOfficiel) {
  const catalogue = CATALOGUE_MOTEUR[id];
  if (!catalogue) {
    return null; // ne devrait pas arriver ; géré par l'appelant.
  }

  const base = {
    strategy: id,
    principles: catalogue.principles,
    requiredConditions: catalogue.requiredConditions,
    confirmations: catalogue.confirmations,
    invalidations: catalogue.invalidations,
    timeframeRequirements: catalogue.timeframeRequirements,
    availableTimeframes: rapportOfficiel?.timeframe ? [rapportOfficiel.timeframe] : [],
    ...blocRisqueNonCalcule(),
    contradictions: [],
    sourceTraceability: [`EXISTING_ENGINE: tradingRulesEngine.js — ${catalogue.fonction}`],
    notes: [],
  };
  if (catalogue.invalidationsNote) base.notes.push(catalogue.invalidationsNote);

  if (!voteEntry) {
    return {
      ...base,
      status: "NON_EVALUABLE_MECANIQUEMENT",
      confirmedConditions: [],
      missingConditions: ["Aucune entrée de vote trouvée dans le rapport officiel pour cette stratégie."],
      notes: [...base.notes, "Le rapport fourni ne contient pas cette stratégie — vérifier qu'il provient bien de runArbitratedAnalysis()."],
    };
  }

  const raw = voteEntry.raw;

  // Cas ORB : contradiction explicite si les deux côtés sont confirmés en même temps.
  if (catalogue.casSpecial === "contradictoire_si_double_confirme" && raw) {
    const up = Boolean(raw.breakoutHaussier && raw.breakoutHaussier.confirme);
    const down = Boolean(raw.breakoutBaissier && raw.breakoutBaissier.confirme);
    if (up && down) {
      return {
        ...base,
        status: "CONTRADICTORY",
        confirmedConditions: ["raw.breakoutHaussier.confirme === true", "raw.breakoutBaissier.confirme === true"],
        missingConditions: [],
        contradictions: [
          { condition: "breakoutHaussier.confirme", valeur: true },
          { condition: "breakoutBaissier.confirme", valeur: true },
        ],
        notes: [...base.notes, "Signal ignoré par le moteur (ni BUY ni SELL) — l'audit confirme qu'il s'agit bien d'une contradiction et non d'une absence de setup."],
      };
    }
  }

  // Entrée requérant un paramètre externe absent (breakout_retest / liquidity_run_sweep).
  if (raw === null || raw === undefined) {
    return {
      ...base,
      status: "NON_EVALUABLE_MECANIQUEMENT",
      confirmedConditions: [],
      missingConditions: [voteEntry.reason || "Donnée ou paramètre externe requis non fourni."],
      notes: [...base.notes, "Aucune supposition n'a été faite pour combler ce paramètre manquant (conformément à la règle de non-invention)."],
    };
  }

  // Cas général : on vérifie si la chaîne a produit un résultat déterministe.
  // Le détecteur a un type/booléen/direction bien définis (même si "pas de setup").
  const confirmedConditions = [];
  const missingConditions = [];

  if (id === "vwap") {
    if (raw.type) confirmedConditions.push("Type de setup VWAP identifié.");
    else missingConditions.push("Aucun type de setup VWAP identifié actuellement (prix n'a pas touché le VWAP).");
    if (raw.confirme) confirmedConditions.push("Setup confirmé par le détecteur.");
    if (raw.direction) confirmedConditions.push(`Direction déterminée : ${raw.direction}.`);
  } else if (id === "market_structure") {
    if (raw.bos) confirmedConditions.push(`BOS confirmé : ${raw.bos}.`);
    else missingConditions.push("Aucun BOS confirmé actuellement" + (raw.choch ? ` (un CHoCH est présent : ${raw.choch}, mais ne suffit pas)." ` : "."));
  } else if (id === "breakout_retest") {
    if (raw.confirme) confirmedConditions.push("Retest confirmé.");
    else missingConditions.push("Retest non confirmé pour le niveau/direction fournis.");
  } else if (id === "liquidity_sweep") {
    if (raw.sweepDetecte) confirmedConditions.push(`Sweep détecté, direction ${raw.direction}.`);
    else missingConditions.push("Aucun sweep de liquidité détecté actuellement.");
  } else if (id === "amd") {
    if (raw.distribution) confirmedConditions.push(`Phase de distribution identifiée : ${raw.distribution}.`);
    else missingConditions.push("Aucune phase de distribution identifiée actuellement (accumulation/manipulation ne votent jamais).");
  } else if (id === "trend_momentum" || id === "mean_reversion") {
    if (raw.confirme) confirmedConditions.push(`Confirmé, direction ${raw.direction}.`);
    else missingConditions.push("Non confirmé actuellement.");
  } else if (id === "fair_value_gap") {
    if (raw.dernier) confirmedConditions.push(`FVG ouvert le plus récent : ${raw.dernier.direction}.`);
    else missingConditions.push("Aucun FVG ouvert actuellement.");
  } else if (id === "liquidity_run_sweep") {
    if (raw.type) confirmedConditions.push(`Type déterminé : ${raw.type}.`);
    else missingConditions.push("Aucun run/sweep détecté pour ce niveau actuellement.");
  } else if (id === "orb") {
    const up = Boolean(raw.breakoutHaussier && raw.breakoutHaussier.confirme);
    const down = Boolean(raw.breakoutBaissier && raw.breakoutBaissier.confirme);
    if (raw.confirme && (up || down)) confirmedConditions.push(`Range confirmé, breakout ${up ? "haussier" : "baissier"}.`);
    else missingConditions.push("Aucun breakout directionnel unique confirmé actuellement.");
  } else if (id === "double_top_bottom") {
    if (raw.confirme && raw.pattern) confirmedConditions.push(`Pattern confirmé : ${raw.pattern}.`);
    else missingConditions.push("Aucun double top/bottom confirmé actuellement.");
  } else if (id === "rsi_divergence") {
    if (raw.confirme && raw.type) confirmedConditions.push(`Divergence confirmée : ${raw.type}.`);
    else missingConditions.push("Aucune divergence RSI confirmée actuellement.");
  } else if (id === "displacement") {
    if (raw.detecte) confirmedConditions.push(`Displacement détecté, direction ${raw.direction}.`);
    else missingConditions.push("Aucun displacement détecté actuellement.");
  } else if (id === "order_blocks") {
    if (raw.totalBlocsValides > 0) confirmedConditions.push(`${raw.totalBlocsValides} bloc(s) valide(s) (imbalance confirmée), direction ${raw.direction}, score ${raw.score}/5.`);
    else missingConditions.push(`Aucun Order Block valide actuellement (${raw.totalBlocsDetectes ?? 0} bloc(s) détecté(s) au total, dont 0 avec imbalance validée).`);
  }

  // Le détecteur a produit une conclusion déterministe dans tous les cas
  // ci-dessus (setup présent OU absence de setup clairement établie) : on ne
  // laisse jamais une valeur "indéterminée" se transformer en verdict.
  const status = "COMPLETE";

  return {
    ...base,
    status,
    confirmedConditions,
    missingConditions,
    notes: [
      ...base.notes,
      voteEntry.applicable
        ? "Setup exploitable identifié par le moteur (comptera dans le vote d'arbitrage)."
        : "Aucun setup exploitable actuellement — conclusion mécanique complète, pas une donnée manquante.",
    ],
  };
}

/**
 * Audite les stratégies structurellement exclues du vote d'arbitrage
 * (support_resistance, chart_patterns, candlestick_patterns) : le rapport
 * officiel ne contient aucune donnée les concernant par construction.
 */
function auditerStrategieExclue(id, raisonExclusion) {
  return {
    strategy: id,
    status: "NON_EVALUABLE_MECANIQUEMENT",
    principles: [],
    requiredConditions: [],
    confirmedConditions: [],
    missingConditions: [
      `Stratégie exclue du vote d'arbitrage par conception du moteur : ${raisonExclusion}`,
    ],
    confirmations: [],
    invalidations: [],
    timeframeRequirements: [],
    availableTimeframes: [],
    ...blocRisqueNonCalcule(),
    contradictions: [],
    sourceTraceability: ["EXISTING_ENGINE: tradingRulesEngine.js — report.strategiesExclusDuVote"],
    notes: [
      "Cette stratégie existe dans le moteur (fonctions detectSupportResistanceZones/detectChartPatterns/detectCandlestickPatterns) mais n'entre pas dans le décompte BUY/SELL — voir runArbitratedAnalysis().",
    ],
  };
}

/** Audite les stratégies 5 et 7 (observation/confirmation, bonus uniquement). */
function auditerStrategieBonus(id, label, observation, bonusAppliqueSi) {
  const base = {
    strategy: id,
    principles: [
      "Stratégie d'observation/confirmation : ne décide jamais seule d'un trade (commentaire explicite du moteur).",
      `Fonction : ${label}`,
    ],
    timeframeRequirements: ["Timeframe unique — nécessite plusieurs journées calendaires distinctes dans CE timeframe pour la stratégie 5 (PDH/PDL), ou au moins 10 bougies pour la stratégie 7 (structure Dow)."],
    availableTimeframes: [],
    ...blocRisqueNonCalcule(),
    contradictions: [],
    sourceTraceability: [`EXISTING_ENGINE: tradingRulesEngine.js — ${label}`],
    notes: ["Ne participe jamais au décompte principal — contribue uniquement un bonus informatif de +6 quand confirmée (voir report.bonus)."],
  };

  if (!observation) {
    return {
      ...base,
      status: "NON_EVALUABLE_MECANIQUEMENT",
      requiredConditions: [],
      confirmedConditions: [],
      missingConditions: ["Aucune observation trouvée dans report.observations pour cette stratégie."],
      confirmations: [],
      invalidations: [],
    };
  }

  const requiredConditions = bonusAppliqueSi;
  const confirmedConditions = [];
  const missingConditions = [];
  if (observation.confirme) {
    confirmedConditions.push(`Confirmée : ${observation.setupIdentifie}`);
  } else {
    missingConditions.push(`Non confirmée actuellement : ${observation.setupIdentifie}`);
  }

  return {
    ...base,
    status: "COMPLETE", // conclusion mécanique complète dans tous les cas (confirmée ou non)
    requiredConditions,
    confirmedConditions,
    missingConditions,
    confirmations: [`observation.confirme === true → bonus +6 appliqué au camp ${observation.direction ?? "N/A"}.`],
    invalidations: [],
  };
}

/** Audite "auto" : ce n'est pas une stratégie de marché indépendante (doc1 §13). */
function auditerAuto() {
  return {
    strategy: "auto",
    status: "NON_EVALUABLE_MECANIQUEMENT",
    principles: ["'auto' n'est pas une stratégie de marché indépendante — elle orchestre les stratégies existantes (voir runArbitratedAnalysis() / runFullAnalysis({strategie:'auto'}))."],
    requiredConditions: [],
    confirmedConditions: [],
    missingConditions: ["Non applicable : 'auto' ne possède pas de règle de marché propre à auditer."],
    confirmations: [],
    invalidations: [],
    timeframeRequirements: [],
    availableTimeframes: [],
    ...blocRisqueNonCalcule(),
    contradictions: [],
    sourceTraceability: ["EXISTING_ENGINE: tradingRulesEngine.js — MarketAnalyzer.STRATEGIES_DISPONIBLES"],
    notes: ["Conformément à la règle : ne pas inventer de règles de marché propres à 'auto'."],
  };
}

const STRATEGIES_VOTEES = Object.keys(CATALOGUE_MOTEUR);
const STRATEGIES_EXCLUES = {
  support_resistance: "zones non directionnelles — jamais transformées en vote BUY/SELL",
  chart_patterns: "patterns graphiques non inclus dans le vote — informatif uniquement",
  candlestick_patterns: "une bougie ne décide jamais seule (voir arbitrageAuditTechniquesSource.js)",
};

/**
 * Fonction principale : audite TOUTES les stratégies connues du moteur à
 * partir d'un rapport officiel (`runArbitratedAnalysis()`), sans jamais
 * modifier ce rapport ni son verdict.
 *
 * @param {object} rapportOfficiel
 * @returns {{ audits: object[], resume: object }}
 */
function auditerMoteur(rapportOfficiel) {
  const votesParId = new Map((rapportOfficiel?.votes || []).map((v) => [v.id, v]));
  const audits = [];

  for (const id of STRATEGIES_VOTEES) {
    audits.push(auditerStrategieVotee(id, votesParId.get(id) || null, rapportOfficiel));
  }

  for (const [id, raison] of Object.entries(STRATEGIES_EXCLUES)) {
    audits.push(auditerStrategieExclue(id, raison));
  }

  const obs = rapportOfficiel?.observations || {};
  audits.push(
    auditerStrategieBonus(
      "previous_day_liquidity",
      "detectPreviousDayLiquidityConfirmation()",
      obs.strategie_5_pdh_pdl,
      ["PDH ou PDL du jour précédent balayé (sweep) puis clôture revenue de l'autre côté du niveau."]
    )
  );
  audits.push(
    auditerStrategieBonus(
      "dow_structure",
      "detectDowStructureConfirmation()",
      obs.strategie_7_dow_structure,
      ["2 derniers swing highs et swing lows forment HH+HL (haussier) ou LH+LL (baissier)."]
    )
  );

  audits.push(auditerAuto());

  const resume = {
    total: audits.length,
    complete: audits.filter((a) => a.status === "COMPLETE").length,
    partial: audits.filter((a) => a.status === "PARTIAL").length,
    nonEvaluable: audits.filter((a) => a.status === "NON_EVALUABLE_MECANIQUEMENT").length,
    contradictory: audits.filter((a) => a.status === "CONTRADICTORY").length,
    note:
      "COMPLETE = la chaîne d'identification/confirmation/direction a été évaluée jusqu'au bout " +
      "(setup présent ou absence clairement établie) — PAS 'prêt à exécuter' (aucune stratégie " +
      "d'arbitrage ne calcule d'entrée/stop/take-profit). PARTIAL n'apparaît jamais dans le moteur " +
      "actuel : ses détecteurs sont déterministes (booléens complets), sans état intermédiaire codé.",
  };

  return { audits, resume };
}

/** Rendu texte simple pour inspection rapide. */
function formatAuditMoteur({ audits, resume }) {
  const lignes = [];
  lignes.push(`Audit moteur — ${resume.complete}/${resume.total} COMPLETE, ${resume.partial} PARTIAL, ${resume.nonEvaluable} NON_EVALUABLE_MECANIQUEMENT, ${resume.contradictory} CONTRADICTORY`);
  for (const a of audits) {
    lignes.push(`- ${a.strategy} : ${a.status}` + (a.missingConditions.length ? ` (manque : ${a.missingConditions.join(" / ")})` : ""));
  }
  return lignes.join("\n");
}

export { auditerMoteur, formatAuditMoteur, CATALOGUE_MOTEUR, STATUTS };
