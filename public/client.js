const socket = io();
let myNickname = "";
let currentRoom = "";
let isHost = false;
let gameActive = false;

// Game state variables
let grid = [];
let players = {};
let myScore = 0;
// Add this near the top with other DOM elements
const roomCodeDisplayElem = document.getElementById("roomCodeDisplay");
const resetButton = document.getElementById("resetButton");
const quitButton = document.createElement("button"); // We'll add this dynamically
// DOM elements
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
const selection = {
    isActive: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isValid: false,
    highlightedCells: []
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

// Modals
const modals = {
  initial: document.getElementById("initialModal"),
  create: document.getElementById("createRoomModal"),
  join: document.getElementById("joinRoomModal"),
  lobby: document.getElementById("lobbyModal"),
  gameOver: document.getElementById("gameOverModal")
};

// Initialize sound
bgmTracks.forEach(track => {
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
  const maxPlayers = parseInt(document.getElementById("maxPlayers").value);
  if (!nickname || maxPlayers < 1 || maxPlayers > 5) {
    alert("Please enter a valid nickname and player count (1-5)");
    return;
  }
  
  myNickname = nickname;
  socket.emit("createRoom", { maxPlayers, nickname });
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
  document.getElementById("roomCodeDisplay").textContent = roomCode;
  modals.lobby.style.display = "flex";
  updatePlayerList(players);
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
  bgmTracks.forEach(track => track.volume = vol);
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
  document.getElementById("roomCodeDisplay").textContent = roomCode;
  modals.create.style.display = "none";
  modals.lobby.style.display = "flex";
  updatePlayerList(players);
});

socket.on("playerJoined", (players) => {
  updatePlayerList(players);
  if (isHost) {
    document.getElementById("startGameBtn").disabled = players.length < 1;
  }
});

socket.on("gameStarted", (gameState) => {
    gameActive = true;
    resetSelection(); // Add this line
  modals.lobby.style.display = "none";
  
document.getElementById("gameInfo").style.display = "flex";
document.getElementById("gameInfo").style.justifyContent = "space-between";

  document.getElementById("gameContainer").style.display = "block";
  document.getElementById("waitOverlay").style.display = "none";
  canvas.classList.remove("spectator");
  initializeGame(gameState);
});

socket.on("spectatorJoined", (gameState) => {
  gameActive = false;
  document.getElementById("waitOverlay").style.display = "flex";
  canvas.classList.add("spectator");
  initializeGame(gameState);
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
      myScoreElem.textContent = myScore;
      // Only play sound for local player
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
      direction: dir
    });
    grid[row][col] = 0;
  });
  
  updateScoreboard();
});

socket.on("selectionFail", (data) => {
  console.log("Selection failed:", data.reason);
});

socket.on("timerUpdate", (data) => {
  timeLeftElem.textContent = data.timeLeft;
});

// Update the gameOver handler:
socket.on("gameOver", (data) => {
    gameActive = false;  // Changed from true to false
    resetSelection(); // Add this line
    const finalScoreElem = document.getElementById("finalScore");
    finalScoreElem.innerHTML = `Your Score: ${myScore}<br>Winner: ${data.winner} (${data.score})`;
    
    // Show the modal
    modals.gameOver.style.display = "flex";
    
    // Ensure buttons exist
    const gameOverModalContent = document.querySelector("#gameOverModal .modal-content");
    if (!document.getElementById("playAgainBtn")) {
      const playAgainBtn = document.createElement("button");
      playAgainBtn.id = "playAgainBtn";
      playAgainBtn.textContent = "Play Again";
      playAgainBtn.className = "modal-btn";
      playAgainBtn.addEventListener("click", () => {
        if (isHost) {
          socket.emit("startGame");
        }
        modals.gameOver.style.display = "none";
      });
      
      const quitBtn = document.createElement("button");
      quitBtn.id = "quitBtn";
      quitBtn.textContent = "Quit";
      quitBtn.className = "modal-btn";
      quitBtn.addEventListener("click", () => {
        socket.emit("quitRoom");
        window.location.reload();
      });
      
      // Remove existing close button
      const closeBtn = document.getElementById("closeModal");
      if (closeBtn) closeBtn.remove();
      
      // Add new buttons
      gameOverModalContent.appendChild(playAgainBtn);
      gameOverModalContent.appendChild(quitBtn);
    }
  });
socket.on("hostDisconnected", () => {
    alert("The host has left the game. You will be returned to the main menu.");
    window.location.reload();
  });
// Reset button functionality
resetButton.addEventListener("click", () => {
    if (isHost) {
      socket.emit("startGame");
    }
  });
  
  // Update the room code display position
  function updateRoomCodeDisplay() {
    const gameInfo = document.getElementById("gameInfo");
    const roomCodeSpan = document.createElement("span");
    roomCodeSpan.id = "roomCodeDisplayInGame";
    roomCodeSpan.textContent = currentRoom;
    roomCodeSpan.style.margin = "0 auto";
    
    // Clear any existing room code display
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
  let html = "<h3>Scoreboard</h3><ul>";
  for (let pid in players) {
    let name = players[pid].nickname || (playerNames[pid] || ("Player " + nextPlayerNumber));
    if (!playerNames[pid] && !players[pid].nickname) {
      playerNames[pid] = "Player " + nextPlayerNumber;
      nextPlayerNumber++;
      name = playerNames[pid];
    }
    let color = getPlayerColor(pid);
    let score = players[pid].score || 0;
    html += `<li style="color: ${color};">${name}: ${score}</li>`;
  }
  html += "</ul>";
  scoreboardDiv.innerHTML = html;
}

function getPlayerColor(playerId) {
  const colors = ["#FF0000","#FF9900","#FFFF00","#00FF00","#00FFFF","#FF00FF","#FFFFFF","#FFD700"];
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
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
        if (grid[r][c] > 0 && !removingApples.some(a => a.row === r && a.col === c)) {
          let x = offsetX + c * cellSize;
          let y = offsetY + r * cellSize;
          drawApple(x, y, grid[r][c], 1.0, 1.0);
        }
      }
    }
    
    // Draw animations
    drawDroppedApples();
    
    // Draw selection (new system only)
    drawSelection();
    
    // Draw remote cursors
    for (let pid in remoteCursors) {
      let data = remoteCursors[pid];
      const color = getPlayerColor(pid);
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(data.x, data.y, 5, 0, 2 * Math.PI);
      ctx.fill();
      if (data.isDragging && data.selection) {
        let { startX: sX, startY: sY, currentX: cX, currentY: cY } = data.selection;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.min(sX, cX), Math.min(sY, cY), Math.abs(sX - cX), Math.abs(sY - cY));
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
  ctx.font = `bold ${Math.floor(30 * scale)}px Arial`;
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
      y = (origY - apple.arcPeak) + Math.pow(p, 3) * (canvas.height + 50 - (origY - apple.arcPeak));
    }
    
    drawApple(x, y, apple.value, 1.0 - progress, 1.0 - progress * 0.5);
  }
}


function updatePlayerList(players) {
  const list = document.getElementById("playerList");
  list.innerHTML = players
    .map(player => `<li>${player.nickname} ${player.id === socket.id ? '(you)' : ''}</li>`)
    .join('');
}

function initializeGame(gameState) {
  grid = gameState.grid;
  players = gameState.players.reduce((acc, player) => {
    acc[player.id] = player;
    return acc;
  }, {});
  
  // Set canvas size
  canvas.width = 1200;
  canvas.height = 1000;
  
  autoScaleGrid();
  updateScoreboard();
}

  
// Mouse event handlers
canvas.addEventListener("mousedown", (e) => {
    if (!gameActive) return;
    
    const rect = canvas.getBoundingClientRect();
    selection.isActive = true;
    selection.startX = e.clientX - rect.left;
    selection.startY = e.clientY - rect.top;
    selection.currentX = selection.startX;
    selection.currentY = selection.startY;
    
    updateSelectionValidity();
    sendCursorUpdate();
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!gameActive || !selection.isActive) return;
    
    const rect = canvas.getBoundingClientRect();
    selection.currentX = e.clientX - rect.left;
    selection.currentY = e.clientY - rect.top;
    
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
    const selX = Math.min(selection.startX, selection.currentX);
    const selY = Math.min(selection.startY, selection.currentY);
    const selW = Math.abs(selection.startX - selection.currentX);
    const selH = Math.abs(selection.startY - selection.currentY);
    
    let sum = 0;
    selection.highlightedCells = [];
    
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[0].length; c++) {
        const x = offsetX + c * cellSize;
        const y = offsetY + r * cellSize;
        
        // More precise overlap calculation (center-point check)
        const centerX = x + cellSize/2;
        const centerY = y + cellSize/2;
        
        if (centerX >= selX && centerX <= selX + selW &&
            centerY >= selY && centerY <= selY + selH) {
          if (grid[r][c] > 0) {
            sum += grid[r][c];
            selection.highlightedCells.push({row: r, col: c});
          }
        }
      }
    }
    
    selection.isValid = sum === 10 && selection.highlightedCells.length > 0;
  }
  
function drawSelection() {
    if (!selection.isActive || !grid.length) return;
    const selX = Math.min(selection.startX, selection.currentX);
    const selY = Math.min(selection.startY, selection.currentY);
    const selW = Math.abs(selection.startX - selection.currentX);
    const selH = Math.abs(selection.startY - selection.currentY);
    
    // Draw selection box
    ctx.strokeStyle = selection.isValid ? "rgba(0, 200, 0, 0.8)" : "rgba(0, 0, 255, 0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(selX, selY, selW, selH);
    
    // Fill selection area
    ctx.fillStyle = selection.isValid ? "rgba(0, 255, 0, 0.1)" : "rgba(0, 0, 255, 0.1)";
    ctx.fillRect(selX, selY, selW, selH);
    
    // Highlight selected apples
    selection.highlightedCells.forEach(({row, col}) => {
      const x = offsetX + col * cellSize;
      const y = offsetY + row * cellSize;
      
      // Draw highlight circle
      ctx.save();
      ctx.strokeStyle = selection.isValid ? "rgba(255, 255, 0, 0.8)" : "rgba(255, 165, 0, 0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        x + cellSize / 2,
        y + cellSize / 2,
        cellSize / 2 - 2,
        0,
        Math.PI * 2
      );
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
function getRectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  const overlapX = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const overlapY = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  return overlapX * overlapY;
}

// Initialize
window.addEventListener("load", () => {
  modals.initial.style.display = "flex";
  canvas.width = 1200;
  canvas.height = 1000;
  requestAnimationFrame(drawGame);
});