const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public"));


const gridLevels = {
  easy: { cols: 16 },
  normal: { cols: 20 },    // Default: 20 columns, rows ≈ 13
  hard: { cols: 24 },
  extreme: { cols: 28 },
  nightmare: { cols: 32 }
};

// Default timer (in seconds)
const DEFAULT_TIMER = 120;
const COMBO_DURATION = 3000;
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
function createGrid(cols, rows) {
  const totalCells = rows * cols;
  let numbers = [];
  const baseCount = Math.floor(totalCells / 9);
  for (let n = 1; n <= 9; n++) {
    for (let i = 0; i < baseCount; i++) {
      numbers.push(n);
    }
  }
  let remainder = totalCells - numbers.length;
  let digit = 1;
  while (remainder > 0) {
    numbers.push(digit);
    digit = (digit % 9) + 1;
    remainder--;
  }
  // Fisher-Yates shuffle
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  // Build grid
  const board = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push(numbers[idx++]);
    }
    board.push(row);
  }
  return board;
}
/**
 * Calculate score based on combo length (triangular number)
 */
function calculateScore(length,combo) {
  const baseScore = length; // Simple length-based scoring
  const comboBonus = [0, 1, 2, 3, 4][combo - 1] || 0; // +1, +2, +3, +4 for x2, x3, x4, x5
  return baseScore + comboBonus;
}

io.on("connection", (socket) => {
  let currentRoom = null;

  // Create a new game room
  socket.on("createRoom", ({ nickname }) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      host: socket.id,
      maxPlayers: 10,
      players: new Map(),
      spectators: new Set(),
      gameActive: false,
      grid: null,
      timer: null,
      timerDuration: DEFAULT_TIMER,
      gridLevel: "normal",
      timeLeft: DEFAULT_TIMER,
      pokeCombos: new Map(),
      mods: {
        hidden: false,
        flashlight: false
      },
      playerCombos: new Map()
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
  socket.on("setGameSettings", (settings) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    
    
    if (settings.level && gridLevels[settings.level]) {
      room.gridLevel = settings.level;
    }
    
    if (settings.timer) {
      room.timerDuration = Math.min(Math.max(settings.timer, 30), 300);
    }
    
    if (settings.mods) {
      room.mods = {
        hidden: settings.mods.includes('hidden'),
        flashlight: settings.mods.includes('flashlight')
      };
    }
    
    io.to(room.code).emit("lobbyNotification", { 
      message: "Game settings updated" 
    });
  });
  // Join an existing room
  socket.on("joinRoom", ({ roomCode, nickname }) => {
    socket.nickname = nickname; // Store the nickname on the socket
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) return socket.emit("roomError", "Room not found");
    
    // Clear any existing status
    room.players.delete(socket.id);
    room.spectators.delete(socket.id);
    
    if (room.gameActive) {
      // Always join as spectator during active game
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
    
    // Notify the host
    if (socket.id !== room.host) {
      const role = room.gameActive ? 'as a spectator' : '';
      io.to(room.host).emit("lobbyNotification", { message: `${nickname} joined the lobby ${role}` });
    }
    
    currentRoom = roomCode;
    socket.join(roomCode);
  });
  
// Add this new event handler
socket.on("requestRejoin", () => {
  if (!currentRoom || !rooms.has(currentRoom)) return socket.emit("roomError", "Room not found");
  const room = rooms.get(currentRoom);
  const wasPlayer = room.players.has(socket.id);
  const wasSpectator = room.spectators.has(socket.id);
  if (wasPlayer || wasSpectator) {
    socket.join(room.code);
    if (room.gameActive) {
      socket.emit("forceGameState", {
        grid: room.grid,
        players: Array.from(room.players.values()).map(p => ({
          ...p,
          comboLevel: room.playerCombos.get(p.id)?.level || 1
        })),
        timeLeft: room.timeLeft,
        isSpectator: wasSpectator,
        playerCombos: Object.fromEntries(room.playerCombos)
      });
      if (wasPlayer) room.players.get(socket.id).isActive = true;
    } else {
      socket.emit("roomJoined", { roomCode: room.code, players: Array.from(room.players.values()) });
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
    const level = room.gridLevel || "normal";
    const cols = gridLevels[level].cols;
    const rows = Math.round(cols * 0.65);
    if (room.timer) clearInterval(room.timer);
    const spectatorIds = Array.from(room.spectators.keys());
    spectatorIds.forEach(spectatorId => {
      if (room.players.size < room.maxPlayers) {
        const spectatorSocket = io.sockets.sockets.get(spectatorId);
        if (spectatorSocket) {
          room.players.set(spectatorId, { id: spectatorId, nickname: spectatorSocket.nickname || `Player ${room.players.size + 1}`, score: 0, isActive: true });
          room.spectators.delete(spectatorId);
        }
      }
    });
    room.players.forEach(player => { player.score = 0; player.isActive = true; });
    room.gameActive = true;
    room.grid = createGrid(cols, rows);
    room.timeLeft = room.timerDuration || DEFAULT_TIMER;
    room.playerCombos.clear(); // Reset combos at game start
    room.players.forEach(player => room.playerCombos.set(player.id, { level: 1, lastSelection: 0 }));
    room.timer = setInterval(() => {
      room.timeLeft--;
      
      // Check and reset expired combos
      const now = Date.now();
      room.playerCombos.forEach((comboData, playerId) => {
        if (now - comboData.lastSelection >= COMBO_DURATION && comboData.level > 1) {
          comboData.level = 1; // Reset to 1 when combo expires
          room.playerCombos.set(playerId, { ...comboData, level: 1 });
        }
      });
  
      io.to(room.code).emit("timerUpdate", { timeLeft: room.timeLeft, totalTime: room.timerDuration });
      io.to(room.code).emit("gameState", {
        grid: room.grid,
        players: Array.from(room.players.values()).map(p => ({
          ...p,
          comboLevel: room.playerCombos.get(p.id)?.level || 1
        })),
        playerCombos: Object.fromEntries(room.playerCombos)
      });
  
      if (room.timeLeft <= 0) {
        clearInterval(room.timer);
        endGame(room);
      }
    }, 1000);
  
    io.to(room.code).emit("gameStarted", {
      roomCode: room.code,
      grid: room.grid,
      players: Array.from(room.players.values()).map(p => ({
        ...p,
        comboLevel: room.playerCombos.get(p.id)?.level || 1
      })),
      level: room.gridLevel,
      timer: room.timerDuration,
      mods: room.mods,
      playerCombos: Object.fromEntries(room.playerCombos)
    });
    io.to(room.code).emit("forceGameState", {
      grid: room.grid,
      players: Array.from(room.players.values()).map(p => ({
        ...p,
        comboLevel: room.playerCombos.get(p.id)?.level || 1
      })),
      timeLeft: room.timeLeft,
      isSpectator: false,
      canPlay: true,
      message: "",
      playerCombos: Object.fromEntries(room.playerCombos)
    });
  });
  // Handle apple selection attempts
  socket.on("selectApples", (data) => {
    if (!currentRoom) return socket.emit("selectionFail", { reason: "Not in a room" });
    const room = rooms.get(currentRoom);
    if (!room || !room.gameActive) return socket.emit("selectionFail", { reason: "Game not active" });
    const player = room.players.get(socket.id);
    if (!player || !player.isActive) return socket.emit("selectionFail", { reason: "Player not active" });
    let sum = 0;
    let validCells = [];
    for (let cell of data.cells) {
      const { row, col } = cell;
      if (room.grid[row] && room.grid[row][col] && room.grid[row][col] > 0) {
        sum += room.grid[row][col];
        validCells.push({ row, col });
      }
    }
    if (sum === 10 && validCells.length > 0) {
      validCells.forEach(({ row, col }) => { room.grid[row][col] = 0; });
      const now = Date.now();
      let comboData = room.playerCombos.get(socket.id) || { level: 1, lastSelection: 0 };
      const isCombo = now - comboData.lastSelection < COMBO_DURATION;
      if (isCombo && comboData.level < 5) comboData.level++;
      else if (!isCombo) comboData.level = 1;
      comboData.lastSelection = now;
      room.playerCombos.set(socket.id, comboData);
      const length = validCells.length;
      const score = calculateScore(length, comboData.level);
      player.score += score;
      io.to(room.code).emit("selectionSuccess", {
        removed: validCells,
        playerId: socket.id,
        newScore: player.score,
        comboLevel: comboData.level
      });
      io.to(room.code).emit("gameState", {
        grid: room.grid,
        players: Array.from(room.players.values()).map(p => ({
          ...p,
          comboLevel: room.playerCombos.get(p.id)?.level || 1
        })),
        playerCombos: Object.fromEntries(room.playerCombos)
      });
    } else {
      room.playerCombos.set(socket.id, { level: 1, lastSelection: 0 });
    
      // Emit both selectionFail and gameState to ensure client is in sync
      socket.emit("selectionFail", { reason: "Invalid selection" });
      socket.emit("gameState", {
        grid: room.grid,
        players: Array.from(room.players.values()).map(p => ({
          ...p,
          comboLevel: room.playerCombos.get(p.id)?.level || 1
        })),
        playerCombos: Object.fromEntries(room.playerCombos)
      });
    }
  });
  socket.on("resetGame", () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    room.players.forEach(player => { player.score = 0; });
    if (room.gameActive) {
      room.grid = createGrid();
      room.timeLeft = room.timerDuration || DEFAULT_TIMER;
      if (room.timer) clearInterval(room.timer);
      room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(room.code).emit("timerUpdate", { timeLeft: room.timeLeft, totalTime: DEFAULT_TIMER });
        if (room.timeLeft <= 0) {
          clearInterval(room.timer);
          endGame(room);
        }
      }, 1000);
    }
    room.playerCombos.clear();
    room.players.forEach(player => room.playerCombos.set(player.id, { level: 1, lastSelection: 0 }));
    io.to(room.code).emit("gameReset", {
      players: Array.from(room.players.values()).map(p => ({
        ...p,
        comboLevel: room.playerCombos.get(p.id)?.level || 1
      })),
      grid: room.grid,
      timeLeft: room.timeLeft,
      playerCombos: Object.fromEntries(room.playerCombos)
    });
  });
  socket.on("playerCursor", (data) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    socket.to(room.code).emit("updateCursor", { playerId: socket.id, ...data });
  });
  socket.on("pokeHost", () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const TIMEOUT = 2000;
    const now = Date.now();
    let comboData = room.pokeCombos.get(socket.id) || { count: 0, lastTime: 0 };
    if (now - comboData.lastTime < TIMEOUT) comboData.count++;
    else comboData.count = 1;
    comboData.lastTime = now;
    room.pokeCombos.set(socket.id, comboData);
    if (room.host) io.to(room.host).emit("pokeReceived", { from: socket.id, combo: comboData.count });
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
        io.to(room.code).emit("hostDisconnected");
        if (room.players.size === 0) {
          clearInterval(room.timer);
          rooms.delete(currentRoom);
        } else {
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
    const players = Array.from(room.players.values()).map(p => ({
      ...p,
      comboLevel: room.playerCombos.get(p.id)?.level || 1
    }));
    room.playerCombos.clear();
    if (players.length === 0) {
      rooms.delete(room.code);
      return;
    }
    let winner = players[0];
    for (let i = 1; i < players.length; i++) {
      if (players[i].score > winner.score) winner = players[i];
    }
    io.to(room.code).emit("gameOver", {
      players,
      winner: winner.nickname || "Anonymous",
      score: winner.score,
    });
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