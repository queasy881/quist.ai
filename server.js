// server.js — FINAL (Railway + Claude + Email + Frontend)

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// ✅ MUST use process.env.PORT for Railway
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
app.use(express.json({ limit: "10mb" }));

// =======================
// SERVE FRONTEND
// =======================
app.use(express.static(path.join(__dirname, "public")));

// =======================
// CLAUDE CLIENT
// =======================
if (!process.env.CLAUDE_API_KEY) {
  console.error("❌ CLAUDE_API_KEY is missing");
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

// =======================
// EMAIL TRANSPORTER
// =======================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify(err => {
  if (err) {
    console.error("❌ Email error:", err);
  } else {
    console.log("✅ Email transporter ready");
  }
});

// =======================
// VERIFICATION STORAGE
// =======================
const verificationCodes = new Map();

// =======================
// SEND VERIFICATION CODE
// =======================
app.post("/api/send-verification", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    verificationCodes.set(email, {
      code,
      expires: Date.now() + 10 * 60 * 1000
    });

    await transporter.sendMail({
      from: `"Quist AI" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Verification Code",
      html: `
        <h2>Your verification code</h2>
        <h1>${code}</h1>
        <p>Expires in 10 minutes.</p>
      `
    });

    res.json({ success: true });

  } catch (err) {
    console.error(err);
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
      messages: claudeMessages
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
