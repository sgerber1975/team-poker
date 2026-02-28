<!-- FULL CORRECTED game.js -->
<!-- Copy everything below this line and replace your entire game.js file -->

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

function loadConfig() {
  if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) return window.FIREBASE_CONFIG;
  try { return JSON.parse(localStorage.getItem('pokerFirebaseConfig') || 'null'); } catch { return null; }
}
function saveConfig(cfg) { localStorage.setItem('pokerFirebaseConfig', JSON.stringify(cfg)); }

function buildAvatarPicker(containerId) {
  const c = $(containerId); if (!c) return;
  c.innerHTML = '';
  AVATARS.forEach(av => {
    const d = document.createElement('div');
    d.className = 'av-opt' + (av===myAvatar?' selected':'');
    d.textContent = av;
    d.onclick = () => { 
      myAvatar = av; 
      c.querySelectorAll('.av-opt').forEach(x => x.classList.remove('selected')); 
      d.classList.add('selected'); 
    };
    c.appendChild(d);
  });
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
async function updateLeaderboard(players) {
  if (practiceMode || !db) return;
  const lbRef = db.ref('leaderboard');
  const snap = await lbRef.once('value');
  const current = snap.val() || {};
  players.forEach(p => {
    if (p.isBot) return;
    const key = p.name.replace(/[.#$[\]]/g, '_');
    const prev = current[key] || { name: p.name, avatar: p.avatar || '😎', bestChips: 0 };
    if (p.chips > prev.bestChips) current[key] = { name: p.name, avatar: p.avatar || '😎', bestChips: p.chips };
  });
  await lbRef.set(current);
}

function listenLeaderboard() {
  if (practiceMode || !db) { renderLeaderboard([]); return; }
  db.ref('leaderboard').on('value', snap => {
    const data = snap.val() || {};
    renderLeaderboard(Object.values(data).sort((a,b) => b.bestChips - a.bestChips).slice(0,10));
  });
}

function renderLeaderboard(entries) {
  const lb = $('leaderboard'); if (!lb) return;
  const medals = ['🥇','🥈','🥉'];
  const rankClass = ['gold','silver','bronze'];
  lb.innerHTML = '<h3>🏆 Top 10</h3>';
  if (!entries.length) { lb.innerHTML += '<div class="lb-empty">No data yet</div>'; return; }
  entries.forEach((e, i) => {
    const row = document.createElement('div'); row.className = 'lb-row';
    row.innerHTML = `<span class="lb-rank ${rankClass[i]||''}">${medals[i]||i+1}</span><span class="lb-avatar">${e.avatar||'😎'}</span><span class="lb-name">${e.name}</span><span class="lb-chips">💰${e.bestChips}</span>`;
    lb.appendChild(row);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  await loadFirebase();
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey) { showScreen('screen-config'); setupConfigScreen(); return; }
  initFirebase(cfg);
  const session = await loadSession();
  if (session && session.roomCode) {
    myId = session.myId; myName = session.myName;
    myAvatar = session.myAvatar || '😎'; roomCode = session.roomCode; isHost = session.isHost;
    roomRef = db.ref('rooms/' + roomCode);
    roomRef.once('value', snap => {
      const data = snap.val();
      if (!data) { clearSession(); showScreen('screen-lobby'); setupLobby(); return; }
      if (data.status === 'waiting') {
        $('room-code-display').textContent = roomCode;
        if (isHost) $('btn-start').classList.remove('hidden');
        showScreen('screen-waiting'); listenWaiting();
      } else if (data.status === 'playing') { startListeningGame(); }
      else { clearSession(); showScreen('screen-lobby'); }
      setupLobby();
    });
  } else { showScreen('screen-lobby'); setupLobby(); }
  setupConfigScreen();
});

function setupConfigScreen() {
  const btn = $('btn-save-config'); if (!btn) return;
  btn.onclick = async () => {
    const cfg = { apiKey: $('cfg-apiKey').value.trim(), projectId: $('cfg-projectId').value.trim(), databaseURL: $('cfg-dbUrl').value.trim() };
    if (!cfg.apiKey||!cfg.projectId||!cfg.databaseURL) return alert('Fill all fields');
    saveConfig(cfg); await loadFirebase(); initFirebase(cfg);
    showScreen('screen-lobby'); setupLobby();
  };
}

function setupLobby() {
  buildAvatarPicker('avatar-picker');
  const resetBtn = $('btn-reset-config');
  if (resetBtn) {
    if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) resetBtn.style.display = 'none';
    else resetBtn.onclick = () => { localStorage.removeItem('pokerFirebaseConfig'); clearSession(); showScreen('screen-config'); };
  }
  $('btn-host').onclick = hostGame;
  $('btn-join').onclick = joinGame;
  $('btn-practice').onclick = startPractice;
  $('btn-start').onclick = startGame;
  $('btn-leave-waiting').onclick = () => {
    if (roomRef) { roomRef.off(); if (isHost) roomRef.remove(); }
    clearSession(); showScreen('screen-lobby');
  };
}

function initFirebase(cfg) {
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  db = firebase.database();
}

// ─── Practice Mode ────────────────────────────────────────────────────────────
function startPractice() {
  myName = $('inp-name').value.trim();
  if (!myName) return alert('Enter your name first');
  practiceMode = true;
  isHost = true;
  myId = 'player_me';

  const bots = BOT_NAMES.map((name, i) => ({
    id: 'bot_' + i, name, avatar: BOT_AVATARS[i],
    chips: STARTING_CHIPS, isBot: true
  }));
  const me = { id: myId, name: myName, avatar: myAvatar, chips: STARTING_CHIPS, isBot: false };
  const players = [me, ...bots];

  practiceState = buildGameState(players, 0);
  startPracticeGame();
}

function buildGameState(players, dealerIdx) {
  const deck = shuffle(makeDeck());
  const pArr = players.filter(p => p.chips > 0);
  const n = pArr.length;
  const sbIdx = (dealerIdx+1)%n, bbIdx = (dealerIdx+2)%n;
  const hands={}, bets={}, stacks={};
  pArr.forEach(p => { hands[p.id]=[deck.pop(),deck.pop()]; bets[p.id]=0; stacks[p.id]=p.chips; });
  const community = [deck.pop(),deck.pop(),deck.pop(),deck.pop(),deck.pop()];
  bets[pArr[sbIdx].id] = Math.min(SMALL_BLIND, stacks[pArr[sbIdx].id]);
  stacks[pArr[sbIdx].id] -= bets[pArr[sbIdx].id];
  bets[pArr[bbIdx].id] = Math.min(BIG_BLIND, stacks[pArr[bbIdx].id]);
  stacks[pArr[bbIdx].id] -= bets[pArr[bbIdx].id];
  return {
    phase:'preflop', dealerIdx, sbIdx, bbIdx,
    players:pArr, playerOrder:pArr.map(p=>p.id),
    hands, community, bets, stacks, pot:0,
    currentBet:BIG_BLIND, actionIdx:(bbIdx+1)%n,
    actionsThisRound:0, folded:{}, allin:{}, log:[]
  };
}

function startPracticeGame() {
  showScreen('screen-game');
  buildGameScreen();
  scaleGameScreen();
  window.onresize = scaleGameScreen;
  renderGame(practiceState);
  scheduleBotAction();
}

function scheduleBotAction() {
  if (!practiceMode || !practiceState) return;
  const g = practiceState;
  const currentPlayer = g.players[g.actionIdx];
  if (!currentPlayer || currentPlayer.id === myId || g.folded[currentPlayer.id]) return;
  if (g.phase === 'showdown') return;
  if (botTimer) clearTimeout(botTimer);
  botTimer = setTimeout(() => doBotAction(g, currentPlayer), 1200);
}

function doBotAction(g, bot) {
  if (!practiceMode) return;
  const hand = g.hands[bot.id];
  const community = g.community.slice(0, {preflop:0,flop:3,turn:4,river:5}[g.phase]||0);
  const strength = evaluateHandStrength(hand, community);
  const toCall = (g.currentBet||0) - (g.bets[bot.id]||0);
  const rand = Math.random();

  if (strength < 0.2) {
    if (toCall === 0) addLog(g, `${bot.name} checks`);
    else if (rand < 0.15 && toCall < g.stacks[bot.id] * 0.3) {
      const ca = Math.min(toCall, g.stacks[bot.id]);
      g.stacks[bot.id] -= ca; g.bets[bot.id] = (g.bets[bot.id]||0) + ca;
      if (g.stacks[bot.id]===0) g.allin[bot.id]=true;
      addLog(g, `${bot.name} calls ${ca}`);
    } else {
      g.folded[bot.id] = true; addLog(g, `${bot.name} folds`);
    }
  } else if (strength < 0.5) {
    if (toCall === 0) addLog(g, `${bot.name} checks`);
    else if (toCall <= g.stacks[bot.id] * 0.4) {
      const ca = Math.min(toCall, g.stacks[bot.id]);
      g.stacks[bot.id] -= ca; g.bets[bot.id] = (g.bets[bot.id]||0) + ca;
      if (g.stacks[bot.id]===0) g.allin[bot.id]=true;
      addLog(g, `${bot.name} calls ${ca}`);
    } else {
      g.folded[bot.id] = true; addLog(g, `${bot.name} folds`);
    }
  } else if (strength < 0.75) {
    if (rand < 0.4 && g.stacks[bot.id] > g.currentBet * 2) {
      const raiseAmt = Math.min(Math.floor(g.currentBet * 1.5 + rand * 50), g.stacks[bot.id] + (g.bets[bot.id]||0));
      const diff = raiseAmt - (g.bets[bot.id]||0);
      if (diff > 0 && diff <= g.stacks[bot.id] && raiseAmt > g.currentBet) {
        g.stacks[bot.id] -= diff; g.bets[bot.id] = raiseAmt; g.currentBet = raiseAmt;
        if (g.stacks[bot.id]===0) g.allin[bot.id]=true;
        addLog(g, `${bot.name} raises to ${raiseAmt}`);
      } else {
        const ca = Math.min(toCall, g.stacks[bot.id]);
        g.stacks[bot.id] -= ca; g.bets[bot.id] = (g.bets[bot.id]||0) + ca;
        if (g.stacks[bot.id]===0) g.allin[bot.id]=true;
        addLog(g, `${bot.name} calls ${ca}`);
      }
    } else {
      const ca = Math.min(toCall||0, g.stacks[bot.id]);
      g.stacks[bot.id] -= ca; g.bets[bot.id] = (g.bets[bot.id]||0) + ca;
      if (g.stacks[bot.id]===0) g.allin[bot.id]=true;
      addLog(g, toCall > 0 ? `${bot.name} calls ${ca}` : `${bot.name} checks`);
    }
  } else {
    const raiseAmt = Math.min(Math.floor(g.currentBet * 2 + rand * 100), g.stacks[bot.id] + (g.bets[bot.id]||0));
    const diff = raiseAmt - (g.bets[bot.id]||0);
    if (diff > 0 && diff <= g.stacks[bot.id] && raiseAmt > g.currentBet) {
      g.stacks[bot.id] -= diff; g.bets[bot.id] = raiseAmt; g.currentBet = raiseAmt;
      if (g.stacks[bot.id]===0) g.allin[bot.id]=true;
      addLog(g, `${bot.name} raises to ${raiseAmt}`);
    } else {
      const ca = Math.min(toCall||0, g.stacks[bot.id]);
      g.stacks[bot.id] -= ca; g.bets[bot.id] = (g.bets[bot.id]||0) + ca;
      if (g.stacks[bot.id]===0) g.allin[bot.id]=true;
      addLog(g, toCall > 0 ? `${bot.name} calls ${ca}` : `${bot.name} checks`);
    }
  }

  advanceAction(g);
  practiceState = g;
  renderGame(g);
  if (g.phase !== 'showdown') scheduleBotAction();
  else setTimeout(() => showShowdownOverlay(g), 800);
}

function evaluateHandStrength(hand, community) {
  const allCards = [...hand, ...community];
  if (allCards.length >= 5) {
    const h = bestHand(allCards);
    return Math.min(1, (h.rank / 9) * 0.7 + Math.max(...hand.map(c=>RANK_VAL[c.rank])) / 56 * 0.3);
  }
  const vals = hand.map(c => RANK_VAL[c.rank]);
  const isPair = vals[0] === vals[1];
  const highCard = Math.max(...vals);
  const suited = hand[0].suit === hand[1].suit;
  let score = highCard / 28;
  if (isPair) score += 0.3;
  if (suited) score += 0.1;
  return Math.min(1, score);
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
function hostGame() {
  myName = $('inp-name').value.trim();
  if (!myName) return alert('Enter your name');
  practiceMode = false;
  myId = uid(); isHost = true; roomCode = randCode();
  roomRef = db.ref('rooms/' + roomCode);
  roomRef.set({ host: myId, status: 'waiting', players: { [myId]: { name: myName, avatar: myAvatar, chips: STARTING_CHIPS, id: myId } } });
  saveSession();
  $('room-code-display').textContent = roomCode;
  $('btn-start').classList.remove('hidden');
  showScreen('screen-waiting'); listenWaiting();
}

function joinGame() {
  myName = $('inp-name').value.trim();
  roomCode = $('inp-room').value.trim().toUpperCase();
  if (!myName) return alert('Enter your name');
  if (!roomCode) return alert('Enter a room code');
  practiceMode = false;
  myId = uid(); isHost = false;
  roomRef = db.ref('rooms/' + roomCode);
  roomRef.once('value', snap => {
    const data = snap.val();
    if (!data) return alert('Room not found');
    if (data.status !== 'waiting') return alert('Game already started');
    if (Object.keys(data.players||{}).length >= 20) return alert('Room full');
    roomRef.child('players/' + myId).set({ name: myName, avatar: myAvatar, chips: STARTING_CHIPS, id: myId });
    saveSession();
    $('room-code-display').textContent = roomCode;
    showScreen('screen-waiting'); listenWaiting();
  });
}

function listenWaiting() {
  roomRef.on('value', snap => {
    const data = snap.val(); if (!data) return;
    if (data.status === 'playing') { roomRef.off(); startListeningGame(); return; }
    const players = data.players || {};
    const list = $('player-list'); list.innerHTML = '';
    Object.values(players).forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'player-chip' + (p.id===data.host?' host':'');
      chip.textContent = (p.avatar||'😎') + ' ' + p.name;
      list.appendChild(chip);
    });
    $('wait-msg').textContent = `${Object.keys(players).length} player(s) joined`;
  });
}

// ─── Deck ─────────────────────────────────────────────────────────────────────
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({rank:r,suit:s});
  return d;
}
function shuffle(d) {
  for (let i=d.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}

// ─── Hand evaluation ──────────────────────────────────────────────────────────
function bestHand(cards) {
  const combos = choose5(cards); let best = null;
  for (const c of combos) { const v=evalHand(c); if (!best||compareHandVal(v,best)>0) best=v; }
  return best;
}
function choose5(cards) {
  if (cards.length===5) return [cards]; const res=[];
  for (let i=0;i<cards.length;i++) for (let j=i+1;j<cards.length;j++)
    for (let k=j+1;k<cards.length;k++) for (let l=k+1;l<cards.length;l++)
      for (let m=l+1;m<cards.length;m++) res.push([cards[i],cards[j],cards[k],cards[l],cards[m]]);
  return res;
}
function evalHand(cards) {
  const vals=cards.map(c=>RANK_VAL[c.rank]).sort((a,b)=>b-a);
  const suits=cards.map(c=>c.suit);
  const flush=suits.every(s=>s===suits[0]), straight=isStraight(vals);
  const counts={}; vals.forEach(v=>counts[v]=(counts[v]||0)+1);
  const g=Object.entries(counts).sort((a,b)=>b[1]-a[1]||b[0]-a[0]).map(x=>+x[1]);
  if (flush&&straight) return {rank:vals[0]===14&&vals[1]===13?9:8,name:vals[0]===14&&vals[1]===13?'Royal Flush':'Straight Flush',vals};
  if (g[0]===4) return {rank:7,name:'Four of a Kind',vals};
  if (g[0]===3&&g[1]===2) return {rank:6,name:'Full House',vals};
  if (flush) return {rank:5,name:'Flush',vals};
  if (straight) return {rank:4,name:'Straight',vals};
  if (g[0]===3) return {rank:3,name:'Three of a Kind',vals};
  if (g[0]===2&&g[1]===2) return {rank:2,name:'Two Pair',vals};
  if (g[0]===2) return {rank:1,name:'One Pair',vals};
  return {rank:0,name:'High Card',vals};
}
function isStraight(vals) {
  const u=[...new Set(vals)].sort((a,b)=>b-a);
  if (u.length<5) return false;
  if (u[0]-u[4]===4) return true;
  return u[0]===14&&u[1]===5&&u[2]===4&&u[3]===3&&u[4]===2;
}
function compareHandVal(a,b) {
  if (a.rank!==b.rank) return a.rank-b.rank;
  for (let i=0;i<a.vals.length;i++) if (a.vals[i]!==b.vals[i]) return a.vals[i]-b.vals[i];
  return 0;
}

// ─── Start / Deal (multiplayer) ───────────────────────────────────────────────
function startGame() {
  roomRef.once('value', snap => {
    const data = snap.val();
    const players = Object.values(data.players||{});
    if (players.length<2) return alert('Need at least 2 players');
    dealRound(players, 0);
  });
}

function dealRound(players, dealerIdx) {
  const g = buildGameState(players, dealerIdx);
  roomRef.set({ host:myId, status:'playing', game:g });
}

// ─── Seat positioning ─────────────────────────────────────────────────────────
function seatPosition(idx, total) {
  const angle = (Math.PI * 2 * idx / total) - Math.PI/2;
  const rx = 36, ry = 30;
  const cx = 50, cy = 46;
  return {
    left: cx + rx * Math.cos(angle),
    top:  cy + ry * Math.sin(angle)
  };
}

// ─── Game screen builder (FIXED) ──────────────────────────────────────────────
function buildGameScreen() {
  $('screen-game').innerHTML = `
    <div id="game-header">
      <span id="hdr-room">${practiceMode ? '🤖 Practice Mode' : 'Room: ' + (roomCode || '—')}</span>
      <span id="hdr-phase"></span>
      <button id="btn-menu" class="small">☰ Menu</button>
    </div>
    <div id="game-menu" class="hidden">
      ${(isHost||practiceMode) ? '<button id="btn-next-round-menu">▶ Next Round</button>' : ''}
      ${(isHost||practiceMode) ? '<button id="btn-end-game">🏁 End Game</button>' : ''}
      <button id="btn-leave-menu">🚪 Leave Table</button>
      <button id="btn-close-menu" class="small">✕ Close</button>
    </div>
    <div id="table-felt">
      <div id="pot-display">Pot: 0</div>
      <div id="community-cards"></div>
      <div id="phase-badge"></div>
    </div>
    <div id="seats-layer"></div>
    <div id="my-area">
      <div id="my-cards"></div>
      <div id="action-area">
        <div id="action-btns" class="hidden">
          <button id="btn-fold">Fold</button>
          <button id="btn-check">Check</button>
          <button id="btn-call">Call <span id="call-amt"></span></button>
          <div class="raise-row">
            <input id="raise-inp" type="number" placeholder="Raise to" />
            <button id="btn-raise">Raise</button>
          </div>
        </div>
        <p id="turn-msg"></p>
      </div>
    </div>
    <div id="log-area"><div id="log"></div></div>
  `;

  // Button bindings
  $('btn-fold').onclick = () => practiceMode ? doPracticeAction('fold') : doAction('fold');
  $('btn-check').onclick = () => practiceMode ? doPracticeAction('check') : doAction('check');
  $('btn-call').onclick = () => practiceMode ? doPracticeAction('call') : doAction('call');
  $('btn-raise').onclick = () => {
    const a = parseInt($('raise-inp').value);
    if (a > 0) practiceMode ? doPracticeAction('raise', a) : doAction('raise', a);
  };

  $('btn-menu').onclick = () => $('game-menu').classList.toggle('hidden');
  $('btn-close-menu').onclick = () => $('game-menu').classList.add('hidden');
  $('btn-leave-menu').onclick = () => { $('game-menu').classList.add('hidden'); leaveGame(); };

  if ($('btn-next-round-menu')) $('btn-next-round-menu').onclick = () => { $('game-menu').classList.add('hidden'); nextRound(); };
  if ($('btn-end-game')) $('btn-end-game').onclick = async () => {
    if (!confirm('End the game?')) return;
    if (!practiceMode && roomRef) await roomRef.update({ status: 'ended' });
    leaveGame();
  };
}

// ─── Scale game screen ────────────────────────────────────────────────────────
function scaleGameScreen() {
  const el = $('screen-game');
  if (!el) return;
  const scaleX = window.innerWidth / 1100;
  const scaleY = window.innerHeight / 620;
  const scale = Math.min(scaleX, scaleY);
  el.style.transform = `scale(${scale})`;
  el.style.marginLeft = ((window.innerWidth - 1100 * scale) / 2) + 'px';
  el.style.marginTop = ((window.innerHeight - 620 * scale) / 2) + 'px';
}

// ─── Game listener ────────────────────────────────────────────────────────────
function startListeningGame() {
  showScreen('screen-game');
  buildGameScreen();
  scaleGameScreen();
  window.onresize = scaleGameScreen;
  listenLeaderboard();
  roomRef.on('value', snap => {
    const data = snap.val(); if (!data||!data.game) return;
    localState = data; renderGame(data.game);
  });
}

function renderGame(g) {
  const potTotal = Object.values(g.bets||{}).reduce((a,b)=>a+b,0)+(g.pot||0);
  if ($('pot-display')) $('pot-display').textContent = '💰 Pot: ' + potTotal;
  if ($('hdr-phase')) $('hdr-phase').textContent = (g.phase||'').toUpperCase();
  if ($('phase-badge')) $('phase-badge').textContent = (g.phase||'').toUpperCase();

  const cc = $('community-cards');
  if (cc) {
    cc.innerHTML = '';
    const reveal = {preflop:0,flop:3,turn:4,river:5,showdown:5}[g.phase]||0;
    for (let i=0;i<5;i++) cc.appendChild(i<reveal ? cardEl(g.community[i]) : cardEl(null,true));
  }

  const seatsLayer = $('seats-layer'); if (!seatsLayer) return;
  seatsLayer.innerHTML = '';
  const players = g.players||[];
  const myIdx = (g.playerOrder||[]).indexOf(myId);
  const rotated = [];
  for (let i=0;i<players.length;i++) rotated.push(players[(myIdx+i)%players.length]);

  rotated.forEach((p, i) => {
    if (!p||!p.id) return;
    const origIdx = players.indexOf(p);
    const pos = seatPosition(i, players.length);
    const seat = document.createElement('div');
    seat.className = 'seat';
    if (origIdx===g.actionIdx && !(g.folded||{})[p.id]) seat.classList.add('active-turn');
    if ((g.folded||{})[p.id]) seat.classList.add('folded');
    if (p.id===myId) seat.classList.add('is-me');
    seat.style.left = pos.left + '%';
    seat.style.top  = pos.top  + '%';
    const bet = (g.bets||{})[p.id]||0;
    const status = (g.folded||{})[p.id]?'Folded':(g.allin||{})[p.id]?'All-in':'';
    seat.innerHTML = `
      <div class="seat-avatar">${p.avatar||'😎'}${origIdx===g.dealerIdx?'<div class="dealer-btn">D</div>':''}</div>
      <div class="seat-name">${p.id===myId?'⭐ ':''}${p.name}${p.isBot?' 🤖':''}</div>
      <div class="seat-chips">💰 ${(g.stacks||{})[p.id]||0}</div>
      ${bet>0?`<div class="seat-bet">Bet: ${bet}</div>`:''}
      ${status?`<div class="seat-status">${status}</div>`:''}
    `;

    const cardRow = document.createElement('div');
    cardRow.className = 'seat-cards';
    if (p.id === myId) {
      const myHand = g.hands&&g.hands[myId];
      if (myHand) myHand.forEach(c => cardRow.appendChild(cardEl(c,false,true)));
    } else if (g.phase==='showdown' && g.hands&&g.hands[p.id] && !(g.folded||{})[p.id]) {
      g.hands[p.id].forEach(c => cardRow.appendChild(cardEl(c,false,true)));
    } else if (!(g.folded||{})[p.id]) {
      cardRow.appendChild(cardEl(null,true,true));
      cardRow.appendChild(cardEl(null,true,true));
    }
    seat.appendChild(cardRow);
    seatsLayer.appendChild(seat);
  });

  const mc = $('my-cards'); if (mc) mc.innerHTML = '';

  const isMyTurn = myIdx>=0 && g.actionIdx===myIdx && !(g.folded||{})[myId] && g.phase!=='showdown';
  const ab = $('action-btns'), tm = $('turn-msg');
  if (!ab||!tm) return;
  if (isMyTurn) {
    ab.classList.remove('hidden'); tm.textContent = '⭐ Your turn!';
    const toCall=(g.currentBet||0)-(g.bets[myId]||0);
    if ($('call-amt')) $('call-amt').textContent = toCall>0?`(${toCall})`:'';
    $('btn-check').disabled = toCall>0; $('btn-call').disabled = toCall<=0;
    if ($('raise-inp')) $('raise-inp').placeholder=`Min ${(g.currentBet||0)+1}`;
  } else {
    ab.classList.add('hidden');
    const ap = players[g.actionIdx];
    tm.textContent = g.phase==='showdown'?'':(ap?`Waiting for ${ap.name}...`:'');
  }

  if (g.log&&g.log.length) {
    const logDiv=$('log'); if (!logDiv) return;
    logDiv.innerHTML='';
    g.log.slice(-15).forEach(l=>{ const p=document.createElement('p'); if(l.important) p.className='important'; p.textContent=l.msg; logDiv.appendChild(p); });
    logDiv.scrollTop=logDiv.scrollHeight;
  }

  if (g.phase==='showdown') setTimeout(()=>showShowdownOverlay(g), 800);
}

// ─── Player actions ───────────────────────────────────────────────────────────
function doPracticeAction(type, amount) {
  const g = practiceState; if (!g) return;
  const myIdx = (g.playerOrder||[]).indexOf(myId);
  if (g.actionIdx !== myIdx) return;
  const toCall = (g.currentBet||0)-(g.bets[myId]||0);

  if (type==='fold') { g.folded[myId]=true; addLog(g,`${myName} folds`); }
  else if (type==='check') { if(toCall>0) return; addLog(g,`${myName} checks`); }
  else if (type==='call') {
    const ca=Math.min(toCall,g.stacks[myId]);
    g.stacks[myId]-=ca; g.bets[myId]=(g.bets[myId]||0)+ca;
    if(g.stacks[myId]===0) g.allin[myId]=true;
    addLog(g,`${myName} calls ${ca}`);
  } else if (type==='raise') {
    if(amount<=g.currentBet) return alert(`Raise must be above ${g.currentBet}`);
    const diff=amount-(g.bets[myId]||0);
    if(diff>g.stacks[myId]) return alert('Not enough chips');
    g.stacks[myId]-=diff; g.bets[myId]=amount; g.currentBet=amount;
    if(g.stacks[myId]===0) g.allin[myId]=true;
    addLog(g,`${myName} raises to ${amount}`);
  }

  advanceAction(g);
  practiceState = g;
  renderGame(g);
  if (g.phase !== 'showdown') scheduleBotAction();
  else setTimeout(() => showShowdownOverlay(g), 800);
}

async function doAction(type, amount) {
  const snap = await roomRef.once('value');
  const data = snap.val(); if (!data||!data.game) return;
  const g = JSON.parse(JSON.stringify(data.game));
  const myIdx = (g.playerOrder||[]).indexOf(myId);
  if (g.actionIdx!==myIdx) return;
  const toCall=(g.currentBet||0)-(g.bets[myId]||0);

  if (type==='fold') { g.folded[myId]=true; addLog(g,`${myName} folds`); }
  else if (type==='check') { if(toCall>0) return; addLog(g,`${myName} checks`); }
  else if (type==='call') {
    const ca=Math.min(toCall,g.stacks[myId]);
    g.stacks[myId]-=ca; g.bets[myId]=(g.bets[myId]||0)+ca;
    if(g.stacks[myId]===0) g.allin[myId]=true;
    addLog(g,`${myName} calls ${ca}`);
  } else if (type==='raise') {
    if(amount<=g.currentBet) return alert(`Raise must be above ${g.currentBet}`);
    const diff=amount-(g.bets[myId]||0);
    if(diff>g.stacks[myId]) return alert('Not enough chips');
    g.stacks[myId]-=diff; g.bets[myId]=amount; g.currentBet=amount;
    if(g.stacks[myId]===0) g.allin[myId]=true;
    addLog(g,`${myName} raises to ${amount}`);
  }
  advanceAction(g);
  await roomRef.update({ game: g });
}

function addLog(g,msg,important=false) {
  if(!g.log) g.log=[];
  g.log.push({msg,important});
  if(g.log.length>50) g.log=g.log.slice(-50);
}

function advanceAction(g) {
  if (!g.folded) g.folded = {};
  if (!g.allin) g.allin = {};
  if (!g.bets) g.bets = {};
  const n=g.players.length;
  const nonFolded=g.players.filter(p=>!(g.folded[p.id]));
  if(nonFolded.length===1){g.phase='showdown';return;}
  let next=(g.actionIdx+1)%n, loops=0;
  while((g.folded[g.players[next].id]||g.allin[g.players[next].id])&&loops<n){next=(next+1)%n;loops++;}
  const allEqual=nonFolded.every(p=>g.allin[p.id]||(g.bets[p.id]||0)===g.currentBet);
  g.actionsThisRound=(g.actionsThisRound||0)+1;
  if(allEqual&&g.actionsThisRound>=nonFolded.length) nextPhase(g);
  else g.actionIdx=next;
}

function nextPhase(g) {
  g.pot=(g.pot||0)+Object.values(g.bets).reduce((a,b)=>a+b,0);
  g.players.forEach(p=>{g.bets[p.id]=0;}); g.currentBet=0; g.actionsThisRound=0;
  const phases=['preflop','flop','turn','river','showdown'];
  g.phase=phases[phases.indexOf(g.phase)+1]||'showdown';
  if(g.phase!=='showdown'){
    addLog(g,`--- ${g.phase.toUpperCase()} ---`,true);
    const n=g.players.length; let s=(g.dealerIdx+1)%n, l=0;
    while((g.folded[g.players[s].id]||g.allin[g.players[s].id])&&l<n){s=(s+1)%n;l++;}
    g.actionIdx=s;
  } else addLog(g,'--- SHOWDOWN ---',true);
}

// ─── Showdown overlay ─────────────────────────────────────────────────────────
function showShowdownOverlay(g) {
  const existing = document.getElementById('showdown-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'showdown-overlay';
  overlay.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);border:2px solid #ffd700;border-radius:16px;padding:20px 30px;z-index:200;text-align:center;min-width:320px;`;
  const nonFolded = g.players.filter(p=>!g.folded[p.id]);
  const totalPot = (g.pot||0)+Object.values(g.bets).reduce((a,b)=>a+b,0);
  let winners=[];
  if(nonFolded.length===1){ winners=[nonFolded[0]]; }
  else {
    const allCards=g.community.slice(0,5);
    const hands=nonFolded.map(p=>({player:p,best:bestHand([...g.hands[p.id],...allCards])}));
    hands.sort((a,b)=>compareHandVal(b.best,a.best));
    const best=hands[0].best;
    winners=hands.filter(h=>compareHandVal(h.best,best)===0).map(h=>h.player);

    const share=Math.floor(totalPot/winners.length);
    winners.forEach(w=>{g.stacks[w.id]=(g.stacks[w.id]||0)+share;});
    g.players.forEach(p=>{p.chips=g
