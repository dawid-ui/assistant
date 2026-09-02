/* ============================================================
   CONFIG.JS — LA ZONE QUE TU PERSONNALISES
   ============================================================
   Tout ce dont tu as besoin pour brancher TON assistant IA est ici.
   Le reste du code (app.js, index.html, style.css) n'a normalement
   pas besoin d'être touché — il lit simplement cet objet CONFIG.

   Tu peux relancer ce fichier à volonté, autant de fois que tu veux.
   ============================================================ */

const CONFIG = {

  /* --------------------------------------------------------
     0. APPARENCE — couleurs, formes, polices
     --------------------------------------------------------
     Modifie ces valeurs pour changer complètement le look de
     l'app, sans toucher à style.css. Couleurs en hexadécimal.
  -------------------------------------------------------- */
  apparence: {
    couleurs: {
      fond: "#EEEEE6",           // arrière-plan général
      panneau: "#FFFFFF",        // fond des zones (en-tête, saisie...)
      texte: "#1E2622",          // couleur du texte principal
      texteAtténué: "#5B6660",   // couleur des textes secondaires (statut, indices)
      bordure: "#DBDBCF",        // lignes de séparation
      accentPrincipal: "#35594C",   // boutons, icônes, avatar
      accentPrincipalFonce: "#223D33", // bouton d'envoi, bulles utilisateur
      accentSecondaire: "#6E5A96",  // focus du champ de texte
      bulleBot: "#FFFFFF",
      bulleUtilisateur: "#223D33",
      texteBulleUtilisateur: "#F3F1E7"
    },
    formes: {
      rayonCoins: "14px"   // arrondi des bulles, boutons, panneaux (ex: "4px" = carré, "24px" = très arrondi)
    },
    polices: {
      titres: "'Fraunces', serif",
      texte: "'Inter', system-ui, sans-serif",
      statutEtCode: "'JetBrains Mono', monospace"
    }
  },

  /* --------------------------------------------------------
     1. IDENTITÉ DE TON ASSISTANT
     -------------------------------------------------------- */
  assistant: {
    nom: "Mon Assistant",
    avatarEmoji: "🤖",
    messageAccueil: "Salut ! Je suis ton assistant. Pose-moi une question, ou demande-moi une image 🎨",
    // Personnalité / instructions système envoyées au modèle à CHAQUE conversation.
    // Utilise des backticks (`) au lieu de guillemets pour écrire sur plusieurs lignes
    // sans limite pratique — écris ici tout ce que tu veux : ton, règles, connaissances,
    // ce qu'il doit faire ou éviter, exemples, etc.
    promptSysteme: `
Tu es un assistant utile, clair et amical. Réponds en français par défaut.

Ici tu peux ajouter, par exemple :
- des règles de ton (ex : "reste toujours concis", "utilise de l'humour léger")
- des connaissances propres à ton usage (ex : infos sur ton projet, ton entreprise)
- des instructions de comportement (ex : "pose une question si la demande est vague")
- des exemples de réponses que tu aimes

Ajoute autant de lignes que nécessaire — remplace tout ce texte par tes propres instructions.
    `.trim()
  },

  /* --------------------------------------------------------
     2. MOTEUR DE CHAT (texte)
     --------------------------------------------------------
     mode:
       "demo"      -> réponses simulées, fonctionne sans rien configurer,
                      utile pour tester l'interface tout de suite.
       "api"       -> appelle une vraie API compatible (OpenAI, Anthropic,
                      Mistral, un modèle open source auto-hébergé type
                      Ollama/LM Studio, etc.)

     ⚠️ Pour le mode "api" : la plupart des API (OpenAI, Anthropic...)
     bloquent les appels directs depuis un navigateur (CORS) et
     exigent que la clé secrète ne soit jamais exposée côté client.
     La bonne pratique : héberger un petit serveur relais (proxy)
     qui garde ta clé secrète et que ton app appelle à sa place.
     Le endpoint ci-dessous doit pointer vers CE relais, pas
     directement vers OpenAI/Anthropic.
  -------------------------------------------------------- */
  chat: {
    mode: "api", // ✅ actif — nécessite que ton relais (voir dossier relais-serveur/) soit déployé

    api: {
      // ⚠️ REMPLACE cette ligne par l'URL Render que tu obtiendras après déploiement,
      // ex : "https://mon-assistant-relais.onrender.com/api/chat"
      endpoint: "https://assistant-30ki.onrender.com/api/chat",
      modele: "openai/gpt-oss-120b", // modèle Groq utilisé par le relais (llama-3.3-70b-versatile a été retiré par Groq le 16/08/2026)
      // Aucune clé API ici ! Elle vit uniquement sur le serveur relais (variable d'environnement).
    }
  },

  /* --------------------------------------------------------
     3. GÉNÉRATION D'IMAGES
     --------------------------------------------------------
     Branché par défaut sur Pollinations.ai : un service gratuit,
     open source, et SANS clé API. Il suffit de construire une URL
     et de l'utiliser comme source d'image — donc ça marche
     immédiatement, sans backend, sans coût.
     Doc : https://pollinations.ai
  -------------------------------------------------------- */
  image: {
    mode: "pollinations", // "pollinations" (gratuit, prêt à l'emploi) ou "api" (ton propre service)

    pollinations: {
      construireUrl: (prompt) =>
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true`
    },

    api: {
      // Si un jour tu préfères Stable Diffusion, DALL·E, etc. via ton relais
      endpoint: "http://localhost:3000/api/image"
    }
  },

  /* --------------------------------------------------------
     4. EMOJIS
     --------------------------------------------------------
     Liste affichée dans le sélecteur rapide. Ajoute/retire ce
     que tu veux — aucune API requise, ce sont des emojis natifs.
  -------------------------------------------------------- */
  emojis: [
    "😀","😂","😍","🤔","😎","😢","😡","👍","👎","🙏",
    "🎉","🔥","💡","✅","❌","❤️","🚀","🎨","🖼️","🤖",
    "📌","⭐","👀","💬","🕒","📎","🧠","🛠️","📷","🎵"
  ],

  /* --------------------------------------------------------
     5. STOCKAGE
     --------------------------------------------------------
     "memoire"   -> les messages disparaissent si on ferme la page
                    (par défaut, aucune config requise)
     "storage"   -> persistant via window.storage (si tu déploies
                    dans un environnement qui le supporte)
  -------------------------------------------------------- */
  stockage: {
    mode: "memoire"
  }

};
