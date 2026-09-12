/**
 * ==================================================================================
 * CATALOGUE DES TECHNIQUES SOURCE — MODULE INDÉPENDANT (ADDITION 2)
 * ==================================================================================
 *
 * DOSSIER TECHNIQUE = SOURCE DE VÉRITÉ (vidéos + photo IMG_5969.jpeg).
 *
 * Ce fichier reproduit fidèlement le dossier fourni. Il n'invente, ne
 * complète, ne corrige et n'optimise AUCUNE règle. Quand le dossier dit
 * NON_DÉFINI ou NON_EVALUABLE_MECANIQUEMENT, ce catalogue le reproduit tel
 * quel — aucune connaissance ICT/SMC personnelle n'a été ajoutée.
 *
 * Chaque entrée suit exactement le format demandé :
 * { id, nom, source, conditionsExplicites, confirmationsExplicites,
 *   invalidationsExplicites, timeframesExplicites, donneesNecessaires,
 *   resultatPossible, conditionsNonDefinies }
 *
 * Le champ `correspondanceMoteur` est une extension volontaire (hors format
 * imposé) qui n'ajoute AUCUNE règle de trading : elle indique seulement, à
 * titre de traçabilité, si tradingRulesEngine.js possède déjà un détecteur
 * relié au même concept — ce qui reste un fait vérifiable dans le code
 * (EXISTING_ENGINE), jamais une invention de règle.
 */

const CATALOGUE_TECHNIQUES_SOURCE = [
  {
    id: "candle_anatomy",
    nom: "Anatomie de la bougie (corps / mèches)",
    source: "SOURCE_OF_TRUTH — vidéo 'Comprendre TOUTES les BOUGIES en TRADING'",
    conditionsExplicites: [
      "Une bougie possède un corps et des mèches.",
      "Une bougie représente une unité de temps correspondant au timeframe utilisé (ex : 1D = une journée, donné comme exemple, pas comme règle universelle).",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: ["Dépend du timeframe utilisé — non imposé par la source."],
    donneesNecessaires: ["OHLC de la bougie."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["Aucun seuil numérique de longueur de mèche fourni par la source."],
  },
  {
    id: "candle_types",
    nom: "Catégories de bougies (continuation / retournement / indécision)",
    source: "SOURCE_OF_TRUTH — vidéo 'Comprendre TOUTES les BOUGIES en TRADING'",
    conditionsExplicites: [
      "La source distingue 3 catégories : continuation, retournement, indécision.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Bougie(s) à classer."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["Critère mécanique précis de classement non fourni."],
  },
  {
    id: "hammer",
    nom: "Bougie Marteau",
    source: "SOURCE_OF_TRUTH — vidéo 'Comprendre TOUTES les BOUGIES en TRADING'",
    conditionsExplicites: [
      "Corps avec une mèche importante, montré dans un contexte de réaction du marché.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Corps et mèches de la bougie."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: [
      "ratio corps/mèche",
      "pourcentage",
      "emplacement obligatoire",
      "nombre de bougies précédentes",
      "confirmation supplémentaire",
    ],
  },
  {
    id: "doji",
    nom: "Doji",
    source: "SOURCE_OF_TRUTH — vidéo 'Comprendre TOUTES les BOUGIES en TRADING'",
    conditionsExplicites: [
      "Corps très faible par rapport à l'évolution du prix, montré dans le contexte de l'indécision.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Corps et amplitude de la bougie."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["Aucun seuil numérique définissant un doji."],
  },
  {
    id: "continuation_sequence",
    nom: "Séquence de bougies de continuation",
    source: "SOURCE_OF_TRUTH — vidéo 'Comprendre TOUTES les BOUGIES en TRADING'",
    conditionsExplicites: [
      "Une séquence de plusieurs bougies haussières successives est montrée comme pouvant indiquer une continuation de tendance haussière (idem pour une séquence baissière).",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Séquence de bougies consécutives."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["Nombre exact de bougies requis non établi comme règle générale par la source."],
  },
  {
    id: "candle_confirms_zone",
    nom: "Une bougie confirme une zone, ne la remplace pas",
    source: "SOURCE_OF_TRUTH — vidéo 'Comprendre TOUTES les BOUGIES en TRADING'",
    conditionsExplicites: [
      "Une bougie ne se trade jamais seule ; elle confirme une zone, elle ne la remplace pas.",
      "Une configuration de bougie peut servir de confirmation d'entrée uniquement si les conditions source de la zone sont par ailleurs disponibles.",
    ],
    confirmationsExplicites: ["Bougie identifiée + conditions source de la zone disponibles = confirmation possible."],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Définition mécanique de la zone concernée (non fournie de façon générique par la source)."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["Définition mécanique générique d'une 'zone' non fournie."],
    correspondanceMoteur:
      "Cohérent avec tradingRulesEngine.js : les patterns de bougies (detectCandlestickPatterns) sont explicitement exclus du vote d'arbitrage — voir report.strategiesExclusDuVote.candlestick_patterns dans runArbitratedAnalysis().",
  },
  {
    id: "daily_profiles_liquidity",
    nom: "Profils journaliers (#1/#2/#3) & liquidité Asia/Londres/NY",
    source: "SOURCE_OF_TRUTH — vidéo 'Profils diarios'",
    conditionsExplicites: [
      "Structure journalière comprenant Asia, Londres, New York, alto asia, bajo asia.",
      "Une prise de liquidité est montrée autour de 'bajo asia' suivie d'un mouvement opposé ; une autre séquence montre une prise autour du haut suivie d'une extension baissière.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Découpage des sessions Asia / Londres / New York."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: [
      "Algorithme complet des 3 profils journaliers non établi par la source.",
      "Seuils ou règles supplémentaires non fournis.",
    ],
    correspondanceMoteur:
      "Concept proche (mais distinct) de detectPreviousDayLiquidityConfirmation (stratégie 5, PDH/PDL) et detectLiquiditySweep dans tradingRulesEngine.js : ceux-ci utilisent le plus haut/bas du jour calendaire précédent, pas les sessions Asia/Londres/NY décrites ici — à ne pas confondre.",
  },
  {
    id: "daily_1d_15m_50pct",
    nom: "Structure 1D + zone 15 MIN + niveau 50%",
    source: "SOURCE_OF_TRUTH — vidéo 'Profil journalier + 15 minutes'",
    conditionsExplicites: [
      "Bougie journalière (1D) avec haut, bas et niveau 50%.",
      "Une zone 15 MIN est montrée à l'intérieur/autour de la structure journalière.",
      "Séquences montrées : attaque du haut puis évolution baissière vers le bas ; attaque du bas puis réaction haussière.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: ["1D", "15 MIN"],
    donneesNecessaires: ["Haut/bas de la bougie journalière.", "Données 15 MIN correspondantes."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["Relation mécanique exacte et complète entre 1D / 15 MIN / 50% / haut / bas non déterminable à partir des seuls éléments visuels fournis."],
  },
  {
    id: "range_8am",
    nom: "8am Range (8am high / 8am low)",
    source: "SOURCE_OF_TRUTH — vidéo '8am range'",
    conditionsExplicites: [
      "Zone définie par 8am high et 8am low.",
      "Comportement du prix montré autour de cette zone : définition du high/low, évolution ultérieure, prise/attaque d'une extrémité, mouvement ultérieur, utilisation d'une zone d'entrée.",
      "Une référence temporelle de 15 MIN apparaît dans la séquence.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: ["15 MIN (référencé dans la séquence)."],
    donneesNecessaires: ["Heure de définition du 8am high/low (non précisée — voir conditionsNonDefinies)."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: [
      "heure de clôture exacte",
      "timezone",
      "nombre exact de bougies",
      "seuil de sweep",
      "ratio",
      "distance d'entrée",
      "stop",
      "take profit",
    ],
  },
  {
    id: "ifvg",
    nom: "IFVG (Inversion Fair Value Gap)",
    source: "SOURCE_OF_TRUTH — vidéo 'IFVG'",
    conditionsExplicites: [
      "Concept IFVG identifié visuellement avec une structure de prix et une zone associée.",
      "Utilisé dans une séquence de trading avec une entrée et un stop visibles, sans paramètres exacts fournis.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Structure de prix + zone associée à l'IFVG (non définies mécaniquement)."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["Règle complète d'entrée", "règle complète d'invalidation", "règle complète de sortie"],
    correspondanceMoteur:
      "Non implémenté dans tradingRulesEngine.js : seul un Fair Value Gap classique (non inversé) existe, via detectFairValueGaps().",
  },
  {
    id: "range_structure",
    nom: "Range / Structure de prix",
    source: "SOURCE_OF_TRUTH — vidéo 'Range / structure'",
    conditionsExplicites: [
      "Structure de prix en range montrée avec des références high/range et l'évolution du prix autour de cette zone.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Niveaux haut/bas du range concerné (non précisément définis)."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["Algorithme opérationnel complet non établi par la source."],
  },
  {
    id: "htf_ltf_contextualisation",
    nom: "HTF / LTF — Key Level (HTF) et précision d'entrée (LTF)",
    source: "SOURCE_OF_TRUTH — fourni directement par l'utilisateur (compétence HTF/LTF)",
    conditionsExplicites: [
      "HTF = Key Level : le HTF détermine le niveau / contexte clé.",
      "LTF = Entry : le LTF recherche la précision d'entrée autour de ce contexte.",
      "Correspondances montrées : D → H1, H4 → M15, H1 → M5, M15 → M1.",
      "Règle : le HTF fournit le Key Level/contexte, le LTF fournit la précision d'entrée — ne pas mélanger les rôles.",
      "TYPE (déclaré par la source) : compétence de contextualisation et de précision d'entrée — ce n'est PAS une stratégie indépendante.",
    ],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: ["D → H1", "H4 → M15", "H1 → M5", "M15 → M1"],
    donneesNecessaires: [
      "OHLC HTF",
      "OHLC LTF correspondant",
      "Relation entre les deux timeframes",
      "Niveau clé HTF",
    ],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: [
      "pourcentage",
      "nombre de bougies",
      "heures",
      "sweep",
      "BOS/CHOCH",
      "condition d'entrée",
      "SL",
      "TP",
      "toute autre règle non explicitement définie par la source",
    ],
    correspondanceMoteur:
      "Distinct de la cohérence multi-timeframe déjà calculée par arbitrageBot.js (validateArbitrage) : celle-ci compare des verdicts BUY/SELL entre timeframes de façon symétrique (accord/contradiction/neutre), alors que cette compétence assigne un RÔLE différent à chaque timeframe (HTF = contexte/niveau clé, LTF = précision d'entrée). Ce rôle n'est implémenté ni dans tradingRulesEngine.js (une instance MarketAnalyzer = un seul timeframe, sans lien HTF/LTF interne) ni dans arbitrageBot.js actuel — aucune correspondance de code existante à ce jour. Conformément à son propre TYPE, cette compétence n'est pas ajoutée à arbitrageAuditMoteur.js (elle n'y aurait aucune stratégie de vote à auditer).",
  },
  {
    id: "falling_wedge",
    nom: "Falling Wedge (I et II — photo)",
    source: "SOURCE_OF_TRUTH — photo IMG_5969.jpeg",
    conditionsExplicites: ["Représentation graphique montrée dans la photo (deux occurrences : Falling Wedge I et II)."],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Géométrie du wedge (lignes hautes/basses convergentes)."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["La photo montre le dessin, pas les conditions mécaniques complètes de détection/direction."],
    correspondanceMoteur:
      "Implémenté géométriquement dans tradingRulesEngine.js via detectWedges() ('Falling Wedge'), mais la direction y est explicitement 'à confirmer' (non déterminée tant que la sortie du wedge n'est pas confirmée) — cohérent avec le NON_EVALUABLE de la source.",
  },
  {
    id: "bullish_rectangle",
    nom: "Bullish Rectangle (photo)",
    source: "SOURCE_OF_TRUTH — photo IMG_5969.jpeg",
    conditionsExplicites: ["Représentation graphique montrée dans la photo."],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Géométrie du rectangle (bornes haute/basse horizontales)."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["La photo montre le dessin, pas les conditions mécaniques complètes de détection/direction (notamment le biais 'bullish')."],
    correspondanceMoteur:
      "Un pattern générique 'Rectangle' existe via detectRectangle() dans tradingRulesEngine.js, mais sans distinction haussière/baissière explicite dans le code actuel.",
  },
  {
    id: "bullish_pennant",
    nom: "Bullish Pennant (photo)",
    source: "SOURCE_OF_TRUTH — photo IMG_5969.jpeg",
    conditionsExplicites: ["Représentation graphique montrée dans la photo."],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Géométrie du pennant."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["La photo montre le dessin, pas les conditions mécaniques complètes de détection/direction."],
    correspondanceMoteur:
      "Explicitement listé comme 'planned' (non implémenté) dans CHART_PATTERN_LIBRARY de tradingRulesEngine.js — aucun détecteur mathématique n'existe actuellement pour ce pattern, dans le moteur comme dans la source.",
  },
  {
    id: "double_bottom",
    nom: "Double Bottom (photo)",
    source: "SOURCE_OF_TRUTH — photo IMG_5969.jpeg",
    conditionsExplicites: ["Représentation graphique montrée dans la photo."],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Deux creux comparables séparés par un rebond intermédiaire."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["La photo montre le dessin ; elle ne fournit pas de conditions mécaniques supplémentaires au-delà de ce que le moteur code déjà séparément."],
    correspondanceMoteur:
      "Implémenté indépendamment dans tradingRulesEngine.js via detectDoubleBottom()/detectDoubleTopBottom() (id de vote : double_top_bottom) — cette implémentation est une règle EXISTING_ENGINE, pas dérivée de la présente photo.",
  },
  {
    id: "inverse_head_shoulders",
    nom: "Inverse Head & Shoulders (photo)",
    source: "SOURCE_OF_TRUTH — photo IMG_5969.jpeg",
    conditionsExplicites: ["Représentation graphique montrée dans la photo."],
    confirmationsExplicites: [],
    invalidationsExplicites: [],
    timeframesExplicites: [],
    donneesNecessaires: ["Trois creux avec le creux central plus bas que les deux épaules, épaules comparables."],
    resultatPossible: "NON_EVALUABLE",
    conditionsNonDefinies: ["La photo montre le dessin ; elle ne fournit pas de conditions mécaniques supplémentaires au-delà de ce que le moteur code déjà séparément."],
    correspondanceMoteur:
      "Implémenté indépendamment dans tradingRulesEngine.js via detectInverseHeadAndShoulders() — mais n'entre pas dans le vote d'arbitrage (voir report.strategiesExclusDuVote.chart_patterns).",
  },
];

/**
 * Traduit le catalogue vers le format de traçabilité imposé par le dossier
 * ("TRAÇABILITÉ OBLIGATOIRE") : { strategie, source, timeframe, statut,
 * conditionsRemplies, conditionsManquantes, invalidations, raison }.
 *
 * `conditionsRemplies` est TOUJOURS vide ici : ce catalogue est une
 * référence statique du dossier, pas une évaluation en direct sur des
 * bougies. Une évaluation en direct nécessiterait un détecteur mécanique
 * complet, que la source elle-même déclare non fourni pour ces techniques.
 */
function auditerTechniquesSource() {
  return CATALOGUE_TECHNIQUES_SOURCE.map((t) => ({
    strategie: t.id,
    source: t.source,
    timeframe: t.timeframesExplicites.length ? t.timeframesExplicites.join(", ") : "NON_DÉFINI",
    statut: t.resultatPossible === "NON_EVALUABLE" ? "NON_EVALUABLE_MECANIQUEMENT" : t.resultatPossible,
    conditionsRemplies: [],
    conditionsManquantes: t.conditionsNonDefinies,
    invalidations: t.invalidationsExplicites,
    raison: `Conditions établies par la source : ${t.conditionsExplicites.join(" ")}`,
  }));
}

function formatTechniquesSource() {
  const lignes = ["Catalogue des techniques source (dossier vidéo/photo) — toutes en NON_EVALUABLE_MECANIQUEMENT sauf mention contraire :"];
  for (const t of CATALOGUE_TECHNIQUES_SOURCE) {
    lignes.push(`- ${t.id} (${t.nom}) : ${t.resultatPossible}` + (t.correspondanceMoteur ? ` — ${t.correspondanceMoteur}` : ""));
  }
  return lignes.join("\n");
}

export { CATALOGUE_TECHNIQUES_SOURCE, auditerTechniquesSource, formatTechniquesSource };
