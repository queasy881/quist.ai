// Enhanced Chat Application - Complete Rewrite with New Settings System
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
  
  // New Settings Elements
  saveSettings: document.getElementById("saveSettings"),
  resetSettings: document.getElementById("resetSettings"),
  categoryBtns: document.querySelectorAll(".category-btn"),
  settingsCategories: document.querySelectorAll(".settings-category"),
  
  // Model Settings
  modelSelect: document.getElementById("modelSelect"),
  responseFormat: document.getElementById("responseFormat"),
  contextWindow: document.getElementById("contextWindow"),
  
  // Parameter Settings
  temperature: document.getElementById("temperature"),
  temperatureValue: document.getElementById("temperatureValue"),
  temperatureProgress: document.getElementById("temperatureProgress"),
  maxTokens: document.getElementById("maxTokens"),
  maxTokensValue: document.getElementById("maxTokensValue"),
  maxTokensProgress: document.getElementById("maxTokensProgress"),
  typingIndicator: document.getElementById("typingIndicator"),
  
  // Appearance Settings
  accentColor: document.getElementById("accentColor"),
  backgroundSelect: document.getElementById("backgroundSelect"),
  fontSizeSelect: document.getElementById("fontSizeSelect"),
  designSelect: document.getElementById("designSelect"),
  
  // Audio Settings
  soundEnabled: document.getElementById("soundEnabled"),
  soundVolume: document.getElementById("soundVolume"),
  soundVolumeValue: document.getElementById("soundVolumeValue"),
  soundVolumeProgress: document.getElementById("soundVolumeProgress"),
  
  // Advanced Settings
  deepThinkingMode: document.getElementById("deepThinkingMode"),
  researchInternet: document.getElementById("researchInternet"),
  compactMode: document.getElementById("compactMode"),
  autoCopyCode: document.getElementById("autoCopyCode")
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
  if (!state.settings.soundEnabled) return;
  
  const sound = soundEffects[soundName];
  if (sound) {
    try {
      const volume = state.settings.soundVolume / 100;
      soundEffects[soundName] = createSound(
        getFrequencyForSound(soundName),
        getDurationForSound(soundName),
        volume
      );
    } catch (error) {
      console.warn("Failed to play sound:", error);
    }
  }
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
   NEW SETTINGS STATE
======================= */
let state = {
  currentArtifact: null,
  isGenerating: false,
  chats: JSON.parse(localStorage.getItem("chats")) || {},
  currentChat: null,
  pendingFiles: [],
  userEmail: localStorage.getItem("verifiedEmail") || null,
  username: localStorage.getItem("username") || null,
  isVerified: false,
  isResearching: false,
  isThinking: false,
  settings: {
    // Models
    model: "claude-3-haiku-20240307",
    responseFormat: "markdown",
    contextWindow: "medium",
    
    // Parameters
    temperature: 0.3,
    maxTokens: 4096,
    typingIndicator: true,
    
    // Appearance
    accentColor: "#00d4ff",
    background: "default",
    fontSize: "medium",
    design: "rounded",
    
    // Audio
    soundEnabled: false,
    soundVolume: 70,
    
    // Advanced
    deepThinkingMode: false,
    researchInternet: false,
    compactMode: false,
    autoCopyCode: false
  }
};

// Load saved settings
const savedSettings = localStorage.getItem("appSettings");
if (savedSettings) {
  try {
    const parsed = JSON.parse(savedSettings);
    // Only apply settings that exist in our new structure
    Object.keys(parsed).forEach(key => {
      if (state.settings.hasOwnProperty(key)) {
        state.settings[key] = parsed[key];
      }
    });
  } catch (e) {
    console.warn("Failed to parse saved settings:", e);
  }
}

// Initialize current chat
state.currentChat = Object.keys(state.chats)[0] || createChat();

/* =======================
   UTILITY FUNCTIONS
======================= */
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function saveToLocalStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveSettings() {
  saveToLocalStorage("appSettings", state.settings);
}

function saveChats() {
  saveToLocalStorage("chats", state.chats);
  renderChatList();
  updateStats();
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

function addMessage(message) {
  renderMessage(message);

  if (state.currentChat && state.chats[state.currentChat]) {
    state.chats[state.currentChat].messages.push(message);
    saveChats();
    updateStats();
  }
}

/* =======================
   SETTINGS FUNCTIONS
======================= */
function updateSliderProgress() {
  // Temperature slider
  if (elements.temperature) {
    const tempValue = (parseInt(elements.temperature.value) / 10).toFixed(1);
    const tempPercent = (parseInt(elements.temperature.value) / 10) * 10;
    elements.temperatureProgress.style.width = `${tempPercent}%`;
    elements.temperatureValue.textContent = tempValue;
  }

  // Max tokens slider
  if (elements.maxTokens) {
    const maxTokensValue = parseInt(elements.maxTokens.value);
    const maxTokensPercent = ((maxTokensValue - 512) / (8192 - 512)) * 100;
    elements.maxTokensProgress.style.width = `${maxTokensPercent}%`;
    elements.maxTokensValue.textContent = maxTokensValue.toLocaleString();
  }

  // Sound volume slider
  if (elements.soundVolume) {
    const volumeValue = parseInt(elements.soundVolume.value);
    elements.soundVolumeProgress.style.width = `${volumeValue}%`;
    elements.soundVolumeValue.textContent = `${volumeValue}%`;
  }
}

function loadSettingsToUI() {
  // Load from state to UI elements
  if (elements.modelSelect) elements.modelSelect.value = state.settings.model;
  if (elements.responseFormat) elements.responseFormat.value = state.settings.responseFormat;
  if (elements.contextWindow) elements.contextWindow.value = state.settings.contextWindow;
  
  if (elements.temperature) elements.temperature.value = Math.round(state.settings.temperature * 10);
  if (elements.maxTokens) elements.maxTokens.value = state.settings.maxTokens;
  if (elements.typingIndicator) elements.typingIndicator.checked = state.settings.typingIndicator;
  
  if (elements.accentColor) elements.accentColor.value = state.settings.accentColor;
  if (elements.backgroundSelect) elements.backgroundSelect.value = state.settings.background;
  if (elements.fontSizeSelect) elements.fontSizeSelect.value = state.settings.fontSize;
  if (elements.designSelect) elements.designSelect.value = state.settings.design;
  
  if (elements.soundEnabled) elements.soundEnabled.checked = state.settings.soundEnabled;
  if (elements.soundVolume) elements.soundVolume.value = state.settings.soundVolume;
  
  if (elements.deepThinkingMode) elements.deepThinkingMode.checked = state.settings.deepThinkingMode;
  if (elements.researchInternet) elements.researchInternet.checked = state.settings.researchInternet;
  if (elements.compactMode) elements.compactMode.checked = state.settings.compactMode;
  if (elements.autoCopyCode) elements.autoCopyCode.checked = state.settings.autoCopyCode;
  
  updateSliderProgress();
  applySettings();
}

function applySettings() {
  // Apply accent color
  document.documentElement.style.setProperty("--primary", state.settings.accentColor);
  
  // Apply background theme
  document.body.className = "";
  document.body.classList.add(`theme-${state.settings.background}`);
  
  // Apply font size
  document.body.classList.add(`font-${state.settings.fontSize}`);
  
  // Apply design style
  document.body.classList.add(`design-${state.settings.design}`);
  document.documentElement.style.setProperty("--radius", 
    state.settings.design === "sharp" ? "4px" : 
    state.settings.design === "neumorphic" ? "24px" : "16px"
  );
  
  // Apply compact mode
  if (state.settings.compactMode) {
    document.body.classList.add("compact-mode");
  } else {
    document.body.classList.remove("compact-mode");
  }
  
  // Apply typing indicator visibility
  elements.typing.style.display = state.settings.typingIndicator ? 'flex' : 'none';
}

function resetSettingsToDefaults() {
  state.settings = {
    model: "claude-3-haiku-20240307",
    responseFormat: "markdown",
    contextWindow: "medium",
    temperature: 0.3,
    maxTokens: 4096,
    typingIndicator: true,
    accentColor: "#00d4ff",
    background: "default",
    fontSize: "medium",
    design: "rounded",
    soundEnabled: false,
    soundVolume: 70,
    deepThinkingMode: false,
    researchInternet: false,
    compactMode: false,
    autoCopyCode: false
  };
  
  saveSettings();
  loadSettingsToUI();
  showNotification("Settings reset to defaults");
  playSound('success');
}

function setupSettingsEventListeners() {
  // Category navigation
  elements.categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.dataset.category;
      
      // Update active button
      elements.categoryBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Show corresponding category
      elements.settingsCategories.forEach(cat => {
        cat.classList.remove('active');
        if (cat.id === `category-${category}`) {
          cat.classList.add('active');
        }
      });
    });
  });
  
  // Model settings
  if (elements.modelSelect) {
    elements.modelSelect.addEventListener('change', () => {
      state.settings.model = elements.modelSelect.value;
      saveSettings();
    });
  }
  
  if (elements.responseFormat) {
    elements.responseFormat.addEventListener('change', () => {
      state.settings.responseFormat = elements.responseFormat.value;
      saveSettings();
    });
  }
  
  if (elements.contextWindow) {
    elements.contextWindow.addEventListener('change', () => {
      state.settings.contextWindow = elements.contextWindow.value;
      saveSettings();
    });
  }
  
  // Parameter settings
  if (elements.temperature) {
    elements.temperature.addEventListener('input', () => {
      state.settings.temperature = parseInt(elements.temperature.value) / 10;
      updateSliderProgress();
      saveSettings();
    });
  }
  
  if (elements.maxTokens) {
    elements.maxTokens.addEventListener('input', () => {
      state.settings.maxTokens = parseInt(elements.maxTokens.value);
      updateSliderProgress();
      saveSettings();
    });
  }
  
  if (elements.typingIndicator) {
    elements.typingIndicator.addEventListener('change', () => {
      state.settings.typingIndicator = elements.typingIndicator.checked;
      applySettings();
      saveSettings();
    });
  }
  
  // Appearance settings
  if (elements.accentColor) {
    elements.accentColor.addEventListener('input', () => {
      state.settings.accentColor = elements.accentColor.value;
      applySettings();
      saveSettings();
    });
  }
  
  if (elements.backgroundSelect) {
    elements.backgroundSelect.addEventListener('change', () => {
      state.settings.background = elements.backgroundSelect.value;
      applySettings();
      saveSettings();
    });
  }
  
  if (elements.fontSizeSelect) {
    elements.fontSizeSelect.addEventListener('change', () => {
      state.settings.fontSize = elements.fontSizeSelect.value;
      applySettings();
      saveSettings();
    });
  }
  
  if (elements.designSelect) {
    elements.designSelect.addEventListener('change', () => {
      state.settings.design = elements.designSelect.value;
      applySettings();
      saveSettings();
    });
  }
  
  // Audio settings
  if (elements.soundEnabled) {
    elements.soundEnabled.addEventListener('change', () => {
      state.settings.soundEnabled = elements.soundEnabled.checked;
      saveSettings();
    });
  }
  
  if (elements.soundVolume) {
    elements.soundVolume.addEventListener('input', () => {
      state.settings.soundVolume = parseInt(elements.soundVolume.value);
      updateSliderProgress();
      saveSettings();
    });
  }
  
  // Advanced settings
  if (elements.deepThinkingMode) {
    elements.deepThinkingMode.addEventListener('change', () => {
      state.settings.deepThinkingMode = elements.deepThinkingMode.checked;
      saveSettings();
    });
  }
  
  if (elements.researchInternet) {
    elements.researchInternet.addEventListener('change', () => {
      state.settings.researchInternet = elements.researchInternet.checked;
      saveSettings();
    });
  }
  
  if (elements.compactMode) {
    elements.compactMode.addEventListener('change', () => {
      state.settings.compactMode = elements.compactMode.checked;
      applySettings();
      saveSettings();
    });
  }
  
  if (elements.autoCopyCode) {
    elements.autoCopyCode.addEventListener('change', () => {
      state.settings.autoCopyCode = elements.autoCopyCode.checked;
      saveSettings();
    });
  }
  
  // Settings buttons
  if (elements.saveSettings) {
    elements.saveSettings.addEventListener('click', () => {
      elements.settingsPanel.classList.add("hidden");
      removeModalOverlay();
      showNotification("Settings saved");
      playSound('success');
    });
  }
  
  if (elements.resetSettings) {
    elements.resetSettings.addEventListener('click', () => {
      if (confirm("Reset all settings to defaults?")) {
        resetSettingsToDefaults();
      }
    });
  }
}

/* =======================
   EMAIL VERIFICATION
======================= */
function checkVerification() {
  if (state.userEmail && state.username) {
    state.isVerified = true;
    elements.verificationModal.classList.add("hidden");
    updateUserDisplay();
    return true;
  }
  elements.verificationModal.classList.remove("hidden");
  return false;
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
  const email = elements.verificationEmail.value.trim();
  
  if (!email || !email.includes("@")) {
    showVerificationError("Please enter a valid email address");
    return;
  }
  
  elements.sendCodeBtn.disabled = true;
  elements.sendCodeBtn.textContent = "Sending...";
  
  try {
    const res = await fetch(`${VERIFICATION_URL}/send-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    
    const data = await res.json();
    
    if (data.success) {
      elements.emailStep.classList.add("hidden");
      elements.codeStep.classList.remove("hidden");
      elements.displayEmail.textContent = email;
      showVerificationSuccess("Verification code sent! Check your email.");
      state.userEmail = email;
    } else {
      showVerificationError(data.error || "Failed to send verification code");
      elements.sendCodeBtn.disabled = false;
      elements.sendCodeBtn.textContent = "📧 Send Verification Code";
    }
  } catch (error) {
    console.error("Verification error:", error);
    showVerificationError("Network error. Please check your connection.");
    elements.sendCodeBtn.disabled = false;
    elements.sendCodeBtn.textContent = "📧 Send Verification Code";
  }
}

async function verifyCode() {
  const code = elements.verificationCode.value.trim();
  
  if (!code || code.length !== 6) {
    showVerificationError("Please enter a 6-digit code");
    return;
  }
  
  elements.verifyCodeBtn.disabled = true;
  elements.verifyCodeBtn.textContent = "Verifying...";
  
  try {
    const res = await fetch(`${VERIFICATION_URL}/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        email: state.userEmail, 
        code 
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      elements.codeStep.classList.add("hidden");
      elements.usernameStep.classList.remove("hidden");
      showVerificationSuccess("Email verified! Please choose a username.");
    } else {
      showVerificationError(data.error || "Invalid verification code");
      elements.verifyCodeBtn.disabled = false;
      elements.verifyCodeBtn.textContent = "✅ Verify Code";
    }
  } catch (error) {
    console.error("Verification error:", error);
    showVerificationError("Network error. Please try again.");
    elements.verifyCodeBtn.disabled = false;
    elements.verifyCodeBtn.textContent = "✅ Verify Code";
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
  localStorage.setItem("verifiedEmail", state.userEmail);
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
  elements.sendCodeBtn.disabled = false;
  elements.sendCodeBtn.textContent = "📧 Send Verification Code";
  showVerificationSuccess("You can request a new code");
}

function changeEmail() {
  elements.codeStep.classList.add("hidden");
  elements.emailStep.classList.remove("hidden");
  elements.verificationEmail.value = "";
  elements.verificationCode.value = "";
  elements.sendCodeBtn.disabled = false;
  elements.sendCodeBtn.textContent = "📧 Send Verification Code";
  state.userEmail = null;
}

function logout() {
  if (confirm("Are you sure you want to logout? You'll need to verify your email again.")) {
    localStorage.removeItem("verifiedEmail");
    localStorage.removeItem("username");
    state.userEmail = null;
    state.username = null;
    state.isVerified = false;
    
    elements.emailStep.classList.remove("hidden");
    elements.codeStep.classList.add("hidden");
    elements.usernameStep.classList.add("hidden");
    elements.verificationEmail.value = "";
    elements.verificationCode.value = "";
    elements.usernameInput.value = "";
    elements.sendCodeBtn.disabled = false;
    elements.sendCodeBtn.textContent = "📧 Send Verification Code";
    elements.verifyCodeBtn.disabled = false;
    elements.verifyCodeBtn.textContent = "✅ Verify Code";
    
    elements.verificationModal.classList.remove("hidden");
    showNotification("Logged out successfully");
    playSound('success');
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
   CHAT FUNCTIONS
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

  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.settings.model,
        messages: [
          {
            role: "system",
            content: "You are an AI assistant. Respond helpfully and accurately."
          },
          ...state.chats[state.currentChat].messages
            .slice(-15)
            .map(m => ({ role: m.role, content: m.content }))
        ],
        max_tokens: state.settings.maxTokens,
        temperature: state.settings.temperature
      })
    });

    if (!response.ok) {
      throw new Error(`Server error ${response.status}`);
    }

    const data = await response.json();

    let aiContent = "";
    if (data.content && Array.isArray(data.content)) {
      aiContent = data.content[0].text || "";
    } else if (data.choices?.[0]?.message) {
      aiContent = data.choices[0].message.content;
    } else if (data.text) {
      aiContent = data.text;
    }

    addMessage({
      role: "assistant",
      content: aiContent,
      time: now()
    });

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
    
    // Clear pending files after sending
    state.pendingFiles = [];
    if (elements.filePreviewArea) {
      elements.filePreviewArea.classList.add("hidden");
    }
    
    saveChats();
    playSound("success");
  }
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

function clearAllFiles() {
  state.pendingFiles = [];
  renderFilePreviews();
  showFilePreviewArea();
  showNotification("All files cleared");
  playSound('success');
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
   MODAL HELPERS
======================= */
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

/* =======================
   EVENT LISTENERS
======================= */
function setupEventListeners() {
  // Verification
  if (elements.sendCodeBtn) elements.sendCodeBtn.onclick = sendVerificationCode;
  if (elements.verifyCodeBtn) elements.verifyCodeBtn.onclick = verifyCode;
  if (elements.resendCodeBtn) elements.resendCodeBtn.onclick = resendCode;
  if (elements.changeEmailBtn) elements.changeEmailBtn.onclick = changeEmail;
  if (elements.completeSetupBtn) elements.completeSetupBtn.onclick = completeSetup;
  if (elements.logoutBtn) elements.logoutBtn.onclick = logout;
  
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
  
  // Chat input
  elements.sendBtn.onclick = () => {
    if (state.isGenerating) {
      state.isGenerating = false;
      elements.typing.style.opacity = 0;
      elements.sendBtn.textContent = "Send";
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
  
  elements.runArtifact.onclick = runArtifactCode;
  
  // Chat management
  const newChatBtn = document.getElementById("newChat");
  if (newChatBtn) {
    newChatBtn.onclick = () => {
      state.currentChat = createChat();
      loadChat(state.currentChat);
      showNotification("New chat created!");
      playSound('success');
    };
  }
  
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
  
  // Voice input
  const voiceBtn = document.getElementById("voiceInputBtn");
  if (voiceBtn) {
    voiceBtn.onclick = () => {
      startVoiceRecording();
    };
  }
  
  // File upload
  const fileBtn = document.getElementById("fileUploadBtn");
  if (fileBtn) {
    fileBtn.onclick = () => {
      handleFileUpload();
    };
  }
  
  // Clear all files
  if (elements.clearAllFiles) {
    elements.clearAllFiles.onclick = clearAllFiles;
  }
  
  // Quick responses
  document.querySelectorAll('.response-template').forEach(btn => {
    btn.onclick = () => {
      elements.input.value = btn.textContent;
      elements.input.focus();
      playSound('messageSent');
    };
  });
  
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
   ARTIFACT FUNCTIONS
======================= */
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
   WELCOME SCREEN
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
   INITIALIZATION
======================= */
function init() {
  checkVerification();
  loadSettingsToUI();
  setupSettingsEventListeners();
  setupEventListeners();
  setupWelcomeScreen();
  loadChat(state.currentChat);
  updateStats();
  updateUserDisplay();
  
  console.log("Quist AI app initialized with new settings system!");
}

// Start the app
init();