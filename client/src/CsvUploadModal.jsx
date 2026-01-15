import { useState, useRef } from 'react';
import axios from 'axios';

const BACKEND_URL = 'http://localhost:5000';

const CsvUploadModal = ({ isOpen, onClose, onSuccess }) => {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setError('');
    setProgress('');
    
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        setError('Please select a valid CSV file');
        setFile(null);
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) { // 10MB limit
        setError('File size must be less than 10MB');
        setFile(null);
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      if (!droppedFile.name.endsWith('.csv')) {
        setError('Please select a valid CSV file');
        return;
      }
      setFile(droppedFile);
      setError('');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a CSV file first');
      return;
    }

    setIsUploading(true);
    setError('');
    setProgress('Uploading file...');

    const formData = new FormData();
    formData.append('csvFile', file);

    try {
      setProgress('Processing CSV with AI agent...');
      
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
        setProgress('Upload complete!');
        // Pass the phone numbers to parent component
        onSuccess(response.data.phoneNumbers);
        // Reset and close modal after a brief delay
        setTimeout(() => {
          handleClose();
        }, 500);
      }
    } catch (err) {
      console.error('Upload error:', err);
      const errorMsg = err.response?.data?.error || 'Failed to upload CSV file';
      setError(errorMsg);
      setProgress('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setError('');
    setProgress('');
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-gray-800 w-full max-w-lg mx-4 p-8 shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-blue-400">Upload CSV Contacts</h2>
          <button
            onClick={handleClose}
            disabled={isUploading}
            className="text-gray-400 hover:text-white text-2xl font-bold transition disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {/* Description */}
        <p className="text-gray-400 text-sm mb-6">
          Upload a CSV file containing contact information. The AI will automatically detect columns 
          for First Name, Last Name, Company Name, and Phone Number.
        </p>

        {/* Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed p-8 text-center cursor-pointer transition mb-6
            ${file 
              ? 'border-green-500 bg-green-900 bg-opacity-20' 
              : 'border-gray-600 hover:border-blue-500 hover:bg-gray-700'
            }`}
        >
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            ref={fileInputRef}
            className="hidden"
          />
          
          {file ? (
            <div>
              <div className="text-green-400 text-lg mb-2">✓ File Selected</div>
              <div className="text-white font-medium">{file.name}</div>
              <div className="text-gray-400 text-sm mt-1">
                {(file.size / 1024).toFixed(2)} KB
              </div>
            </div>
          ) : (
            <div>
              <div className="text-4xl mb-3">📄</div>
              <div className="text-gray-300 mb-2">
                Drag and drop your CSV file here
              </div>
              <div className="text-gray-500 text-sm">
                or click to browse
              </div>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900 bg-opacity-50 border border-red-700 text-red-200 px-4 py-3 mb-6 text-sm">
            <span className="font-medium">Error: </span>{error}
          </div>
        )}

        {/* Progress Display */}
        {progress && !error && (
          <div className="bg-blue-900 bg-opacity-50 border border-blue-700 text-blue-200 px-4 py-3 mb-6 text-sm flex items-center">
            {isUploading && (
              <svg className="animate-spin h-4 w-4 mr-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {progress}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button
            onClick={handleClose}
            disabled={isUploading}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? 'Processing...' : 'Upload & Process'}
          </button>
        </div>

        {/* Help Text */}
        <p className="text-gray-500 text-xs mt-6 text-center">
          Supported format: CSV files up to 10MB
        </p>
      </div>
    </div>
  );
};

export default CsvUploadModal;
