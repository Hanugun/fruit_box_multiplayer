const socket = io();
// Modify the forceGameState handler to properly handle player activation
socket.on("forceGameState", (data) => {
  if (data.roomCode) {
    currentRoom = data.roomCode;
    updateRoomCodeDisplay();
  }
  // Hide all modals
  Object.values(modals).forEach(modal => {
    modal.style.display = "none";
  });
  
  // Initialize game state
  grid = data.grid;
  players = data.players.reduce((acc, player) => {
    acc[player.id] = player;
    return acc;
  }, {});
  
  // Set game active status based on both canPlay and isSpectator
  gameActive = data.canPlay || false;
  
  // Update UI
  document.getElementById("gameContainer").style.display = "block";
  
  if (data.isSpectator) {
    document.getElementById("waitOverlay").style.display = "flex";
    document.querySelector("#waitOverlay .wait-message").textContent = 
      data.message || "You joined mid-game. Waiting for next round...";
    canvas.classList.add("spectator");
  } else {
    document.getElementById("waitOverlay").style.display = "none";
    canvas.classList.remove("spectator");
  }
  
  // Initialize game view
  const container = document.getElementById('gameContainer');
  canvas.width = container.clientWidth - 20;
  canvas.height = container.clientHeight - 20;
  autoScaleGrid();
  updateScoreboard();
});
socket.on("lobbyNotification", (data) => {
  if (isHost) {
    showLobbyNotification(data.message);
  }
});

function showLobbyNotification(message) {
  const notification = document.createElement("div");
  notification.className = "lobby-notification";
  notification.textContent = message;
  
  // Basic inline styling for the notification
  notification.style.position = "fixed";
  notification.style.top = "10px";
  notification.style.left = "10px";
  notification.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
  notification.style.color = "#fff";
  notification.style.padding = "8px 12px";
  notification.style.borderRadius = "4px";
  notification.style.zIndex = "2000";
  notification.style.fontSize = "1rem";
  notification.style.opacity = "1";
  notification.style.transition = "opacity 0.5s ease";
  
  document.body.appendChild(notification);
  
  // Remove after 3 seconds by fading out
  setTimeout(() => {
    notification.style.opacity = "0";
    setTimeout(() => {
      notification.remove();
    }, 500);
  }, 3000);
}
// Connection handling
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

socket.on("connect", () => {
  reconnectAttempts = 0;
  
  if (currentRoom && myNickname) {
      socket.emit("requestRejoin");
      document.getElementById("waitOverlay").style.display = "flex";
      document.querySelector("#waitOverlay .wait-message").textContent = 
          "Reconnecting to game...";
  }
});

socket.on("disconnect", () => {
  if (gameActive) {
      document.getElementById("waitOverlay").style.display = "flex";
      document.querySelector("#waitOverlay .wait-message").textContent = 
          "Connection lost. Reconnecting...";
  }
});

socket.on("reconnect_attempt", (attempt) => {
  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      alert("Failed to reconnect. Please refresh the page.");
      window.location.reload();
  } else {
      document.querySelector("#waitOverlay .wait-message").textContent = 
          `Reconnecting... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;
  }
});

// Prevent text selection during gameplay
document.addEventListener('selectstart', function(e) {
  if (gameActive) {
    e.preventDefault();
    return false;
  }
});

// Prevent dragging header
document.addEventListener('mousedown', function(e) {
  if (gameActive && e.target.closest('#gameHeader')) {
    e.preventDefault();
  }
}, { passive: false });

// Prevent touch events from scrolling
document.addEventListener(
  "touchstart",
  function (e) {
    if (e.target === canvas) e.preventDefault();
  },
  { passive: false }
);
document.addEventListener(
  "touchmove",
  function (e) {
    if (e.target === canvas) e.preventDefault();
  },
  { passive: false }
);

// Game state variables
let myNickname = "";
let currentRoom = "";
let isHost = false;
let gameActive = false;
let grid = [];
let players = {};
let myScore = 0;
let flashlightPos = { x: 0.5, y: 0.5 }; // Start at center instead of (0,0)
let appleAppearTimes = []; // 2D array matching grid dimensions
let gameMods = {
  hidden: false,
  flashlight: false
};

// DOM elements
const roomCodeDisplayElem = document.getElementById("roomCodeDisplay");
const resetButton = document.getElementById("resetButton");
const timeLeftElem = document.getElementById("timeLeft");
const myScoreElem = document.getElementById("yourScore");
const scoreboardDiv = document.getElementById("scoreboard");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let flashlightRadius = Math.min(canvas.width, canvas.height) * 0.6;
let mouseX = canvas.width / 2;
let mouseY = canvas.height / 2;
// Grid sizing
let cellSize = 50;
let offsetX = 0;
let offsetY = 0;
const margin = 50;

// Selection state
const selection = {
  isActive: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  isValid: false,
  highlightedCells: [],
};

// Animation
let removingApples = [];
let remoteCursors = {};
let playerNames = {};
let nextPlayerNumber = 1;

// Sound effects
const popSound = new Audio("pop.mp3");
const bgmBoss = new Audio("boss.mp3");
const bgmOIA = new Audio("oia.m4a");
const bgmChill = new Audio("chill.m4a");
const bgmTracks = [bgmBoss, bgmOIA, bgmChill];
const availableColors = [
  "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF",
  "#FF00FF", "#FFFFFF", "#FFD700", "#00BFFF", "#8A2BE2"
];
const playerColors = {};

// Modals
const modals = {
  initial: document.getElementById("initialModal"),
  create: document.getElementById("createRoomModal"),
  join: document.getElementById("joinRoomModal"),
  lobby: document.getElementById("lobbyModal"),
  gameOver: document.getElementById("gameOverModal"),
};

// Initialize sound
bgmTracks.forEach((track) => {
  track.loop = true;
  track.volume = parseFloat(document.getElementById("bgmVolume").value);
});

// Event listeners
document.getElementById("createRoomBtn").addEventListener("click", () => {
  modals.initial.style.display = "none";
  modals.create.style.display = "flex";
});

document.getElementById("confirmCreateRoom").addEventListener("click", () => {
  const nickname = document.getElementById("createNickname").value.trim();
  if (!nickname) {
    alert("Please enter a valid nickname");
    return;
  }
  myNickname = nickname;
  socket.emit("createRoom", { nickname });
});

document.getElementById("joinExistingBtn").addEventListener("click", () => {
  modals.initial.style.display = "none";
  modals.join.style.display = "flex";
});

document.getElementById("confirmJoinRoom").addEventListener("click", () => {
  const nickname = document.getElementById("joinNickname").value.trim();
  const roomCode = document.getElementById("joinRoomCode").value.trim().toUpperCase();

  if (!nickname || !roomCode) {
    alert("Please enter both nickname and room code");
    return;
  }

  myNickname = nickname;
  socket.emit("joinRoom", { roomCode, nickname });
  modals.join.style.display = "none";
});

socket.on("roomJoined", ({ roomCode, players }) => {
  currentRoom = roomCode;
  isHost = false;
  roomCodeDisplayElem.textContent = roomCode;
  updateRoomCodeDisplay();
  modals.lobby.style.display = "flex";
  updatePlayerList(players);

  const startBtn = document.getElementById("startGameBtn");
  startBtn.style.display = "none";

  if (!document.getElementById("waitingMessage")) {
    const waitingMsg = document.createElement("p");
    waitingMsg.id = "waitingMessage";
    waitingMsg.style.fontSize = "1.2rem";
    waitingMsg.style.marginTop = "10px";
    waitingMsg.textContent = "Waiting for host to start the game...";
    modals.lobby.querySelector(".modal-content").appendChild(waitingMsg);
  }
});

document.getElementById("startGameBtn").addEventListener("click", () => {
  // Optionally, if settings are stored in the UI, emit them first:
  const level = document.getElementById("levelSelect").value;
  const timer = parseInt(document.getElementById("timerInput").value, 10);
  socket.emit("setGameSettings", { level, timer });
  // Then start the game.
  socket.emit("startGame");
});

// Sound controls
document.getElementById("bgmToggleBoss").addEventListener("change", (e) => {
  e.target.checked ? bgmBoss.play() : bgmBoss.pause();
});
document.getElementById("bgmToggleOIA").addEventListener("change", (e) => {
  e.target.checked ? bgmOIA.play() : bgmOIA.pause();
});
document.getElementById("bgmToggleChill").addEventListener("change", (e) => {
  e.target.checked ? bgmChill.play() : bgmChill.pause();
});
document.getElementById("bgmVolume").addEventListener("input", (e) => {
  const vol = parseFloat(e.target.value);
  bgmTracks.forEach((track) => (track.volume = vol));
});
document.getElementById("popVolume").addEventListener("input", (e) => {
  popSound.volume = parseFloat(e.target.value);
});

// Socket event handlers
socket.on("roomCreated", ({ roomCode, players }) => {
  currentRoom = roomCode;
  isHost = true;
  roomCodeDisplayElem.textContent = roomCode;
  updateRoomCodeDisplay();
  modals.create.style.display = "none";
  modals.lobby.style.display = "flex";
  updatePlayerList(players);

  const startBtn = document.getElementById("startGameBtn");
  startBtn.disabled = false;
  startBtn.style.display = "inline-block";
  const waitingMsg = document.getElementById("waitingMessage");
  if (waitingMsg) waitingMsg.remove();
});

socket.on("playerJoined", (players) => {
  updatePlayerList(players);
  if (isHost) {
    document.getElementById("startGameBtn").disabled = players.length < 1;
  }
});

socket.on("playerLeft", (players) => {
  updatePlayerList(players);
});

socket.on("gameStarted", (gameState) => {
  const isPlayer = gameState.players.some(p => p.id === socket.id);
  gameActive = isPlayer;
  appleAppearTimes = grid.map(row => row.map(() => performance.now()));

  if (isPlayer) {
    document.getElementById("waitOverlay").style.display = "none";
    canvas.classList.remove("spectator");
  } else {
    document.getElementById("waitOverlay").style.display = "flex";
    document.querySelector("#waitOverlay .wait-message").textContent = 
      "Wait for the next game to start...";
    canvas.classList.add("spectator");
  }

  grid = gameState.grid;
  players = gameState.players.reduce((acc, player) => {
    acc[player.id] = player;
    return acc;
  }, {});
  appleAppearTimes = [];
  for (let r = 0; r < grid.length; r++) {
    appleAppearTimes[r] = [];
    for (let c = 0; c < grid[0].length; c++) {
      appleAppearTimes[r][c] = performance.now();
    }
  }
  gameMods = gameState.mods || { 
    hidden: false, 
    flashlight: false 
  };
  
  updateScoreboard();
  autoScaleGrid();
});

socket.on("spectatorJoined", (gameState) => {
  gameActive = false;
  initializeGame(gameState);
  
  Object.values(modals).forEach(modal => {
      modal.style.display = "none";
  });
  
  document.getElementById("gameContainer").style.display = "block";
});

socket.on("gameState", (data) => {
  grid = data.grid;
  players = data.players.reduce((acc, player) => {
    acc[player.id] = player;
    return acc;
  }, {});
  autoScaleGrid();
  updateScoreboard();
});

socket.on("selectionSuccess", (data) => {
  const { removed, playerId, newScore } = data;
  players[playerId].score = newScore;
  if (playerId === socket.id) {
    myScore = newScore;
    myScoreElem.textContent = `Your Score: ${myScore}`;
    popSound.currentTime = 0;
    popSound.play();
  }

  removed.forEach(({ row, col }) => {
    let oldValue = grid[row][col];
    if (oldValue < 1) oldValue = 1;
    let dir = Math.random() < 0.5 ? -1 : 1;
    let randomArcPeak = 100 + Math.random() * 100;
    let randomArcSide = 80 + Math.random() * 40;

    removingApples.push({
      row,
      col,
      value: oldValue,
      startTime: performance.now(),
      duration: 600,
      arcPeak: randomArcPeak,
      arcSide: randomArcSide,
      direction: dir,
    });
    grid[row][col] = 0;
  });

  updateScoreboard();
  data.removed.forEach(({ row, col }) => {
    // When apples are removed, we'll assume new ones appear
    // In a real game, you'd need to track when new apples spawn
    appleAppearTimes[row][col] = performance.now();
  });
});

socket.on("selectionFail", (data) => {
  console.log("Selection failed:", data.reason);
});
let totalTimeFromServer = 120;
let lastServerTimeLeft = totalTimeFromServer;
let serverUpdateTimestamp = Date.now();
let hasReceivedFirstUpdate = false;

socket.on("timerUpdate", (data) => {
  totalTimeFromServer = data.totalTime;
  lastServerTimeLeft = data.timeLeft;
  serverUpdateTimestamp = Date.now();
  hasReceivedFirstUpdate = true;
  
  timeLeftElem.textContent = `Time Left: ${data.timeLeft}s`;
});

function animateTimeBar() {
  const now = Date.now();
  const elapsed = (now - serverUpdateTimestamp) / 1000;
  
  // If no update has been received, just show full bar
  let smoothTimeLeft = hasReceivedFirstUpdate 
    ? Math.max(0, lastServerTimeLeft - elapsed)
    : totalTimeFromServer;
  
  const percent = (smoothTimeLeft / totalTimeFromServer) * 100;
  const timeBar = document.getElementById("timeBar");
  timeBar.style.width = percent + "%";
  
  // Recalculate thresholds dynamically
  const currentThreshold1 = 0.66 * totalTimeFromServer;
  const currentThreshold2 = 0.33 * totalTimeFromServer;
  
  if (smoothTimeLeft <= currentThreshold2) {
    timeBar.style.backgroundColor = "#FF4655"; // Red
  } else if (smoothTimeLeft <= currentThreshold1) {
    timeBar.style.backgroundColor = "#FFC107"; // Yellow
  } else {
    timeBar.style.backgroundColor = "#F5E14C"; // Light yellow
  }
  
  requestAnimationFrame(animateTimeBar);
}

animateTimeBar();
socket.on("gameOver", (data) => {
  gameActive = false;
  resetSelection();
  const finalScoreElem = document.getElementById("finalScore");
  finalScoreElem.innerHTML = `Your Score: ${myScore}<br>Winner: ${data.winner} (${data.score})`;

  modals.gameOver.style.display = "flex";
  const gameOverModalContent = document.querySelector("#gameOverModal .modal-content");

  // Remove any existing buttons first
  const existingPlayAgain = document.getElementById("playAgainBtn");
  if (existingPlayAgain) existingPlayAgain.remove();
  const existingPoke = document.getElementById("pokeBtn");
  if (existingPoke) existingPoke.remove();
  const existingQuit = document.getElementById("quitBtn");
  if (existingQuit) existingQuit.remove();

  if (isHost) {
    // Host gets a "Play Again" button.
    const playAgainBtn = document.createElement("button");
    playAgainBtn.id = "playAgainBtn";
    playAgainBtn.textContent = "Play Again";
    playAgainBtn.className = "modal-btn";
    playAgainBtn.addEventListener("click", () => {
      socket.emit("startGame");
      myScore = 0;
      myScoreElem.textContent = `Your Score: 0`;
      modals.gameOver.style.display = "none";
    });
    gameOverModalContent.appendChild(playAgainBtn);
  } else {
    // Non-host players get a "Poke" button.
    const pokeBtn = document.createElement("button");
    pokeBtn.id = "pokeBtn";
    pokeBtn.textContent = "Poke";
    pokeBtn.className = "modal-btn";
    pokeBtn.addEventListener("click", () => {
      socket.emit("pokeHost");
    });
    gameOverModalContent.appendChild(pokeBtn);
  }

  // In both cases, add a Quit button (with a smaller style)
  const quitBtn = document.createElement("button");
  quitBtn.id = "quitBtn";
  quitBtn.textContent = "Quit";
  quitBtn.className = "modal-btn small-btn"; // add a new class for smaller styling
  quitBtn.addEventListener("click", () => {
    socket.emit("quitRoom");
    window.location.reload();
  });
  gameOverModalContent.appendChild(quitBtn);
});

socket.on("hostDisconnected", () => {
  alert("The host has left the game. You will be returned to the main menu.");
  window.location.reload();
});
socket.on("pokeReceived", (data) => {
  if (isHost) {
    showStickers(data.combo);
  }
});
socket.on("pokeCombo", (data) => {
  if (!isHost) {
    showPokeComboAnimation(data.combo);
  }
});

function showPokeComboAnimation(combo) {
  // Remove any existing combo indicator so we can show the new one
  const existingIndicator = document.getElementById("pokeComboIndicator");
  if (existingIndicator) {
    existingIndicator.remove();
  }

  // Create a new div for the combo
  const comboEl = document.createElement("div");
  comboEl.id = "pokeComboIndicator";
  comboEl.className = "poke-combo-indicator";
  comboEl.textContent = `x${combo}`;

  // Calculate a scale factor: +0.1 per combo, up to 2.0
  let scale = 1 + Math.min(combo, 10) * 0.1;
  if (scale > 2) scale = 2; // clamp max scale

  // Apply initial transform to center & scale
  // We'll let the CSS animation do a quick "pulse," then settle on this scale
  comboEl.style.transform = `translate(-50%, -50%) scale(${scale})`;

  document.body.appendChild(comboEl);

  // After 1 second, fade out
  setTimeout(() => {
    comboEl.classList.add("fade-out");
    setTimeout(() => {
      comboEl.remove();
    }, 500);
  }, 1000);
}
// Function to create a sticker pop-out effect
function showStickers(combo) {
  // Define possible words and fun font families (make sure to import these fonts in your HTML)
  const words = ["GO", "HURRY", "START", "WTF", "HELLO", "LET'S GO", "MOVE IT", "NOW"];
  const fonts = [
    "'Bangers', cursive",
    "'Fredoka One', sans-serif",
    "'Press Start 2P', cursive",
    "'Chewy', cursive",
    "'Luckiest Guy', cursive",
    "Comic Sans MS",
    "Impact"
  ];

  // Randomly choose a word and a font
  const randomWord = words[Math.floor(Math.random() * words.length)];
  const randomFont = fonts[Math.floor(Math.random() * fonts.length)];

  // Create the sticker element
  const sticker = document.createElement("div");
  sticker.classList.add("sticker");
  sticker.textContent = randomWord;
  sticker.style.fontFamily = randomFont;
  sticker.style.fontWeight = "bold";
  
  // Base font size is 50px; if combo exists, increase size (up to a max of 100px)
  let baseSize = 50;
  let fontSize = combo && combo > 1 ? Math.min(baseSize + combo * 5, 100) : baseSize;
  sticker.style.fontSize = fontSize + "px";

  // Optionally, display the combo as an overlay:
  if (combo && combo > 1) {
    const comboSpan = document.createElement("span");
    comboSpan.classList.add("combo-count");
    comboSpan.textContent = ` x${combo}`;
    sticker.appendChild(comboSpan);
  }
  
  // Use a safe margin so the sticker doesn't overflow
  const safeMargin = 100; // Adjust as needed
  // Position the sticker randomly within the viewport
  sticker.style.position = "fixed";
  sticker.style.left = Math.random() * (window.innerWidth - safeMargin) + "px";
  sticker.style.top = Math.random() * (window.innerHeight - safeMargin) + "px";
  sticker.style.zIndex = 1000;
  
  document.body.appendChild(sticker);
  
  // Fade out and remove after a short delay
  setTimeout(() => {
    sticker.classList.add("fade-out");
    setTimeout(() => {
      sticker.remove();
    }, 1000);
  }, 500);
}
document.getElementById("openSettingsBtn").addEventListener("click", () => {
  document.getElementById("settingsModal").style.display = "flex";
});
document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  const level = document.getElementById("levelSelect").value;
  const timer = parseInt(document.getElementById("timerInput").value, 10);
  
  const mods = [];
  if (document.getElementById("modHidden").checked) mods.push("hidden");
  if (document.getElementById("modFlashlight").checked) mods.push("flashlight");
  
  socket.emit("setGameSettings", { level, timer, mods });
  document.getElementById("settingsModal").style.display = "none";
});

socket.on("gameReset", (data) => {
  // Update players and scores
  players = data.players.reduce((acc, player) => {
    acc[player.id] = player;
    return acc;
  }, {});

  // Reset local score
  if (players[socket.id]) {
    myScore = players[socket.id].score;
    myScoreElem.textContent = `Your Score: ${myScore}`;
  }

  // Update grid if provided
  if (data.grid) {
    grid = data.grid;
  }

  // Update timer if provided
  if (data.timeLeft !== undefined) {
    timeLeftElem.textContent = `Time Left: ${data.timeLeft}s`;
  }

  // Refresh the display
  updateScoreboard();
  autoScaleGrid();
});
function updateRoomCodeDisplay() {
  const gameInfo = document.getElementById("gameInfo");

  const existing = document.getElementById("roomCodeDisplayInGame");
  if (existing) existing.remove();

  const wrapper = document.createElement("span");
  wrapper.id = "roomCodeDisplayInGame";
  wrapper.style.margin = "0 auto";
  wrapper.style.display = "inline-flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "0.3rem";

  const codeSpan = document.createElement("span");
  codeSpan.textContent = currentRoom;

  const icon = document.createElement("span");
  icon.id = "copyIcon";
  icon.className = "copy-icon";
  icon.textContent = "content_copy";

  wrapper.appendChild(codeSpan);
  wrapper.appendChild(icon);

  gameInfo.insertBefore(wrapper, gameInfo.firstChild.nextSibling);
}

socket.on("updateCursor", (data) => {
  remoteCursors[data.playerId] = data;
});

socket.on("removeCursor", (data) => {
  delete remoteCursors[data.playerId];
});

socket.on("roomError", (message) => {
  alert(`Room Error: ${message}`);
});

// Game functions
function autoScaleGrid() {
  if (!grid || grid.length === 0) return;

  const rows = grid.length;
  const cols = grid[0].length;

  const availableWidth = canvas.width - margin * 2;
  const availableHeight = canvas.height - margin * 2;

  const scaleX = Math.floor(availableWidth / cols);
  const scaleY = Math.floor(availableHeight / rows);
  cellSize = Math.min(scaleX, scaleY);

  const gridWidth = cols * cellSize;
  const gridHeight = rows * cellSize;
  offsetX = margin + (availableWidth - gridWidth) / 2;
  offsetY = margin + (availableHeight - gridHeight) / 2;
}

function updateScoreboard() {
  const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);
  let html = `<div class="scoreboard-grid">`;

  sortedPlayers.slice(0, 5).forEach((player, index) => {
    const color = getPlayerColor(player.id);
    html += `
      <div class="player-chip ${player.id === socket.id ? "you" : ""}" style="border-color: ${color}">
        <span class="medal">${index < 3 ? ["🥇", "🥈", "🥉"][index] : ""}</span>
        <span class="name" style="color: ${color}">${player.nickname}</span>
        <span class="score">${player.score}</span>
      </div>
    `;
  });

  if (sortedPlayers.length > 5) {
    html += `<div class="more-players">+${sortedPlayers.length - 5}</div>`;
  }

  html += `</div>`;
  scoreboardDiv.innerHTML = html;
}
function getPlayerColor(playerId) {
  if (playerColors[playerId]) {
    return playerColors[playerId];
  }
  for (let color of availableColors) {
    if (!Object.values(playerColors).includes(color)) {
      playerColors[playerId] = color;
      return color;
    }
  }
  playerColors[playerId] = availableColors[0];
  return availableColors[0];
}

function drawGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!grid || grid.length === 0) {
    requestAnimationFrame(drawGame);
    return;
  }

  if (gameMods.flashlight) {
    // First draw the game elements normally (but we'll cover them)
    drawGameElements();
    
    // Draw a dark overlay over the entire canvas
    ctx.save();
    ctx.fillStyle = 'rgb(0, 0, 0)'; // 85% opaque black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Create the flashlight effect by cutting a hole in the overlay
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, flashlightRadius, 0, Math.PI * 2);
    ctx.fill();
    
    // Add a subtle glow effect around the flashlight
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(
      mouseX, mouseY, flashlightRadius * 0.7,
      mouseX, mouseY, flashlightRadius
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.1)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, flashlightRadius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
    
    // Redraw game elements inside the flashlight area with full brightness
    ctx.save();
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, flashlightRadius, 0, Math.PI * 2);
    ctx.clip();
    drawGameElements();
    ctx.restore();
  } else {
    // Normal drawing when flashlight is off
    drawGameElements();
  }

  requestAnimationFrame(drawGame);
}

function drawGameElements() {
  // Draw mod text indicator
  if (gameMods.hidden || gameMods.flashlight) {
    ctx.save();
    ctx.fillStyle = "#FF4655";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "left";
    
    let modText = "";
    if (gameMods.hidden) modText += "HD";
    if (gameMods.flashlight) modText += (modText ? "+" : "") + "FL";
    
    ctx.fillText(modText, 10, 30);
    ctx.restore();
  }

  const rows = grid.length;
  const cols = grid[0].length;
  ctx.strokeStyle = "rgba(96, 121, 102, 0.5)";
  ctx.lineWidth = 1;

  // Draw grid lines
  const netSpacingFactor = 0.25;
  for (let c = 0; c <= cols; c += netSpacingFactor) {
    let x = offsetX + c * cellSize;
    if (c > cols) x = offsetX + cols * cellSize;
    ctx.beginPath();
    ctx.moveTo(x, offsetY);
    ctx.lineTo(x, offsetY + rows * cellSize);
    ctx.stroke();
  }

  for (let r = 0; r <= rows; r += netSpacingFactor) {
    let y = offsetY + r * cellSize;
    if (r > rows) y = offsetY + rows * cellSize;
    ctx.beginPath();
    ctx.moveTo(offsetX, y);
    ctx.lineTo(offsetX + cols * cellSize, y);
    ctx.stroke();
  }

  // Draw apples
  const currentTime = performance.now();
  const hiddenFadeTime = 2000;
  const hiddenDelay = 1000;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      if (grid[r][c] > 0 && !removingApples.some((a) => a.row === r && a.col === c)) {
        let x = offsetX + c * cellSize;
        let y = offsetY + r * cellSize;
        
        let alpha = 1.0;
        let scale = 1.0;
        const isSelected = selection.highlightedCells.some(cell => cell.row === r && cell.col === c);
        
        if (gameMods.hidden) {
          const appleAge = currentTime - appleAppearTimes[r][c];
          if (appleAge > hiddenDelay) {
            alpha = 1.0 - Math.min(1.0, (appleAge - hiddenDelay) / hiddenFadeTime);
            scale = 1.0 - (1.0 - alpha) * 0.5;
          }
        }
        
        if (alpha > 0.01 || isSelected) {
          drawApple(x, y, grid[r][c], isSelected ? 1.0 : alpha, isSelected ? 1.0 : scale);
        }
      }
    }
  }

  // Draw animations
  drawDroppedApples();

  // Draw selection
  drawSelection();
  
  // Draw remote cursors
  for (let pid in remoteCursors) {
    let data = remoteCursors[pid];
    const color = getPlayerColor(pid);
    
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(data.x * canvas.width, data.y * canvas.height, 5, 0, 2 * Math.PI);
    ctx.fill();
    
    if (data.isDragging && data.selection) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        data.selection.startX * canvas.width,
        data.selection.startY * canvas.height,
        (data.selection.currentX - data.selection.startX) * canvas.width,
        (data.selection.currentY - data.selection.startY) * canvas.height
      );
    }
    ctx.restore();
  }
}

function drawApple(x, y, value, alpha, scale) {
  const minRadius = 1;
  const radius = Math.max(minRadius, (cellSize / 2 - 5) * scale);
  if (gameMods.hidden && alpha < 0.3) {
    // Draw a faint outline for memory aid
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = "#FF4655";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#FF4655";
  ctx.beginPath();
  ctx.arc(x + cellSize / 2, y + cellSize / 2, radius, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = "white";
  ctx.font = `bold ${Math.floor(cellSize * 0.5)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x + cellSize / 2, y + cellSize / 2);
  ctx.restore();
}

function drawDroppedApples() {
  const now = performance.now();
  for (let i = removingApples.length - 1; i >= 0; i--) {
    const apple = removingApples[i];
    const elapsed = now - apple.startTime;
    if (elapsed >= apple.duration) {
      removingApples.splice(i, 1);
      continue;
    }

    let progress = elapsed / apple.duration;
    let origX = offsetX + apple.col * cellSize;
    let origY = offsetY + apple.row * cellSize;
    let sideOffset = apple.arcSide * apple.direction * progress;
    let x = origX + sideOffset;
    let y;

    if (progress <= 0.5) {
      let p = progress / 0.5;
      y = origY - apple.arcPeak * (1 - Math.pow(1 - p, 3));
    } else {
      let p = (progress - 0.5) / 0.5;
      y = origY - apple.arcPeak + Math.pow(p, 3) * (canvas.height + 50 - (origY - apple.arcPeak));
    }

    drawApple(x, y, apple.value, 1.0 - progress, 1.0 - progress * 0.5);
  }
}
// Back button functionality
document.getElementById('backFromCreate').addEventListener('click', () => {
  document.getElementById('createRoomModal').style.display = 'none';
  document.getElementById('initialModal').style.display = 'flex';
});

document.getElementById('backFromJoin').addEventListener('click', () => {
  document.getElementById('joinRoomModal').style.display = 'none';
  document.getElementById('initialModal').style.display = 'flex';
});
function updatePlayerList(players) {
  const list = document.getElementById("playerList");
  list.innerHTML = players
    .map((player) => `<li>${player.nickname} ${player.id === socket.id ? "(you)" : ""}</li>`)
    .join("");
}

function initializeGame(gameState) {
  grid = gameState.grid;
  players = gameState.players.reduce((acc, player) => {
    acc[player.id] = player;
    return acc;
  }, {});

  modals.initial.style.display = "none";
  modals.lobby.style.display = "none";
  modals.gameOver.style.display = "none";
  
  const container = document.getElementById('gameContainer');
  canvas.width = container.clientWidth - 20;
  canvas.height = container.clientHeight - 20;
  
  autoScaleGrid();
  updateScoreboard();
  
  document.getElementById("gameContainer").style.display = "block";
  if (gameActive) {
    document.getElementById("waitOverlay").style.display = "none";
    canvas.classList.remove("spectator");
  } else {
    document.getElementById("waitOverlay").style.display = "flex";
    canvas.classList.add("spectator");
  }
}

function handleResize() {
  if (grid && grid.length > 0) {
    const container = document.getElementById("gameContainer");
    canvas.width = container.clientWidth - 20;
    canvas.height = container.clientHeight - 20;
    flashlightRadius = Math.min(canvas.width, canvas.height) * 0.3;
    autoScaleGrid();
  }
}

// Convert touch events to mouse events
canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
canvas.addEventListener("touchend", handleTouchEnd);

function handleTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  
  selection.isActive = true;
  selection.startX = (touch.clientX - rect.left) / rect.width;
  selection.startY = (touch.clientY - rect.top) / rect.height;
  selection.currentX = selection.startX;
  selection.currentY = selection.startY;

  updateSelectionValidity();
  sendCursorUpdate();
}

function handleTouchMove(e) {
  if (!gameActive || !selection.isActive) return;
  e.preventDefault();

  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  
  // Use the same scaling calculation for touch events
  mouseX = (touch.clientX - rect.left) * (canvas.width / rect.width);
  mouseY = (touch.clientY - rect.top) * (canvas.height / rect.height);
  
  selection.currentX = (touch.clientX - rect.left) / rect.width;
  selection.currentY = (touch.clientY - rect.top) / rect.height;

  updateSelectionValidity();
  sendCursorUpdate();
}
function handleTouchEnd(e) {
  if (!gameActive || !selection.isActive) return;
  e.preventDefault();

  if (selection.isValid) {
    finalizeSelection();
  }

  resetSelection();
  sendCursorUpdate();
}

// Mouse event handlers
canvas.addEventListener("mousedown", (e) => {
  if (!gameActive) return;

  const rect = canvas.getBoundingClientRect();
  
  selection.isActive = true;
  selection.startX = (e.clientX - rect.left) / rect.width;
  selection.startY = (e.clientY - rect.top) / rect.height;
  selection.currentX = selection.startX;
  selection.currentY = selection.startY;

  updateSelectionValidity();
  sendCursorUpdate();
});
// Add this to your initialization code
canvas.addEventListener("mouseenter", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});
canvas.addEventListener("mousemove", (e) => {
  if (!gameActive) return;

  const rect = canvas.getBoundingClientRect();
  // Calculate mouse position relative to canvas with proper scaling
  mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  // Only update selection if mouse button is pressed
  if (selection.isActive) {
    selection.currentX = (e.clientX - rect.left) / rect.width;
    selection.currentY = (e.clientY - rect.top) / rect.height;
    updateSelectionValidity();
    sendCursorUpdate();
  }
});
window.addEventListener("mouseup", () => {
  if (!gameActive || !selection.isActive) return;

  if (selection.isValid) {
    finalizeSelection();
  }

  resetSelection();
  sendCursorUpdate();
});

function updateSelectionValidity() {
  const startX = selection.startX * canvas.width;
  const startY = selection.startY * canvas.height;
  const currentX = selection.currentX * canvas.width;
  const currentY = selection.currentY * canvas.height;
  
  const selX = Math.min(startX, currentX);
  const selY = Math.min(startY, currentY);
  const selW = Math.abs(startX - currentX);
  const selH = Math.abs(startY - currentY);

  let sum = 0;
  selection.highlightedCells = [];

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      const x = offsetX + c * cellSize;
      const y = offsetY + r * cellSize;

      // More precise overlap calculation (center-point check)
      const centerX = x + cellSize / 2;
      const centerY = y + cellSize / 2;

      if (centerX >= selX && centerX <= selX + selW &&
          centerY >= selY && centerY <= selY + selH) {
        if (grid[r][c] > 0) {
          sum += grid[r][c];
          selection.highlightedCells.push({ row: r, col: c });
        }
      }
    }
  }

  selection.isValid = sum === 10 && selection.highlightedCells.length > 0;
}

function drawSelection() {
  if (!selection.isActive || !grid.length) return;
  
  const startX = selection.startX * canvas.width;
  const startY = selection.startY * canvas.height;
  const currentX = selection.currentX * canvas.width;
  const currentY = selection.currentY * canvas.height;
  
  const selX = Math.min(startX, currentX);
  const selY = Math.min(startY, currentY);
  const selW = Math.abs(startX - currentX);
  const selH = Math.abs(startY - currentY);

  // Draw selection box
  ctx.strokeStyle = selection.isValid ? "rgba(0, 200, 0, 0.8)" : "rgba(0, 0, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(selX, selY, selW, selH);

  // Fill selection area
  ctx.fillStyle = selection.isValid ? "rgba(0, 255, 0, 0.1)" : "rgba(0, 0, 255, 0.1)";
  ctx.fillRect(selX, selY, selW, selH);

  // Highlight selected apples
  selection.highlightedCells.forEach(({ row, col }) => {
    const x = offsetX + col * cellSize;
    const y = offsetY + row * cellSize;

    // Draw highlight circle
    ctx.save();
    ctx.strokeStyle = selection.isValid ? "rgba(255, 255, 0, 0.8)" : "rgba(255, 165, 0, 0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

function finalizeSelection() {
  if (selection.isValid) {
    socket.emit("selectApples", { cells: selection.highlightedCells });
  }
}

function resetSelection() {
  selection.isActive = false;
  selection.isValid = false;
  selection.highlightedCells = [];
  selection.startX = 0;
  selection.startY = 0;
  selection.currentX = 0;
  selection.currentY = 0;
}

function sendCursorUpdate() {
  if (!gameActive) return;

  const rect = canvas.getBoundingClientRect();
  flashlightPos = {
    x: selection.currentX,
    y: selection.currentY
  };

  socket.emit("playerCursor", {
    x: selection.currentX,
    y: selection.currentY,
    isDragging: selection.isActive,
    selection: selection.isActive ? {
      startX: selection.startX,
      startY: selection.startY,
      currentX: selection.currentX,
      currentY: selection.currentY
    } : null
  });
}



// Copy room code functionality
document.addEventListener("click", function (e) {
  const icon = e.target.closest(".copy-icon");
  if (!icon) return;

  const roomCode = document.querySelector("#roomCodeDisplayInGame span:first-child").textContent;

  const tempInput = document.createElement("input");
  tempInput.value = roomCode;
  document.body.appendChild(tempInput);
  tempInput.select();

  try {
    document.execCommand("copy");
    icon.textContent = "✓";
    icon.style.color = "#2ecc71";

    setTimeout(() => {
      icon.textContent = "content_copy";
      icon.style.color = "#FF4655"; // matches theme
    }, 2000);
  } catch (err) {
    console.error("Failed to copy text: ", err);
  }

  document.body.removeChild(tempInput);
});


// Initialize
window.addEventListener("load", () => {
  modals.initial.style.display = "flex";
  requestAnimationFrame(drawGame);
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", function() {
    setTimeout(handleResize, 300);
  });
});
document.getElementById('waitOverlayBackBtn').addEventListener('click', () => {
  // Hide game container and show initial modal
  document.getElementById('gameContainer').style.display = 'none';
  document.getElementById('initialModal').style.display = 'flex';
  
  // Leave the room if connected
  if (socket.connected && currentRoom) {
    socket.emit('quitRoom');
    currentRoom = '';
  }
  
  // Reset game state
  gameActive = false;
  grid = [];
  players = {};
  myScore = 0;
});
document.getElementById('backFromLobby').addEventListener('click', () => {
  // Leave the room
  if (currentRoom) {
    socket.emit('quitRoom');
    currentRoom = '';
  }
  
  // Return to initial screen
  document.getElementById('lobbyModal').style.display = 'none';
  document.getElementById('initialModal').style.display = 'flex';
});
// Reset button functionality
document.getElementById("resetButton").addEventListener("click", () => {
  if (isHost) {
    // Reset all scores immediately
    Object.values(players).forEach(player => {
      player.score = 0;
    });
    myScore = 0;
    myScoreElem.textContent = `Your Score: ${myScore}`;
    
    // Update the scoreboard immediately
    updateScoreboard();
    
    // Emit reset event to server
    socket.emit("resetGame");
    
    // If game is active, also reset the grid
    if (gameActive) {
      socket.emit("startGame"); // This will create a new grid
    }
  } else {
    // For non-hosts, just reset their own score display
    myScore = 0;
    myScoreElem.textContent = `Your Score: ${myScore}`;
    socket.emit("requestRejoin");
  }
});