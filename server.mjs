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

const connectedUsers = new Map();

const teamMembers = {
  dispatchers: new Set(),
  glass: new Set(),
  cap: new Set(),
  box: new Set(),
  pump: new Set()
};

const userIdentities = new Map(); 

io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  const { userId, role, team, teamType } = socket.handshake.query;
  if (userId && role) {
    const userInfo = {
      socketId: socket.id,
      userId,
      role,
      team: team?.toLowerCase().trim(),
      teamType: teamType?.toLowerCase().trim(),
      connected: true,
      connectedAt: new Date().toISOString()
    };

    connectedUsers.set(socket.id, userInfo);
    userIdentities.set(userId, socket.id);

    addUserToTeams(socket, userInfo);

    broadcastConnectedUsers();
  }

  socket.on('register', (userData) => {
    const { userId, role, team, teamType } = userData;

    const uniqueId = userId || socket.id;

    const userInfo = {
      socketId: socket.id,
      userId: uniqueId,
      role,
      team: team?.toLowerCase().trim(),
      teamType: teamType?.toLowerCase().trim(),
      connected: true,
      connectedAt: new Date().toISOString()
    };

    removeUserFromTeams(socket.id);

    connectedUsers.set(socket.id, userInfo);
    userIdentities.set(uniqueId, socket.id);

    console.log(`📝 User registered: ${role}${team ? ', ' + team : ''} (${socket.id})`);

    addUserToTeams(socket, userInfo);
    socket.emit('registered', {
      success: true,
      user: {
        socketId: socket.id,
        role,
        team: team?.toLowerCase().trim(),
        teamType: teamType?.toLowerCase().trim()
      }
    });

    broadcastConnectedUsers();
  });


  function addUserToTeams(socket, userInfo) {
    const { role, team, teamType } = userInfo;

    // Handle admin/dispatcher role
    if (role === 'admin' || role === 'dispatcher') {
      // Add to dispatchers team
      teamMembers.dispatchers.add(socket.id);
      socket.join('dispatchers');
      console.log(`🔌 User joined dispatchers room`);
    }

    // Handle team membership - add to specific team if provided
    if (team) {
      const normalizedTeam = team.toLowerCase().trim();

      // Only join valid team rooms
      if (teamMembers[normalizedTeam]) {
        teamMembers[normalizedTeam].add(socket.id);
        socket.join(normalizedTeam);
        console.log(`🔌 User joined ${normalizedTeam} room`);
      }
    }

    // Also join based on teamType if it's different from team
    if (teamType && teamType !== team) {
      const normalizedTeamType = teamType.toLowerCase().trim();

      if (teamMembers[normalizedTeamType]) {
        teamMembers[normalizedTeamType].add(socket.id);
        socket.join(normalizedTeamType);
        console.log(`🔌 User joined ${normalizedTeamType} room based on teamType`);
      }
    }
  }

  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback({ time: new Date().toISOString() });
    }
  });


  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.id}`);

    const userInfo = connectedUsers.get(socket.id);

    removeUserFromTeams(socket.id);

    connectedUsers.delete(socket.id);

    broadcastConnectedUsers();
  });

  socket.on('create-order', (data) => {
    const { order, teamTypes, timestamp } = data;
    const user = connectedUsers.get(socket.id);

    if (!order) {
      console.error('❌ Invalid order data received');
      socket.emit('order-create-error', { error: 'Invalid order data' });
      return;
    }

    console.log(`📝 New order created by ${user?.role || 'unknown'}: Order #${order.order_number}`);

    // Determine target teams
    let targetTeams = teamTypes || [];
    if (!targetTeams.length) {
      if (order.order_details?.glass?.length > 0) targetTeams.push('glass');
      if (order.order_details?.caps?.length > 0) targetTeams.push('cap');
      if (order.order_details?.boxes?.length > 0) targetTeams.push('box');
      if (order.order_details?.pumps?.length > 0) targetTeams.push('pump');
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
      io.to(team).emit('new-order', {
        order,
        _meta: metaInfo
      });
    });

    // Always broadcast to dispatchers
    io.to('dispatchers').emit('new-order', {
      order,
      _meta: metaInfo
    });


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
    const user = connectedUsers.get(socket.id);

    // Determine which teams should receive this update
    const targetTeams = [];
    const details = order.order_details || {};

    if (Array.isArray(details.glass) && details.glass.length > 0) targetTeams.push('glass');
    if (Array.isArray(details.caps) && details.caps.length > 0) targetTeams.push('cap');
    if (Array.isArray(details.boxes) && details.boxes.length > 0) targetTeams.push('box');
    if (Array.isArray(details.pumps) && details.pumps.length > 0) targetTeams.push('pump');

    // Create meta information
    const metaInfo = {
      updatedBy: user,
      teamType,
      timestamp: timestamp || new Date().toISOString(),
      targetTeams
    };

    // Send to each specific team
    targetTeams.forEach(team => {
      console.log(`📤 Emitting order update to room: ${team}`);
      io.to(team).emit('order-updated', {
        order,
        _meta: metaInfo
      });
    });

    // Always broadcast to dispatchers
    console.log(`📢 Broadcasting order update to dispatchers`);
    io.to('dispatchers').emit('order-updated', {
      order,
      _meta: metaInfo
    });

    socket.emit('order-update-confirmed', {
      orderId: order._id,
      status: 'delivered',
      timestamp: new Date().toISOString()
    });
  });

  // Handle order edits with improved implementation
  socket.on('edit-order', ({ order, teamTypes }) => {
    console.log(`✏️ Order edited: #${order.order_number}`);
    const user = connectedUsers.get(socket.id);

    // Default to all relevant teams if not specified
    let targetTeams = teamTypes || [];
    if (!targetTeams.length) {
      const details = order.order_details || {};
      if (details.glass?.length > 0) targetTeams.push('glass');
      if (details.caps?.length > 0) targetTeams.push('cap');
      if (details.boxes?.length > 0) targetTeams.push('box');
      if (details.pumps?.length > 0) targetTeams.push('pump');
    }

    console.log(`🔁 Notifying teams:`, targetTeams);


    const metaInfo = {
      editedBy: user,
      timestamp: new Date().toISOString(),
      targetTeams
    };


    targetTeams.forEach(team => {
      io.to(team).emit('order-edited', order);
      console.log(`📤 Emitting edited order to room: ${team}`);
    });

    io.to('dispatchers').emit('order-edited', order);
  });


  socket.on('delete-order', (data) => {
    const { order, teamTypes, timestamp } = data;
    const user = connectedUsers.get(socket.id);

    if (!order || !order._id) {
      console.error('❌ Invalid order data received for deletion');
      socket.emit('order-delete-error', { error: 'Invalid order data' });
      return;
    }

    console.log(`🗑️ Order deletion request from ${user?.role || 'unknown'}: Order #${order.order_number}`);

    let normalizedTeams = teamTypes || [];
    if (!normalizedTeams.length) {
      const details = order.order_details || {};
      if (details.glass?.length > 0) normalizedTeams.push('glass');
      if (details.caps?.length > 0) normalizedTeams.push('cap');
      if (details.boxes?.length > 0) normalizedTeams.push('box');
      if (details.pumps?.length > 0) normalizedTeams.push('pump');
    }


    const metaInfo = {
      deletedBy: user,
      timestamp: timestamp || new Date().toISOString(),
      targetTeams: normalizedTeams
    };


    if (normalizedTeams.length > 0) {
      console.log(`📢 Broadcasting order deletion to teams: ${normalizedTeams.join(', ')}`);
      normalizedTeams.forEach(team => {
        const roomName = team.toLowerCase().trim();
        io.to(roomName).emit('order-deleted', {
          order,
          _meta: metaInfo
        });
      });
    }


    io.to('dispatchers').emit('order-deleted', {
      order,
      _meta: metaInfo
    });


    socket.emit('order-delete-confirmed', {
      orderId: order._id,
      orderNumber: order.order_number,
      status: 'deleted',
      timestamp: new Date().toISOString()
    });
  });


  function removeUserFromTeams(socketId) {
    if (teamMembers.dispatchers.has(socketId)) {
      teamMembers.dispatchers.delete(socketId);
    }

    for (const team of ['glass', 'cap', 'box', 'pump']) {
      if (teamMembers[team].has(socketId)) {
        teamMembers[team].delete(socketId);
      }
    }
  }

  setInterval(() => {

    for (const [socketId, user] of connectedUsers.entries()) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket || socket.disconnected) {
        console.log(`🧹 Cleaning up stale connection: ${socketId}`);
        connectedUsers.delete(socketId);
        removeUserFromTeams(socketId);
      }
    }
  
    broadcastConnectedUsers();
  }, 30000); 
  

  function broadcastConnectedUsers() {
    // Prepare dispatchersList
    const dispatchersList = Array.from(teamMembers.dispatchers).map(socketId => {
      const user = connectedUsers.get(socketId);
      return {
        userId: user?.userId || socketId,
        connected: true,
        lastActive: new Date().toISOString()
      };
    });

    // Prepare team lists
    const teamLists = {};
    const allTeamMembers = [];

    for (const [teamName, socketIds] of Object.entries(teamMembers)) {
      if (teamName === 'dispatchers') continue; // Skip dispatchers as they're handled separately

      const teamUsers = Array.from(socketIds).map(socketId => {
        const user = connectedUsers.get(socketId);
        return {
          userId: user?.userId || socketId,
          team: teamName,
          connected: true,
          lastActive: new Date().toISOString()
        };
      });

      teamLists[teamName] = teamUsers;
      allTeamMembers.push(...teamUsers);
    }


    io.to('dispatchers').emit('connected-users', {
      dispatchers: dispatchersList,
      teamMembers: allTeamMembers,
      teams: teamLists
    });
    for (const teamName of ['glass', 'cap', 'box', 'pump']) {
  
      if (teamMembers[teamName].size > 0) {
        const teamInfo = {
          teamMembers: teamLists[teamName] || [],
          dispatchers: dispatchersList
        };

        io.to(teamName).emit('connected-users', teamInfo);
      }
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Socket.IO server ready for connections`);
});