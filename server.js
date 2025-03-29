const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public"));

// Game configuration
const GRID_ROWS = 15;
const GRID_COLS = 20;
const GAME_DURATION = 120; // 2 minutes
const rooms = new Map();

/**
 * Generate a random 6-character room code
 */
function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

/**
 * Create a uniform board where each digit from 1 to 9 appears roughly equally
 */
function createGrid() {
  const totalCells = GRID_ROWS * GRID_COLS;
  let numbers = [];
  const baseCount = Math.floor(totalCells / 9);
  
  // Add each number (1..9) exactly baseCount times
  for (let n = 1; n <= 9; n++) {
    for (let i = 0; i < baseCount; i++) {
      numbers.push(n);
    }
  }
  
  // Fill any remaining cells
  let remainder = totalCells - numbers.length;
  let n = 1;
  while (remainder > 0) {
    numbers.push(n);
    n = (n % 9) + 1;
    remainder--;
  }
  
  // Shuffle the numbers
  numbers = numbers.sort(() => Math.random() - 0.5);
  
  // Build the 2D array
  let board = [];
  let idx = 0;
  for (let r = 0; r < GRID_ROWS; r++) {
    let row = [];
    for (let c = 0; c < GRID_COLS; c++) {
      row.push(numbers[idx++]);
    }
    board.push(row);
  }
  return board;
}

/**
 * Calculate score based on combo length (triangular number)
 */
function calculateScore(length) {
  return Math.floor((length * (length + 1)) / 2);
}

io.on("connection", (socket) => {
  let currentRoom = null;

  // Create a new game room
  socket.on("createRoom", ({ maxPlayers, nickname }) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      host: socket.id,
      maxPlayers: Math.min(5, Math.max(1, maxPlayers)),
      players: new Map(),
      spectators: new Set(),
      gameActive: false,
      grid: null,
      timer: null,
      timeLeft: GAME_DURATION
    };
    
    room.players.set(socket.id, {
      id: socket.id,
      nickname,
      score: 0,
      isActive: true
    });
    
    rooms.set(roomCode, room);
    currentRoom = roomCode;
    socket.join(roomCode);
    
    socket.emit("roomCreated", {
      roomCode,
      players: Array.from(room.players.values())
    });
  });

  // Join an existing room
  socket.on("joinRoom", ({ roomCode, nickname }) => {
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) return socket.emit("roomError", "Room not found");
    
    if (room.gameActive) {
      // Join as spectator if game is already active
      room.spectators.add(socket.id);
      socket.join(roomCode);
      socket.emit("spectatorJoined", { 
        grid: room.grid,
        players: Array.from(room.players.values()),
        timeLeft: room.timeLeft 
      });
      return;
    }
    
    if (room.players.size >= room.maxPlayers) {
      return socket.emit("roomError", "Room is full");
    }
    
    room.players.set(socket.id, { 
      id: socket.id, 
      nickname,
      score: 0,
      isActive: true 
    });
    currentRoom = roomCode;
    socket.join(roomCode);
    
    // Notify the joining player
    socket.emit("roomJoined", {
      roomCode,
      players: Array.from(room.players.values())
    });
    
    // Notify all players in the room
    io.to(roomCode).emit("playerJoined", Array.from(room.players.values()));
  });
  socket.on("quitRoom", () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    
    if (room.players.has(socket.id)) {
      room.players.delete(socket.id);
      io.to(currentRoom).emit("playerLeft", Array.from(room.players.values()));
      
      if (room.players.size === 0) {
        clearInterval(room.timer);
        rooms.delete(currentRoom);
      }
    }
  });
  // Start the game (host only)
  socket.on("startGame", () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    
    room.gameActive = true;
    room.grid = createGrid();
    room.timeLeft = GAME_DURATION;
    
    // Start game timer
    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(room.code).emit("timerUpdate", { timeLeft: room.timeLeft });
        
        if (room.timeLeft <= 0) {
          clearInterval(room.timer);
          // Only end game if there are players
          if (room.players.size > 0) {
            endGame(room);
          } else {
            // No players, just clean up
            clearInterval(room.timer);
            rooms.delete(room.code);
          }
        }
      }, 1000);
    
    // Notify all players that game has started
    io.to(room.code).emit("gameStarted", {
      grid: room.grid,
      players: Array.from(room.players.values())
    });
  });

  // Handle apple selection attempts
  socket.on("selectApples", (data) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.gameActive || !room.players.get(socket.id)?.isActive) return;
    
    let sum = 0;
    let validCells = [];
    
    // Validate selected cells
    for (let cell of data.cells) {
      const { row, col } = cell;
      if (room.grid[row] && room.grid[row][col] && room.grid[row][col] > 0) {
        sum += room.grid[row][col];
        validCells.push({ row, col });
      }
    }
    
    // If selection sums to 10 and has at least one cell
    if (sum === 10 && validCells.length > 0) {
      // Clear the selected cells
      validCells.forEach(({ row, col }) => {
        room.grid[row][col] = 0;
      });
      
      // Update player score
      const player = room.players.get(socket.id);
      player.score += calculateScore(validCells.length);
      
      // Notify all players of successful selection
      io.to(room.code).emit("selectionSuccess", {
        removed: validCells,
        playerId: socket.id,
        newScore: player.score
      });      
    } else {
      // Notify player of failed selection
      socket.emit("selectionFail", { reason: "Invalid selection" });
    }
  });

  // Broadcast cursor position to other players
  socket.on("playerCursor", (data) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    
    socket.to(room.code).emit("updateCursor", {
      playerId: socket.id,
      ...data
    });
  });

  // Handle disconnections
  socket.on("disconnect", () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    
    if (room.players.has(socket.id)) {
      const wasHost = room.host === socket.id;
      room.players.delete(socket.id);
      
      if (wasHost) {
        // Notify all players that host has left
        io.to(room.code).emit("hostDisconnected");
        
        // Clean up room if host was the only player
        if (room.players.size === 0) {
          clearInterval(room.timer);
          rooms.delete(currentRoom);
        } else {
          // Assign new host
          room.host = room.players.keys().next().value;
        }
      }
      
      io.to(currentRoom).emit("playerLeft", Array.from(room.players.values()));
    } 
    else if (room.spectators.has(socket.id)) {
      room.spectators.delete(socket.id);
    }
  });

  /**
   * End the game and declare winner
   */
  function endGame(room) {
    room.gameActive = false;
    clearInterval(room.timer);
    
    const players = Array.from(room.players.values());
    
    // Check if there are any players left
    if (players.length === 0) {
      // No players left, just clean up
      rooms.delete(room.code);
      return;
    }
    
    let winner = players[0];
    
    // Find player with highest score
    for (let i = 1; i < players.length; i++) {
      if (players[i].score > winner.score) {
        winner = players[i];
      }
    }
    
    // Check if we actually have a winner
    if (winner) {
      io.to(room.code).emit("gameOver", {
        players,
        winner: winner.nickname || "Anonymous",
        score: winner.score
      });
    } else {
      // Fallback if no winner could be determined
      io.to(room.code).emit("gameOver", {
        players,
        winner: "No winner",
        score: 0
      });
    }
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});