const socket = io();

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

// Drop animation (apples drop instead of fade)
let removingApples = []; // Each: { row, col, value, startTime, duration, dropDistance }

// Remote cursors
let remoteCursors = {};

// For assigning player names
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
 */
function updateScoreboard() {
  let html = "<h3>Scoreboard</h3><ul>";
  for (let pid in players) {
    if (!playerNames[pid]) {
      playerNames[pid] = "Player " + nextPlayerNumber;
      nextPlayerNumber++;
    }
    let name = playerNames[pid];
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
  
  // Animate dropped apples (drop animation)
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

/**
 * Animate removed apples with a drop animation.
 * Apples drop vertically by a fixed distance.
 */
function drawDroppedApples() {
    const now = performance.now();
  
    for (let i = removingApples.length - 1; i >= 0; i--) {
      const apple = removingApples[i];
      const elapsed = now - apple.startTime;
      const duration = apple.duration;
  
      if (elapsed >= duration) {
        // animation finished => remove from array
        removingApples.splice(i, 1);
      } else {
        // progress in [0..1]
        let progress = elapsed / duration;
  
        // Original (x, y) on the board
        let origX = offsetX + apple.col * cellSize;
        let origY = offsetY + apple.row * cellSize;
  
        // Move sideways linearly
        let sideOffset = apple.arcSide * apple.direction * progress;
        let x = origX + sideOffset;
  
        // Parabolic vertical offset
        // We'll use a simple parabola: up = arcPeak * 4 * progress * (1 - progress)
        // This gives 0 at progress=0 and progress=1, and a maximum at progress=0.5
        let up = apple.arcPeak * 4 * progress * (1 - progress);
        // The apple goes up from origY, so subtract 'up'
        let y = origY - up;
  
        // draw the apple at (x, y)
        drawApple(x, y, apple.value, 1.0, 1.0);
      }
    }
  }

/**
 * Draw the selection rectangle.
 */
function drawSelectionRect() {
  const selX = Math.min(startX, currentX);
  const selY = Math.min(startY, currentY);
  const selW = Math.abs(startX - currentX);
  const selH = Math.abs(startY - currentY);
  ctx.strokeStyle = "blue";
  ctx.lineWidth = 2;
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
  
      // pick random direction left/right
      let dir = Math.random() < 0.5 ? -1 : 1;
  
      removingApples.push({
        row,
        col,
        value: oldValue,
        startTime: performance.now(),
        duration: 600,    // 600ms for example
        arcPeak: 150,     // how high it flies (px)
        arcSide: 100,     // how far horizontally it travels
        direction: dir
      });
  
      grid[row][col] = 0; // remove from the main grid
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
    
    // Determine the winner
    let winnerId = null;
    for (let pid in data.players) {
      if (!winnerId || data.players[pid].score > data.players[winnerId].score) {
        winnerId = pid;
      }
    }
    let winnerName = playerNames[winnerId] || "Unknown";
    let winnerScore = data.players[winnerId].score;
    
    const modal = document.getElementById("gameOverModal");
    const finalScoreElem = document.getElementById("finalScore");
    finalScoreElem.innerHTML = `Your Score: ${myScore}<br>Winner: ${winnerName} (${winnerScore})`;
    modal.style.display = "flex";
    
    updateScoreboard();
});
socket.on("endGame", (data) => {
    updateScoreboard();
});
// --- Remote Cursor Handling ---
socket.on("updateCursor", (data) => {
  // Data: { playerId, x, y, isDragging, selection }
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

// Global mouseup: if released outside the canvas, end drag
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

// Close modal
document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("gameOverModal").style.display = "none";
});

// Start animation loop
autoScaleGrid();
requestAnimationFrame(drawGame);
