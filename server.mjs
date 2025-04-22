import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import orderRoutes from './routes/orderRoutes.js';
import './config/db.js';


dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true
}));

const PORT = process.env.PORT || 5000;

app.use('/orders', orderRoutes);

app.get('/', (req, res) => {
  res.send('✅ Pragati Glass Order Management API is Running!');
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const connectedUsers = {
  dispatchers: new Map(),
  teams: {
    glass: new Map(),
    caps: new Map(),
    boxes: new Map(),
    pumps: new Map()
  }
};

io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);
  socket.on('register', (userData) => {
    const { userId, role, team, teamType } = userData;
  
    console.log(`📝 User registered: (${role}${team ? ', ' + team : ''})`);
  
    const userInfo = { socketId: socket.id, userId, role, team, connected: true };

  
    socket.join('all-teams');
    console.log(`🔌 User joined all-teams room`);
  

    if (role === 'admin' ) {
      connectedUsers.dispatchers.set(userId, userInfo);
      socket.join('dispatchers');
      console.log(`🔌 User joined dispatchers room`);
      
      const teamRooms = ['glass', 'caps', 'boxes', 'pumps'];
      teamRooms.forEach(teamRoom => {
        socket.join(teamRoom);
        console.log(`🔌 Admin/Dispatcher joined ${teamRoom} room`);
      });
    }
    
    if (team) {
      const normalizedTeam = team.toLowerCase().trim();
      socket.join(normalizedTeam);
      console.log(`🔌 User joined ${normalizedTeam} room`);
  
      if (connectedUsers.teams[normalizedTeam]) {
        connectedUsers.teams[normalizedTeam].set(userId, userInfo);
      } else {
        connectedUsers.teams[normalizedTeam] = new Map();
        connectedUsers.teams[normalizedTeam].set(userId, userInfo);
      }
    }
  
    socket.emit('registered', { success: true });
    emitConnectedUsers();
  });
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback({ time: new Date().toISOString() });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.id}`);
    let userRemoved = false;

    for (const [userId, info] of connectedUsers.dispatchers.entries()) {
      if (info.socketId === socket.id) {
        connectedUsers.dispatchers.delete(userId);
        userRemoved = true;
        break;
      }
    }

    if (!userRemoved) {
      for (const team of Object.keys(connectedUsers.teams)) {
        for (const [userId, info] of connectedUsers.teams[team].entries()) {
          if (info.socketId === socket.id) {
            connectedUsers.teams[team].delete(userId);
            userRemoved = true;
            break;
          }
        }
        if (userRemoved) break;
      }
    }

    emitConnectedUsers();
  });

  socket.on('create-order', (data) => {
    const { order, teamTypes, timestamp } = data;
    const user = findUserBySocketId(socket.id);
  
    if (!order) {
      console.error('❌ Invalid order data received');
      socket.emit('order-create-error', { error: 'Invalid order data' });
      return;
    }
    
    console.log(`📝 New order created by ${user?.role || 'unknown'}: Order #${order.order_number}`);
    
    // Determine target teams
    let targetTeams = teamTypes || [];
    if (!targetTeams.length) {
      const itemTeams = new Set();
      
      if (order.order_details?.glass?.length > 0) targetTeams.push('glass');
      if (order.order_details?.caps?.length > 0) targetTeams.push('caps');
      if (order.order_details?.boxes?.length > 0) targetTeams.push('boxes');
      if (order.order_details?.pumps?.length > 0) targetTeams.push('pumps');
      
      targetTeams = [...new Set([...targetTeams, ...itemTeams])];
    }
    
    if (targetTeams.length === 0) {
      console.warn(`⚠️ No target teams identified for order #${order.order_number}`);
      targetTeams = ['unassigned'];
    }
    
    const normalizedTeams = targetTeams.map(team => team.toLowerCase().trim());
    console.log(`📢 Broadcasting new order to teams: ${normalizedTeams.join(', ')}`);
    
    // Create the meta information for all broadcasts
    const metaInfo = {
      createdBy: user,
      timestamp: timestamp || new Date().toISOString(),
      targetTeams: normalizedTeams
    };
    
    // Send to each specific team
    normalizedTeams.forEach(team => {
      console.log(`📤 Emitting to room: ${team}`);
      const room = io.sockets.adapter.rooms.get(team);
      const roomSize = room ? room.size : 0;
      console.log(`Room ${team} has ${roomSize} members`);
      
      if (roomSize > 0) {
        io.to(team).emit('new-order', {
          order,
          _meta: metaInfo
        });
      } else {
        console.warn(`⚠️ Room ${team} has no members. Order might not be delivered.`);
      }
    });
    
    // Always broadcast to dispatchers
    io.to('dispatchers').emit('new-order', {
      order,
      _meta: metaInfo
    });
    
    // Confirm order creation to sender
    socket.emit('order-create-confirmed', {
      orderId: order._id,
      orderNumber: order.order_number,
      status: 'delivered',
      targetTeams: normalizedTeams,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('order-update', (data) => {
    const { order, teamType, timestamp } = data;
    console.log(`📦 Order update received from ${teamType}: Order #${order.order_number}`);
    const user = findUserBySocketId(socket.id);
    console.log(`📢 Broadcasting order update to dispatchers`);
    io.to('dispatchers').emit('order-updated', {
      ...order,
      _meta: {
        updatedBy: user,
        teamType,
        timestamp
      }
    });

    socket.emit('order-update-confirmed', {
      orderId: order._id,
      status: 'delivered',
      timestamp: new Date().toISOString()
    });
  });

  socket.on('edit-order', ({ order, teamTypes }) => {
    console.log(`✏️ Order edited: #${order.order_number}`);
    console.log(`🔁 Notifying teams:`, teamTypes);

    teamTypes.forEach(team => {
      io.to(team).emit('order-edited', order);
      console.log(`📤 Emitting edited order to room: ${team}`);
    });
  });

 
  socket.on('delete-order', (data) => {
    const { order, teamTypes, timestamp } = data;
    const user = findUserBySocketId(socket.id);
  
    if (!order || !order._id) {
      console.error('❌ Invalid order data received for deletion');
      socket.emit('order-delete-error', { error: 'Invalid order data' });
      return;
    }
    
    console.log(`🗑️ Order deletion request from ${user?.role || 'unknown'}: Order #${order.order_number}`);
    
    // Notify teams about the deleted order
    if (teamTypes && teamTypes.length > 0) {
      console.log(`📢 Broadcasting order deletion to teams: ${teamTypes.join(', ')}`);
      teamTypes.forEach(team => {
        const roomName = team.toLowerCase().trim();
        console.log(`📤 Emitting deleted order to room: ${roomName}`);
        io.to(roomName).emit('order-deleted', {
          order,
          _meta: {
            deletedBy: user,
            timestamp: timestamp || new Date().toISOString()
          }
        });
      });
    }
  
    // Always notify dispatchers
    io.to('dispatchers').emit('order-deleted', {
      order,
      _meta: {
        deletedBy: user,
        targetTeams: teamTypes,
        timestamp: timestamp || new Date().toISOString()
      }
    });
  
    // Confirm deletion to the client that requested it
    socket.emit('order-delete-confirmed', {
      orderId: order._id,
      orderNumber: order.order_number,
      status: 'deleted',
      timestamp: new Date().toISOString()
    });
  });

 
  function findUserBySocketId(socketId) {
    // Check dispatchers
    for (const user of connectedUsers.dispatchers.values()) {
      if (user.socketId === socketId) {
        return user;
      }
    }

    // Check team members
    for (const team of Object.values(connectedUsers.teams)) {
      for (const user of team.values()) {
        if (user.socketId === socketId) {
          return user;
        }
      }
    }

    return null;
  }

  function emitConnectedUsers() {
    const dispatchersList = Array.from(connectedUsers.dispatchers.values()).map(u => ({
      userId: u.userId,
      connected: true,
      lastActive: new Date().toISOString()
    }));


    const teamLists = {};
    const allTeamMembers = [];

    for (const [teamName, users] of Object.entries(connectedUsers.teams)) {
      const teamUsers = Array.from(users.values()).map(u => ({
        userId: u.userId,
        team: teamName,
        connected: true,
        lastActive: new Date().toISOString()
      }));

      teamLists[teamName] = teamUsers;
      allTeamMembers.push(...teamUsers);
    }

    io.to('dispatchers').emit('connected-users', {
      dispatchers: dispatchersList,
      teamMembers: allTeamMembers,
      teams: teamLists
    });

    for (const teamName of Object.keys(connectedUsers.teams)) {
      io.to(teamName).emit('connected-users', {
        dispatchers: dispatchersList,
        teamMembers: teamLists[teamName] || []
      });
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.io server initialized`);
});

export { io, httpServer };
