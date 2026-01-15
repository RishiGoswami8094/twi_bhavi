require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const twilio = require('twilio');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const multer = require('multer');
const Message = require('./models/Message');
const User = require('./models/User');
const Contact = require('./models/Contact');
const { detectColumnMapping, detectColumnMappingFallback } = require('./services/csvAgent');
const { setupSmsWorker, addBulkSmsJobs, getQueueStats } = require('./services/smsQueue');

// Configure multer for file uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

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

// Trust proxy (needed for Railway/Heroku to detect HTTPS)
app.set('trust proxy', 1);

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
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' required for cross-site cookies
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

    // Explicitly save session before sending response
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Registration failed - session error' });
      }
      console.log('✅ Session saved for new user:', user.username);
      res.status(201).json({ success: true, message: 'Registration successful' });
    });
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

    // Explicitly save session before sending response
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Login failed - session error' });
      }
      console.log('✅ Session saved for user:', user.username, 'Session ID:', req.sessionID);
      res.json({ success: true, message: 'Login successful' });
    });
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
  console.log('Auth check - Session ID:', req.sessionID, 'User ID:', req.session?.userId);
  if (req.session && req.session.userId) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// --- Helper: Parse CSV string to array ---
function parseCSV(csvString) {
  const lines = csvString.split(/\r?\n/).filter(line => line.trim());
  const rows = [];
  
  for (const line of lines) {
    const row = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    rows.push(row);
  }
  
  return rows;
}

// --- API: Upload and Process CSV ---
app.post('/api/upload-csv', requireAuth, upload.single('csvFile'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No CSV file uploaded' 
      });
    }

    // Parse CSV content
    const csvContent = req.file.buffer.toString('utf-8');
    const allRows = parseCSV(csvContent);

    if (allRows.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'CSV file is empty' 
      });
    }

    if (allRows.length < 2) {
      return res.status(400).json({ 
        success: false, 
        error: 'CSV file must have at least a header row and one data row' 
      });
    }

    // Get first 3 rows for AI analysis
    const sampleRows = allRows.slice(0, Math.min(3, allRows.length));
    console.log('Sample rows for AI analysis:', sampleRows);

    // Detect column mapping using AI agent
    let columnMapping;
    try {
      columnMapping = await detectColumnMapping(sampleRows);
    } catch (aiError) {
      console.warn('AI agent failed, using fallback:', aiError.message);
      // If AI fails, use fallback heuristic detection
      columnMapping = detectColumnMappingFallback(sampleRows);
    }

    console.log('Column mapping:', columnMapping);

    // Validate that phone number column was detected
    if (columnMapping.phoneNumber === null) {
      return res.status(400).json({ 
        success: false, 
        error: 'Could not detect phone number column in CSV. Please ensure your CSV contains phone numbers.' 
      });
    }

    // Generate batch ID for this upload
    const uploadBatchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Process data rows (skip header)
    const dataRows = allRows.slice(1);
    const contacts = [];
    const phoneNumbers = [];
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      try {
        // Extract phone number (required)
        const phoneIdx = columnMapping.phoneNumber - 1; // Convert to 0-based
        let phoneNumber = row[phoneIdx]?.trim() || '';
        
        if (!phoneNumber) {
          errors.push(`Row ${i + 2}: Missing phone number`);
          continue;
        }

        // Clean and normalize phone number
        phoneNumber = phoneNumber.replace(/[^\d+\-\(\)\s]/g, '').trim();
        
        // Extract other fields
        const firstName = columnMapping.firstName ? (row[columnMapping.firstName - 1]?.trim() || '') : '';
        const lastName = columnMapping.lastName ? (row[columnMapping.lastName - 1]?.trim() || '') : '';
        const companyName = columnMapping.companyName ? (row[columnMapping.companyName - 1]?.trim() || '') : '';
        
        // Extract "other" fields
        const otherData = {};
        const headerRow = allRows[0];
        if (columnMapping.other && columnMapping.other.length > 0) {
          for (const colNum of columnMapping.other) {
            const colIdx = colNum - 1;
            const headerName = headerRow[colIdx] || `Column${colNum}`;
            const value = row[colIdx]?.trim() || '';
            if (value) {
              otherData[headerName] = value;
            }
          }
        }

        // Create contact object
        const contact = {
          firstName,
          lastName,
          companyName,
          phoneNumber,
          other: otherData,
          uploadedBy: req.session.userId,
          uploadBatchId
        };

        contacts.push(contact);
        phoneNumbers.push(phoneNumber);
        
      } catch (rowError) {
        errors.push(`Row ${i + 2}: ${rowError.message}`);
      }
    }

    // Save contacts to database
    if (contacts.length > 0) {
      try {
        await Contact.insertMany(contacts);
        console.log(`✅ Saved ${contacts.length} contacts to database`);
      } catch (dbError) {
        console.error('Database save error:', dbError);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to save contacts to database' 
        });
      }
    }

    // Prepare response
    const response = {
      success: true,
      message: `Successfully processed ${contacts.length} contacts`,
      phoneNumbers,
      columnMapping,
      totalRows: dataRows.length,
      processedRows: contacts.length,
      uploadBatchId
    };

    if (errors.length > 0) {
      response.warnings = errors.slice(0, 10); // Limit warnings to first 10
      if (errors.length > 10) {
        response.warnings.push(`... and ${errors.length - 10} more warnings`);
      }
    }

    res.json(response);

  } catch (error) {
    console.error('CSV Upload Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to process CSV file' 
    });
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

// --- API: Send Bulk SMS (Queue-based) ---
app.post('/api/send-bulk-sms', requireAuth, async (req, res) => {
  const { phoneNumbers, message } = req.body;

  // Validation
  if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Phone numbers array is required' 
    });
  }

  if (!message || message.trim() === '') {
    return res.status(400).json({ 
      success: false, 
      error: 'Message body is required' 
    });
  }

  // Filter out empty phone numbers
  const validNumbers = phoneNumbers.filter(num => num && num.trim() !== '');

  if (validNumbers.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'No valid phone numbers provided' 
    });
  }

  try {
    console.log(`📋 Queueing ${validNumbers.length} SMS jobs...`);

    // Add jobs to the queue
    const batchInfo = await addBulkSmsJobs(validNumbers, message.trim());

    // Save messages to DB as pending
    const messageDocs = validNumbers.map(phoneNumber => ({
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
      body: message.trim(),
      direction: 'outbound',
      status: 'queued',
      batchId: batchInfo.batchId
    }));

    await Message.insertMany(messageDocs);

    res.json({
      success: true,
      message: `${validNumbers.length} SMS jobs queued for sending`,
      batchId: batchInfo.batchId,
      totalJobs: batchInfo.totalJobs,
      jobs: batchInfo.jobs
    });

  } catch (error) {
    console.error('Bulk SMS Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to queue SMS jobs' 
    });
  }
});

// --- API: Get Queue Stats ---
app.get('/api/queue-stats', requireAuth, async (req, res) => {
  try {
    const stats = await getQueueStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get queue stats' });
  }
});

// Initialize SMS Worker with Socket.io
setupSmsWorker(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));