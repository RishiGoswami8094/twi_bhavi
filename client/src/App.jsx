import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const socket = io(BACKEND_URL);

function App({ setIsAuthenticated }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messages, setMessages] = useState([]);

  // Status is now an object to handle types (success vs error)
  const [status, setStatus] = useState({ type: '', msg: '' });
  const chatEndRef = useRef(null);

  // CSV Upload states
  const [csv_window_opened, set_csv_window_opened] = useState(false);
  const [csvFile, setCSVFile] = useState(null);
  const [csvLogs, setCsvLogs] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [currentPhoneIndex, setCurrentPhoneIndex] = useState(0);

  // SMS Logs panel states
  const [smsLogsOpen, setSmsLogsOpen] = useState(false);
  const [smsQueue, setSmsQueue] = useState([]); // Current queue of pending SMS
  const [isSendingBulk, setIsSendingBulk] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState({ show: false, message: '', type: 'info' });

  // Settings state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [numberPrefix, setNumberPrefix] = useState('+1'); // Default to +1

  // Country code options for dropdown
  const countryCodes = [
    { code: 'none', label: 'None (No prefix)' },
    { code: '+1', label: '+1 (USA/Canada)' },
    { code: '+44', label: '+44 (UK)' },
    { code: '+91', label: '+91 (India)' },
    { code: '+61', label: '+61 (Australia)' },
    { code: '+49', label: '+49 (Germany)' },
    { code: '+33', label: '+33 (France)' },
    { code: '+81', label: '+81 (Japan)' },
    { code: '+86', label: '+86 (China)' },
    { code: '+55', label: '+55 (Brazil)' },
    { code: '+52', label: '+52 (Mexico)' },
    { code: '+34', label: '+34 (Spain)' },
    { code: '+39', label: '+39 (Italy)' },
    { code: '+7', label: '+7 (Russia)' },
    { code: '+82', label: '+82 (South Korea)' },
    { code: '+31', label: '+31 (Netherlands)' },
    { code: '+46', label: '+46 (Sweden)' },
    { code: '+41', label: '+41 (Switzerland)' },
    { code: '+65', label: '+65 (Singapore)' },
    { code: '+971', label: '+971 (UAE)' },
    { code: '+966', label: '+966 (Saudi Arabia)' },
    { code: '+27', label: '+27 (South Africa)' },
    { code: '+234', label: '+234 (Nigeria)' },
    { code: '+63', label: '+63 (Philippines)' },
    { code: '+62', label: '+62 (Indonesia)' },
    { code: '+60', label: '+60 (Malaysia)' },
    { code: '+64', label: '+64 (New Zealand)' },
    { code: '+48', label: '+48 (Poland)' },
    { code: '+90', label: '+90 (Turkey)' },
    { code: '+20', label: '+20 (Egypt)' },
  ];

  // Show toast notification (auto-dismiss after 5 seconds)
  const showToast = (message, type = 'info') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'info' });
    }, 5000);
  };

  // Fetch user settings
  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/settings`, { withCredentials: true });
      if (res.data.success && res.data.settings) {
        setNumberPrefix(res.data.settings.numberPrefix || '+1');
      }
    } catch (err) {
      console.error('Could not fetch settings', err);
    }
  };

  // Save user settings
  const saveSettings = async (newPrefix) => {
    try {
      const res = await axios.put(`${BACKEND_URL}/api/settings`, {
        numberPrefix: newPrefix
      }, { withCredentials: true });

      if (res.data.success) {
        setNumberPrefix(newPrefix);
        showToast('Settings saved successfully!', 'success');
      }
    } catch (err) {
      console.error('Could not save settings', err);
      showToast('Failed to save settings', 'error');
    }
  };

  // Helper function to check if a phone number has a country code
  const hasCountryCode = (phoneNumber) => {
    if (!phoneNumber) return false;
    const cleaned = phoneNumber.trim();
    // Number has country code if it starts with + followed by digits
    return /^\+\d/.test(cleaned);
  };

  // Apply prefix to phone number if needed
  const applyPrefixToNumber = (phoneNumber) => {
    if (!phoneNumber) return phoneNumber;
    const cleaned = phoneNumber.trim();

    // If number already has a country code, return as is
    if (hasCountryCode(cleaned)) {
      return cleaned;
    }

    // If prefix is 'none', return the number as is
    if (numberPrefix === 'none') {
      return cleaned;
    }

    // Add the prefix
    return `${numberPrefix}${cleaned}`;
  };

  // Apply prefix to all phone numbers
  const applyPrefixToNumbers = (numbers) => {
    return numbers.map(num => applyPrefixToNumber(num));
  };

  // Add log entry
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setCsvLogs(prev => [...prev, { message, type, timestamp }]);
  };

  // Clear logs
  const clearLogs = () => {
    setCsvLogs([]);
  };

  useEffect(() => {
    fetchHistory();
    fetchSettings(); // Fetch user settings on load

    // Listen for SMS updates
    socket.on('sms_update', (newMessage) => {
      setMessages((prev) => [...prev, newMessage]);
    });

    // Listen for batch queued event
    socket.on('sms_batch_queued', (data) => {
      console.log('Batch queued:', data);
      setSmsQueue(data.jobs.map(j => ({ ...j, status: 'queued' })));
      setSmsLogsOpen(true);
    });

    // Listen for job started event
    socket.on('sms_job_started', (data) => {
      console.log('Job started:', data);
      setSmsQueue(prev => prev.map(item =>
        item.phoneNumber === data.phoneNumber
          ? { ...item, status: 'sending' }
          : item
      ));
    });

    // Listen for job completed event
    socket.on('sms_job_completed', (data) => {
      console.log('Job completed:', data);
      setSmsQueue(prev => prev.filter(item => item.phoneNumber !== data.phoneNumber));
    });

    // Listen for job failed event
    socket.on('sms_job_failed', (data) => {
      console.log('Job failed:', data);
      setSmsQueue(prev => prev.map(item =>
        item.phoneNumber === data.phoneNumber
          ? { ...item, status: 'failed', error: data.error }
          : item
      ));
    });

    return () => {
      socket.off('sms_update');
      socket.off('sms_batch_queued');
      socket.off('sms_job_started');
      socket.off('sms_job_completed');
      socket.off('sms_job_failed');
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchHistory = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/messages`, { withCredentials: true });
      setMessages(res.data);
    } catch (err) {
      console.error("Could not fetch history", err);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${BACKEND_URL}/api/logout`, {}, { withCredentials: true });
      setIsAuthenticated(false);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  // Handle CSV file upload
  const handleCsvUpload = async () => {
    if (!csvFile) {
      addLog('Please select a CSV file first', 'error');
      return;
    }

    setIsUploading(true);
    clearLogs();
    addLog('Starting upload...', 'info');

    const formData = new FormData();
    formData.append('csvFile', csvFile);

    try {
      addLog('Uploading file to server...', 'info');

      const response = await axios.post(
        `${BACKEND_URL}/api/upload-csv`,
        formData,
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }
      );

      if (response.data.success) {
        addLog(`✓ File processed successfully!`, 'success');
        addLog(`Column mapping detected by AI:`, 'info');

        const mapping = response.data.columnMapping;
        if (mapping.firstName) addLog(`  • First Name: Column ${mapping.firstName}`, 'info');
        if (mapping.lastName) addLog(`  • Last Name: Column ${mapping.lastName}`, 'info');
        if (mapping.companyName) addLog(`  • Company: Column ${mapping.companyName}`, 'info');
        if (mapping.phoneNumber) addLog(`  • Phone: Column ${mapping.phoneNumber}`, 'info');

        addLog(`Total rows processed: ${response.data.processedRows}`, 'success');
        addLog(`Phone numbers extracted: ${response.data.phoneNumbers.length}`, 'success');

        // Show duplicate notifications
        if (response.data.duplicates && response.data.duplicates.totalSkipped > 0) {
          const { inCsv, inDb } = response.data.duplicates;

          if (inCsv.length > 0) {
            addLog(`⚠ ${inCsv.length} duplicate(s) found within CSV - skipped`, 'warning');
          }

          if (inDb.length > 0) {
            addLog(`⚠ ${inDb.length} number(s) already exist in database - skipped saving`, 'warning');
            // Show toast for DB duplicates
            showToast(
              `${inDb.length} phone number(s) already exist in contacts and were not saved again`,
              'warning'
            );
          }
        }

        // Show warnings if any
        if (response.data.warnings && response.data.warnings.length > 0) {
          addLog(`⚠ Warnings:`, 'warning');
          response.data.warnings.forEach(w => addLog(`  ${w}`, 'warning'));
        }

        // Store phone numbers and set first one
        if (response.data.phoneNumbers.length > 0) {
          setPhoneNumbers(response.data.phoneNumbers);
          setCurrentPhoneIndex(0);
          setPhoneNumber(response.data.phoneNumbers[0]);
          addLog(`✓ Phone numbers loaded! Use navigation to cycle through them.`, 'success');
        }

        // Close modal after 2 seconds
        setTimeout(() => {
          set_csv_window_opened(false);
          setCSVFile(null);
        }, 2000);
      }
    } catch (err) {
      console.error('Upload error:', err);
      const errorMsg = err.response?.data?.error || 'Failed to upload CSV file';
      addLog(`✗ Error: ${errorMsg}`, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // Navigate to next phone number
  const handleNextNumber = () => {
    if (currentPhoneIndex < phoneNumbers.length - 1) {
      const newIndex = currentPhoneIndex + 1;
      setCurrentPhoneIndex(newIndex);
      setPhoneNumber(phoneNumbers[newIndex]);
    }
  };

  // Navigate to previous phone number
  const handlePrevNumber = () => {
    if (currentPhoneIndex > 0) {
      const newIndex = currentPhoneIndex - 1;
      setCurrentPhoneIndex(newIndex);
      setPhoneNumber(phoneNumbers[newIndex]);
    }
  };

  // Clear loaded phone numbers
  const handleClearNumbers = () => {
    setPhoneNumbers([]);
    setCurrentPhoneIndex(0);
    setPhoneNumber('');
  };

  const handleSend = async (e) => {
    e.preventDefault();

    // Determine which numbers to send to
    const rawNumbers = phoneNumbers.length > 0 ? phoneNumbers : [phoneNumber];

    if (rawNumbers.length === 0 || !rawNumbers[0]) {
      setStatus({ type: 'error', msg: 'Please enter a phone number or upload a CSV' });
      return;
    }

    if (!messageBody.trim()) {
      setStatus({ type: 'error', msg: 'Please enter a message' });
      return;
    }

    // Apply country code prefix to numbers without one
    const numbersToSend = applyPrefixToNumbers(rawNumbers);

    setStatus({ type: 'info', msg: 'Queueing SMS jobs...' });
    setIsSendingBulk(true);

    try {
      const response = await axios.post(`${BACKEND_URL}/api/send-bulk-sms`, {
        phoneNumbers: numbersToSend,
        message: messageBody
      }, { withCredentials: true });

      if (response.data.success) {
        setStatus({
          type: 'success',
          msg: `✓ ${response.data.totalJobs} SMS queued for sending!`
        });

        // Clear the form
        setMessageBody('');
        setPhoneNumbers([]);
        setCurrentPhoneIndex(0);
        setPhoneNumber('');

        // Open SMS logs panel
        setSmsLogsOpen(true);
      }

      // Clear success message after 5 seconds
      setTimeout(() => setStatus({ type: '', msg: '' }), 5000);

    } catch (err) {
      console.error("Send Error:", err);
      const errorMsg = err.response?.data?.error || 'Connection Failed';
      setStatus({ type: 'error', msg: `Error: ${errorMsg}` });
    } finally {
      setIsSendingBulk(false);
    }
  };

  const open_csv_window = () => {
    set_csv_window_opened(true);
    clearLogs();
    addLog('Ready to upload CSV file', 'info');
  }

  return (
    <div className=" relative min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center">

      {/* Settings Modal */}
      {settingsOpen && (
        <div
          style={{ background: "rgba(255, 255, 255, 0.7)" }}
          className='w-full h-full fixed inset-0 z-50 flex justify-center items-center'
          onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}
        >
          <div
            style={{ background: "rgba(255, 255, 255)" }}
            className="w-[400px] bg-gray-800 text-white border border-gray-600 shadow-2xl rounded-xl overflow-hidden">
            {/* Header */}
            <div className='flex justify-between items-center border-b border-gray-600 px-4 py-3 bg-gray-700'>
              <div className='font-semibold text-lg'>⚙️ Settings</div>
              <button
                onClick={() => setSettingsOpen(false)}
                className='text-gray-400 hover:text-white text-xl font-bold'
              >
                ×
              </button>
            </div>

            {/* Settings Content */}
            <div className='p-6'>
              <div className='mb-4'>
                <label className='block text-sm text-gray-400 mb-2'>
                  Number Prefix (Country Code)
                </label>
                <select
                  value={numberPrefix}
                  onChange={(e) => {
                    const newPrefix = e.target.value;
                    setNumberPrefix(newPrefix);
                    saveSettings(newPrefix);
                  }}
                  className='w-full bg-gray-700 text-white p-3 rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500'
                >
                  {countryCodes.map((cc) => (
                    <option key={cc.code} value={cc.code}>
                      {cc.label}
                    </option>
                  ))}
                </select>
                <p className='text-xs text-gray-500 mt-2'>
                  If a phone number doesn't have a country code (doesn't start with +),
                  this prefix will be added automatically when sending SMS.
                </p>
              </div>

              {/* Current Setting Display */}
              <div className='bg-gray-900 p-4 rounded-lg border border-gray-700'>
                <div className='text-sm text-gray-400 mb-1'>Current Setting:</div>
                <div className='text-lg font-semibold'>
                  {numberPrefix === 'none'
                    ? '❌ No prefix will be added'
                    : `${numberPrefix} will be added to numbers without country code`
                  }
                </div>
              </div>

              {/* Example */}
              <div className='mt-4 text-sm text-gray-500'>
                <div className='font-medium text-gray-400 mb-1'>Example:</div>
                <div>• <code className='bg-gray-700 px-1 rounded'>9876543210</code> → <code className='bg-gray-700 px-1 rounded'>{numberPrefix === 'none' ? '9876543210' : `${numberPrefix}9876543210`}</code></div>
                <div>• <code className='bg-gray-700 px-1 rounded'>+919876543210</code> → <code className='bg-gray-700 px-1 rounded'>+919876543210</code> (unchanged)</div>
              </div>
            </div>

            {/* Footer */}
            <div className='border-t border-gray-600 px-4 py-3 bg-gray-900'>
              <button
                onClick={() => setSettingsOpen(false)}
                className='w-full bg-blue-600 hover:bg-blue-500 py-2 rounded-lg font-semibold transition'
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {csv_window_opened &&
        <div style={{ background: "rgba(255,255,255,0.8)" }} className='w-[100%] h-[100%] fixed inset-0 z-30 flex justify-center items-center'>

          <div style={{ background: "rgba(255,255,255)" }} className="w-[50%] max-w-[600px] bg-gray-800 text-white border border-gray-600 shadow-2xl ">
            {/* Header */}
            <div className='flex justify-between items-center border-b border-gray-600 px-4 py-3 bg-gray-700'>
              <div className='font-semibold text-lg'>📄 Upload CSV Contacts</div>
              <button
                onClick={() => { set_csv_window_opened(false); setCSVFile(null); }}
                disabled={isUploading}
                className='text-gray-400 hover:text-white text-xl font-bold disabled:opacity-50'
              >
                ×
              </button>
            </div>

            {/* Main Panel */}
            <div className='p-4'>
              <p className='text-gray-400 text-sm mb-4'>
                Upload a CSV file with contact data. The AI will automatically detect columns for
                First Name, Last Name, Company, and Phone Number.
              </p>

              <div className='border-2 border-dashed border-gray-600 p-6 mb-4 text-center hover:border-blue-500 transition'>
                <input
                  onChange={(e) => {
                    setCSVFile(e.target.files[0]);
                    if (e.target.files[0]) {
                      addLog(`Selected file: ${e.target.files[0].name}`, 'info');
                    }
                  }}
                  type="file"
                  accept=".csv"
                  className='hidden'
                  id="csv-file-input"
                  disabled={isUploading}
                />
                <label htmlFor="csv-file-input" className='cursor-pointer'>
                  {csvFile ? (
                    <div>
                      <div className='text-green-400 text-lg mb-1'>✓ File Selected</div>
                      <div className='text-white font-medium'>{csvFile.name}</div>
                      <div className='text-gray-500 text-sm mt-1'>
                        {(csvFile.size / 1024).toFixed(2)} KB
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className='text-4xl mb-2'>📄</div>
                      <div className='text-gray-300'>Click to select CSV file</div>
                      <div className='text-gray-500 text-sm mt-1'>or drag and drop</div>
                    </div>
                  )}
                </label>
              </div>

              <div className='flex gap-3'>
                <button
                  onClick={() => { set_csv_window_opened(false); setCSVFile(null); }}
                  disabled={isUploading}
                  className='flex-1 bg-gray-700 hover:bg-gray-600 py-2 px-4 font-semibold transition disabled:opacity-50'
                >
                  Cancel
                </button>
                <button
                  onClick={handleCsvUpload}
                  disabled={!csvFile || isUploading}
                  className='flex-1 bg-blue-600 hover:bg-blue-500 py-2 px-4 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  {isUploading ? 'Processing...' : 'Upload & Process'}
                </button>
              </div>
            </div>

            {/* Logs Panel */}
            <div className='border-t border-gray-600 px-4 py-3 bg-gray-900'>
              <div className='flex justify-between items-center mb-2'>
                <div className='text-sm font-semibold text-gray-400'>Logs</div>
                <button
                  onClick={clearLogs}
                  className='text-xs text-gray-500 hover:text-gray-300'
                >
                  Clear
                </button>
              </div>
              <div className='h-[120px] overflow-y-auto text-sm font-mono bg-gray-950 p-2 border border-gray-700'>
                {csvLogs.length === 0 ? (
                  <div className='text-gray-600'>No logs yet...</div>
                ) : (
                  csvLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`mb-1 ${log.type === 'error' ? 'text-red-400' :
                        log.type === 'success' ? 'text-green-400' :
                          log.type === 'warning' ? 'text-yellow-400' :
                            'text-gray-300'
                        }`}
                    >
                      <span className='text-gray-600'>[{log.timestamp}]</span> {log.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      }

      <div className="w-full max-w-5xl flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-blue-400">Twilio SMS Panel</h1>
        <div className='flex items-center gap-2'>
          {!smsLogsOpen && (
            <button
              onClick={() => setSmsLogsOpen(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg shadow-lg transition-all flex items-center gap-1"
              title="Open SMS Panel"
            >
              <span className="text-sm font-semibold">📋 SMS Panel</span>
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg shadow-lg transition-all flex items-center gap-1"
            title="Settings"
          >
            <span className="text-sm font-semibold">⚙️ Settings</span>
          </button>
          <button
            onClick={handleLogout}
            className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded-lg font-semibold transition"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="flex w-full max-w-5xl gap-6 h-[80vh]">

        {/* Left: Input Panel */}
        <div className="w-1/3 bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Compose Message</h2>
            <button onClick={open_csv_window} className="text-sm text-blue-400 hover:underline">📄 CSV</button>
          </div>
          {/* <button onClick={fetchHistory} className="mb-4 text-sm text-blue-400 hover:underline">Refresh Message History</button> */}
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm text-gray-400">To (Phone Number)</label>
                {phoneNumbers.length > 0 && (
                  <span className="text-xs text-blue-400 font-medium">
                    {currentPhoneIndex + 1} / {phoneNumbers.length}
                  </span>
                )}
              </div>
              <input
                type="text"
                placeholder="+1234567890"
                className="w-full bg-gray-700 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                required
              />

              {/* Navigation controls for CSV numbers */}
              {phoneNumbers.length > 0 && (
                <div className="flex items-center justify-between mt-2 gap-2">
                  <button
                    type="button"
                    onClick={handlePrevNumber}
                    disabled={currentPhoneIndex === 0}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ← Prev
                  </button>
                  <button
                    type="button"
                    onClick={handleNextNumber}
                    disabled={currentPhoneIndex >= phoneNumbers.length - 1}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                  <button
                    type="button"
                    onClick={handleClearNumbers}
                    className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-sm"
                    title="Clear all loaded numbers"
                  >
                    ✕
                  </button>
                </div>
              )}

              <p className="text-xs text-gray-500 mt-1">Must include country code (e.g., +1 or +91)</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Message Body</label>
              <textarea
                rows="5"
                placeholder="Type your message here..."
                className="w-full bg-gray-700 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className={`w-full font-bold py-3 rounded-lg transition ${status.type === 'info' || isSendingBulk
                ? 'bg-gray-600 cursor-wait'
                : 'bg-blue-600 hover:bg-blue-500'
                }`}
              disabled={status.type === 'info' || isSendingBulk}
            >
              {status.type === 'info' || isSendingBulk
                ? 'Processing...'
                : phoneNumbers.length > 0
                  ? `Send SMS to ${phoneNumbers.length} numbers`
                  : 'Send SMS'
              }
            </button>

            {/* SMS Side Panel Button */}
            <button
              type="button"
              onClick={() => setSmsLogsOpen(true)}
              className="w-full bg-gray-700 hover:bg-gray-600 font-semibold py-2 rounded-lg transition mt-2 flex items-center justify-center gap-2"
            >
              📋 SMS Side Panel
              {smsQueue.length > 0 && (
                <span className="bg-yellow-500 text-black text-xs px-2 py-0.5 rounded-full font-bold">
                  {smsQueue.length}
                </span>
              )}
            </button>

            {/* ERROR / SUCCESS MESSAGE DISPLAY */}
            {status.msg && (
              <div className={`text-center text-sm mt-2 p-2 rounded ${status.type === 'error' ? 'bg-red-900 text-red-200 border border-red-700' :
                status.type === 'success' ? 'bg-green-900 text-green-200 border border-green-700' :
                  'text-gray-400'
                }`}>
                {status.msg}
              </div>
            )}

          </form>
        </div>

        {/* Right: Live Chat Log */}
        <div className="w-2/3 bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 flex flex-col">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">Live Message Log</h2>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex flex-col max-w-[70%] p-4 rounded-xl ${msg.direction === 'outbound'
                  ? 'ml-auto bg-blue-600 text-white rounded-tr-none'
                  : 'mr-auto bg-gray-700 text-gray-200 rounded-tl-none'
                  }`}
              >
                <div className="text-xs opacity-70 mb-1">
                  {msg.direction === 'outbound'
                    ? `Sent to ${msg.to}`
                    : msg.contact
                      ? `${msg.contact.firstName || ''} ${msg.contact.lastName || ''}${msg.contact.companyName ? ` • ${msg.contact.companyName}` : ''}`
                      : `From ${msg.from}`
                  }
                </div>
                {msg.direction === 'inbound' && msg.contact && (
                  <div className="text-xs text-gray-400 mb-1">{msg.from}</div>
                )}
                <div className="text-md break-words">{msg.body}</div>
                <div className="text-xs text-right opacity-50 mt-2">
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </div>

      </div>

      {/* SMS Logs Side Panel */}
      {
        smsLogsOpen &&
        <div
          style={{ background: "white" }}
          className={`absolute right-0 top-0 h-[90%] w-[400px] border border-black z-50 flex flex-col transform transition-transform duration-300 ease-in-out ${smsLogsOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
          {/* Header */}
          <div className="flex justify-between items-center border-b border-gray-700 bg-gray-700">
            <h3 className="font-semibold text-lg">📋 SMS Queue</h3>
            <button
              onClick={() => setSmsLogsOpen(false)}
              className="text-gray-400 hover:text-white text-xl font-bold"
            >
              ×
            </button>
          </div>

          {/* Queue Stats */}
          <div className="p-4 bg-gray-900 border-b border-gray-700">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Pending:</span>
              <span className="text-yellow-400 font-medium">
                {smsQueue.filter(s => s.status === 'queued').length}
              </span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-400">Sending:</span>
              <span className="text-blue-400 font-medium">
                {smsQueue.filter(s => s.status === 'sending').length}
              </span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-400">Failed:</span>
              <span className="text-red-400 font-medium">
                {smsQueue.filter(s => s.status === 'failed').length}
              </span>
            </div>
          </div>

          {/* Queue List */}
          <div className="flex-1 overflow-y-auto p-4">
            {smsQueue.length === 0 ? (
              <div className="text-center text-gray-500 mt-10">
                <div className="text-4xl mb-2">✓</div>
                <div>All messages sent!</div>
              </div>
            ) : (
              <div className="space-y-2">
                {smsQueue.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded border ${item.status === 'sending'
                      ? 'bg-blue-900 border-blue-700'
                      : item.status === 'failed'
                        ? 'bg-red-900 border-red-700'
                        : 'bg-gray-700 border-gray-600'
                      }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-sm">{item.phoneNumber}</span>
                      <span className={`text-xs px-2 py-1 rounded ${item.status === 'sending'
                        ? 'bg-blue-600 text-blue-100'
                        : item.status === 'failed'
                          ? 'bg-red-600 text-red-100'
                          : 'bg-gray-600 text-gray-300'
                        }`}>
                        {item.status === 'sending' ? '⏳ Sending...' :
                          item.status === 'failed' ? '❌ Failed' :
                            '⏱️ Queued'}
                      </span>
                    </div>
                    {item.error && (
                      <div className="text-xs text-red-300 mt-1">{item.error}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-700 bg-gray-900">
            <button
              onClick={() => {
                setSmsQueue([]);
                setSmsLogsOpen(false);
              }}
              className="w-full bg-gray-700 hover:bg-gray-600 py-2 rounded font-semibold text-sm"
            >
              Clear & Close
            </button>
          </div>
        </div>
      }

      {/* Toast Notification */}
      {toast.show && (
        <div
          className={`fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in ${toast.type === 'warning'
              ? 'bg-yellow-600 text-white'
              : toast.type === 'error'
                ? 'bg-red-600 text-white'
                : toast.type === 'success'
                  ? 'bg-green-600 text-white'
                  : 'bg-blue-600 text-white'
            }`}
        >
          <span className="text-xl">
            {toast.type === 'warning' ? '⚠️' :
              toast.type === 'error' ? '❌' :
                toast.type === 'success' ? '✅' : 'ℹ️'}
          </span>
          <span className="font-medium">{toast.message}</span>
          <button
            onClick={() => setToast({ show: false, message: '', type: 'info' })}
            className="ml-2 text-white/80 hover:text-white font-bold"
          >
            ×
          </button>
        </div>
      )}

    </div>
  );
}

export default App;