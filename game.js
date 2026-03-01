// ─── HARD-CODED FIREBASE CONFIG (edit once, never see config screen again) ───
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDtBEH5k1b-Q2E3zXTDgEC5BuqPUO1l7tA",           // ← replace this
  projectId: "team-poker-8b2f0",     // ← replace this
  databaseURL: "https://team-poker-8b2f0-default-rtdb.asia-southeast1.firebasedatabase.app"  // ← replace this
};

// ─── Load Firebase ────────────────────────────────────────────────────────────
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.onload = resolve;
    s.onerror = () => reject(new Error('Failed: ' + url));
    document.head.appendChild(s);
  });
}
async function loadFirebase() {
  try {
    await loadScript('firebase-compat.js');
    await loadScript('firebase-compat-database.js');
  } catch(e) { alert('Could not load Firebase SDK files.'); }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10, BIG_BLIND = 20;
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = Object.fromEntries(RANKS.map((r,i) => [r,i+2]));
const AVATARS = ['😎','🤠','🦊','🐯','🦁','🐸','🦄','🐲','👽','🤖','💀','🎭','🧙','🥷','👸','🤴'];
const BOT_NAMES = ['Alex','Jordan','Sam','Riley','Morgan','Casey'];
const BOT_AVATARS = ['🤖','👾','🎮','🃏','🎲','♟️'];

// ─── State ────────────────────────────────────────────────────────────────────
let db, roomRef, myId, myName, myAvatar = '😎', roomCode, isHost;
let localState = null;
let practiceMode = false;
let practiceState = null;
let botTimer = null;

// ─── Session ──────────────────────────────────────────────────────────────────
function saveSession() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ pokerSession: { myId, myName, myAvatar, roomCode, isHost } });
      return;
    }
  } catch(e) {}
  try { localStorage.setItem('pokerSession', JSON.stringify({ myId, myName, myAvatar, roomCode, isHost })); } catch {}
}
function clearSession() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove('pokerSession'); return;
    }
  } catch(e) {}
  try { localStorage.removeItem('pokerSession'); } catch {}
}
async function loadSession() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise(r => chrome.storage.local.get('pokerSession', d => r(d.pokerSession || null)));
    }
  } catch(e) {}
  try { return JSON.parse(localStorage.getItem('pokerSession') || 'null'); } catch { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2,10);
const randCode = () => Math.random().toString(36).slice(2,8).toUpperCase();

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function cardEl(card, faceDown=false, small=false) {
  const el = document.createElement('div');
  el.className = 'card' + (small?' small':'');
  if (faceDown||!card) { el.classList.add('back'); return el; }
  const red = card.suit==='♥'||card.suit==='♦';
  el.classList.add(red?'red':'black');
  el.innerHTML = `<span class="rank">${card.rank}</span><span class="suit">${card.suit}</span>`;
  return el;
}

// (rest of your original game.js continues exactly the same — I kept everything else unchanged)

function loadConfig() {
  return window.FIREBASE_CONFIG;   // now always uses the hardcoded one
}
function saveConfig() {} // no longer needed

// ... [the rest of the file is identical to the full version I sent you last time — buildGameScreen, practice mode, multiplayer, everything]
