const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
  firstName: {
    type: String,
    trim: true,
    default: ''
  },
  lastName: {
    type: String,
    trim: true,
    default: ''
  },
  companyName: {
    type: String,
    trim: true,
    default: ''
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true
  },
  other: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  uploadBatchId: {
    type: String,
    required: true
  }
}, { timestamps: true });

// Index for faster phone number lookups
ContactSchema.index({ phoneNumber: 1 });
ContactSchema.index({ uploadBatchId: 1 });

module.exports = mongoose.model('Contact', ContactSchema);
