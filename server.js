const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public")); // Serve front-end files from /public

// Grid configuration
const GRID_ROWS = 15;
const GRID_COLS = 20;

// Global game state
let grid = [];
let players = {};
let gameDuration = 120; // seconds
let gameActive = false;
let timerInterval;

// Global object to track players' cursors
let playerCursors = {};

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
   * Create a uniform board where each digit from 1 to 9 appears roughly equally.
   * This ensures that complementary pairs (e.g., 1 & 9, 2 & 8, etc.) occur with similar frequency.
   */
  function createGrid(rows = GRID_ROWS, cols = GRID_COLS) {
    const totalCells = rows * cols;
    let numbers = [];
    // Compute base count for each digit
    let baseCount = Math.floor(totalCells / 9);
    
    // Add each number (1..9) exactly baseCount times
    for (let n = 1; n <= 9; n++) {
      for (let i = 0; i < baseCount; i++) {
        numbers.push(n);
      }
    }
    
    // Fill any remaining cells (if totalCells is not divisible by 9) 
    let remainder = totalCells - numbers.length;
    let n = 1;
    while (remainder > 0) {
      numbers.push(n);
      n = (n % 9) + 1;
      remainder--;
    }
    
    // Shuffle the numbers array to randomize placement
    shuffleArray(numbers);
    
    // Build the board (2D array)
    let board = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      let row = [];
      for (let c = 0; c < cols; c++) {
        row.push(numbers[idx++]);
      }
      board.push(row);
    }
    return board;
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
  socket.on("setNickname", (data) => {
    if (players[socket.id]) {
      players[socket.id].nickname = data.nickname;
    }
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
      // ✅ NEW SCORING LOGIC BASED ON LENGTH
      const comboLength = validCells.length;
      const scoreGained = calculateScore(comboLength);
  
      validCells.forEach(({ row, col }) => {
        grid[row][col] = 0;
      });
  
      players[socket.id].score += scoreGained;
  
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
  
  // Scoring helper (feel free to tweak)
  function calculateScore(length) {
    return Math.floor((length * (length + 1)) / 2); // Triangular number logic
  }

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
