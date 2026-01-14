require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const twilio = require('twilio');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const Message = require('./models/Message');
const User = require('./models/User');

// --- 1. Startup Validation (Prevents "Silent" Config Failures) ---
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  console.error("CRITICAL ERROR: Twilio credentials missing in .env file.");
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["https://twibhavi-production.up.railway.app", "https://twili.netlify.app", "http://localhost:5173"] }
});

console.log("process.env.TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, process.env.TWILIO_PHONE_NUMBER);


app.use(cors({
  origin: ['https://twibhavi-production.up.railway.app', 'https://twili.netlify.app', 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration for authentication
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/twilio_chat',
    ttl: 24 * 60 * 60 // 24 hours
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Auth Middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized. Please login.' });
};

// Twilio Config
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/twilio_chat')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// --- API: Register User ---
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Create new user
    const user = new User({ username, password });
    await user.save();

    // Set session
    req.session.userId = user._id;
    req.session.username = user.username;

    res.status(201).json({ success: true, message: 'Registration successful' });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// --- API: Login User ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Set session
    req.session.userId = user._id;
    req.session.username = user.username;

    res.json({ success: true, message: 'Login successful' });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- API: Logout User ---
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// --- API: Check Auth Status ---
app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// --- API: Send SMS ---
app.post('/api/send-sms', async (req, res) => {
  const { to, body } = req.body;

  console.log("process.env.TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, process.env.TWILIO_PHONE_NUMBER);

  // 2. Input Validation
  if (!to || !body) {
    return res.status(400).json({ success: false, error: "Missing 'to' number or message body" });
  }

  try {
    console.log(`Attempting to send to ${to}...`);

    // 3. Send via Twilio
    const message = await client.messages.create({
      body: body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });

    console.log(`✅ Message Sent! SID: ${message.sid}`);

    // 4. Save to DB
    const newMessage = new Message({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      body,
      direction: 'outbound',
      status: message.status
    });
    await newMessage.save();

    // 5. Emit to Frontend
    io.emit('sms_update', newMessage);

    res.json({ success: true, message });

  } catch (error) {
    // --- BETTER ERROR HANDLING HERE ---
    // This prints the REAL error to your VS Code Terminal
    console.error("❌ TWILIO ERROR:", error);

    // This sends the REAL error reason to the Frontend (React)
    res.status(500).json({
      success: false,
      error: error.message || "Twilio failed to send message"
    });
  }
});

// --- Webhook: Receive SMS ---
app.post('/api/incoming-sms', async (req, res) => {
  const { From, Body } = req.body;
  console.log(`📩 Incoming SMS from ${From}: ${Body}`);

  try {
    const receivedMessage = new Message({
      to: process.env.TWILIO_PHONE_NUMBER,
      from: From,
      body: Body,
      direction: 'inbound',
      status: 'received'
    });
    await receivedMessage.save();

    io.emit('sms_update', receivedMessage);

    // Forward to Zoho CRM
    if (process.env.ZOHO_FORWARD_URL) {
      try {
        const axios = require('axios');
        await axios.post(process.env.ZOHO_FORWARD_URL, {
          from: From,
          to: process.env.TWILIO_PHONE_NUMBER,
          body: Body,
          direction: 'inbound',
          receivedAt: new Date().toISOString()
        });
        console.log('✅ Message forwarded to Zoho CRM');
      } catch (zohoError) {
        console.error('❌ Zoho Forward Error:', zohoError.message);
        // Don't fail the webhook if Zoho forwarding fails
      }
    }

    res.type('text/xml').send('<Response></Response>');
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).send('Error');
  }
});

// --- API: Get History ---
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));