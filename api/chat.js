const rateLimitStore = new Map();

const PROVIDERS = [
  {
    name: "kilo-ultra",
    url: "https://api.kilo.ai/api/gateway/v1/chat/completions",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free"
  },
  {
    name: "ovh-oss",
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    model: "gpt-oss-120b"
  },
  {
    name: "ovh-mistral",
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    model: "Mistral-Small-3.2-24B-Instruct-2506"
  }
];

async function verifyFirebaseUser(idToken) {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    // Local dev fallback before Firebase keys are added
    return { uid: "local-dev", email: process.env.OWNER_EMAIL || "dev@local" };
  }
  if (!idToken || typeof idToken !== "string") return null;

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data?.users?.[0];
  if (!user?.localId) return null;
  return { uid: user.localId, email: user.email || "" };
}

function checkDailyLimit(uid, email) {
  const ownerEmail = (process.env.OWNER_EMAIL || "").toLowerCase().trim();
  if (ownerEmail && email.toLowerCase().trim() === ownerEmail) {
    return { allowed: true, remaining: "Unlimited", isOwner: true };
  }

  const today = new Date().toISOString().slice(0, 10);
  const key = `${uid}:${today}`;
  const limit = Number(process.env.DAILY_LIMIT || 20);
  const used = rateLimitStore.get(key) || 0;

  if (used >= limit) {
    return { allowed: false, remaining: 0, isOwner: false };
  }
  rateLimitStore.set(key, used + 1);
  return { allowed: true, remaining: limit - (used + 1), isOwner: false };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const user = await verifyFirebaseUser(idToken);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized. Please sign in with Google." });
    }

    const quota = checkDailyLimit(user.uid, user.email);
    if (!quota.allowed) {
      return res.status(429).json({
        error: "Aaj ki 20 messages ki free limit poori ho gayi hai. Kal phir try karein!"
      });
    }

    const { messages = [], memory = "" } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Message is required." });
    }

    const safeHistory = messages
      .slice(-12)
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

    const systemPrompt = `You are Codeon, a friendly, sharp, and encouraging AI coding partner.
Rules:
1. Focus ONLY on programming, web/app development, debugging, algorithms, UI/UX code, and tech architecture. If asked unrelated non-tech topics, politely steer back to coding.
2. Talk like a supportive coding friend—clear, practical, and easy to understand (match the user's language, including Hinglish/Hindi/English).
3. Always write clean, complete, production-ready code with proper markdown code blocks (\`\`\`html, \`\`\`js, etc.).
4. Use the user's saved memory and chat history naturally so your answers feel personalized and continuous.
${memory ? `\nUser Memory & Preferences:\n${String(memory).slice(0, 1500)}` : ""}`;

    const payloadMessages = [{ role: "system", content: systemPrompt }, ...safeHistory];

    for (const provider of PROVIDERS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);

        const aiRes = await fetch(provider.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: provider.model,
            messages: payloadMessages,
            temperature: 0.4,
            max_tokens: 4096
          }),
          signal: controller.signal
        });

        clearTimeout(timer);

        if (!aiRes.ok) continue;
        const data = await aiRes.json();
        const reply = data?.choices?.[0]?.message?.content;

        if (reply) {
          return res.status(200).json({
            reply,
            remaining: quota.remaining,
            isOwner: quota.isOwner
          });
        }
      } catch {
        // Try next provider automatically
      }
    }

    return res.status(502).json({ error: "AI engines abhi busy hain, 5 second baad dobara try karein." });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}
