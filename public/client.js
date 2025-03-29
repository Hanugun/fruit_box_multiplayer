const socket = io();

// Global variable for player's chosen nickname.
let myNickname = "";

// Grid data
let grid = [];
let players = {};
let myScore = 0;

// References
let timeLeftElem = document.getElementById("timeLeft");
let myScoreElem = document.getElementById("yourScore");
let scoreboardDiv = document.getElementById("scoreboard");

// Canvas
let canvas = document.getElementById("gameCanvas");
let ctx = canvas.getContext("2d");

// For auto-scaling & centering the grid
let cellSize = 50;
let offsetX = 0;
let offsetY = 0;
let margin = 50; // margin inside the canvas

// Drag selection
let isDragging = false;
let startX = 0, startY = 0;
let currentX = 0, currentY = 0;

// Drop animation (apples drop with arc)
let removingApples = []; // Each: { row, col, value, startTime, duration, arcPeak, arcSide, direction }

// Remote cursors
let remoteCursors = {};

// For assigning player names (fallback if server has no nickname)
let playerNames = {};
let nextPlayerNumber = 1;

/**
 * Returns a unique color for a player based on their ID.
 */
function getPlayerColor(playerId) {
  const colors = [
    "#FF0000", // bright red
    "#FF9900", // bright orange
    "#FFFF00", // bright yellow
    "#00FF00", // bright lime green
    "#00FFFF", // bright cyan
    "#FF00FF", // bright magenta
    "#FFFFFF", // white
    "#FFD700"  // gold
  ];
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

/**
 * Utility: Calculate overlap area between two rectangles.
 */
function getRectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  const overlapX = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const overlapY = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  return overlapX * overlapY;
}

/**
 * Scale & center the grid in the canvas, leaving a margin.
 */
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

/**
 * Update scoreboard with player names and scores.
 * If a player's nickname is set (from server), use that.
 */
function updateScoreboard() {
  let html = "<h3>Scoreboard</h3><ul>";
  for (let pid in players) {
    // Use nickname from server if available; otherwise fallback.
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
  if (scoreboardDiv) {
    scoreboardDiv.innerHTML = html;
  }
}

/**
 * Main draw loop.
 */
function drawGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (!grid || grid.length === 0) {
    requestAnimationFrame(drawGame);
    return;
  }
  
  const rows = grid.length;
  const cols = grid[0].length;
  
  // Draw grid cell lines
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let x = offsetX + c * cellSize;
      let y = offsetY + r * cellSize;
      ctx.strokeStyle = "#b2e6be";
      ctx.strokeRect(x, y, cellSize, cellSize);
    }
  }
  
  // Draw remote players' cursors and selection boxes
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
  
  // If dragging locally, highlight selected apples with a ring
  if (isDragging) {
    highlightSelectedApples();
  }
  
  // Draw local apples (skip ones being removed)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] > 0) {
        let isRemoving = removingApples.some(a => a.row === r && a.col === c);
        if (!isRemoving) {
          let x = offsetX + c * cellSize;
          let y = offsetY + r * cellSize;
          drawApple(x, y, grid[r][c], 1.0, 1.0);
        }
      }
    }
  }
  
  // Animate dropped apples with arc animation
  drawDroppedApples();
  
  // Draw local selection rectangle if dragging
  if (isDragging) {
    drawSelectionRect();
  }
  
  requestAnimationFrame(drawGame);
}

/**
 * Highlight selected apples (local) with a ring.
 */
function highlightSelectedApples() {
  const selX = Math.min(startX, currentX);
  const selY = Math.min(startY, currentY);
  const selW = Math.abs(startX - currentX);
  const selH = Math.abs(startY - currentY);
  
  const rows = grid.length;
  const cols = grid[0].length;
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] > 0) {
        let x = offsetX + c * cellSize;
        let y = offsetY + r * cellSize;
        const overlapArea = getRectOverlap(selX, selY, selW, selH, x, y, cellSize, cellSize);
        const cellArea = cellSize * cellSize;
        if (overlapArea >= cellArea / 2) {
          const appleRadius = cellSize / 2 - 5;
          const ringRadius = appleRadius + 4;
          ctx.save();
          ctx.strokeStyle = "rgba(255, 255, 0, 0.8)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x + cellSize / 2, y + cellSize / 2, ringRadius, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }
}

/**
 * Draw a single apple: red circle with bold white number.
 */
function drawApple(x, y, value, alpha, scale) {
  const radius = (cellSize / 2 - 5) * scale;
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
// Bounce easing function (easeOutBounce)
function easeOutBounce(t) {
    if (t < (1 / 2.75)) {
      return 7.5625 * t * t;
    } else if (t < (2 / 2.75)) {
      t -= 1.5 / 2.75;
      return 7.5625 * t * t + 0.75;
    } else if (t < (2.5 / 2.75)) {
      t -= 2.25 / 2.75;
      return 7.5625 * t * t + 0.9375;
    } else {
      t -= 2.625 / 2.75;
      return 7.5625 * t * t + 0.984375;
    }
  }
  
/**
 * Animate removed apples with an arc animation.
 * Apples fly up and sideways in a parabolic arc.
 */
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
      
      // Horizontal movement: linear
      let sideOffset = apple.arcSide * apple.direction * progress;
      let x = origX + sideOffset;
      
      let y;
      if (progress <= 0.5) {
        // Upward phase: from origY to origY - apple.arcPeak
        let p = progress / 0.5; // normalize to [0,1]
        y = origY - apple.arcPeak * easeOutCubic(p);
      } else {
        // Fall phase: from (origY - apple.arcPeak) to off-screen (canvas.height + 50)
        let p = (progress - 0.5) / 0.5; // normalize to [0,1]
        let startYPos = origY - apple.arcPeak;
        let endYPos = canvas.height + 50;
        y = startYPos + easeInCubic(p) * (endYPos - startYPos);
      }
      
      drawApple(x, y, apple.value, 1.0, 1.0);
    }
  }
  
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  
  function easeInCubic(t) {
    return t * t * t;
  }
  

/**
 * Draw the selection rectangle.
 */
function drawSelectionRect() {
    const selX = Math.min(startX, currentX);
    const selY = Math.min(startY, currentY);
    const selW = Math.abs(startX - currentX);
    const selH = Math.abs(startY - currentY);
  
    // Calculate sum for the selected area
    let sum = 0;
    const rows = grid.length;
    const cols = grid[0].length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let x = offsetX + c * cellSize;
        let y = offsetY + r * cellSize;
        const overlapArea = getRectOverlap(selX, selY, selW, selH, x, y, cellSize, cellSize);
        const cellArea = cellSize * cellSize;
        if (overlapArea >= cellArea / 2) {
          sum += grid[r][c];
        }
      }
    }
  
    // If sum is exactly 10, use a dimmed style
    if (sum === 10) {
      // Draw a semi-transparent fill to "dim" the selection box
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(selX, selY, selW, selH);
      // And a thicker, darker border
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = 3;
    } else {
      ctx.strokeStyle = "blue";
      ctx.lineWidth = 2;
    }
    
    ctx.strokeRect(selX, selY, selW, selH);
  }
  
  
/**
 * Finalize selection and emit selected cells to the server.
 */
function finalizeSelection() {
  const selX = Math.min(startX, currentX);
  const selY = Math.min(startY, currentY);
  const selW = Math.abs(startX - currentX);
  const selH = Math.abs(startY - currentY);
  
  const rows = grid.length;
  const cols = grid[0].length;
  let selectedCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let x = offsetX + c * cellSize;
      let y = offsetY + r * cellSize;
      const overlapArea = getRectOverlap(selX, selY, selW, selH, x, y, cellSize, cellSize);
      const cellArea = cellSize * cellSize;
      if (overlapArea >= cellArea / 2) {
        selectedCells.push({ row: r, col: c });
      }
    }
  }
  socket.emit("selectApples", { cells: selectedCells });
}

// ----------------------------------------------------
// Socket.IO events
// ----------------------------------------------------
socket.on("gameState", (data) => {
  grid = data.grid;
  players = data.players;
  autoScaleGrid();
  updateScoreboard();
});

socket.on("selectionSuccess", (data) => {
    const { removed, playerId, newScore } = data;
    players[playerId].score = newScore;
    if (playerId === socket.id) {
      myScore = newScore;
      myScoreElem.textContent = myScore;
    }
    
    removed.forEach(({ row, col }) => {
      let oldValue = grid[row][col];
      if (oldValue < 1) oldValue = 1;
      let dir = Math.random() < 0.5 ? -1 : 1;
      // Randomize arcPeak between, say, 100 and 200 pixels.
      let randomArcPeak = 100 + Math.random() * 100;
      // Optionally randomize arcSide as well (e.g., between 80 and 120 pixels)
      let randomArcSide = 80 + Math.random() * 40;
      
      removingApples.push({
        row,
        col,
        value: oldValue,
        startTime: performance.now(),
        duration: 600,    // duration in milliseconds
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

socket.on("gameOver", (data) => {
  console.log("Game Over! Final Scores:", data.players);
  
  // Determine winner from players object
  let winnerId = null;
  for (let pid in data.players) {
    if (!winnerId || data.players[pid].score > data.players[winnerId].score) {
      winnerId = pid;
    }
  }
  let winnerName = players[winnerId] && players[winnerId].nickname ? players[winnerId].nickname : (playerNames[winnerId] || "Unknown");
  let winnerScore = data.players[winnerId].score;
  
  const modal = document.getElementById("gameOverModal");
  const finalScoreElem = document.getElementById("finalScore");
  finalScoreElem.innerHTML = `Your Score: ${myScore}<br>Winner: ${winnerName} (${winnerScore})`;
  modal.style.display = "flex";
  
  updateScoreboard();
});

// --- Remote Cursor Handling ---
socket.on("updateCursor", (data) => {
  remoteCursors[data.playerId] = data;
});
socket.on("removeCursor", (data) => {
  delete remoteCursors[data.playerId];
});

// Emit local cursor/selection info
function emitCursor() {
  socket.emit("playerCursor", {
    x: currentX,
    y: currentY,
    isDragging: isDragging,
    selection: { startX, startY, currentX, currentY }
  });
}

// ----------------------------------------------------
// Background Music and Sound Effects
// ----------------------------------------------------
const popSound = new Audio("pop.mp3");
const bgmBoss = new Audio("boss.mp3");
const bgmOIA = new Audio("oia.m4a");
const bgmChill = new Audio("chill.m4a");
const bgmAnime = new Audio("anime.m4a");

const bgmTracks = [bgmBoss, bgmOIA, bgmChill, bgmAnime];
bgmTracks.forEach(track => {
  track.loop = true;
  track.volume = parseFloat(document.getElementById("bgmVolume").value);
});

// Play pop sound on selection success and set its volume from popVolume slider
socket.on("selectionSuccess", (data) => {
  popSound.currentTime = 0;
  popSound.volume = parseFloat(document.getElementById("popVolume").value);
  popSound.play();
});

// BGM toggles
document.getElementById("bgmToggleBoss").addEventListener("change", (e) => {
  if (e.target.checked) {
    bgmBoss.play();
  } else {
    bgmBoss.pause();
  }
});
document.getElementById("bgmToggleOIA").addEventListener("change", (e) => {
  if (e.target.checked) {
    bgmOIA.play();
  } else {
    bgmOIA.pause();
  }
});
document.getElementById("bgmToggleChill").addEventListener("change", (e) => {
  if (e.target.checked) {
    bgmChill.play();
  } else {
    bgmChill.pause();
  }
});
document.getElementById("bgmToggleAnime").addEventListener("change", (e) => {
  if (e.target.checked) {
    bgmAnime.play();
  } else {
    bgmAnime.pause();
  }
});

// BGM volume control
document.getElementById("bgmVolume").addEventListener("input", (e) => {
  const vol = parseFloat(e.target.value);
  bgmTracks.forEach(track => track.volume = vol);
});

// Pop sound volume control
document.getElementById("popVolume").addEventListener("input", (e) => {
  const vol = parseFloat(e.target.value);
  popSound.volume = vol;
});

// ----------------------------------------------------
// Nickname Modal Handling
// ----------------------------------------------------
const nicknameModal = document.getElementById("nicknameModal");
const nicknameInput = document.getElementById("nicknameInput");
const nicknameSubmit = document.getElementById("nicknameSubmit");

// When the nickname is submitted, send it to the server and hide the modal.
nicknameSubmit.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim();
  if (nickname === "") {
    alert("Please enter a nickname.");
    return;
  }
  myNickname = nickname;
  // Emit setNickname event to server
  socket.emit("setNickname", { nickname });
  // Also store locally
  playerNames[socket.id] = nickname;
  // Hide the modal
  nicknameModal.style.display = "none";
});

// Optionally, prevent closing the modal without entering a nickname
window.addEventListener("load", () => {
  nicknameModal.style.display = "flex";
});

// ----------------------------------------------------
// Mouse & UI Setup
// ----------------------------------------------------
canvas.addEventListener("mousedown", (e) => {
  isDragging = true;
  const rect = canvas.getBoundingClientRect();
  startX = e.clientX - rect.left;
  startY = e.clientY - rect.top;
  currentX = startX;
  currentY = startY;
  emitCursor();
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  currentX = e.clientX - rect.left;
  currentY = e.clientY - rect.top;
  if (isDragging) {
    emitCursor();
  }
});

// Global mouseup: if released outside the canvas, end drag.
window.addEventListener("mouseup", (e) => {
  if (isDragging) {
    isDragging = false;
    finalizeSelection();
    emitCursor();
  }
});

// Reset button
document.getElementById("resetButton").addEventListener("click", () => {
  socket.emit("restartGame");
});

// Optional toggle for Light Colors
document.getElementById("lightColors").addEventListener("change", (e) => {
  console.log("Light Colors toggled:", e.target.checked);
});

// Close modal (for game over)
document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("gameOverModal").style.display = "none";
});

// Start animation loop
autoScaleGrid();
requestAnimationFrame(drawGame);
