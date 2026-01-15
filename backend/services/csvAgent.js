const axios = require('axios');

/**
 * AI Agent to detect column mappings from CSV data
 * Uses Google Gemini API to intelligently map CSV columns to contact fields
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

/**
 * Analyzes CSV sample data and returns column mapping
 * @param {Array<Array<string>>} sampleRows - First 3 rows of CSV data
 * @returns {Object} Column mapping object
 */
async function detectColumnMapping(sampleRows) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please add it to your .env file.');
  }

  if (!sampleRows || sampleRows.length === 0) {
    throw new Error('No data provided for analysis');
  }

  // Format sample data for the AI
  const sampleDataStr = sampleRows.map((row, idx) => 
    `Row ${idx + 1}: ${row.map((cell, colIdx) => `Col${colIdx + 1}="${cell}"`).join(', ')}`
  ).join('\n');

  const prompt = `You are a data analyst agent. Analyze the following CSV sample data and identify which columns contain:
- First Name
- Last Name  
- Company Name
- Phone Number

Here is the sample data (first 3 rows):
${sampleDataStr}

Total number of columns: ${sampleRows[0]?.length || 0}

Instructions:
1. Look at the header row (if present) and data patterns
2. Phone numbers typically have digits, +, -, (, ) characters
3. Names are usually text without numbers
4. Company names might contain Inc, LLC, Corp, Ltd, or be longer text
5. If the first row looks like headers, use that to guide your analysis

Return ONLY a valid JSON object in this exact format (no other text, no markdown):
{
  "firstName": <column_number or null if not found>,
  "lastName": <column_number or null if not found>,
  "companyName": <column_number or null if not found>,
  "phoneNumber": <column_number or null if not found>,
  "other": [<array of remaining column numbers>]
}

Column numbers should be 1-based (first column is 1, not 0).
If a field cannot be confidently identified, set it to null.
The "other" array should contain all column numbers not assigned to the main fields.`;

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: "application/json"
        }
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (!content) {
      throw new Error('Empty response from Gemini agent');
    }

    // Parse the JSON response
    let mapping;
    try {
      // Remove any markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      mapping = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', content);
      throw new Error('Gemini agent returned invalid JSON format');
    }

    // Validate the mapping structure
    if (typeof mapping !== 'object' || mapping === null) {
      throw new Error('Invalid mapping structure from Gemini agent');
    }

    // Ensure all required fields exist
    mapping.firstName = mapping.firstName ?? null;
    mapping.lastName = mapping.lastName ?? null;
    mapping.companyName = mapping.companyName ?? null;
    mapping.phoneNumber = mapping.phoneNumber ?? null;
    mapping.other = Array.isArray(mapping.other) ? mapping.other : [];

    console.log('Gemini Agent Column Mapping Result:', mapping);
    
    return mapping;

  } catch (error) {
    if (error.response?.status === 400) {
      throw new Error('Invalid Gemini API key or request. Please check your configuration.');
    }
    if (error.response?.status === 429) {
      throw new Error('Gemini rate limit exceeded. Please try again later.');
    }
    if (error.response?.data?.error?.message) {
      throw new Error(`Gemini Error: ${error.response.data.error.message}`);
    }
    throw error;
  }
}

/**
 * Fallback detection using heuristics when AI is not available
 * @param {Array<Array<string>>} sampleRows - First 3 rows of CSV data
 * @returns {Object} Column mapping object
 */
function detectColumnMappingFallback(sampleRows) {
  if (!sampleRows || sampleRows.length === 0) {
    throw new Error('No data provided for analysis');
  }

  const headerRow = sampleRows[0] || [];
  const numCols = headerRow.length;
  
  const mapping = {
    firstName: null,
    lastName: null,
    companyName: null,
    phoneNumber: null,
    other: []
  };

  const assignedCols = new Set();

  // Check each column header and data
  for (let i = 0; i < numCols; i++) {
    const header = (headerRow[i] || '').toLowerCase().trim();
    const sampleData = sampleRows.slice(1).map(row => row[i] || '');
    
    // Check for phone number patterns
    const hasPhonePattern = sampleData.some(val => 
      /^[\d\s\-\+\(\)\.]+$/.test(val) && val.replace(/\D/g, '').length >= 7
    );
    
    if (hasPhonePattern && mapping.phoneNumber === null) {
      mapping.phoneNumber = i + 1; // 1-based index
      assignedCols.add(i);
      continue;
    }

    // Check headers for field names
    if (/first.*name|fname|given.*name/i.test(header) && mapping.firstName === null) {
      mapping.firstName = i + 1;
      assignedCols.add(i);
    } else if (/last.*name|lname|surname|family.*name/i.test(header) && mapping.lastName === null) {
      mapping.lastName = i + 1;
      assignedCols.add(i);
    } else if (/company|organization|org|business|employer/i.test(header) && mapping.companyName === null) {
      mapping.companyName = i + 1;
      assignedCols.add(i);
    } else if (/phone|mobile|cell|tel|contact.*number/i.test(header) && mapping.phoneNumber === null) {
      mapping.phoneNumber = i + 1;
      assignedCols.add(i);
    }
  }

  // Add remaining columns to "other"
  for (let i = 0; i < numCols; i++) {
    if (!assignedCols.has(i)) {
      mapping.other.push(i + 1);
    }
  }

  console.log('Fallback Column Mapping Result:', mapping);
  
  return mapping;
}

module.exports = {
  detectColumnMapping,
  detectColumnMappingFallback
};
