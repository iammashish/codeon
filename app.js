import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

let auth = null;
let db = null;
let currentUser = null;
let sessions = [];
let activeSessionId = null;
let userMemory = localStorage.getItem("codeon_memory") || "";

if (FIREBASE_CONFIG.apiKey) {
  const app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);
}

const el = {
  workspace: document.getElementById("workspace"),
  sidebar: document.getElementById("sidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  openSidebarBtn: document.getElementById("openSidebarBtn"),
  closeSidebarBtn: document.getElementById("closeSidebarBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  chatList: document.getElementById("chatList"),
  currentChatTitle: document.getElementById("currentChatTitle"),
  messagesArea: document.getElementById("messagesArea"),
  welcomeScreen: document.getElementById("welcomeScreen"),
  heroUserName: document.getElementById("heroUserName"),
  topAvatarBtn: document.getElementById("topAvatarBtn"),
  avatarInitial: document.getElementById("avatarInitial"),
  chatForm: document.getElementById("chatForm"),
  promptInput: document.getElementById("promptInput"),
  sendBtn: document.getElementById("sendBtn"),
  clearPromptBtn: document.getElementById("clearPromptBtn"),
  insertSnippetBtn: document.getElementById("insertSnippetBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  authBtn: document.getElementById("authBtn"),
  userName: document.getElementById("userName"),
  userQuota: document.getElementById("userQuota"),
  openMemoryBtn: document.getElementById("openMemoryBtn"),
  quickMemoryBtn: document.getElementById("quickMemoryBtn"),
  quickSandboxBtn: document.getElementById("quickSandboxBtn"),
  memoryModal: document.getElementById("memoryModal"),
  closeMemoryBtn: document.getElementById("closeMemoryBtn"),
  memoryInput: document.getElementById("memoryInput"),
  saveMemoryBtn: document.getElementById("saveMemoryBtn"),
  previewModal: document.getElementById("previewModal"),
  closePreviewBtn: document.getElementById("closePreviewBtn"),
  sandboxFrame: document.getElementById("sandboxFrame")
};

// Theme toggle
const savedTheme = localStorage.getItem("codeon_theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);

el.themeToggleBtn.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("codeon_theme", next);
});

// Sidebar controls
function toggleSidebar(open) {
  el.sidebar.classList.toggle("open", open);
  el.sidebarOverlay.classList.toggle("hidden", !open);
}
el.openSidebarBtn.addEventListener("click", () => toggleSidebar(true));
el.closeSidebarBtn.addEventListener("click", () => toggleSidebar(false));
el.sidebarOverlay.addEventListener("click", () => toggleSidebar(false));

// Memory modal
function openMemory() {
  el.memoryInput.value = userMemory;
  el.memoryModal.classList.remove("hidden");
}
el.openMemoryBtn.addEventListener("click", openMemory);
el.quickMemoryBtn.addEventListener("click", openMemory);
el.closeMemoryBtn.addEventListener("click", () => el.memoryModal.classList.add("hidden"));
el.saveMemoryBtn.addEventListener("click", async () => {
  userMemory = el.memoryInput.value.trim();
  localStorage.setItem("codeon_memory", userMemory);
  if (db && currentUser) {
    await setDoc(doc(db, "users", currentUser.uid), { memory: userMemory }, { merge: true });
  }
  el.memoryModal.classList.add("hidden");
});

// Sandbox modal
el.quickSandboxBtn.addEventListener("click", () => {
  el.sandboxFrame.srcdoc = `<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;color:#334155;"><h3>Codeon Live Sandbox Ready — Run any HTML/JS snippet from chat!</h3></body></html>`;
  el.previewModal.classList.remove("hidden");
});
el.closePreviewBtn.addEventListener("click", () => {
  el.sandboxFrame.srcdoc = "";
  el.previewModal.classList.add("hidden");
});

// Prompt tools
el.clearPromptBtn.addEventListener("click", () => {
  el.promptInput.value = "";
  el.promptInput.focus();
});
el.insertSnippetBtn.addEventListener("click", () => {
  el.promptInput.value += "\n```\n\n```";
  el.promptInput.focus();
});

// Sessions
async function loadSessions() {
  if (db && currentUser) {
    const snap = await getDocs(collection(db, "users", currentUser.uid, "sessions"));
    sessions = snap.docs.map((d) => d.data()).sort((a, b) => b.updatedAt - a.updatedAt);
    const profile = await getDoc(doc(db, "users", currentUser.uid));
    if (profile.exists() && profile.data().memory !== undefined) {
      userMemory = profile.data().memory;
    }
  } else {
    sessions = JSON.parse(localStorage.getItem("codeon_sessions") || "[]");
  }
  renderSidebar();
  createNewSession();
}

async function saveSession(session) {
  session.updatedAt = Date.now();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  else sessions.unshift(session);

  if (db && currentUser) {
    await setDoc(doc(db, "users", currentUser.uid, "sessions", session.id), session);
  } else {
    localStorage.setItem("codeon_sessions", JSON.stringify(sessions));
  }
  renderSidebar();
}

function createNewSession() {
  const id = "sess_" + Date.now();
  const session = { id, title: "New Session", messages: [], updatedAt: Date.now() };
  sessions.unshift(session);
  activeSessionId = id;
  renderSidebar();
  renderMessages();
  toggleSidebar(false);
}

function selectSession(id) {
  activeSessionId = id;
  renderSidebar();
  renderMessages();
  toggleSidebar(false);
}

function renderSidebar() {
  el.chatList.innerHTML = "";
  sessions.forEach((s) => {
    const item = document.createElement("div");
    item.className = "chat-item" + (s.id === activeSessionId ? " active" : "");
    item.textContent = s.title;
    item.addEventListener("click", () => selectSession(s.id));
    el.chatList.appendChild(item);
  });
}

function renderMessages() {
  const session = sessions.find((s) => s.id === activeSessionId);
  el.messagesArea.innerHTML = "";

  if (!session || session.messages.length === 0) {
    el.workspace.classList.remove("mode-chat");
    el.workspace.classList.add("mode-home");
    el.currentChatTitle.textContent = "";
    el.promptInput.rows = 2;
    el.messagesArea.appendChild(el.welcomeScreen);
    return;
  }

  el.workspace.classList.remove("mode-home");
  el.workspace.classList.add("mode-chat");
  el.currentChatTitle.textContent = session.title;
  el.promptInput.rows = 1;

  session.messages.forEach((m) => appendThreadItem(m.role, m.content));
  el.messagesArea.scrollTop = el.messagesArea.scrollHeight;
}

function appendThreadItem(role, content) {
  const item = document.createElement("div");
  item.className = "thread-item";

  const header = document.createElement("div");
  header.className = "thread-header";

  if (role === "user") {
    const first = currentUser?.displayName ? currentUser.displayName.split(" ")[0] : "You";
    header.innerHTML = `<span class="thread-avatar">${escapeHtml(first[0].toUpperCase())}</span><span>${escapeHtml(first)}</span>`;
  } else {
    header.innerHTML = `<span class="thread-avatar ai">◈</span><span>Codeon</span>`;
  }

  const body = document.createElement("div");
  body.className = "thread-body";

  if (role === "user") {
    body.textContent = content;
  } else {
    const rawHtml = marked.parse(content);
    body.innerHTML = DOMPurify.sanitize(rawHtml);
    enhanceCodeBlocks(body);
  }

  item.appendChild(header);
  item.appendChild(body);

  if (role === "assistant" && content !== "Thinking...") {
    const actions = document.createElement("div");
    actions.className = "thread-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-action-btn";
    copyBtn.textContent = "❐ Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(content);
      copyBtn.textContent = "✓ Copied";
      setTimeout(() => (copyBtn.textContent = "❐ Copy"), 1400);
    });
    actions.appendChild(copyBtn);
    item.appendChild(actions);
  }

  el.messagesArea.appendChild(item);
  el.messagesArea.scrollTop = el.messagesArea.scrollHeight;
  return body;
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll("pre code").forEach((block) => {
    hljs.highlightElement(block);
    const pre = block.parentElement;
    const langClass = [...block.classList].find((c) => c.startsWith("language-")) || "language-code";
    const lang = langClass.replace("language-", "");
    const rawCode = block.textContent;

    const wrapper = document.createElement("div");
    wrapper.className = "code-wrapper";

    const header = document.createElement("div");
    header.className = "code-header";
    header.innerHTML = `<span>${escapeHtml(lang.toUpperCase())}</span>`;

    const actions = document.createElement("div");
    actions.className = "code-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "code-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(rawCode);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    });
    actions.appendChild(copyBtn);

    if (["html", "xml", "svg", "javascript", "js"].includes(lang.toLowerCase())) {
      const runBtn = document.createElement("button");
      runBtn.className = "code-btn run-btn";
      runBtn.textContent = "▶ Run";
      runBtn.addEventListener("click", () => {
        const docHtml = lang.toLowerCase().includes("js")
          ? `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:16px;"><script>${rawCode}<\/script></body></html>`
          : rawCode;
        el.sandboxFrame.srcdoc = docHtml;
        el.previewModal.classList.remove("hidden");
      });
      actions.appendChild(runBtn);
    }

    header.appendChild(actions);
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

async function sendMessage(text) {
  const prompt = text.trim();
  if (!prompt) return;

  let session = sessions.find((s) => s.id === activeSessionId);
  if (!session) {
    createNewSession();
    session = sessions.find((s) => s.id === activeSessionId);
  }

  if (session.messages.length === 0) {
    session.title = prompt.slice(0, 32) + (prompt.length > 32 ? "..." : "");
    el.welcomeScreen.remove();
    el.workspace.classList.remove("mode-home");
    el.workspace.classList.add("mode-chat");
    el.currentChatTitle.textContent = session.title;
    el.promptInput.rows = 1;
  }

  session.messages.push({ role: "user", content: prompt });
  appendThreadItem("user", prompt);
  el.promptInput.value = "";
  el.sendBtn.disabled = true;

  const thinkingBody = appendThreadItem("assistant", "Thinking...");

  try {
    const token = currentUser ? await currentUser.getIdToken() : "";
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        messages: session.messages,
        memory: userMemory
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");

    thinkingBody.parentElement.remove();
    session.messages.push({ role: "assistant", content: data.reply });
    appendThreadItem("assistant", data.reply);

    if (data.remaining !== undefined) {
      el.userQuota.textContent = data.isOwner ? "Owner • Unlimited" : `${data.remaining} msgs left today`;
    }
    await saveSession(session);
  } catch (err) {
    thinkingBody.textContent = "Error: " + err.message;
  } finally {
    el.sendBtn.disabled = false;
  }
}

el.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(el.promptInput.value);
});

el.promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(el.promptInput.value);
  }
});

document.querySelectorAll(".starter-chip").forEach((chip) => {
  chip.addEventListener("click", () => sendMessage(chip.dataset.prompt));
});

el.newChatBtn.addEventListener("click", createNewSession);

function triggerAuth() {
  if (!auth) {
    alert("Add your Firebase Web Config in app.js to enable Google Sign-In & Cloud Sync!");
    return;
  }
  if (currentUser) signOut(auth);
  else signInWithPopup(auth, new GoogleAuthProvider());
}

el.authBtn.addEventListener("click", triggerAuth);
el.topAvatarBtn.addEventListener("click", triggerAuth);

if (auth) {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
      const firstName = (user.displayName || "Coder").split(" ")[0];
      el.userName.textContent = user.displayName || user.email;
      el.heroUserName.textContent = firstName;
      el.authBtn.textContent = "Sign Out";
      if (user.photoURL) {
        el.topAvatarBtn.innerHTML = `<img src="${user.photoURL}" alt="User" />`;
      } else {
        el.avatarInitial.textContent = firstName[0].toUpperCase();
      }
    } else {
      el.userName.textContent = "Guest Coder";
      el.heroUserName.textContent = "Coder";
      el.authBtn.textContent = "Sign In";
      el.topAvatarBtn.innerHTML = `<span id="avatarInitial">C</span>`;
    }
    loadSessions();
  });
} else {
  loadSessions();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
