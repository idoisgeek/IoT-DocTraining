// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); // For making API calls
const multer = require('multer');
const { Client } = require('ssh2');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;
const CASES_FILE = path.join(__dirname, 'cases.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
//const upload = multer({ dest: 'uploads/' }); // Local tmp directory


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const caseName = req.params.caseName;
    const spotField = file.fieldname; // e.g., 'spot1', 'spot2'
    const extension = path.extname(file.originalname) || '.wav'; // default to .wav if missing
    cb(null, `${caseName}_${spotField}${extension}`);
  }
});

const upload = multer({ storage });





// Check if API key is configured
if (!process.env.OPENAI_API_KEY) {
  console.warn('Warning: OPENAI_API_KEY is not set in environment variables');
}

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname)); // Serve static files from current directory

// Helper middleware to log requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Helper function to read cases
function readCases() {
  try {
    if (!fs.existsSync(CASES_FILE)) {
      // Create empty cases file if it doesn't exist
      fs.writeFileSync(CASES_FILE, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(CASES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading cases:', error);
    return [];
  }
}

// Helper function to write cases
function writeCases(cases) {
  try {
    fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing cases:', error);
    return false;
  }
}

// Helper function to read sessions
function readSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      // Create empty sessions file if it doesn't exist
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading sessions:', error);
    return [];
  }
}

// Helper function to write sessions
function writeSessions(sessions) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    
    // Also save sessions to sessions.txt in a readable format
    writeSessionsToTextFile(sessions);
    
    return true;
  } catch (error) {
    console.error('Error writing sessions:', error);
    return false;
  }
}

// Helper function to write sessions to a text file in a readable format
function writeSessionsToTextFile(sessions) {
  try {
    const SESSIONS_TEXT_FILE = path.join(__dirname, 'sessions.txt');
    let textContent = '=== SESSIONS LOG ===\n\n';
    
    // Sort sessions by timestamp (newest first)
    const sortedSessions = [...sessions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    sortedSessions.forEach(session => {
      const date = new Date(session.timestamp).toLocaleString();
      
      textContent += `===== SESSION ID: ${session.id} =====\n`;
      textContent += `CASE: ${session.caseName}\n`;
      textContent += `DATE: ${date}\n`;
      textContent += `USER: ${session.userName || 'Anonymous'}\n`;
      textContent += `CASE PROMPT: ${session.casePrompt || 'Not available'}\n\n`;
      
      // Include differential diagnosis if available
      if (session.diagnosis && session.diagnosis.trim()) {
        textContent += `DIFFERENTIAL DIAGNOSIS:\n${session.diagnosis}\n\n`;
      } else {
        textContent += `DIFFERENTIAL DIAGNOSIS: Not provided\n\n`;
      }
      
      textContent += `CONVERSATION:\n`;
      
      if (session.messages && session.messages.length > 0) {
        session.messages.forEach(message => {
          const role = message.role.toUpperCase();
          textContent += `${role}: ${message.content}\n\n`;
        });
      } else {
        textContent += `No messages available\n\n`;
      }
      
      // Include AI review if available
      if (session.review) {
        textContent += `AI REVIEW:\n${session.review}\n\n`;
      }
      
      textContent += `=================================\n\n`;
    });
    
    fs.writeFileSync(SESSIONS_TEXT_FILE, textContent);
    console.log(`Sessions saved to ${SESSIONS_TEXT_FILE}`);
    
    return true;
  } catch (error) {
    console.error('Error writing sessions to text file:', error);
    return false;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Server is running correctly'
  });
});

// GET /cases - Get all cases
app.get('/cases', (req, res) => {
  try {
    const cases = readCases();
    res.json(cases);
  } catch (error) {
    console.error('Error in GET /cases:', error);
    res.status(500).json({ error: 'Failed to retrieve cases' });
  }
});

// POST /cases - Create a new case
app.post('/cases', (req, res) => {
  try {
    const cases = readCases();
    const newCase = req.body;
    
    // Validate required fields
    if (!newCase.name || !newCase.prompt) {
      return res.status(400).json({ error: 'Name and prompt are required fields' });
    }
    
    // Check if case with same name already exists
    if (cases.some(c => c.name === newCase.name)) {
      return res.status(409).json({ error: 'A case with this name already exists' });
    }
    
    // Add timestamp if not provided
    if (!newCase.timestamp) {
      newCase.timestamp = new Date().toISOString();
    }
    
    cases.push(newCase);
    
    if (writeCases(cases)) {
      res.status(201).json(newCase);
    } else {
      res.status(500).json({ error: 'Failed to save the case' });
    }
  } catch (error) {
    console.error('Error in POST /cases:', error);
    res.status(500).json({ error: 'Failed to create case: ' + error.message });
  }
});

// DELETE /cases/:name - Delete a case by name
app.delete('/cases/:name', async (req, res) => {
  try {
    const caseName = req.params.name;
    const cases = readCases();
    
    const initialLength = cases.length;
    const filteredCases = cases.filter(c => c.name !== caseName);
    
    if (filteredCases.length === initialLength) {
      return res.status(404).json({ error: 'Case not found' });
    }
    
    if (writeCases(filteredCases)) {
      res.json({ message: 'Case deleted successfully' });
    } else {
      res.status(500).json({ error: 'Failed to delete the case' });
    }
    // delete Case On RPI
    await deleteCaseOnRPI(caseName);
    res.json({ message: `Case ${caseName} deleted from RPI` });

  } catch (error) {
    console.error('Error in DELETE /cases/:name:', error);
    res.status(500).json({ error: 'Failed to delete case: ' + error.message });
  }
});

// PUT /cases/:name - Update a case by name
app.put('/cases/:name', (req, res) => {
  try {
    const caseName = req.params.name;
    const updatedCase = req.body;
    const cases = readCases();
    
    // Validate required fields
    if (!updatedCase.name || !updatedCase.prompt) {
      return res.status(400).json({ error: 'Name and prompt are required fields' });
    }
    
    // Find the case to update
    const caseIndex = cases.findIndex(c => c.name === caseName);
    if (caseIndex === -1) {
      return res.status(404).json({ error: 'Case not found' });
    }
    
    // Check for name conflict if the name is being changed
    if (updatedCase.name !== caseName && cases.some(c => c.name === updatedCase.name)) {
      return res.status(409).json({ error: 'A case with this new name already exists' });
    }
    
    // Preserve the original timestamp if not provided
    if (!updatedCase.timestamp) {
      updatedCase.timestamp = cases[caseIndex].timestamp;
    }
    
    // Update the case
    cases[caseIndex] = updatedCase;
    
    if (writeCases(cases)) {
      console.log(`Case "${caseName}" updated to "${updatedCase.name}"`);
      res.json(updatedCase);
    } else {
      res.status(500).json({ error: 'Failed to save the updated case' });
    }
  } catch (error) {
    console.error('Error in PUT /cases/:name:', error);
    res.status(500).json({ error: 'Failed to update case: ' + error.message });
  }
});

// GET /get-sessions - Get all sessions
app.get('/get-sessions', (req, res) => {
  try {
    const sessions = readSessions();
    // Sort sessions by timestamp (newest first)
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(sessions);
  } catch (error) {
    console.error('Error in GET /get-sessions:', error);
    res.status(500).json({ error: 'Failed to retrieve sessions' });
  }
});

// POST /save-session - Save a session
app.post('/save-session', (req, res) => {
  try {
    const { id, caseId, caseName, messages, userName, review, lastUpdated, casePrompt, diagnosis } = req.body;
    
    // Get existing sessions
    const sessions = readSessions();
    
    // If an ID is provided, try to update an existing session
    if (id) {
      const sessionIndex = sessions.findIndex(s => s.id === id);
      if (sessionIndex >= 0) {
        // Update the existing session
        const existingSession = sessions[sessionIndex];
        const updatedSession = {
          ...existingSession,
          caseId: caseId || existingSession.caseId,
          caseName: caseName || existingSession.caseName,
          userName: userName || existingSession.userName,
          messages: messages || existingSession.messages,
          casePrompt: casePrompt || existingSession.casePrompt,
          diagnosis: diagnosis !== undefined ? diagnosis : existingSession.diagnosis,
          lastUpdated: lastUpdated || new Date().toISOString()
        };
        
        // Add review if provided
        if (review) {
          updatedSession.review = review;
        }
        
        sessions[sessionIndex] = updatedSession;
        
        if (writeSessions(sessions)) {
          console.log(`Session updated for case: "${updatedSession.caseName}" by user: "${updatedSession.userName}"`);
          res.json({ success: true, session: updatedSession });
        } else {
          res.status(500).json({ error: 'Failed to update session' });
        }
        return;
      }
    }
    
    // Create a new session if no ID was provided or no matching session was found
    // Validate required fields for new sessions
    if (!caseId || !caseName || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing required fields or invalid data format' });
    }

    // Create a new session object with unique ID
    const newSession = {
      id: id || Date.now().toString(), // Use provided ID or generate a new one
      caseId,
      caseName,
      userName: userName || 'Anonymous', // Use 'Anonymous' if userName is not provided
      casePrompt: casePrompt || '',
      diagnosis: diagnosis || '',
      timestamp: new Date().toISOString(),
      messages
    };
    
    // Add review if provided
    if (review) {
      newSession.review = review;
    }

    // Add the new session
    sessions.push(newSession);
    
    // Save sessions to file
    if (writeSessions(sessions)) {
      console.log(`Session saved for case: "${caseName}" by user: "${newSession.userName}" (${messages.length} messages)`);
      if (diagnosis) {
        console.log(`Differential diagnosis included (${diagnosis.length} chars)`);
      }
      res.status(201).json({ success: true, session: newSession });
    } else {
      res.status(500).json({ error: 'Failed to save session' });
    }
  } catch (error) {
    console.error('Error in POST /save-session:', error);
    res.status(500).json({ error: 'Failed to save session: ' + error.message });
  }
});

// DELETE /sessions/:id - Delete a session by ID
app.delete('/sessions/:id', (req, res) => {
  try {
    const sessionId = req.params.id;
    
    // Get existing sessions
    const sessions = readSessions();
    
    // Find the session with the specified ID
    const sessionIndex = sessions.findIndex(session => session.id === sessionId);
    
    if (sessionIndex === -1) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get the session details for logging
    const { caseName } = sessions[sessionIndex];
    
    // Remove the session from the array
    sessions.splice(sessionIndex, 1);
    
    // Save the updated sessions
    if (writeSessions(sessions)) {
      console.log(`Session deleted for case: "${caseName}" (ID: ${sessionId})`);
      res.json({ success: true, message: 'Session deleted successfully' });
    } else {
      res.status(500).json({ error: 'Failed to delete session' });
    }
  } catch (error) {
    console.error('Error in DELETE /sessions/:id:', error);
    res.status(500).json({ error: 'Failed to delete session: ' + error.message });
  }
});

// DELETE /sessions - Delete all sessions
app.delete('/sessions', (req, res) => {
  try {
    // Get existing sessions to count them
    const sessions = readSessions();
    const count = sessions.length;
    
    // Write an empty array to the sessions file
    if (writeSessions([])) {
      console.log(`All sessions deleted (${count} sessions)`);
      res.json({ success: true, message: `All sessions deleted successfully (${count} sessions)` });
    } else {
      res.status(500).json({ error: 'Failed to delete all sessions' });
    }
  } catch (error) {
    console.error('Error in DELETE /sessions:', error);
    res.status(500).json({ error: 'Failed to delete all sessions: ' + error.message });
  }
});

// Proxy endpoint for OpenAI API calls
app.post('/api/openai', async (req, res) => {
  try {
    // Check if API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured on server' });
    }

    const { model, messages, temperature } = req.body;
    
    // Validate request body
    if (!model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request. Required fields: model, messages (array)' });
    }
    
    // Forward request to OpenAI API
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model,
      messages,
      temperature: temperature || 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Return the OpenAI API response to the client
    res.json(response.data);
    
  } catch (error) {
    console.error('Error calling OpenAI API:', error.response?.data || error.message);
    
    // Pass through OpenAI's error response if available
    if (error.response && error.response.data) {
      return res.status(error.response.status).json(error.response.data);
    }
    
    res.status(500).json({ error: 'Failed to call OpenAI API: ' + error.message });
  }
});




// login methodology

// Path to the JSON file where users will be stored
const usersFilePath = path.join(__dirname, 'users.json');

// Read users from JSON file
const readUsersFromFile = () => {
    try {
        const data = fs.readFileSync(usersFilePath);
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
};

// Write users to JSON file
const writeUsersToFile = (users) => {
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
};

// API to get all users
app.get('/api/users', (req, res) => {
    const users = readUsersFromFile();
    res.json(users);
});

// API to register a new user
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    const users = readUsersFromFile();

    // Check if user already exists
    if (users.some(user => user.username === username)) {
        return res.status(400).json({ message: 'User already exists' });
    }

    // Add new user
    users.push({ username, password });
    writeUsersToFile(users);

    res.status(201).json({ message: 'User registered successfully' });
});

// API to login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = readUsersFromFile();

    const user = users.find(user => user.username === username && user.password === password);

    if (!user) {
        return res.status(400).json({ message: 'Invalid username or password' });
    }

    res.json({ message: 'Login successful', user });
});



// ssh to RPI
function uploadWavFilesToRPI(caseName, files) {
  const conn = new Client();
  const rpiDir = `/home/admin/Documents/DocTraining/readingRFPy/sounds/${caseName}`; // adjust path if needed

  conn.on('ready', () => {
      console.log('SSH Connected');

      conn.exec(`mkdir -p ${rpiDir}`, (err, stream) => {
          if (err) {
              console.error('Directory creation failed:', err);
              conn.end();
              return;
          }

          // stream.on('close', () => {

            stream.on('close', (code, signal) => {
              console.log(`Stream close: code: ${code}, signal: ${signal}`); // Add this
              if (code !== 0) {
                console.error(`mkdir command failed with code ${code}, signal ${signal}`);
                conn.end();
                return;
              }

              conn.sftp((err, sftp) => {
                  if (err) {
                      console.error('SFTP error:', err);
                      conn.end();
                      return;
                  }

                  const spots = ['spot1', 'spot2', 'spot3', 'spot4'];
                  let completed = 0;

                  spots.forEach((key, i) => {
                      const localPath = files[key][0].path;
                      const remotePath = `${rpiDir}/spot${i + 1}.wav`;

                      sftp.fastPut(localPath, remotePath, (err) => {
                          if (err) {
                              console.error(`Upload failed for ${key}:`, err);
                          } else {
                              console.log(`${key} uploaded successfully.`);
                          }

                          completed++;
                          if (completed === 4) {
                              conn.end();
                          }
                      });
                  });
              });
          }); 
          stream.on('data', (data) => { // And this
            console.log(`STDOUT: ${data}`);
          });
          stream.stderr.on('data', (data) => { // And this
            console.error(`STDERR: ${data}`);
          });     
      });
  }).connect({
      host: 'raspberrypi.local',
      port: 22,
      username: 'admin',             // Or other RPI user
      privateKey: fs.readFileSync('C:\\Users\\topaz\\.ssh\\id_rsa', 'utf-8')   // Or use privateKey: 
  });
}

// uploading wav files
app.post('/upload-case/:caseName', upload.fields([
  { name: 'spot1', maxCount: 1 },
  { name: 'spot2', maxCount: 1 },
  { name: 'spot3', maxCount: 1 },
  { name: 'spot4', maxCount: 1 }
]), (req, res) => {
  const caseName = req.params.caseName;

  if (!caseName) {
    return res.status(400).json({ error: 'Missing case name in URL' });
  }

  // Ensure all files are received
  if (!req.files.spot1 || !req.files.spot2 || !req.files.spot3 || !req.files.spot4) {
      return res.status(400).json({ error: 'All 4 spot files are required' });
  }

  // Send to RPI (Upload the files to the Raspberry Pi)
  uploadWavFilesToRPI(caseName, req.files);

  res.status(200).json({ message: 'WAV files uploaded successfully' });
});

// Delete a case directory on the RPI
function deleteCaseOnRPI(caseName) {
  return new Promise((resolve, reject) => {
      const conn = new Client();
      const rpiDir = `/home/admin/Documents/DocTraining/readingRFPy/sounds/${caseName}`;

      conn.on('ready', () => {
          conn.exec(`rm -rf ${rpiDir}`, (err, stream) => {
              if (err) {
                  conn.end();
                  return reject(`Failed to delete directory: ${err.message}`);
              }

              stream.on('close', (code, signal) => {
                  conn.end();
                  if (code === 0) {
                      resolve(`Deleted ${rpiDir}`);
                  } else {
                      reject(`rm command exited with code ${code}`);
                  }
              });
          });
      }).on('error', reject).connect({
          host: 'raspberrypi.local',
          port: 22,
          username: 'admin',
          privateKey: fs.readFileSync('C:\\Users\\topaz\\.ssh\\id_rsa', 'utf-8')
      });
  });
}


function editWavFilesOnRPI(caseName, files) {
  const conn = new Client();
  const rpiDir = `/home/admin/Documents/DocTraining/readingRFPy/sounds/${caseName}`;
  const spots = ['spot1', 'spot2', 'spot3', 'spot4'];

  conn.on('ready', () => {
    console.log('SSH Connected');

    conn.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP error:', err);
        conn.end();
        return;
      }

      let completed = 0;
      const toEdit = spots.filter(key => files[key]);

      if (toEdit.length === 0) {
        console.log("No files to edit.");
        conn.end();
        return;
      }

      toEdit.forEach((key, i) => {
        const localPath = files[key][0].path;
        const remotePath = `${rpiDir}/${key}.wav`;

        if (!fs.existsSync(localPath)) {
          console.warn(`Local file for ${key} does not exist: ${localPath}`);
          done();
          return;
        }

        sftp.unlink(remotePath, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== 2) {
            console.warn(`Warning: couldn't delete ${remotePath}:`, unlinkErr.message || unlinkErr);
            // Proceed anyway
          }

          // Upload file regardless of unlink success
          sftp.fastPut(localPath, remotePath, (uploadErr) => {
            if (uploadErr) {
              console.error(`Upload failed for ${key}:`, uploadErr.message);
            } else {
              console.log(`${key} replaced successfully.`);
            }

            done();
          });
        });

        function done() {
          completed++;
          if (completed === toEdit.length) {
            conn.end();
          }
        }
      });
    });
  }).connect({
    host: 'raspberrypi.local',
    port: 22,
    username: 'admin',
    privateKey: fs.readFileSync('C:\\Users\\topaz\\.ssh\\id_rsa')
  });
}




// edit wav files
app.post('/edit-case/:caseName', upload.fields([
  { name: 'spot1', maxCount: 1 },
  { name: 'spot2', maxCount: 1 },
  { name: 'spot3', maxCount: 1 },
  { name: 'spot4', maxCount: 1 }
]), (req, res) => {
  const caseName = req.params.caseName;

  if (!caseName) {
      return res.status(400).json({ error: 'Missing case name in URL' });
  }

  if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'No files uploaded for editing' });
  }

  editWavFilesOnRPI(caseName, req.files);
  res.status(200).json({ message: 'WAV files replaced successfully' });
});



// check RPI status
app.get('/rpi-status', (req, res) => {
  exec('ping -n 1 raspberrypi.local', (error, stdout, stderr) => {
      if (error) {
          res.json({ online: false });
      } else {
          res.json({ online: true });
      }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API endpoints available at:`);
  console.log(`- GET /cases - Get all cases`);
  console.log(`- POST /cases - Create a new case`);
  console.log(`- DELETE /cases/:name - Delete a case by name`);
  console.log(`- PUT /cases/:name - Update a case by name`);
  console.log(`- GET /get-sessions - Get all sessions`);
  console.log(`- POST /save-session - Save a session`);
  console.log(`- DELETE /sessions/:id - Delete a session by ID`);
  console.log(`- DELETE /sessions - Delete all sessions`);
  console.log(`- GET /health - Check server health`);
  console.log(`- POST /api/openai - Proxy for OpenAI API calls`);
}); 


