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
    const { modele, promptSysteme, messages } = req.body;

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: modele || "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: promptSysteme || "Tu es un assistant utile." },
          ...(messages || []).map(m => ({ role: m.role, content: m.contenu }))
        ]
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ erreur: detail });
    }

    const data = await r.json();
    res.json({ reponse: data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

app.get("/", (req, res) => res.send("Relais actif ✅"));
app.post("/api/tradingview-alert", (req, res) => {
  const {
    secret,
    symbol,
    timeframe,
    close,
    volume,
    event,
    time
  } = req.body || {};

  if (!secret || secret !== process.env.TRADINGVIEW_WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!symbol  !timeframe  !close || !time) {
    return res.status(400).json({
      ok: false,
      error: "Missing required market data"
    });
  }

  const receivedAt = new Date();
  const signal = {
    status: "OBSERVE",
    reason: "Alerte reçue et enregistrée. Aucune opération n’est exécutée.",
    symbol,
    timeframe,
    close: Number(close),
    volume: volume ? Number(volume) : null,
    event: event || "unknown",
    marketTime: time,
    receivedAt: receivedAt.toISOString()
  };

  console.log("TradingView alert:", JSON.stringify(signal));

  return res.status(200).json({
    ok: true,
    signal
  });
});
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Relais actif sur le port ${port}`));
