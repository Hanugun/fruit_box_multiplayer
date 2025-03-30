const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public"));

// Game configuration
const GRID_ROWS = 13;
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
  socket.on("createRoom", ({ nickname }) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode.toUpperCase(),
      host: socket.id,
      maxPlayers: 10,
      players: new Map(),
      spectators: new Set(),
      gameActive: false,
      grid: null,
      timer: null,
      timeLeft: GAME_DURATION,
      pokeCombos: new Map(),
    };

    room.players.set(socket.id, {
      id: socket.id,
      nickname,
      score: 0,
      isActive: true,
    });

    rooms.set(roomCode, room);
    currentRoom = roomCode;
    socket.join(roomCode);

    socket.emit("roomCreated", {
      roomCode,
      players: Array.from(room.players.values()),
    });
  });

  // Join an existing room
 // Update the joinRoom handler
 socket.on("joinRoom", ({ roomCode, nickname }) => {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) return socket.emit("roomError", "Room not found");
  
  // Clear any existing status
  room.players.delete(socket.id);
  room.spectators.delete(socket.id);
  
  if (room.gameActive) {
    // ALWAYS join as spectator during active game
    room.spectators.add(socket.id);
    socket.join(roomCode);
    
    socket.emit("forceGameState", {
      roomCode: room.code,
      grid: room.grid,
      players: Array.from(room.players.values()),
      timeLeft: room.timeLeft,
      isSpectator: true,
      canPlay: false,
      message: "Wait till the next game starts..."
    });
  } else {
    // Normal join as player when game isn't active
    if (room.players.size >= room.maxPlayers) {
      return socket.emit("roomError", "Room is full");
    }
    
    room.players.set(socket.id, { 
      id: socket.id, 
      nickname,
      score: 0,
      isActive: true 
    });

    socket.emit("roomJoined", {
      roomCode,
      players: Array.from(room.players.values()),
      canPlay: true
    });
    
    io.to(roomCode).emit("playerJoined", Array.from(room.players.values()));
  }
  currentRoom = roomCode;
  socket.join(roomCode);
  
});
// Add this new event handler
socket.on("requestRejoin", () => {
  if (!currentRoom || !rooms.has(currentRoom)) {
    socket.emit("roomError", "Room not found");
    return;
  }

  const room = rooms.get(currentRoom);
  
  // Check if player was previously in this room
  const wasPlayer = room.players.has(socket.id);
  const wasSpectator = room.spectators.has(socket.id);

  if (wasPlayer || wasSpectator) {
    socket.join(room.code);
    
    if (room.gameActive) {
      // Send full game state
      socket.emit("forceGameState", {
        grid: room.grid,
        players: Array.from(room.players.values()),
        timeLeft: room.timeLeft,
        isSpectator: wasSpectator
      });
      
      if (wasPlayer) {
        // Reactivate player if they were disconnected
        const player = room.players.get(socket.id);
        if (player) player.isActive = true;
      }
    } else {
      // If game isn't active, just put them back in the lobby
      socket.emit("roomJoined", {
        roomCode: room.code,
        players: Array.from(room.players.values())
      });
    }
  } else {
    socket.emit("roomError", "Not previously in this room");
  }
});
socket.on("quitRoom", () => {
  const room = rooms.get(currentRoom);
  if (!room) return;

  // Remove from players if present
  if (room.players.has(socket.id)) {
    room.players.delete(socket.id);
    io.to(currentRoom).emit("playerLeft", Array.from(room.players.values()));
    if (room.players.size === 0) {
      clearInterval(room.timer);
      rooms.delete(currentRoom);
    }
  }
  // Also remove from spectators if present
  if (room.spectators.has(socket.id)) {
    room.spectators.delete(socket.id);
  }
  // Remove the socket from the room completely
  socket.leave(room.code);
});


  // Start the game (host only)
  socket.on("startGame", () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
  
    // Clear existing timer
    if (room.timer) clearInterval(room.timer);
  
    // Convert ALL spectators to players (if there's space)
    const spectatorIds = Array.from(room.spectators.keys());
    spectatorIds.forEach(spectatorId => {
      if (room.players.size < room.maxPlayers) {
        const spectatorSocket = io.sockets.sockets.get(spectatorId);
        if (spectatorSocket) {
          room.players.set(spectatorId, {
            id: spectatorId,
            nickname: spectatorSocket.nickname || `Player ${room.players.size + 1}`,
            score: 0,
            isActive: true
          });
          room.spectators.delete(spectatorId);
        }
      }
    });
  
    // Reset game state for all players
    room.players.forEach(player => {
      player.score = 0;
      player.isActive = true; // Ensure all players are active
    });
  
    room.gameActive = true;
    room.grid = createGrid();
    room.timeLeft = GAME_DURATION;
  
    // Start timer
    room.timer = setInterval(() => {
      room.timeLeft--;
      io.to(room.code).emit("timerUpdate", { timeLeft: room.timeLeft });
      if (room.timeLeft <= 0) {
        clearInterval(room.timer);
        endGame(room);
      }
    }, 1000);
  
    // Notify all clients
    io.to(room.code).emit("gameStarted", {
      roomCode: room.code,
      grid: room.grid,
      players: Array.from(room.players.values())
    });
  
    // Force update state for everyone
    io.to(room.code).emit("forceGameState", {
      grid: room.grid,
      players: Array.from(room.players.values()),
      timeLeft: room.timeLeft,
      isSpectator: false,
      canPlay: true,
      message: ""
    });
  });
  // Handle apple selection attempts
  socket.on("selectApples", (data) => {
    if (!currentRoom) {
      return socket.emit("selectionFail", { reason: "Not in a room" });
    }
    const room = rooms.get(currentRoom);
    if (!room || !room.gameActive) {
      return socket.emit("selectionFail", { reason: "Game not active" });
    }
  
    const player = room.players.get(socket.id);
    if (!player || !player.isActive) {
      return socket.emit("selectionFail", { reason: "Player not active" });
    }
  
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
        newScore: player.score,
      });
    } else {
      // Notify player of failed selection
      socket.emit("selectionFail", { reason: "Invalid selection" });
    }
  });
  socket.on("resetGame", () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
  
    // Reset all player scores
    room.players.forEach(player => {
      player.score = 0;
    });
  
    // Reset the grid if game is active
    if (room.gameActive) {
      room.grid = createGrid();
      room.timeLeft = GAME_DURATION;
      
      // Reset and restart timer
      if (room.timer) clearInterval(room.timer);
      room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(room.code).emit("timerUpdate", { timeLeft: room.timeLeft });
        if (room.timeLeft <= 0) {
          clearInterval(room.timer);
          endGame(room);
        }
      }, 1000);
    }
  
    // Broadcast the full reset state to all clients
    io.to(room.code).emit("gameReset", {
      players: Array.from(room.players.values()),
      grid: room.grid,
      timeLeft: room.timeLeft
    });
  });
  socket.on("playerCursor", (data) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    socket.to(room.code).emit("updateCursor", {
      playerId: socket.id,
      ...data,
    });
  });
  socket.on("pokeHost", () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const TIMEOUT = 2000; // milliseconds for combo threshold
    const now = Date.now();
  
    // Retrieve or initialize combo data for this sender
    let comboData = room.pokeCombos.get(socket.id) || { count: 0, lastTime: 0 };
  
    // If the last poke was within the threshold, increment; otherwise, reset
    if (now - comboData.lastTime < TIMEOUT) {
      comboData.count++;
    } else {
      comboData.count = 1;
    }
    comboData.lastTime = now;
    room.pokeCombos.set(socket.id, comboData);
  
    // Forward the poke to the host with the combo count
    if (room.host) {
      io.to(room.host).emit("pokeReceived", { from: socket.id, combo: comboData.count });
    }
  
    // Also send the combo count back to the poking (non-host) player
    socket.emit("pokeCombo", { combo: comboData.count });
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
    } else if (room.spectators.has(socket.id)) {
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
        score: winner.score,
      });
    } else {
      // Fallback if no winner could be determined
      io.to(room.code).emit("gameOver", {
        players,
        winner: "No winner",
        score: 0,
      });
    }
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
app.get('/ads.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'ads.txt'));
});