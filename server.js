// server.js — FINAL VERSION (Claude + Email + Frontend + ngrok-safe)

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = 3000;

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

// ✅ SERVE FRONTEND
app.use(express.static(path.join(__dirname, "public")));

// =======================
// CLAUDE CLIENT (ENV VAR)
// =======================
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
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Verify email on startup
transporter.verify(err => {
  if (err) {
    console.error("❌ Email transporter error:", err);
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
      return res.status(400).json({
        success: false,
        error: "Invalid email address"
      });
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
        <div style="font-family: Arial; padding: 20px;">
          <h2>Email Verification</h2>
          <p>Your code is:</p>
          <h1 style="letter-spacing:5px;">${code}</h1>
          <p>Expires in 10 minutes.</p>
        </div>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Send verification error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to send verification code"
    });
  }
});

// =======================
// VERIFY CODE
// =======================
app.post("/api/verify-code", (req, res) => {
  const { email, code } = req.body;
  const stored = verificationCodes.get(email);

  if (!stored) {
    return res.status(400).json({
      success: false,
      error: "No verification code found"
    });
  }

  if (Date.now() > stored.expires) {
    verificationCodes.delete(email);
    return res.status(400).json({
      success: false,
      error: "Verification code expired"
    });
  }

  if (stored.code !== code) {
    return res.status(400).json({
      success: false,
      error: "Invalid verification code"
    });
  }

  verificationCodes.delete(email);
  res.json({ success: true });
});

// =======================
// CHAT ENDPOINT (CLAUDE FIXED)
// =======================
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, temperature = 0.7, max_tokens = 1024 } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array required" });
    }

    // ✅ Extract system message (Claude requires this)
    const systemMessage = messages.find(m => m.role === "system")?.content;

    // ✅ Claude only allows user / assistant roles
    const claudeMessages = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({
        role: m.role,
        content: m.content
      }));

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      system: systemMessage,
      temperature,
      max_tokens,
      messages: claudeMessages
    });

    // ✅ Claude-native response (matches frontend)
    res.json({
      content: response.content
    });

  } catch (err) {
    console.error("❌ Claude API error:", err);
    res.status(500).json({
      error: err.message
    });
  }
});

// =======================
// START SERVER
// =======================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
