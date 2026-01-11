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
  "https://quist.world",
  "https://www.quist.world",
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
    password_hash TEXT,
    google_id TEXT UNIQUE,
    name TEXT,
    picture TEXT,
    auth_provider TEXT DEFAULT 'email',
    email_verified INTEGER DEFAULT 0,
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

// Add columns if they don't exist (for existing databases)
try {
  db.prepare("ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE").run();
} catch (e) { /* column already exists */ }

try {
  db.prepare("ALTER TABLE users ADD COLUMN name TEXT").run();
} catch (e) { /* column already exists */ }

try {
  db.prepare("ALTER TABLE users ADD COLUMN picture TEXT").run();
} catch (e) { /* column already exists */ }

try {
  db.prepare("ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'email'").run();
} catch (e) { /* column already exists */ }

try {
  db.prepare("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0").run();
} catch (e) { /* column already exists */ }

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
    const model = "claude-3-haiku-20240307";

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

// =======================
// GOOGLE AUTH ENDPOINT
// =======================
app.post("/api/auth/google", async (req, res) => {
  try {
    const { email, name, picture, googleId, credential, accessToken, isSignup } = req.body;

    console.log("Google auth request:", { email, name, googleId: googleId?.substring(0, 8) + "...", isSignup });

    if (!email || !googleId) {
      return res.status(400).json({ error: "Email and Google ID required" });
    }

    // Check if user exists by Google ID
    let user = db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId);

    if (user) {
      // Existing Google user - just log them in
      console.log("Existing Google user found:", email);
      
      // Update name/picture if changed
      db.prepare(`
        UPDATE users SET name = ?, picture = ? WHERE google_id = ?
      `).run(name || user.name, picture || user.picture, googleId);

      return res.json({
        success: true,
        user: {
          email: user.email,
          name: name || user.name,
          picture: picture || user.picture,
          authProvider: "google"
        },
        message: "Logged in successfully"
      });
    }

    // Check if email exists with different auth method
    const existingEmailUser = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());

    if (existingEmailUser) {
      // Email exists but with password auth - link the Google account
      console.log("Linking Google account to existing email user:", email);
      
      db.prepare(`
        UPDATE users 
        SET google_id = ?, name = COALESCE(?, name), picture = ?, auth_provider = 'google', email_verified = 1
        WHERE email = ?
      `).run(googleId, name, picture, email.toLowerCase());

      return res.json({
        success: true,
        user: {
          email: email,
          name: name || existingEmailUser.name,
          picture: picture,
          authProvider: "google"
        },
        message: "Google account linked successfully"
      });
    }

    // New user - create account (Google users are auto-verified, bypass email verification)
    console.log("Creating new Google user:", email);
    
    const stmt = db.prepare(`
      INSERT INTO users (email, google_id, name, picture, auth_provider, email_verified)
      VALUES (?, ?, ?, ?, 'google', 1)
    `);
    
    stmt.run(email.toLowerCase(), googleId, name || "", picture || "");

    res.json({
      success: true,
      user: {
        email: email,
        name: name || "",
        picture: picture || "",
        authProvider: "google"
      },
      message: "Account created successfully",
      isNewUser: true
    });

  } catch (err) {
    console.error("Google auth error:", err);
    
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(400).json({ error: "Account already exists" });
    }
    
    res.status(500).json({ error: "Server error during Google authentication" });
  }
});

// =======================
// Standard Authentication endpoints
// =======================
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
    const stmt = db.prepare("INSERT INTO users (email, password_hash, auth_provider) VALUES (?, ?, 'email')");
    
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

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Check if user signed up with Google only
    if (!user.password_hash && user.auth_provider === "google") {
      return res.status(400).json({ 
        error: "This account uses Google sign-in. Please use the 'Sign in with Google' button." 
      });
    }

    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    res.json({ 
      success: true,
      user: {
        email: user.email,
        name: user.name,
        authProvider: user.auth_provider
      }
    });
    
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// Email Verification
// =======================
const verificationCodes = new Map();

app.post("/api/send-verification", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    if (!resend) {
      return res.status(500).json({ error: "Email service not configured" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    verificationCodes.set(email, code);

    console.log("Verification code for", email, ":", code);

    const { error } = await resend.emails.send({
      from: "Quist AI <verify@resend.dev>",
      to: email,
      subject: "Your Quist Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="color: #0a0e27; font-size: 24px; margin-bottom: 20px;">Verify your email</h1>
          <p style="color: #666; font-size: 16px; margin-bottom: 30px;">
            Enter this code to complete your Quist AI registration:
          </p>
          <div style="background: #f5f5f5; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 30px;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0a0e27;">${code}</span>
          </div>
          <p style="color: #999; font-size: 14px;">
            This code expires in 10 minutes. If you didn't request this, you can ignore this email.
          </p>
        </div>
      `
    });

    if (error) {
      console.error("Email send error:", error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/verify-code", (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: "Email and code required" });
  }

  const storedCode = verificationCodes.get(email);

  if (!storedCode || storedCode !== code) {
    return res.status(400).json({ error: "Invalid verification code" });
  }

  // Mark user as verified
  db.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").run(email.toLowerCase());

  verificationCodes.delete(email);
  res.status(200).json({ success: true });
});

// =======================
// Bug Reports
// =======================
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
  console.log(`Google Auth endpoint: POST /api/auth/google`);
  console.log(`Ready for Railway deployment`);
});