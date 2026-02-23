import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // restrict later in production
    methods: ["GET", "POST"],
  },
});

/*
  Room Structure:

  {
    roomId: {
      users: {
        socketId: username
      }
    }
  }
*/
const rooms: Record<
  string,
  {
    users: Record<string, string>;
  }
> = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // =========================
  // JOIN ROOM
  // =========================
  socket.on("join-room", ({ roomId, name }) => {
    if (!roomId) return;

    // Create room if not exists
    if (!rooms[roomId]) {
      rooms[roomId] = { users: {} };
    }

    const room = rooms[roomId];

    // Limit room to 10 users
    if (Object.keys(room.users).length >= 10) {
      socket.emit("room-full");
      return;
    }

    // Clean or auto-generate name
    const cleanName =
      typeof name === "string" && name.trim()
        ? name.trim().slice(0, 20)
        : `User_${socket.id.slice(-4)}`;

    // Save user
    room.users[socket.id] = cleanName;

    socket.join(roomId);

    // Send existing users (excluding self)
    const otherUsers = Object.entries(room.users)
      .filter(([id]) => id !== socket.id)
      .map(([id, username]) => ({
        id,
        name: username,
      }));

    socket.emit("all-users", otherUsers);

    // Notify others
    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      name: cleanName,
    });

    console.log(`${cleanName} joined room ${roomId}`);
  });

  // =========================
  // WEBRTC SIGNALING
  // =========================
  socket.on("sending-signal", (payload) => {
    io.to(payload.userToSignal).emit("receiving-signal", {
      signal: payload.signal,
      callerId: payload.callerId,
    });
  });

  socket.on("returning-signal", (payload) => {
    io.to(payload.callerId).emit("receiving-returned-signal", {
      signal: payload.signal,
      id: socket.id,
    });
  });

  // =========================
// MUTE STATE SYNC
// =========================
socket.on("mute-state-changed", ({ userId, isMuted }) => {
  console.log("Server received mute:", userId, isMuted);

  for (const roomId in rooms) {
    if (rooms[roomId].users[socket.id]) {
      console.log("Broadcasting to room:", roomId);

      socket.to(roomId).emit("mute-state-changed", {
        userId,
        isMuted,
      });

      break;
    }
  }
});

  // =========================
  // DISCONNECT
  // =========================
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.users[socket.id]) {
        const username = room.users[socket.id];

        delete room.users[socket.id];

        socket.to(roomId).emit("user-left", socket.id);

        console.log(`${username} left room ${roomId}`);

        // Remove room if empty
        if (Object.keys(room.users).length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted (empty)`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
