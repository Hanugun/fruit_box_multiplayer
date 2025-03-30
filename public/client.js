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

// DOM elements
const roomCodeDisplayElem = document.getElementById("roomCodeDisplay");
const resetButton = document.getElementById("resetButton");
const timeLeftElem = document.getElementById("timeLeft");
const myScoreElem = document.getElementById("yourScore");
const scoreboardDiv = document.getElementById("scoreboard");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

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
const bgmAnime = new Audio("anime.m4a");
const bgmTracks = [bgmBoss, bgmOIA, bgmChill, bgmAnime];
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
document.getElementById("bgmToggleAnime").addEventListener("change", (e) => {
  e.target.checked ? bgmAnime.play() : bgmAnime.pause();
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
});

socket.on("selectionFail", (data) => {
  console.log("Selection failed:", data.reason);
});

socket.on("timerUpdate", (data) => {
  timeLeftElem.textContent = `Time Left: ${data.timeLeft}s`;
});

socket.on("gameOver", (data) => {
  gameActive = false;
  resetSelection();
  const finalScoreElem = document.getElementById("finalScore");
  finalScoreElem.innerHTML = `Your Score: ${myScore}<br>Winner: ${data.winner} (${data.score})`;

  modals.gameOver.style.display = "flex";
  const gameOverModalContent = document.querySelector("#gameOverModal .modal-content");

  const existingPlayAgain = document.getElementById("playAgainBtn");
  if (existingPlayAgain) existingPlayAgain.remove();
  const existingQuit = document.getElementById("quitBtn");
  if (existingQuit) existingQuit.remove();

  if (isHost) {
    const playAgainBtn = document.createElement("button");
    playAgainBtn.id = "playAgainBtn";
    playAgainBtn.textContent = "Play Again";
    playAgainBtn.className = "modal-btn";
    playAgainBtn.addEventListener("click", () => {
      socket.emit("startGame");
      modals.gameOver.style.display = "none";
    });
    gameOverModalContent.appendChild(playAgainBtn);
  }

  const quitBtn = document.createElement("button");
  quitBtn.id = "quitBtn";
  quitBtn.textContent = "Quit";
  quitBtn.className = "modal-btn";
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

socket.on("gameReset", () => {
  if (gameActive) {
    socket.emit("requestRejoin");
  }
});
function updateRoomCodeDisplay() {
  const gameInfo = document.getElementById("gameInfo");
  const roomCodeSpan = document.createElement("span");
  roomCodeSpan.id = "roomCodeDisplayInGame";
  roomCodeSpan.textContent = currentRoom;
  roomCodeSpan.style.margin = "0 auto";

  const existing = document.getElementById("roomCodeDisplayInGame");
  if (existing) existing.remove();

  gameInfo.insertBefore(roomCodeSpan, gameInfo.firstChild.nextSibling);
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
            <div class="player-chip ${player.id === socket.id ? "you" : ""}" 
                 style="border-color: ${color}">
                <span class="medal">${["🥇", "🥈", "🥉"][index]}</span>
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

  const rows = grid.length;
  const cols = grid[0].length;

  // Draw grid
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let x = offsetX + c * cellSize;
      let y = offsetY + r * cellSize;
      ctx.strokeStyle = "#b2e6be";
      ctx.strokeRect(x, y, cellSize, cellSize);
    }
  }

  // Draw apples
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] > 0 && !removingApples.some((a) => a.row === r && a.col === c)) {
        let x = offsetX + c * cellSize;
        let y = offsetY + r * cellSize;
        drawApple(x, y, grid[r][c], 1.0, 1.0);
      }
    }
  }

  // Draw animations
  drawDroppedApples();

  // Draw selection
  drawSelection();

  // Draw remote cursors and selections
  for (let pid in remoteCursors) {
    let data = remoteCursors[pid];
    const color = getPlayerColor(pid);
    
    // Draw cursor
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(data.x * canvas.width, data.y * canvas.height, 5, 0, 2 * Math.PI);
    ctx.fill();
    
    // Draw selection if dragging
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

  requestAnimationFrame(drawGame);
}

function drawApple(x, y, value, alpha, scale) {
  const minRadius = 1;
  const radius = Math.max(minRadius, (cellSize / 2 - 5) * scale);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "red";
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

canvas.addEventListener("mousemove", (e) => {
  if (!gameActive || !selection.isActive) return;

  const rect = canvas.getBoundingClientRect();
  
  selection.currentX = (e.clientX - rect.left) / rect.width;
  selection.currentY = (e.clientY - rect.top) / rect.height;

  updateSelectionValidity();
  sendCursorUpdate();
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
}

function sendCursorUpdate() {
  if (!gameActive) return;

  const rect = canvas.getBoundingClientRect();
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
document.getElementById('copyIcon').addEventListener('click', function() {
  const roomCode = document.getElementById('roomCodeDisplayInGame').textContent;
  
  const tempInput = document.createElement('input');
  tempInput.value = roomCode;
  document.body.appendChild(tempInput);
  tempInput.select();
  
  try {
    document.execCommand('copy');
    
    const icon = document.getElementById('copyIcon');
    icon.textContent = '✓';
    icon.style.color = '#2ecc71';
    
    setTimeout(() => {
      icon.textContent = '⎘';
      icon.style.color = '#3498db';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy text: ', err);
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

// Reset button functionality
resetButton.addEventListener("click", () => {
  if (isHost) {
    socket.emit("startGame");
  } else {
    socket.emit("requestRejoin");
  }
});