import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Resend } from "resend";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// =======================
// Middleware
// =======================
app.use(express.json());
app.use(express.static("public"));

// =======================
// Email (Resend)
// =======================
const resend = new Resend(process.env.RESEND_API_KEY);

// =======================
// CHAT ENDPOINT
// =======================
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages" });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages,
      }),
    });

    const data = await response.json();

    res.json({
      reply: data?.content?.[0]?.text || "No response",
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

// =======================
// VERIFICATION EMAIL
// =======================
app.post("/api/send-verification", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Missing email or code" });
    }

    const { error } = await resend.emails.send({
      from: "Quist AI <verify@resend.dev>",
      to: email,
      subject: "Your Quist AI Verification Code",
      html: `
        <h2>Verify Your Email</h2>
        <p>Your verification code is:</p>
        <h1>${code}</h1>
      `,
    });

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Email failed" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// =======================
// BUG REPORT (TXT FILE)
// =======================
app.post("/api/report-bug", (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const report = `
==============================
Time: ${new Date().toISOString()}
Title: ${title}

Description:
${description}
==============================

`;



    const filePath = path.join(process.cwd(), "bug-reports.txt");
console.log("BUG REPORT RECEIVED:\n", report);

    fs.appendFile(filePath, report, (err) => {
      if (err) {
        console.error("Bug report write failed:", err);
        return res.status(500).json({ error: "Write failed" });
      }

      res.json({ success: true });
    });
  } catch (err) {
    console.error("Bug report error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// START SERVER
// =======================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
