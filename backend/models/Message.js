const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  to: String,         // The recipient's number
  from: String,       // Your Twilio number or the sender's number
  body: String,
  direction: String,  // 'outbound' (sent by you) or 'inbound' (received)
  status: String,
  // Reference to Contact model (for inbound messages where sender is a known contact)
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    default: null
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
