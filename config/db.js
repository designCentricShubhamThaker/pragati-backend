import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

mongoose.connection.on("connected", () => {
  console.log(`📌 Connected to database: ${mongoose.connection.db.databaseName}`);
});

const teamTrackingSchema = {
  total_completed_qty: { type: Number, default: 0 },
  completed_entries: [{
    qty_completed: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  status: {
    type: String,
    enum: ['Pending', 'Completed'],
    default: 'Pending'
  }
}

const orderSchema = new mongoose.Schema({
  order_number: { type: String, required: true, unique: true },

  dispatcher_name: { type: String, required: true },
  customer_name: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  order_status: {
    type: String,
    enum: ['Pending', 'Completed'],
    default: 'Pending'
  },
  order_details: {
    glass: [{
      glass_name: { type: String,  },
      quantity: { type: Number, },
      weight: String,
      neck_size: String,
      decoration: String,
      decoration_no: String,
      decoration_details: {
        type: { type: String },
        decoration_number: String
      },
      team: String,
      status: {
        type: String,
        enum: ['Pending', 'Done'],
        default: 'Pending'
      },
      team_tracking: teamTrackingSchema
    }],
    caps: [{
      cap_name: { type: String, },
      neck_size: String,
      quantity: { type: Number,  },
      process: String,
      material: String,
      team: String,
      status: {
        type: String,
        enum: ['Pending', 'Done'],
        default: 'Pending'
      },
      team_tracking: teamTrackingSchema
    }],
    boxes: [{
      box_name: { type: String, },
      quantity: { type: Number,  },
      approval_code: String,
      team: String,
      status: {
        type: String,
        enum: ['Pending', 'Done'],
        default: 'Pending'
      },
      team_tracking: teamTrackingSchema
    }],
    pumps: [{
      pump_name: { type: String,  },
      neck_type: String,
      quantity: { type: Number, },
      team: String,
      status: {
        type: String,
        enum: ['Pending', 'Done'],
        default: 'Pending'
      },
      team_tracking: teamTrackingSchema
    }]
  }
}, {
  minimize: false,
  timestamps: true
});




const Order = mongoose.model('Order', orderSchema);

export default Order