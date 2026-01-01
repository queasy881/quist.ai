import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { Resend } from "resend";
import bcrypt from "bcrypt";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

console.log("=== QUIST AI SERVER STARTING ===");
console.log("Environment:", process.env.NODE_ENV || "development");
console.log("Port:", PORT);
console.log("Railway detected:", !!process.env.RAILWAY_STATIC_URL);
console.log("Railway Public URL:", process.env.RAILWAY_PUBLIC_DOMAIN || "Not set");

// =======================
// Middleware
// =======================
app.use(express.json());

// =======================
// Railway/Cloudflare specific CORS
// =======================
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://your-domain.com", // REPLACE WITH YOUR ACTUAL DOMAIN
  process.env.RAILWAY_STATIC_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN
].filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow requests from any origin in development, specific in production
  if (process.env.NODE_ENV === "development" || !origin || allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  } else {
    console.log("Blocked origin:", origin);
  }
  
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Credentials", "true");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// =======================
// Trust Cloudflare proxy headers
// =======================
app.set("trust proxy", 1);

// =======================
// Request logging (Railway-friendly)
// =======================
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// =======================
// Routes
// =======================

// Health check endpoint (for Railway health checks)
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "healthy",
    service: "Quist AI",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    railway: {
      static_url: process.env.RAILWAY_STATIC_URL,
      public_domain: process.env.RAILWAY_PUBLIC_DOMAIN
    }
  });
});

// HTML routes
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/public/index.html");
});

app.get("/signin", (req, res) => {
  res.sendFile(process.cwd() + "/public/signin.html");
});

app.get("/signup", (req, res) => {
  res.sendFile(process.cwd() + "/public/signup.html");
});

// Static files (must come AFTER specific routes)
app.use(express.static("public"));

// =======================
// Database
// =======================
const db = new Database("app.db");

// Create tables if they don't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS bug_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

console.log("Database initialized");

// =======================
// Services
// =======================
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// =======================
// API Endpoints
// =======================

// CHAT ENDPOINT (Railway optimized)
app.post("/api/chat", async (req, res) => {
  try {
    console.log("Chat request received");
    
    const { messages, max_tokens = 4096, temperature = 0.7 } = req.body;
const model = "claude-3-5-sonnet-latest";




    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages must be an array" });
    }

    if (!process.env.CLAUDE_API_KEY) {
      console.error("CLAUDE_API_KEY missing");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.content || ""
    }));

    console.log(`Calling Claude API with ${formattedMessages.length} messages`);
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens,
        temperature,
        messages: formattedMessages,
        system: "You are Quist, an advanced AI assistant."
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Claude API error:", error);
      return res.status(response.status).json({ 
        error: error.error?.message || "Claude API error",
        type: error.error?.type
      });
    }

    const data = await response.json();
    const aiContent = data.content?.[0]?.text || "No response generated.";

    res.json({
      reply: aiContent,
      raw: data
    });

  } catch (err) {
    console.error("Chat endpoint error:", err);
    res.status(500).json({ 
      error: "Internal server error",
      message: err.message 
    });
  }
});

// Authentication endpoints
app.post("/api/signup", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be 8+ characters" });
    }

    const hash = await bcrypt.hash(password, 12);
    const stmt = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)");
    
    stmt.run(email.toLowerCase(), hash);
    res.json({ success: true });
    
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    res.json({ success: true });
    
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/send-verification", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Email and code required" });
    }

    if (!resend) {
      return res.status(500).json({ error: "Email service not configured" });
    }

    const { error } = await resend.emails.send({
      from: "Quist AI <verify@resend.dev>",
      to: email,
      subject: "Your Quist AI Verification Code",
      html: `<h2>Verification Code: ${code}</h2>`
    });

    if (error) {
      console.error("Email error:", error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.json({ success: true });
    
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/report-bug", (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: "Title and description required" });
    }

    db.prepare("INSERT INTO bug_reports (title, description) VALUES (?, ?)").run(title, description);
    res.json({ success: true });
    
  } catch (err) {
    console.error("Bug report error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/admin/bug-reports", (req, res) => {
  const reports = db.prepare("SELECT * FROM bug_reports ORDER BY created_at DESC").all();
  res.json(reports);
});

// =======================
// 404 Handler
// =======================
app.use((req, res) => {
  console.log(`404: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: "Not found",
    path: req.url,
    method: req.method
  });
});

// =======================
// Error Handler
// =======================
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ 
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined
  });
});

// =======================
// Start Server
// =======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`=== SERVER STARTED ===`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Health endpoint: /api/health`);
  console.log(`Chat endpoint: POST /api/chat`);
  console.log(`Ready for Railway deployment`);
});