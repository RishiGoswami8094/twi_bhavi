import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import CsvUploadModal from './CsvUploadModal';

const BACKEND_URL = 'http://localhost:5000';
const socket = io(BACKEND_URL);

function Home({ handleLogout }) {
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [currentPhoneIndex, setCurrentPhoneIndex] = useState(0);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messages, setMessages] = useState([]);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  
  // Status is now an object to handle types (success vs error)
  const [status, setStatus] = useState({ type: '', msg: '' }); 
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchHistory();

    socket.on('sms_update', (newMessage) => {
      setMessages((prev) => [...prev, newMessage]);
    });

    return () => socket.off('sms_update');
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Update phone number when phoneNumbers array or currentPhoneIndex changes
  useEffect(() => {
    if (phoneNumbers.length > 0 && currentPhoneIndex < phoneNumbers.length) {
      setPhoneNumber(phoneNumbers[currentPhoneIndex]);
    }
  }, [phoneNumbers, currentPhoneIndex]);

  const fetchHistory = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/messages`, { withCredentials: true });
      setMessages(res.data);
    } catch (err) {
      console.error("Could not fetch history", err);
      if (err.response && err.response.status === 401) {
        // Session expired
        window.location.reload(); 
      }
    }
  };

  // Handle CSV upload success
  const handleCsvUploadSuccess = (numbers) => {
    if (numbers && numbers.length > 0) {
      setPhoneNumbers(numbers);
      setCurrentPhoneIndex(0);
      setPhoneNumber(numbers[0]);
      setStatus({ 
        type: 'success', 
        msg: `Loaded ${numbers.length} phone numbers from CSV` 
      });
      setTimeout(() => setStatus({ type: '', msg: '' }), 3000);
    }
  };

  // Navigate to next phone number
  const handleNextNumber = () => {
    if (currentPhoneIndex < phoneNumbers.length - 1) {
      setCurrentPhoneIndex(currentPhoneIndex + 1);
    }
  };

  // Navigate to previous phone number
  const handlePrevNumber = () => {
    if (currentPhoneIndex > 0) {
      setCurrentPhoneIndex(currentPhoneIndex - 1);
    }
  };

  // Clear all loaded phone numbers
  const handleClearNumbers = () => {
    setPhoneNumbers([]);
    setCurrentPhoneIndex(0);
    setPhoneNumber('');
  };

  const handleSend = async (e) => {
    e.preventDefault();
    setStatus({ type: 'info', msg: 'Sending...' });

    try {
      await axios.post(`${BACKEND_URL}/api/send-sms`, {
        to: phoneNumber,
        body: messageBody
      }, { withCredentials: true });
      
      setMessageBody('');
      setStatus({ type: 'success', msg: 'Message Sent!' });
      
      // Clear success message after 3 seconds
      setTimeout(() => setStatus({ type: '', msg: '' }), 3000);

    } catch (err) {
      console.error("Send Error:", err);
      
      // --- CAPTURE THE EXACT ERROR FROM BACKEND ---
      const errorMsg = err.response && err.response.data && err.response.data.error 
        ? err.response.data.error 
        : 'Connection Failed';

      setStatus({ type: 'error', msg: `Error: ${errorMsg}` });
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-10 flex flex-col items-center">
      <div className="w-full max-w-5xl flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-blue-400">Twilio SMS Panel</h1>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsCsvModalOpen(true)} 
            className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded text-sm font-semibold flex items-center gap-2"
          >
            📄 Upload CSV
          </button>
          <button onClick={handleLogout} className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded text-sm font-semibold">Logout</button>
        </div>
      </div>

      <div className="flex w-full max-w-5xl gap-6 h-[80vh]">
        
        {/* Left: Input Panel */}
        <div className="w-1/3 bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
          <h2 className="text-xl font-semibold mb-4">Compose Message</h2>
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm text-gray-400">To (Phone Number)</label>
                {phoneNumbers.length > 0 && (
                  <span className="text-xs text-blue-400">
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
              className={`w-full font-bold py-3 rounded-lg transition ${
                status.type === 'info' ? 'bg-gray-600 cursor-wait' : 'bg-blue-600 hover:bg-blue-500'
              }`}
              disabled={status.type === 'info'}
            >
              {status.type === 'info' ? 'Sending...' : 'Send SMS'}
            </button>

            {/* ERROR / SUCCESS MESSAGE DISPLAY */}
            {status.msg && (
              <div className={`text-center text-sm mt-2 p-2 rounded ${
                status.type === 'error' ? 'bg-red-900 text-red-200 border border-red-700' :
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
                className={`flex flex-col max-w-[70%] p-4 rounded-xl ${
                  msg.direction === 'outbound' 
                    ? 'ml-auto bg-blue-600 text-white rounded-tr-none' 
                    : 'mr-auto bg-gray-700 text-gray-200 rounded-tl-none'
                }`}
              >
                <div className="text-xs opacity-70 mb-1">
                  {msg.direction === 'outbound' ? `Sent to ${msg.to}` : `From ${msg.from}`}
                </div>
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

      {/* CSV Upload Modal */}
      <CsvUploadModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        onSuccess={handleCsvUploadSuccess}
      />
    </div>
  );
}

export default Home;
