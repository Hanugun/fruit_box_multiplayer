const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public")); // Serve front-end files from /public

// Grid configuration
const GRID_ROWS = 10;
const GRID_COLS = 17;

// Global game state
let grid = [];
let players = {};
let gameDuration = 120; // seconds
let gameActive = false;
let timerInterval;

// Global object to track players' cursors
let playerCursors = {};

/** Shuffle array (Fisher-Yates). */
/**
 * Shuffle array (Fisher-Yates).
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Create a grid with an even distribution of numbers 1..9,
 * then place them row by row, swapping out duplicates
 * when we detect adjacency with left or above cells.
 */
function createGrid(rows = GRID_ROWS, cols = GRID_COLS) {
  const totalCells = rows * cols;
  let numbers = [];

  // Evenly distribute 1..9
  const countEach = Math.floor(totalCells / 9);
  for (let n = 1; n <= 9; n++) {
    for (let i = 0; i < countEach; i++) {
      numbers.push(n);
    }
  }
  // Fill leftover
  while (numbers.length < totalCells) {
    numbers.push(Math.floor(Math.random() * 9) + 1);
  }

  // Shuffle once
  shuffleArray(numbers);

  // Prepare empty grid
  let newGrid = Array.from({ length: rows }, () => Array(cols).fill(0));

  // We'll place numbers in row-major order,
  // but if we detect adjacency duplicates, try a quick swap.
  let index = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let chosen = numbers[index];

      let left = c > 0 ? newGrid[r][c - 1] : null;
      let up   = r > 0 ? newGrid[r - 1][c] : null;

      // If chosen is the same as left or up, try to swap it
      if ((chosen === left) || (chosen === up)) {
        let swapIndex = -1;

        // Look ahead in the array for a different digit
        for (let j = index + 1; j < numbers.length; j++) {
          let temp = numbers[j];
          if (temp !== left && temp !== up) {
            swapIndex = j;
            break;
          }
        }
        // If found a suitable candidate, swap
        if (swapIndex !== -1) {
          [numbers[index], numbers[swapIndex]] = [numbers[swapIndex], numbers[index]];
          chosen = numbers[index];
        }
      }

      newGrid[r][c] = chosen;
      index++;
    }
  }

  return newGrid;
}
/** Start a new game: create grid, reset scores, broadcast state, start timer. */
function startGame() {
  grid = createGrid();
  gameActive = true;
  Object.values(players).forEach((p) => (p.score = 0));
  io.emit("gameState", {
    grid,
    players,
    timeLeft: gameDuration,
  });
  let timeLeft = gameDuration;
  timerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      gameOver();
    } else {
      io.emit("timerUpdate", { timeLeft });
    }
  }, 1000);
}

/** End the current game session. */
function gameOver() {
  clearInterval(timerInterval);
  gameActive = false;
  io.emit("gameOver", { players });
}
function endGame() {
    clearInterval(timerInterval);
    gameActive = false;
    io.emit("endGame", { players });
  }
  
// Socket.IO events
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);
  players[socket.id] = { playerId: socket.id, score: 0 };

  if (gameActive) {
    socket.emit("gameState", { grid, players });
  }

  // Listen for player's cursor updates
  socket.on("playerCursor", (data) => {
    // data: { x, y, isDragging, selection: { startX, startY, currentX, currentY } }
    playerCursors[socket.id] = data;
    // Broadcast to everyone except sender
    socket.broadcast.emit("updateCursor", { playerId: socket.id, ...data });
  });

  // Handle apple selection
  socket.on("selectApples", (data) => {
    if (!gameActive || !data.cells) return;
    let sum = 0;
    let validCells = [];
    for (let cell of data.cells) {
      const { row, col } = cell;
      if (grid[row] && grid[row][col] && grid[row][col] > 0) {
        sum += grid[row][col];
        validCells.push({ row, col });
      }
    }
    if (sum === 10 && validCells.length > 0) {
      validCells.forEach(({ row, col }) => {
        grid[row][col] = 0;
      });
      players[socket.id].score += validCells.length;
      io.emit("selectionSuccess", {
        removed: validCells,
        playerId: socket.id,
        newScore: players[socket.id].score,
      });
    } else {
      socket.emit("selectionFail", {
        reason: "Sum not 10 or cells invalid.",
      });
    }
  });

  // Restart game
  socket.on("restartGame", () => {
    console.log("Restarting game at the request of:", socket.id);
    endGame();
    startGame();
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    delete players[socket.id];
    delete playerCursors[socket.id];
    socket.broadcast.emit("removeCursor", { playerId: socket.id });
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startGame();
});
