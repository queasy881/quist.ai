import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Database from "better-sqlite3";
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
// SQLite (Bug Reports)
// =======================
const db = new Database("bug-reports.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS bug_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

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

    if (!Array.isArray(messages)) {
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
        <h2>Email Verification</h2>
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
// BUG REPORT (SQLite)
// =======================
app.post("/api/report-bug", (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const stmt = db.prepare(
      "INSERT INTO bug_reports (title, description) VALUES (?, ?)"
    );

    stmt.run(title, description);

    console.log("Bug report saved:", title);

    res.json({ success: true });
  } catch (err) {
    console.error("Bug report error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// (OPTIONAL) ADMIN VIEW
// =======================
app.get("/api/admin/bug-reports", (req, res) => {
  const reports = db
    .prepare("SELECT * FROM bug_reports ORDER BY created_at DESC")
    .all();

  res.json(reports);
});

// =======================
// START SERVER
// =======================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
