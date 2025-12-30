// server.js — FINAL (Railway + Resend + Claude)

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { Resend } from "resend";
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { fileURLToPath } from "url";

console.log("SERVER VERSION: RESEND ACTIVE");

const app = express();

// =======================
// PORT (Railway)
// =======================
const PORT = process.env.PORT || 8080;

// =======================
// PATH FIX (ES MODULES)
// =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =======================
// MIDDLEWARE
// =======================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =======================
// ENV CHECKS
// =======================
if (!process.env.RESEND_API_KEY) {
  console.error("❌ RESEND_API_KEY missing");
  process.exit(1);
}

if (!process.env.CLAUDE_API_KEY) {
  console.error("❌ CLAUDE_API_KEY missing");
  process.exit(1);
}

// =======================
// CLIENTS
// =======================
const resend = new Resend(process.env.RESEND_API_KEY);

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// =======================
// VERIFICATION STORE
// =======================
const verificationCodes = new Map();

// =======================
// SEND VERIFICATION EMAIL
// =======================
app.post("/api/send-verification", async (req, res) => {
  try {
    const { email } = req.body;

    console.log("EMAIL RECEIVED:", email);

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    verificationCodes.set(email, {
      code,
      expires: Date.now() + 10 * 60 * 1000,
    });

    const { data, error } = await resend.emails.send({
      from: "Quist AI <onboarding@resend.dev>",
      to: email,
      subject: "Your verification code",
      html: `
        <h2>Email Verification</h2>
        <p>Your verification code is:</p>
        <h1>${code}</h1>
        <p>This code expires in 10 minutes.</p>
      `,
    });

    console.log("RESEND RESULT:", data, error);

    if (error) {
      return res.status(500).json({ error: "Email failed" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Email error:", err);
    res.status(500).json({ error: "Email failed" });
  }
});

// =======================
// VERIFY CODE
// =======================
app.post("/api/verify-code", (req, res) => {
  const { email, code } = req.body;

  const stored = verificationCodes.get(email);

  if (!stored) return res.status(400).json({ error: "No code found" });
  if (Date.now() > stored.expires) return res.status(400).json({ error: "Code expired" });
  if (stored.code !== code) return res.status(400).json({ error: "Invalid code" });

  verificationCodes.delete(email);
  res.json({ success: true });
});

// =======================
// CHAT (CLAUDE)
// =======================
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, temperature = 0.7, max_tokens = 1024 } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array required" });
    }

    const system = messages.find(m => m.role === "system")?.content;

    const claudeMessages = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role, content: m.content }));

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      system,
      temperature,
      max_tokens,
      messages: claudeMessages,
    });

    res.json({ content: response.content });
  } catch (err) {
    console.error("❌ Claude error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// START SERVER
// =======================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
