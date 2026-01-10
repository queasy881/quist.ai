// Enhanced Chat Application - Complete Rewrite with Email Verification
const VERIFICATION_URL = "/api";
const BACKEND_URL = "/api/chat";
const VOICE_TRANSCRIPTION_URL = "/api/transcribe";

/* =======================
   DOM ELEMENTS
======================= */
const elements = {
  chat: document.getElementById("chat"),
  input: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
  typing: document.getElementById("typing"),
  chatList: document.getElementById("chatList"),
  welcomeScreen: document.getElementById("welcomeScreen"),
  settingsPanel: document.getElementById("settings"),
  settingsBtn: document.getElementById("settingsBtn"),
  closeSettings: document.getElementById("closeSettings"),
  artifactPanel: document.getElementById("artifactPanel"),
  artifactContent: document.getElementById("artifactContent"),
  closeArtifact: document.getElementById("closeArtifact"),
  copyArtifact: document.getElementById("copyArtifact"),
  downloadArtifact: document.getElementById("downloadArtifact"),
  runArtifact: document.getElementById("runArtifact"),
  totalChats: document.getElementById("totalChats"),
  totalMessages: document.getElementById("totalMessages"),
  verificationModal: document.getElementById("verificationModal"),
  emailStep: document.getElementById("emailStep"),
  codeStep: document.getElementById("codeStep"),
  usernameStep: document.getElementById("usernameStep"),
  verificationEmail: document.getElementById("verificationEmail"),
  verificationCode: document.getElementById("verificationCode"),
  usernameInput: document.getElementById("usernameInput"),
  sendCodeBtn: document.getElementById("sendCodeBtn"),
  verifyCodeBtn: document.getElementById("verifyCodeBtn"),
  resendCodeBtn: document.getElementById("resendCodeBtn"),
  changeEmailBtn: document.getElementById("changeEmailBtn"),
  completeSetupBtn: document.getElementById("completeSetupBtn"),
  displayEmail: document.getElementById("displayEmail"),
  verificationError: document.getElementById("verificationError"),
  verificationSuccess: document.getElementById("verificationSuccess"),
  displayUsername: document.getElementById("displayUsername"),
  displayUserEmail: document.getElementById("displayUserEmail"),
  logoutBtn: document.getElementById("logoutBtn"),
  thinkingModal: document.getElementById("thinkingModal"),
  researchModal: document.getElementById("researchModal"),
  cancelResearch: document.getElementById("cancelResearch"),
  quickResponses: document.getElementById("quickResponses"),
  welcomeInput: document.getElementById("welcomeInput"),
  welcomeVoiceBtn: document.getElementById("welcomeVoiceBtn"),
  welcomeSendBtn: document.getElementById("welcomeSendBtn"),
  filePreviewArea: document.getElementById("filePreviewArea"),
  filePreviews: document.getElementById("filePreviews"),
  clearAllFiles: document.getElementById("clearAllFiles"),
  modelSelect: document.getElementById("modelSelect"),
  temperature: document.getElementById("temperature"),
  temperatureValue: document.getElementById("temperatureValue"),
  maxTokens: document.getElementById("maxTokens"),
  maxTokensValue: document.getElementById("maxTokensValue"),
  accentColor: document.getElementById("accentColor"),
  backgroundSelect: document.getElementById("backgroundSelect"),
  fontSize: document.getElementById("fontSize"),
  deepThinkingToggle: document.getElementById("deepThinkingToggle"),
  researchInternetToggle: document.getElementById("researchInternetToggle"),
  typingIndicatorToggle: document.getElementById("typingIndicatorToggle"),
  autoOpenArtifactsToggle: document.getElementById("autoOpenArtifactsToggle"),
  soundToggle: document.getElementById("soundToggle"),
  soundVolume: document.getElementById("soundVolume"),
  soundVolumeValue: document.getElementById("soundVolumeValue"),
  soundMessageSentToggle: document.getElementById("soundMessageSentToggle"),
  soundMessageReceivedToggle: document.getElementById("soundMessageReceivedToggle"),
  soundSuccessToggle: document.getElementById("soundSuccessToggle"),
  exportChat: document.getElementById("exportChat"),
  backupChats: document.getElementById("backupChats"),
  exportSettings: document.getElementById("exportSettings"),
  resetSettings: document.getElementById("resetSettings"),
  clearCache: document.getElementById("clearCache"),
  storageUsage: document.getElementById("storageUsage"),
  localStorageUsage: document.getElementById("localStorageUsage"),
  fileUploadBtn: document.getElementById("fileUploadBtn"),
  voiceInputBtn: document.getElementById("voiceInputBtn")
};

/* =======================
   SOUND SYSTEM
======================= */
const soundEffects = {
  messageSent: createSound(523, 0.1, 0.1),
  messageReceived: createSound(659, 0.15, 0.2),
  success: createSound(1046, 0.2, 0.3),
  error: createSound(220, 0.3, 0.4),
  typing: createSound(880, 0.05, 0.1),
  thinking: createSound(329, 0.1, 0.5),
  research: createSound(783, 0.1, 0.2)
};

function createSound(frequency, duration, volume = 0.5) {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
    
    return { audioContext, oscillator, gainNode };
  } catch (error) {
    console.warn("Web Audio API not supported:", error);
    return null;
  }
}

function playSound(soundName) {
  if (!state.settings || !state.settings.soundEnabled) return;

  const toggleKey = `sound${soundName.charAt(0).toUpperCase() + soundName.slice(1)}Toggle`;
  const soundToggle = elements[toggleKey];

  if (soundToggle && soundToggle.checked === false) return;

  const sound = soundEffects[soundName];
  if (!sound) return;

  try {
    const volume = (state.settings.soundVolume || 70) / 100;
    soundEffects[soundName] = createSound(
      getFrequencyForSound(soundName),
      getDurationForSound(soundName),
      volume
    );
  } catch {}
}

function getFrequencyForSound(soundName) {
  switch(soundName) {
    case 'messageSent': return 523;
    case 'messageReceived': return 659;
    case 'success': return 1046;
    case 'error': return 220;
    case 'typing': return 880;
    case 'thinking': return 329;
    case 'research': return 783;
    default: return 440;
  }
}

function getDurationForSound(soundName) {
  switch(soundName) {
    case 'messageSent': return 0.1;
    case 'messageReceived': return 0.2;
    case 'success': return 0.3;
    case 'error': return 0.4;
    case 'typing': return 0.1;
    case 'thinking': return 0.5;
    case 'research': return 0.2;
    default: return 0.2;
  }
}

/* =======================
   STATE
======================= */
let state = {
  currentArtifact: null,
  isGenerating: false,
  chats: JSON.parse(localStorage.getItem("chats")) || {},
  currentChat: null,
  pendingFiles: [],
  userEmail: localStorage.getItem("userEmail") || localStorage.getItem("verifiedEmail"),
  username: localStorage.getItem("username") || null,
  isVerified: false,
  isResearching: false,
  isThinking: false,
  settings: {
    model: "claude-3-sonnet-20240229",
    maxTokens: 4096,
    temperature: 0.7,
    typingIndicator: true,
    soundEnabled: true,
    soundVolume: 70,
    deepThinkingMode: false,
    researchInternet: false,
    autoOpenArtifacts: true,
    accentColor: "#00d4ff",
    backgroundTheme: "default",
    fontSize: "medium"
  }
};

// Load saved settings
const savedSettings = JSON.parse(localStorage.getItem("settings"));
if (savedSettings) {
  state.settings = { ...state.settings, ...savedSettings };
}

// Initialize current chat
state.currentChat = Object.keys(state.chats)[0] || createChat();

/* =======================
   MINIMAL FORMATTING
======================= */
function minimalFormatting(text) {
  if (!text || typeof text !== "string") {
    return text;
  }

  if (
    text.includes("\n") ||
    text.includes("•") ||
    text.match(/^\s*[-*]\s+/m)
  ) {
    return text;
  }

  if (text.length < 200) {
    return text.trim();
  }

  let cleaned = text
    .replace(/\s{3,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

/* =======================
   DEDICATED CODE RENDER FUNCTION
======================= */
function renderCode(rawCode) {
  const container = elements.artifactContent;
  container.innerHTML = "";

  const pre = document.createElement("pre");
  const code = document.createElement("code");

  code.textContent = rawCode;
  pre.appendChild(code);
  container.appendChild(pre);
}

/* =======================
   MODAL FUNCTIONS
======================= */
function showThinkingModal() {
  if (!state.settings.deepThinkingMode) return false;
  
  playSound('thinking');
  elements.thinkingModal.classList.remove('hidden');
  state.isThinking = true;
  
  const progressFill = document.querySelector('.thinking-progress-fill');
  const stages = document.querySelectorAll('.thinking-stage');
  
  let stageIndex = 0;
  const interval = setInterval(() => {
    if (!state.isThinking) {
      clearInterval(interval);
      return;
    }
    
    stages.forEach((stage, index) => {
      stage.classList.toggle('active', index === stageIndex);
    });
    
    const progress = ((stageIndex + 1) / stages.length) * 100;
    progressFill.style.width = `${progress}%`;
    
    stageIndex = (stageIndex + 1) % stages.length;
  }, 1500);
  
  return true;
}

function hideThinkingModal() {
  elements.thinkingModal.classList.add('hidden');
  state.isThinking = false;
}

function showResearchModal() {
  if (!state.settings.researchInternet) return false;
  
  playSound('research');
  elements.researchModal.classList.remove('hidden');
  state.isResearching = true;
  
  const progressFill = document.querySelector('.research-progress-fill');
  const sourcesCount = document.getElementById('sourcesCount');
  const dataAnalyzed = document.getElementById('dataAnalyzed');
  const logEntries = document.querySelectorAll('.log-entry');
  
  let progress = 0;
  let sources = 0;
  
  const researchInterval = setInterval(() => {
    if (!state.isResearching) {
      clearInterval(researchInterval);
      return;
    }
    
    if (progress < 30 && Math.random() > 0.7) {
      sources += Math.floor(Math.random() * 3) + 1;
      sourcesCount.textContent = sources;
    }
    
    progress += Math.random() * 10;
    if (progress > 100) progress = 100;
    
    progressFill.style.width = `${progress}%`;
    dataAnalyzed.textContent = `${Math.min(progress, 100).toFixed(0)}%`;
    
    logEntries.forEach((entry, index) => {
      if (progress > (index + 1) * 25 - 10) {
        entry.style.opacity = '1';
        entry.style.transform = 'translateX(0)';
      }
    });
    
    if (progress >= 100) {
      clearInterval(researchInterval);
    }
  }, 300);
  
  return true;
}

function hideResearchModal() {
  elements.researchModal.classList.add('hidden');
  state.isResearching = false;
}

function cancelResearch() {
  hideResearchModal();
  showNotification("Research cancelled");
}

/* =======================
   EMAIL VERIFICATION
======================= */
function checkVerification() {
  if (!elements.verificationModal) {
    updateUserDisplay();
    return;
  }

  if (state.isVerified || state.userEmail) {
    elements.verificationModal.classList.add("hidden");
    updateUserDisplay();
  } else {
    elements.verificationModal.classList.remove("hidden");
  }
}

function updateUserDisplay() {
  if (elements.displayUsername && state.username) {
    elements.displayUsername.textContent = state.username;
  }
  if (elements.displayUserEmail && state.userEmail) {
    elements.displayUserEmail.textContent = state.userEmail;
  }
}

async function sendVerificationCode() {
  const email = document.getElementById("verificationEmail")?.value.trim();

  if (!email) {
    showVerificationError("Please enter an email address");
    return;
  }

  try {
    const res = await fetch("/api/send-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    const data = await res.json();

    if (data.success) {
      showVerificationSuccess("Verification code sent");
      state.userEmail = email;
      elements.emailStep.classList.add("hidden");
      elements.codeStep.classList.remove("hidden");
      elements.displayEmail.textContent = email;
    } else {
      showVerificationError("Failed to send verification code");
    }
  } catch (err) {
    console.error(err);
    showVerificationError("Network error. Please try again.");
  }
}

async function verifyCode() {
  const input = document.getElementById("verificationCode")?.value.trim();

  if (!input) {
    showVerificationError("Please enter the verification code");
    return;
  }

  try {
    const res = await fetch("/api/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: state.userEmail, code: input })
    });

    const data = await res.json();

    if (data.success) {
      state.isVerified = true;
      localStorage.setItem("verified", "true");
      localStorage.setItem("verifiedEmail", state.userEmail);

      showVerificationSuccess("Email verified successfully");

      setTimeout(() => {
        elements.verificationModal.classList.add("hidden");
        updateUserDisplay();
        showNotification("Email verified!");
        playSound("success");
      }, 800);
    } else {
      showVerificationError("Invalid verification code");
    }
  } catch (err) {
    showVerificationError("Network error. Please try again.");
  }
}

function completeSetup() {
  const username = elements.usernameInput.value.trim();
  
  if (!username || username.length < 3) {
    showVerificationError("Username must be at least 3 characters");
    return;
  }
  
  state.username = username;
  localStorage.setItem("username", username);
  state.isVerified = true;
  
  showVerificationSuccess("Setup complete! Welcome, " + username);
  
  setTimeout(() => {
    elements.verificationModal.classList.add("hidden");
    updateUserDisplay();
    showNotification("Welcome, " + username + "! You're all set.");
    playSound('success');
  }, 1500);
}

function resendCode() {
  elements.codeStep.classList.add("hidden");
  elements.emailStep.classList.remove("hidden");
  elements.verificationCode.value = "";
  showVerificationSuccess("You can request a new code");
}

function changeEmail() {
  elements.codeStep.classList.add("hidden");
  elements.emailStep.classList.remove("hidden");
  elements.verificationEmail.value = "";
  elements.verificationCode.value = "";
  state.userEmail = null;
}

function logout() {
  if (confirm("Are you sure you want to logout? You'll need to verify your email again.")) {
    localStorage.removeItem("verifiedEmail");
    localStorage.removeItem("username");
    localStorage.removeItem("loggedIn");
    state.userEmail = null;
    state.username = null;
    state.isVerified = false;
    
    window.location.href = "/signin";
  }
}

function showVerificationError(message) {
  elements.verificationError.textContent = message;
  elements.verificationError.classList.remove("hidden");
  elements.verificationSuccess.classList.add("hidden");
  playSound('error');
  setTimeout(() => {
    elements.verificationError.classList.add("hidden");
  }, 5000);
}

function showVerificationSuccess(message) {
  elements.verificationSuccess.textContent = message;
  elements.verificationSuccess.classList.remove("hidden");
  elements.verificationError.classList.add("hidden");
  playSound('success');
}

/* =======================
   BACKGROUND THEMES
======================= */
const backgroundThemes = {
  "default": "linear-gradient(135deg, #0a0e27 0%, #1a0b2e 50%, #16213e 100%)",
  "quist-blue": "linear-gradient(135deg, #0066ff 0%, #00d4ff 50%, #0a2540 100%)",
  "cosmic-purple": "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #1a1a2e 100%)",
  "cyberpunk": "linear-gradient(135deg, #ff006e 0%, #8338ec 25%, #3a86ff 50%, #06ffa5 75%, #1a1a2e 100%)",
  "dark-void": "linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #000000 100%)"
};

/* =======================
   UTILITY FUNCTIONS
======================= */
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function saveToLocalStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveChats() {
  saveToLocalStorage("chats", state.chats);
  renderChatList();
  updateStats();
}

/* =======================
   CHAT MANAGEMENT
======================= */
function createChat() {
  const id = Date.now().toString();
  state.chats[id] = {
    name: "New Chat",
    titled: false,
    firstUserMessage: null,
    messages: [],
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveChats();
  return id;
}

function updateStats() {
  const totalChatCount = Object.keys(state.chats).length;
  const totalMessageCount = Object.values(state.chats).reduce((sum, chat) => sum + chat.messages.length, 0);
  
  elements.totalChats.textContent = totalChatCount;
  elements.totalMessages.textContent = totalMessageCount;
}

function renderChatList() {
  elements.chatList.innerHTML = "";
  
  const sortedChats = Object.entries(state.chats).sort((a, b) => 
    new Date(b[1].updatedAt) - new Date(a[1].updatedAt)
  );
  
  sortedChats.forEach(([id, chatData]) => {
    const div = document.createElement("div");
    div.textContent = chatData.name;
    
    if (id === state.currentChat) div.classList.add("active");
    div.onclick = () => loadChat(id);
    elements.chatList.appendChild(div);
  });
}

function updateWelcomeVisibility() {
  const hasMessages =
    state.currentChat &&
    state.chats[state.currentChat] &&
    state.chats[state.currentChat].messages.length > 0;

  elements.welcomeScreen.style.display = hasMessages ? "none" : "flex";
  elements.chat.style.display = hasMessages ? "flex" : "none";
}

function loadChat(id) {
  state.currentChat = id;
  elements.chat.innerHTML = "";

  state.chats[id].messages.forEach(renderMessage);

  updateWelcomeVisibility();
  renderChatList();
  updateStats();
}

/* =======================
   CHAT TITLE GENERATION
======================= */
function generateChatTitle(userQuestion) {
  const question = userQuestion.toLowerCase().trim();
  
  let cleaned = question
    .replace(/^(\s*(what|how|why|when|where|who|can|could|would|will|is|are|do|does|did|explain|tell me about|help me with|i need help with|i want to know about|show me|give me|find|search for)\s+)/i, '')
    .replace(/[?.!]$/, '')
    .trim();
  
  if (cleaned.length > 40) {
    const breakPoints = [',', ';', '-', '–', '—', ' about ', ' regarding ', ' concerning '];
    
    for (const breakPoint of breakPoints) {
      if (cleaned.includes(breakPoint)) {
        const parts = cleaned.split(breakPoint);
        if (parts[0].length > 10 && parts[0].length < 40) {
          cleaned = parts[0].trim();
          break;
        }
      }
    }
    
    if (cleaned.length > 40) {
      const truncated = cleaned.substring(0, 35);
      const lastSpace = truncated.lastIndexOf(' ');
      cleaned = lastSpace > 10 ? truncated.substring(0, lastSpace) : truncated;
    }
  }
  
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  
  if (question.length > cleaned.length + 10) {
    cleaned = cleaned.replace(/[.,;!?]$/, '') + '...';
  }
  
  const emoji = getTitleEmoji(question);
  return emoji + " " + cleaned;
}

function getTitleEmoji(question) {
  const lowerQ = question.toLowerCase();
  
  if (lowerQ.includes('code') || lowerQ.includes('programming') || lowerQ.includes('developer')) return "💻";
  else if (lowerQ.includes('math') || lowerQ.includes('calculate') || lowerQ.includes('formula')) return "🧮";
  else if (lowerQ.includes('write') || lowerQ.includes('essay') || lowerQ.includes('story')) return "📝";
  else if (lowerQ.includes('image') || lowerQ.includes('picture') || lowerQ.includes('photo')) return "🖼️";
  else if (lowerQ.includes('file') || lowerQ.includes('upload')) return "📎";
  else if (lowerQ.includes('explain') || lowerQ.includes('what is') || lowerQ.includes('definition')) return "📚";
  else if (lowerQ.includes('how to') || lowerQ.includes('tutorial') || lowerQ.includes('guide')) return "🔧";
  else if (lowerQ.includes('why') || lowerQ.includes('reason')) return "🤔";
  else if (lowerQ.includes('compare') || lowerQ.includes('vs') || lowerQ.includes('difference')) return "⚖️";
  else if (lowerQ.includes('list') || lowerQ.includes('examples') || lowerQ.includes('ideas')) return "📋";
  else if (lowerQ.includes('translate') || lowerQ.includes('language')) return "🌐";
  else if (lowerQ.includes('help') || lowerQ.includes('support')) return "🆘";
  else if (lowerQ.includes('business') || lowerQ.includes('marketing') || lowerQ.includes('sales')) return "💼";
  else if (lowerQ.includes('science') || lowerQ.includes('physics') || lowerQ.includes('chemistry')) return "🔬";
  else if (lowerQ.includes('health') || lowerQ.includes('medical') || lowerQ.includes('fitness')) return "🏥";
  else if (lowerQ.includes('travel') || lowerQ.includes('vacation') || lowerQ.includes('tour')) return "✈️";
  else if (lowerQ.includes('food') || lowerQ.includes('recipe') || lowerQ.includes('cooking')) return "🍳";
  else if (lowerQ.includes('music') || lowerQ.includes('song') || lowerQ.includes('artist')) return "🎵";
  else if (lowerQ.includes('movie') || lowerQ.includes('film') || lowerQ.includes('tv')) return "🎬";
  else if (lowerQ.includes('game') || lowerQ.includes('gaming') || lowerQ.includes('play')) return "🎮";
  else if (lowerQ.includes('weather') || lowerQ.includes('temperature') || lowerQ.includes('climate')) return "🌤️";
  else if (lowerQ.includes('money') || lowerQ.includes('finance') || lowerQ.includes('investment')) return "💰";
  else if (lowerQ.includes('ai') || lowerQ.includes('artificial intelligence') || lowerQ.includes('machine learning')) return "🤖";
  
  return "💬";
}

/* =======================
   CODE BLOCK NORMALIZATION & DETECTION
======================= */
function normalizeCodeBlocks(text) {
  if (!text.includes('```') && !text.includes('`')) {
    return { normalizedText: text, hasCode: false };
  }
  
  let normalizedText = text;
  const codeBlocks = [];
  
  const codeStartIndices = [];
  for (let i = 0; i < normalizedText.length - 2; i++) {
    if (normalizedText.substring(i, i + 3) === '```') {
      codeStartIndices.push(i);
    }
  }
  
  if (codeStartIndices.length % 2 === 1) {
    normalizedText += '\n```';
    codeStartIndices.push(normalizedText.length - 3);
  }
  
  for (let i = 0; i < codeStartIndices.length; i += 2) {
    const startIdx = codeStartIndices[i];
    
    let endIdx = normalizedText.indexOf('```', startIdx + 3);
    if (endIdx === -1) {
      endIdx = normalizedText.length;
      normalizedText += '```';
    }
    
    const blockContent = normalizedText.substring(startIdx + 3, endIdx);
    
    const firstNewline = blockContent.indexOf('\n');
    let language = 'text';
    let codeContent = blockContent;
    
    if (firstNewline > 0) {
      const firstLine = blockContent.substring(0, firstNewline).trim();
      const commonLanguages = ['javascript', 'js', 'python', 'py', 'html', 'css', 'java', 'cpp', 'c', 'php', 'ruby', 'go', 'rust', 'sql', 'json', 'xml', 'yaml', 'markdown', 'bash', 'sh'];
      const isLanguage = commonLanguages.includes(firstLine.toLowerCase()) || 
                         /^[a-z]+$/.test(firstLine) && firstLine.length < 20;
      
      if (isLanguage) {
        language = firstLine.toLowerCase();
        codeContent = blockContent.substring(firstNewline + 1);
      }
    }
    
    codeBlocks.push({
      language: language,
      code: codeContent,
      startIdx: startIdx,
      endIdx: endIdx + 3
    });
  }
  
  if (codeBlocks.length > 0) {
    let textWithoutCode = normalizedText;
    
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      const block = codeBlocks[i];
      textWithoutCode = textWithoutCode.substring(0, block.startIdx) + 
                       textWithoutCode.substring(block.endIdx);
    }
    
    return {
      normalizedText: textWithoutCode.trim(),
      hasCode: true,
      codeBlocks: codeBlocks
    };
  }
  
  return { normalizedText: normalizedText, hasCode: false };
}

function detectCode(text) {
  const normalized = normalizeCodeBlocks(text);
  
  if (normalized.hasCode && normalized.codeBlocks && normalized.codeBlocks.length > 0) {
    const firstBlock = normalized.codeBlocks[0];
    
    return {
      hasCode: true,
      language: firstBlock.language,
      code: firstBlock.code,
      fullText: normalized.normalizedText,
      allCodeBlocks: normalized.codeBlocks
    };
  }
  
  const codeBlockRegex = /```(\w+)?\n([\s\S]+?)```/g;
  const matches = [...text.matchAll(codeBlockRegex)];
  
  if (matches.length > 0) {
    const match = matches[0];
    return {
      hasCode: true,
      language: match[1] || 'text',
      code: match[2],
      fullText: text
    };
  }
  
  return { hasCode: false };
}

function renderMessage({ role, content, time }) {
  const messagesContainer = elements.chat;

  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";

  if (typeof content === "string" && content.trim().startsWith("<div")) {
    messageContent.innerHTML = content;
  } else {
    messageContent.textContent = content;
  }

  messageDiv.appendChild(messageContent);

  if (time) {
    const timeDiv = document.createElement("div");
    timeDiv.className = "time";
    timeDiv.textContent = time;
    messageDiv.appendChild(timeDiv);
  }

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/* =======================
   MESSAGE HANDLING
======================= */
function addMessage(message) {
  renderMessage(message);

  if (state.currentChat && state.chats[state.currentChat]) {
    state.chats[state.currentChat].messages.push(message);
    saveChats();
    updateStats();
  }
}

window.openArtifact = function(artifactId) {
  const artifact = state.chats[state.currentChat].artifacts.find(a => a.id === artifactId);
  if (artifact) displayArtifact(artifact);
};

function displayArtifact(artifact) {
  state.currentArtifact = artifact;
  
  renderCode(artifact.code);
  
  elements.artifactPanel.classList.add("visible");
  
  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.style.opacity = "0";
    settingsBtn.style.visibility = "hidden";
  }
}

function runArtifactCode() {
  if (!state.currentArtifact) return;
  
  const { language, code } = state.currentArtifact;
  
  if (language === 'javascript' || language === 'js') {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      
      const sandboxedCode = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Code Execution</title>
        </head>
        <body>
          <script>
            try {
              ${code}
              console.log('Code executed successfully');
            } catch (error) {
              console.error('Execution error:', error);
              document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: ' + error.message + '</div>';
            }
          <\/script>
        </body>
        </html>
      `;
      
      iframe.srcdoc = sandboxedCode;
      setTimeout(() => document.body.removeChild(iframe), 5000);
      showNotification("JavaScript executed in sandbox");
    } catch (error) {
      showNotification("Execution error: " + error.message);
      playSound('error');
    }
  } else if (language === 'python' || language === 'py') {
    showNotification("Python execution requires backend server");
  } else if (language === 'html') {
    const newWindow = window.open();
    newWindow.document.write(code);
    newWindow.document.close();
  } else {
    showNotification(`Running ${language} code...`);
  }
  
  playSound('success');
}

/* =======================
   FILE PREVIEW MANAGEMENT
======================= */
function showFilePreviewArea() {
  if (state.pendingFiles.length > 0) {
    elements.filePreviewArea.classList.remove("hidden");
  } else {
    elements.filePreviewArea.classList.add("hidden");
  }
}

function addFileToPreview(fileData) {
  state.pendingFiles.push(fileData);
  renderFilePreviews();
  showFilePreviewArea();
}

function removeFileFromPreview(index) {
  state.pendingFiles.splice(index, 1);
  renderFilePreviews();
  showFilePreviewArea();
}

function clearAllFiles(silent = false) {
  state.pendingFiles = [];
  renderFilePreviews();
  showFilePreviewArea();

  if (!silent) {
    showNotification("All files cleared");
    playSound("success");
  }
}

function renderFilePreviews() {
  elements.filePreviews.innerHTML = "";
  
  state.pendingFiles.forEach((fileData, index) => {
    const previewCard = document.createElement("div");
    previewCard.className = "file-preview-card";
    
    const fileIcon = getFileIcon(fileData.type, fileData.name);
    
    previewCard.innerHTML = `
      <div class="file-preview-info">
        <div class="file-icon">${fileIcon}</div>
        <div class="file-details">
          <div class="file-name">${fileData.name}</div>
          <div class="file-size">${formatFileSize(fileData.size)}</div>
        </div>
      </div>
      <button class="remove-file-btn" data-index="${index}" title="Remove file">✕</button>
    `;
    
    if (fileData.isImage && fileData.data) {
      previewCard.classList.add("image-preview");
      previewCard.onclick = (e) => {
        if (!e.target.closest('.remove-file-btn')) {
          showImagePreview(fileData.data, fileData.name);
        }
      };
    }
    
    elements.filePreviews.appendChild(previewCard);
  });
  
  document.querySelectorAll('.remove-file-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      removeFileFromPreview(index);
      playSound('success');
    };
  });
}

function getFileIcon(fileType, fileName) {
  if (fileType.startsWith('image/')) return '🖼️';
  else if (fileType.includes('pdf')) return '📕';
  else if (fileType.includes('text') || 
           fileName.endsWith('.txt') || 
           fileName.endsWith('.md')) return '📄';
  else if (fileName.endsWith('.js') || 
           fileName.endsWith('.py') || 
           fileName.endsWith('.java') || 
           fileName.endsWith('.cpp') || 
           fileName.endsWith('.c') || 
           fileName.endsWith('.html') || 
           fileName.endsWith('.css')) return '💻';
  else if (fileName.endsWith('.doc') || fileName.endsWith('.docx')) return '📘';
  else if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) return '📊';
  else if (fileName.endsWith('.zip') || fileName.endsWith('.rar') || fileName.endsWith('.7z')) return '📦';
  else return '📎';
}

function showImagePreview(imageSrc, fileName) {
  const modal = document.createElement('div');
  modal.className = 'image-preview-modal';
  modal.innerHTML = `
    <div class="image-preview-content">
      <div class="image-preview-header">
        <h3>${fileName}</h3>
        <button class="close-preview-btn">✕</button>
      </div>
      <img src="${imageSrc}" alt="${fileName}" />
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.close-preview-btn').onclick = () => {
    modal.remove();
  };
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
}

/* =======================
   SEND MESSAGE
======================= */
async function sendMessage() {
  if (state.isGenerating) return;

  const inputEl = elements.input;
  const text = inputEl.value.trim();
  
  if (!text && state.pendingFiles.length === 0) return;

  inputEl.value = "";

  if (!state.currentChat) {
    state.currentChat = createChat();
  }

  if (text) {
    addMessage({
      role: "user",
      content: text,
      time: now()
    });
  }

  if (state.pendingFiles.length > 0) {
    const filePreviewHTML = state.pendingFiles.map(fileData => {
      if (fileData.isImage && fileData.data) {
        return `
          <div class="file-upload-preview">
            <img src="${fileData.data}" alt="${fileData.name}" style="max-width: 300px; border-radius: 12px; margin: 10px 0;">
            <div style="font-size: 13px; opacity: 0.7;">${fileData.name} - ${formatFileSize(fileData.size)}</div>
          </div>
        `;
      } else if (fileData.content) {
        const truncatedContent = fileData.content.length > 500 
          ? fileData.content.substring(0, 500) + '...' 
          : fileData.content;
        return `
          <div class="file-upload-preview">
            <div style="
              font-weight: bold;
              margin-bottom: 8px;
              display: flex;
              align-items: center;
              gap: 6px;
            ">
              📄 ${fileData.name} (${formatFileSize(fileData.size)})
            </div>
            <div style="
              font-size: 12px;
              opacity: 0.75;
              max-height: 120px;
              overflow: auto;
              white-space: pre-wrap;
              font-family: monospace;
              background: rgba(0, 0, 0, 0.25);
              padding: 8px;
              border-radius: 6px;
            ">
              ${escapeHtml(truncatedContent)}
            </div>
          </div>
        `;
      } else {
        return `
          <div class="file-upload-preview">
            <div style="
              font-weight: bold;
              margin-bottom: 8px;
              display: flex;
              align-items: center;
              gap: 6px;
            ">
              📎 ${fileData.name} (${formatFileSize(fileData.size)})
            </div>
            <div style="
              font-size: 12px;
              opacity: 0.6;
            ">
              Binary file - ${fileData.type}
            </div>
          </div>
        `;
      }
    }).join('');
    
    addMessage({
      role: "user",
      content: filePreviewHTML,
      time: now()
    });
  }

  updateWelcomeVisibility();

  if (state.settings.typingIndicator) {
    elements.typing.style.opacity = 1;
  }

  elements.sendBtn.textContent = "Stop";
  state.isGenerating = true;

  if (state.settings.deepThinkingMode) {
    showThinkingModal();
  }

  if (state.settings.researchInternet && text && text.toLowerCase().includes("search")) {
    showResearchModal();
  }

  try {
    const messagesToSend = state.chats[state.currentChat].messages
      .slice(-15)
      .map(m => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content.replace(/<[^>]*>/g, "")
          : String(m.content)
      }));

    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: messagesToSend,
        model: state.settings.model,
        max_tokens: state.settings.maxTokens,
        temperature: state.settings.temperature
      })
    });

    if (!response.ok) {
      throw new Error(`Server error ${response.status}`);
    }

    const data = await response.json();
    let aiContent = data.reply || "I apologize, but I couldn't generate a response.";

    const detected = detectCode(aiContent);

    if (detected.hasCode) {
      const artifact = {
        id: Date.now().toString(),
        language: detected.language,
        code: detected.code,
        createdAt: new Date().toISOString()
      };

      state.chats[state.currentChat].artifacts.push(artifact);
      aiContent = detected.fullText || "";
      
      if (state.settings.autoOpenArtifacts) {
        displayArtifact(artifact);
      }
    } else {
      aiContent = minimalFormatting(aiContent);
    }

    addMessage({
      role: "assistant",
      content: aiContent,
      time: now()
    });

    if (!state.chats[state.currentChat].titled && !state.chats[state.currentChat].firstUserMessage) {
      state.chats[state.currentChat].firstUserMessage = text || `Files: ${state.pendingFiles.map(f => f.name).join(', ')}`;
      const title = generateChatTitle(state.chats[state.currentChat].firstUserMessage);
      state.chats[state.currentChat].name = title;
      state.chats[state.currentChat].titled = true;
      saveChats();
      renderChatList();
    }

  } catch (err) {
    addMessage({
      role: "assistant",
      content: `Connection error: ${err.message}`,
      time: now()
    });
  } finally {
    if (state.settings.typingIndicator) {
      elements.typing.style.opacity = 0;
    }

    elements.sendBtn.textContent = "Send";
    state.isGenerating = false;

    hideThinkingModal();
    hideResearchModal();

    clearAllFiles(true);

    saveChats();
    playSound("success");
  }
}

/* =======================
   VOICE RECORDING
======================= */
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function startVoiceRecording() {
  const voiceBtn = document.getElementById("voiceInputBtn");
  
  if (isRecording) {
    stopVoiceRecording();
    return;
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };
    
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      
      try {
        showNotification("Processing voice input...");
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];
          
          try {
            const response = await fetch(VOICE_TRANSCRIPTION_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                audio: base64Audio,
                format: "webm"
              })
            });
            
            if (!response.ok) {
              if (response.status === 404) {
                showNotification("Voice transcription service is not available. Please type your message.");
                playSound('error');
                return;
              }
              throw new Error(`Transcription failed: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.text) {
              elements.input.value = result.text;
              showNotification("Voice input transcribed!");
              playSound('success');
            } else {
              throw new Error(result.error || "Transcription failed");
            }
          } catch (transcriptionError) {
            console.error("Transcription error:", transcriptionError);
            showNotification("Could not transcribe audio. Please type your message.");
            playSound('error');
          }
        };
        
      } catch (error) {
        console.error("Audio processing error:", error);
        showNotification("Could not process audio. Please type your message.");
        playSound('error');
      }
      
      voiceBtn.textContent = "🎤";
      voiceBtn.style.background = "var(--bg-card)";
      isRecording = false;
      
      stream.getTracks().forEach(track => track.stop());
    };
    
    mediaRecorder.start();
    isRecording = true;
    
    voiceBtn.textContent = "⏹️";
    voiceBtn.style.background = "linear-gradient(135deg, #ff006e, #ff4d8e)";
    
    showNotification("Recording... Click again to stop");
    playSound('messageSent');
    
  } catch (error) {
    console.error("Microphone access error:", error);
    showNotification("Could not access microphone. Please check permissions.");
    playSound('error');
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

/* =======================
   WELCOME SCREEN FUNCTIONALITY
======================= */
function setupWelcomeScreen() {
  document.querySelectorAll('.example-query').forEach(button => {
    button.addEventListener('click', () => {
      const text = button.querySelector('.query-text').textContent;
      elements.welcomeInput.value = text;
      elements.welcomeInput.focus();
    });
  });
  
  if (elements.welcomeSendBtn) {
    elements.welcomeSendBtn.addEventListener('click', () => {
      const text = elements.welcomeInput.value.trim();
      if (text) {
        sendMessageFromWelcomeScreen(text);
      }
    });
  }
  
  if (elements.welcomeInput) {
    elements.welcomeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = elements.welcomeInput.value.trim();
        if (text && !state.isGenerating) {
          sendMessageFromWelcomeScreen(text);
        }
      }
    });
  }
  
  if (elements.welcomeVoiceBtn) {
    elements.welcomeVoiceBtn.addEventListener('click', () => {
      if (elements.welcomeInput) {
        elements.welcomeInput.focus();
        showNotification("Voice input is available in the main chat interface");
        playSound('messageSent');
      }
    });
  }
  
  document.querySelector('.attach-icon')?.addEventListener('click', () => {
    handleFileUpload();
  });
}

function sendMessageFromWelcomeScreen(text) {
  elements.welcomeInput.value = "";
  elements.input.value = text;
  updateWelcomeVisibility();
  sendMessage();
}

/* =======================
   FILE UPLOAD
======================= */
function handleFileUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf,.txt,.doc,.docx,.json,.js,.html,.css,.py,.java,.cpp,.c,.xml,.csv';
  input.multiple = true;
  
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    for (const file of files) {
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        showNotification(`File too large! ${file.name} exceeds 10MB limit`);
        playSound('error');
        continue;
      }
      
      try {
        const fileData = {
          name: file.name,
          type: file.type || 'unknown',
          size: file.size
        };
        
        if (file.type.startsWith('image/')) {
          const base64 = await readFileAsBase64(file);
          fileData.data = base64;
          fileData.isImage = true;
        } else if (isTextFile(file.name, file.type)) {
          const textContent = await readFileAsText(file);
          fileData.content = textContent;
          fileData.isImage = false;
        } else {
          const base64 = await readFileAsBase64(file);
          fileData.data = base64;
          fileData.isImage = false;
        }
        
        addFileToPreview(fileData);
        showNotification(`File added: ${file.name}`);
        playSound('success');
        
      } catch (error) {
        console.error("File upload error:", error);
        showNotification(`Could not read file: ${file.name}`);
        playSound('error');
      }
    }
  };
  
  input.click();
}

function isTextFile(fileName, fileType) {
  const textExtensions = ['.txt', '.json', '.js', '.html', '.css', '.xml', '.csv', 
                          '.py', '.java', '.cpp', '.c', '.h', '.md', '.log'];
  const textTypes = ['text/', 'application/json', 'application/xml', 
                     'application/javascript'];
  
  const hasTextExtension = textExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
  const hasTextType = textTypes.some(type => fileType.startsWith(type));
  
  return hasTextExtension || hasTextType;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* =======================
   SETTINGS MANAGEMENT
======================= */
function saveSettings() {
  localStorage.setItem("settings", JSON.stringify(state.settings));
  applySettings();
}

function applySettings() {
  if (!state.settings) return;
  
  // Update UI elements to match state
  if (elements.modelSelect) {
    elements.modelSelect.value = state.settings.model;
  }
  
  if (elements.temperature) {
    elements.temperature.value = state.settings.temperature * 10;
    if (elements.temperatureValue) {
      elements.temperatureValue.textContent = state.settings.temperature;
    }
  }
  
  if (elements.maxTokens) {
    elements.maxTokens.value = state.settings.maxTokens;
    if (elements.maxTokensValue) {
      elements.maxTokensValue.textContent = state.settings.maxTokens;
    }
  }
  
  if (elements.accentColor) {
    elements.accentColor.value = state.settings.accentColor;
  }
  
  if (elements.backgroundSelect) {
    elements.backgroundSelect.value = state.settings.backgroundTheme;
    applyBackgroundTheme(state.settings.backgroundTheme);
  }
  
  if (elements.fontSize) {
    elements.fontSize.value = state.settings.fontSize;
    applyFontSize(state.settings.fontSize);
  }
  
  if (elements.deepThinkingToggle) {
    elements.deepThinkingToggle.checked = state.settings.deepThinkingMode;
  }
  
  if (elements.researchInternetToggle) {
    elements.researchInternetToggle.checked = state.settings.researchInternet;
  }
  
  if (elements.typingIndicatorToggle) {
    elements.typingIndicatorToggle.checked = state.settings.typingIndicator;
  }
  
  if (elements.autoOpenArtifactsToggle) {
    elements.autoOpenArtifactsToggle.checked = state.settings.autoOpenArtifacts;
  }
  
  if (elements.soundToggle) {
    elements.soundToggle.checked = state.settings.soundEnabled;
  }
  
  if (elements.soundVolume) {
    elements.soundVolume.value = state.settings.soundVolume;
    if (elements.soundVolumeValue) {
      elements.soundVolumeValue.textContent = state.settings.soundVolume + "%";
    }
  }
  
  // Apply accent color
  if (state.settings.accentColor) {
    document.documentElement.style.setProperty('--primary', state.settings.accentColor);
  }
}

function applyBackgroundTheme(theme) {
  const gradient = backgroundThemes[theme] || backgroundThemes["default"];
  document.body.style.background = gradient;
}

function applyFontSize(size) {
  document.body.classList.remove('font-small', 'font-medium', 'font-large');
  document.body.classList.add(`font-${size}`);
}

function setupSettingsBindings() {
  // Model selection
  if (elements.modelSelect) {
    elements.modelSelect.addEventListener('change', (e) => {
      state.settings.model = e.target.value;
      saveSettings();
    });
  }
  
  // Temperature slider
  if (elements.temperature) {
    elements.temperature.addEventListener('input', (e) => {
      state.settings.temperature = e.target.value / 10;
      if (elements.temperatureValue) {
        elements.temperatureValue.textContent = state.settings.temperature;
      }
      saveSettings();
    });
  }
  
  // Max tokens slider
  if (elements.maxTokens) {
    elements.maxTokens.addEventListener('input', (e) => {
      state.settings.maxTokens = parseInt(e.target.value);
      if (elements.maxTokensValue) {
        elements.maxTokensValue.textContent = state.settings.maxTokens;
      }
      saveSettings();
    });
  }
  
  // Accent color
  if (elements.accentColor) {
    elements.accentColor.addEventListener('change', (e) => {
      state.settings.accentColor = e.target.value;
      saveSettings();
    });
  }
  
  // Background theme
  if (elements.backgroundSelect) {
    elements.backgroundSelect.addEventListener('change', (e) => {
      state.settings.backgroundTheme = e.target.value;
      saveSettings();
    });
  }
  
  // Font size
  if (elements.fontSize) {
    elements.fontSize.addEventListener('change', (e) => {
      state.settings.fontSize = e.target.value;
      saveSettings();
    });
  }
  
  // Toggle switches
  if (elements.deepThinkingToggle) {
    elements.deepThinkingToggle.addEventListener('change', (e) => {
      state.settings.deepThinkingMode = e.target.checked;
      saveSettings();
    });
  }
  
  if (elements.researchInternetToggle) {
    elements.researchInternetToggle.addEventListener('change', (e) => {
      state.settings.researchInternet = e.target.checked;
      saveSettings();
    });
  }
  
  if (elements.typingIndicatorToggle) {
    elements.typingIndicatorToggle.addEventListener('change', (e) => {
      state.settings.typingIndicator = e.target.checked;
      saveSettings();
    });
  }
  
  if (elements.autoOpenArtifactsToggle) {
    elements.autoOpenArtifactsToggle.addEventListener('change', (e) => {
      state.settings.autoOpenArtifacts = e.target.checked;
      saveSettings();
    });
  }
  
  if (elements.soundToggle) {
    elements.soundToggle.addEventListener('change', (e) => {
      state.settings.soundEnabled = e.target.checked;
      saveSettings();
    });
  }
  
  // Sound volume
  if (elements.soundVolume) {
    elements.soundVolume.addEventListener('input', (e) => {
      state.settings.soundVolume = parseInt(e.target.value);
      if (elements.soundVolumeValue) {
        elements.soundVolumeValue.textContent = state.settings.soundVolume + "%";
      }
      saveSettings();
    });
  }
  
  // Sound toggles
  if (elements.soundMessageSentToggle) {
    elements.soundMessageSentToggle.addEventListener('change', () => {
      saveSettings();
    });
  }
  
  if (elements.soundMessageReceivedToggle) {
    elements.soundMessageReceivedToggle.addEventListener('change', () => {
      saveSettings();
    });
  }
  
  if (elements.soundSuccessToggle) {
    elements.soundSuccessToggle.addEventListener('change', () => {
      saveSettings();
    });
  }
  
  // Data actions
  if (elements.exportChat) {
    elements.exportChat.addEventListener('click', () => {
      if (state.currentChat && state.chats[state.currentChat]) {
        const chatData = state.chats[state.currentChat];
        const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-${state.currentChat}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification("Chat exported!");
        playSound('success');
      }
    });
  }
  
  if (elements.backupChats) {
    elements.backupChats.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.chats, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chats-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showNotification("All chats backed up!");
      playSound('success');
    });
  }
  
  if (elements.exportSettings) {
    elements.exportSettings.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `settings-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showNotification("Settings exported!");
      playSound('success');
    });
  }
  
  if (elements.resetSettings) {
    elements.resetSettings.addEventListener('click', () => {
      if (confirm("Reset all settings to defaults?")) {
        state.settings = {
          model: "claude-3-sonnet-20240229",
          maxTokens: 4096,
          temperature: 0.7,
          typingIndicator: true,
          soundEnabled: true,
          soundVolume: 70,
          deepThinkingMode: false,
          researchInternet: false,
          autoOpenArtifacts: true,
          accentColor: "#00d4ff",
          backgroundTheme: "default",
          fontSize: "medium"
        };
        saveSettings();
        applySettings();
        showNotification("Settings reset to defaults!");
        playSound('success');
      }
    });
  }
  
  if (elements.clearCache) {
    elements.clearCache.addEventListener('click', () => {
      if (confirm("Clear all cached data? This won't delete your chats.")) {
        // Clear non-chat localStorage items
        const chats = localStorage.getItem("chats");
        const settings = localStorage.getItem("settings");
        localStorage.clear();
        if (chats) localStorage.setItem("chats", chats);
        if (settings) localStorage.setItem("settings", settings);
        showNotification("Cache cleared!");
        playSound('success');
      }
    });
  }
  
  // Update storage usage display
  updateStorageUsage();
}

function updateStorageUsage() {
  if (elements.storageUsage) {
    const chatsSize = JSON.stringify(state.chats).length;
    elements.storageUsage.textContent = formatFileSize(chatsSize);
  }
  
  if (elements.localStorageUsage) {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      total += key.length + value.length;
    }
    elements.localStorageUsage.textContent = formatFileSize(total);
  }
}

/* =======================
   SETTINGS TAB SWITCHING
======================= */
function setupSettingsTabs() {
  const tabs = document.querySelectorAll('.settings-tab');
  const panels = document.querySelectorAll('.settings-panel[data-panel]');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      panels.forEach(panel => {
        panel.classList.toggle(
          'active',
          panel.dataset.panel === target
        );
      });
    });
  });
}

/* =======================
   EVENT LISTENERS
======================= */
function setupEventListeners() {
  // Verification buttons
  if (elements.sendCodeBtn) elements.sendCodeBtn.onclick = sendVerificationCode;
  if (elements.verifyCodeBtn) elements.verifyCodeBtn.onclick = verifyCode;
  if (elements.resendCodeBtn) elements.resendCodeBtn.onclick = resendCode;
  if (elements.changeEmailBtn) elements.changeEmailBtn.onclick = changeEmail;
  if (elements.completeSetupBtn) elements.completeSetupBtn.onclick = completeSetup;
  if (elements.logoutBtn) elements.logoutBtn.onclick = logout;
  
  // Research cancel
  if (elements.cancelResearch) elements.cancelResearch.onclick = cancelResearch;
  
  // Artifact actions
  if (elements.runArtifact) elements.runArtifact.onclick = runArtifactCode;
  
  // Verification input handlers
  if (elements.verificationEmail) {
    elements.verificationEmail.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendVerificationCode();
    });
  }
  
  if (elements.verificationCode) {
    elements.verificationCode.addEventListener("keydown", (e) => {
      if (e.key === "Enter") verifyCode();
    });
    
    elements.verificationCode.addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '').substring(0, 6);
    });
  }
  
  if (elements.usernameInput) {
    elements.usernameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") completeSetup();
    });
  }
  
  // Chat input and send
  elements.sendBtn.onclick = () => {
    if (state.isGenerating) {
      state.isGenerating = false;
      elements.typing.style.opacity = 0;
      elements.sendBtn.textContent = "Send";
      hideThinkingModal();
      hideResearchModal();
    } else {
      sendMessage();
    }
  };
  
  elements.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !state.isGenerating) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Settings modal
  elements.settingsBtn.onclick = () => {
    elements.settingsPanel.classList.remove("hidden");
    createModalOverlay();
  };
  
  elements.closeSettings.onclick = () => {
    elements.settingsPanel.classList.add("hidden");
    removeModalOverlay();
  };
  
  // Artifact panel
  elements.closeArtifact.onclick = () => {
    elements.artifactPanel.classList.remove("visible");
    state.currentArtifact = null;
    const settingsBtn = document.getElementById("settingsBtn");
    if (settingsBtn) {
      settingsBtn.style.opacity = "1";
      settingsBtn.style.visibility = "visible";
    }
  };
  
  elements.copyArtifact.onclick = () => {
    if (state.currentArtifact) {
      navigator.clipboard.writeText(state.currentArtifact.code);
      showNotification("Code copied!");
      playSound('success');
    }
  };
  
  elements.downloadArtifact.onclick = () => {
    if (state.currentArtifact) {
      const blob = new Blob([state.currentArtifact.code], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `code.${state.currentArtifact.language}`;
      a.click();
      URL.revokeObjectURL(url);
      showNotification("Code downloaded!");
      playSound('success');
    }
  };
  
  // New chat button
  const newChatBtn = document.getElementById("newChat");
  if (newChatBtn) {
    newChatBtn.onclick = () => {
      state.currentChat = createChat();
      loadChat(state.currentChat);
      showNotification("New chat created!");
      playSound('success');
    };
  }
  
  // Clear chats button
  const clearBtn = document.getElementById("clearChats");
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (confirm("Clear all chats?")) {
        state.chats = {};
        state.currentChat = createChat();
        saveChats();
        loadChat(state.currentChat);
        showNotification("All chats cleared!");
        playSound('success');
      }
    };
  }
  
  // Voice input button
  if (elements.voiceInputBtn) {
    elements.voiceInputBtn.onclick = () => {
      startVoiceRecording();
    };
  }
  
  // File upload button
  if (elements.fileUploadBtn) {
    elements.fileUploadBtn.onclick = () => {
      handleFileUpload();
    };
  }
  
  // Quick response templates
  document.querySelectorAll('.response-template').forEach(btn => {
    btn.onclick = () => {
      elements.input.value = btn.textContent;
      elements.input.focus();
      playSound('messageSent');
    };
  });
  
  // Clear all files button
  if (elements.clearAllFiles) {
    elements.clearAllFiles.onclick = () => {
      clearAllFiles();
    };
  }
  
  // Quick responses show/hide
  elements.input.addEventListener('focus', () => {
    if (elements.quickResponses) {
      elements.quickResponses.classList.remove('hidden');
    }
  });
  
  elements.input.addEventListener('blur', () => {
    if (elements.quickResponses) {
      setTimeout(() => {
        elements.quickResponses.classList.add('hidden');
      }, 200);
    }
  });
}

function createModalOverlay() {
  let overlay = document.querySelector('.modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = () => {
      elements.settingsPanel.classList.add("hidden");
      overlay.classList.remove('active');
    };
    document.body.appendChild(overlay);
  }
  overlay.classList.add('active');
}

function removeModalOverlay() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--primary);
    color: white;
    padding: 12px 20px;
    border-radius: 12px;
    z-index: 10000;
    animation: fadeIn 0.3s ease;
    box-shadow: 0 6px 20px rgba(0, 212, 255, 0.4);
    font-weight: 600;
    font-family: var(--font-primary);
  `;
  
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(-10px)';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/* =======================
   INITIALIZATION
======================= */
function init() {
  // Load saved state
  if (localStorage.getItem("verifiedEmail")) {
    state.userEmail = localStorage.getItem("verifiedEmail");
    state.isVerified = true;
  }
  
  if (localStorage.getItem("username")) {
    state.username = localStorage.getItem("username");
  }
  
  // Apply settings
  applySettings();
  
  // Setup event listeners
  setupEventListeners();
  setupWelcomeScreen();
  setupSettingsBindings();
  setupSettingsTabs();
  
  // Load current chat
  loadChat(state.currentChat);
  
  // Update stats and user display
  updateStats();
  updateUserDisplay();
  updateStorageUsage();
  
  // Check verification
  checkVerification();
  
  console.log("Quist AI app initialized!");
}

// Start the app
document.addEventListener("DOMContentLoaded", () => {
  init();
});