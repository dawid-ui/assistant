/* ============================================================
   RELAIS — sert d'intermédiaire sécurisé entre ton app et OpenAI.
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

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: modele || "gpt-4o-mini",
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Relais actif sur le port ${port}`));
