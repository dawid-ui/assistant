/* ============================================================
   RELAIS — sert d'intermédiaire sécurisé entre ton app et Groq.
   Ta clé API vit ICI (en variable d'environnement), jamais dans
   le code du site.
   ============================================================ */

import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

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
          model: modele || "openai/gpt-oss-120b",
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

app.post("/api/tradingview-alert", (req, res) => {
  const {
    secret,
    ...alerte
  } = req.body || {};

  if (
    !process.env.TRADINGVIEW_WEBHOOK_SECRET ||
    secret !== process.env.TRADINGVIEW_WEBHOOK_SECRET
  ) {
    return res.status(401).json({
      ok: false,
      erreur: "Secret TradingView incorrect"
    });
  }

  console.log(
    "Alerte TradingView reçue :",
    alerte
  );

  return res.json({
    ok: true,
    message: "Alerte TradingView reçue"
  });
});

app.get("/", (req, res) => {
  res.send("Relais actif ✅");
});

const port = process.env.PORT || 10000;

app.listen(port, "0.0.0.0", () => {
  console.log(
    `Relais actif sur le port ${port}`
  );
});
