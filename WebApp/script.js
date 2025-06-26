// Define API_URL in the global scope
const API_URL =
  window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://github-io-nzkl.onrender.com';

// Global CONFIG object for API settings
let CONFIG = {
    apiKey: '', // Will be loaded from localStorage if available
    model: 'gpt-3.5-turbo',
    temperature: 0.7
};

// Global DOM elements and variables
let currentCase = null;
let currentConversation = [];
let messages = [];
let allSessions = []; // Store all sessions to allow filtering
let currentUserName = ''; // Store the current user name

// Function to save chat session
async function saveChatSession(caseId, caseName, messages, userName, casePrompt, diagnosis = '') {
    try {
        console.log('Saving chat session:', { caseId, caseName, userName, messages, casePrompt, diagnosis });
        
        const session = {
            caseId,
            caseName,
            userName,
            messages,
            casePrompt,
            diagnosis, // Include the user's differential diagnosis
            timestamp: new Date().toISOString()
        };
        
        // Save to server
        const response = await fetch(`${API_URL}/save-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(session)
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save session: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Also update local backup
        const backupSessions = JSON.parse(localStorage.getItem('sessions_backup') || '[]');
        backupSessions.push(result);
        localStorage.setItem('sessions_backup', JSON.stringify(backupSessions));
        
        return result;
    } catch (error) {
        console.error('Error saving session:', error);
        
        // Create a backup in localStorage
        const backupSession = {
            id: Date.now().toString(),
            caseId,
            caseName,
            userName,
            messages,
            casePrompt,
            diagnosis, // Include diagnosis in backup
            timestamp: new Date().toISOString()
        };
        
        const backupSessions = JSON.parse(localStorage.getItem('sessions_backup') || '[]');
        backupSessions.push(backupSession);
        localStorage.setItem('sessions_backup', JSON.stringify(backupSessions));
        
        throw error;
    }
}

// Check for saved config in localStorage on page load
(() => {
    try {
        const savedConfig = JSON.parse(localStorage.getItem('openai_config') || '{}');
        if (savedConfig.apiKey) CONFIG.apiKey = savedConfig.apiKey;
        if (savedConfig.model) CONFIG.model = savedConfig.model;
        if (savedConfig.temperature !== undefined) CONFIG.temperature = savedConfig.temperature;
        
        // Also try to load sessions from localStorage as backup
        const backupSessions = localStorage.getItem('sessions_backup');
        if (backupSessions) {
            try {
                allSessions = JSON.parse(backupSessions);
                console.log('Loaded sessions from backup:', allSessions.length);
            } catch (e) {
                console.error('Error parsing sessions backup:', e);
            }
        }
    } catch (e) {
        console.error('Error loading saved config:', e);
    }
})();

let ttsSupported = false;
let speechSynth = window.speechSynthesis;
let voices = [];

document.addEventListener('DOMContentLoaded', () => {
    const menuItems = document.querySelectorAll('.menu-item');
    const contentSections = document.querySelectorAll('.content-section');
    const caseForm = document.getElementById('caseForm');
    const casesContainer = document.getElementById('casesContainer');
    const casesGrid = document.getElementById('casesGrid');
    const chatPopup = document.getElementById('chatPopup');
    const chatMessages = document.getElementById('chatMessages');
    const userInput = document.getElementById('userInput');
    const chatTitle = document.getElementById('chatTitle');
    let sortOrder = 'newest';
    let cases = [];
    let isTyping = false;
    // let ttsSupported = false;
    let selectedVoice = null;
    let voiceSettings = {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        voice: null
    };
    
    // API URL - change if your server runs on a different port
    // const API_URL = 'http://localhost:3001';

    // Speech recognition setup
    let recognition = null;
    let isListening = false;

    // Initialize speech recognition
    function initSpeechRecognition() {
        if ('webkitSpeechRecognition' in window) {
            recognition = new webkitSpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'en-US';

            recognition.onresult = function(event) {
                const transcript = event.results[0][0].transcript;
                const userInput = document.getElementById('userInput');
                if (userInput) {
                    userInput.value = transcript;
                    // Auto-resize the textarea
                    userInput.style.height = 'auto';
                    userInput.style.height = (userInput.scrollHeight) + 'px';
                }
            };

            recognition.onerror = function(event) {
                console.error('Speech recognition error:', event.error);
                const micButton = document.getElementById('micButton');
                if (micButton) {
                    micButton.classList.remove('recording');
                }
            };

            recognition.onend = function() {
                isListening = false;
                const micButton = document.getElementById('micButton');
                if (micButton) {
                    micButton.classList.remove('recording');
                }
            };
        } else {
            console.warn('Speech recognition not supported in this browser');
        }
    }

    // Toggle speech recognition
    window.toggleSpeechRecognition = function() {
        if (!recognition) {
            initSpeechRecognition();
        }

        if (isListening) {
            recognition.stop();
            isListening = false;
        } else {
            try {
                recognition.start();
                isListening = true;
                const micButton = document.getElementById('micButton');
                if (micButton) {
                    micButton.classList.add('recording');
                }
            } catch (error) {
                console.error('Error starting speech recognition:', error);
            }
        }
    };

    // Function to check if all UI components exist
    function checkUIComponents() {
        // Check content sections
        const requiredSections = ['home', 'profile', 'management'];
        let missingSections = [];
        
        requiredSections.forEach(sectionId => {
            const section = document.getElementById(sectionId);
            if (!section) {
                missingSections.push(sectionId);
                console.error(`Missing section: ${sectionId}`);
            }
        });
        
        if (missingSections.length > 0) {
            console.error('Missing content sections:', missingSections);
        }
        
        // Make sure the active section is visible
        const activeMenuItem = document.querySelector('.menu-item.active');
        if (activeMenuItem) {
            const contentId = activeMenuItem.getAttribute('data-content');
            const contentSection = document.getElementById(contentId);
            if (contentSection) {
                // Hide all sections first
                document.querySelectorAll('.content-section').forEach(section => {
                    section.style.display = 'none';
                    section.classList.add('hidden');
                    section.classList.remove('animate-fade-in');
                });
                
                // Show the active section
                contentSection.style.display = 'block';
                contentSection.classList.remove('hidden');
                contentSection.classList.add('animate-fade-in');
                
                console.log(`Initial section: ${contentId}`);
            }
        }
    }

    // Add typing indicator to chat messages
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    typingIndicator.innerHTML = '<span></span><span></span><span></span>';
    // Do not append to chatMessages here - we'll add it only when needed
    
    // Function to show/hide typing indicator
    function setTypingIndicator(show) {
        if (show) {
            // Add the typing indicator at the bottom of the chat
            chatMessages.appendChild(typingIndicator);
            typingIndicator.style.display = 'block';
            // Scroll to the bottom to ensure the indicator is visible
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            typingIndicator.style.display = 'none';
            // Remove from DOM when not in use
            if (typingIndicator.parentNode) {
                typingIndicator.parentNode.removeChild(typingIndicator);
            }
        }
        isTyping = show;
    }

    // Function to save cases to API
    async function saveCases() {
        // This function is no longer needed for batch saves since we save each case individually
        console.log('Individual cases are saved via API');
    }

    // Added chat counter to track recent chats
    let chatSessionCounter = 0;
    
    // Try to load the chat counter from localStorage
    try {
        const savedCounter = localStorage.getItem('chat_session_counter');
        if (savedCounter) {
            chatSessionCounter = parseInt(savedCounter, 10);
        }
    } catch (error) {
        console.error('Error loading chat counter:', error);
    }

    // Function to update stats on the home page
    function updateHomeStats() {
        const totalCasesElement = document.getElementById('totalCases');
        const recentChatsElement = document.getElementById('recentChats');
        
        if (totalCasesElement) {
            totalCasesElement.textContent = cases.length;
        }
        
        // Display the chat session counter
        if (recentChatsElement) {
            recentChatsElement.textContent = chatSessionCounter;
        }
    }

    // Function to increment chat counter
    function incrementChatCounter() {
        chatSessionCounter++;
        localStorage.setItem('chat_session_counter', chatSessionCounter);
        updateHomeStats();
    }

    // Function to load cases from API with localStorage fallback
    async function loadCases() {
        try {
            console.log(`Attempting to fetch cases from ${API_URL}/cases`);
            const response = await fetch(`${API_URL}/cases`);
            console.log('Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Error response:', errorText);
                throw new Error(`Failed to fetch cases: ${response.status} - ${errorText}`);
            }
            
            const data = await response.json();
            console.log('Fetched cases from API:', data);
            cases = data;
            
            // Save to localStorage as backup
            localStorage.setItem('cases_backup', JSON.stringify(cases));
            
            displayCases();
            displayCasesGrid();
            updateHomeStats(); // Update stats after loading cases
        } catch (error) {
            console.error('Error loading cases from API:', error);
            
            // Try to load from localStorage backup
            const backupCases = localStorage.getItem('cases_backup');
            if (backupCases) {
                console.log('Loading cases from localStorage backup');
                cases = JSON.parse(backupCases);
                displayCases();
                displayCasesGrid();
                
                // Show temporary message
                alert('Using cached cases. Connection to server failed: ' + error.message);
            } else {
                // Create default cases if no backup is available
                console.log('No backup cases available, creating default case');
                cases = [{
                    name: 'Example Case',
                    prompt: 'This is an example case. Please create a new case to get started.',
                    timestamp: new Date().toISOString()
                }];
                localStorage.setItem('cases_backup', JSON.stringify(cases));
                displayCases();
                displayCasesGrid();
                alert(`Error loading cases: ${error.message}\nCreated a default case. Please check if the server is running on port 3001.`);
            }
        }
    }

    // Function to add a new case via API with localStorage backup
    async function addCase(newCase) {
        try {
            const response = await fetch(`${API_URL}/cases`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newCase)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Failed to add case: ${response.status}`);
            }
            
            const savedCase = await response.json();
            cases.push(savedCase);
            
            // Save to localStorage backup
            localStorage.setItem('cases_backup', JSON.stringify(cases));
            
            displayCases();
            displayCasesGrid();
            updateHomeStats(); // Update stats after adding a case
            alert('Case created successfully!');
        } catch (error) {
            console.error('Error adding case:', error);
            
            // Add to local array and localStorage as fallback
            cases.push(newCase);
            localStorage.setItem('cases_backup', JSON.stringify(cases));
            displayCases();
            displayCasesGrid();
            updateHomeStats(); // Update stats after adding a case
            
            alert(`Case created and saved locally. Server error: ${error.message}`);
        }
    }

    // Function to upload the wav files to the backend
    async function uploadWavFiles(files, caseName) {
        const formData = new FormData();
        formData.append('spot1', files[0]);
        formData.append('spot2', files[1]);
        formData.append('spot3', files[2]);
        formData.append('spot4', files[3]);

        try {
            const response = await fetch(`${API_URL}/upload-case/${encodeURIComponent(caseName)}`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Failed to upload WAV files: ${response.status}`);
                } else {
                    const text = await response.text();
                    throw new Error(`Failed to upload WAV files: ${response.status} - ${text}`);
                }
            }

            alert('WAV files uploaded successfully!');
        } catch (error) {
            console.error('Error uploading WAV files:', error);
            alert(`Failed to upload WAV files: ${error.message}`);
        }
    }

    // Function to delete a case via API with localStorage backup
    async function deleteCase(caseName) {
        try {
            const response = await fetch(`${API_URL}/cases/${encodeURIComponent(caseName)}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Failed to delete case: ${response.status}`);
            }
            
            // Remove case from local array
            cases = cases.filter(c => c.name !== caseName);
            
            // Update localStorage backup
            localStorage.setItem('cases_backup', JSON.stringify(cases));
            
            displayCases();
            displayCasesGrid();
            updateHomeStats(); // Update stats after deleting a case
            alert('Case deleted successfully');
        } catch (error) {
            console.error('Error deleting case:', error);
            
            // Delete from local array as fallback
            cases = cases.filter(c => c.name !== caseName);
            localStorage.setItem('cases_backup', JSON.stringify(cases));
            displayCases();
            displayCasesGrid();
            updateHomeStats(); // Update stats after deleting a case
            
            alert(`Case deleted locally. Server error: ${error.message}`);
        }
    }

    // Function to call ChatGPT API
    async function callChatGPT(message) {
        try {
            // Create messages array
            const messages = [];
            
            // Add the conversation history (which now includes the system prompt)
            messages.push(...currentConversation);
            
            // Add the current user message
            messages.push({ role: "user", content: message });

            console.log("==== API REQUEST ====");
            console.log("Current conversation:", JSON.stringify(currentConversation));
            console.log("Adding message:", message);
            console.log("Full messages array:", JSON.stringify(messages));
            console.log("====================");

            // Use server-side proxy to avoid exposing API key in the frontend
            const response = await fetch(`${API_URL}/api/openai`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: CONFIG.model || 'gpt-3.5-turbo',
                    messages: messages,
                    temperature: CONFIG.temperature || 0.7
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error('Error calling ChatGPT API:', error);
            return "Sorry, I encountered an error: " + error.message;
        }
    }

    // Function to sort cases
    function sortCases() {
        cases.sort((a, b) => {
            const dateA = new Date(a.timestamp);
            const dateB = new Date(b.timestamp);
            return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
        });
    }

    // Function to filter cases based on search query
    function filterCases(query) {
        return cases.filter(caseItem => 
            caseItem.name.toLowerCase().includes(query.toLowerCase()) ||
            caseItem.prompt.toLowerCase().includes(query.toLowerCase())
        );
    }

    // Function to display cases in grid (home view)
    function displayCasesGrid() {
        if (!casesGrid) return;
        
        casesGrid.innerHTML = '';
        sortCases();
        
        cases.forEach((caseItem, index) => {
            const caseButton = document.createElement('button');
            caseButton.className = 'case-button';
            caseButton.innerHTML = `
                <span class="text-3xl mb-2">📋</span>
                <span class="font-medium text-sm">${truncateText(caseItem.name, 15)}</span>
            `;
            caseButton.title = caseItem.name; // Add tooltip for longer names
            caseButton.onclick = () => {
                incrementChatCounter(); // Increment counter when chat is opened
                openChat(caseItem.name, caseItem.prompt);
            };
            casesGrid.appendChild(caseButton);
        });
    }

    // Helper function to truncate text
    function truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + '...';
    }

    // Function to display cases in management view
    function displayCases(filteredCases = cases) {
        if (!casesContainer) return;
        
        casesContainer.innerHTML = '';
        
        // Add search and sort controls
        const controls = document.createElement('div');
        controls.className = 'controls';
        controls.innerHTML = `
            <div class="search-controls">
                <input type="text" id="searchInput" placeholder="Search cases..." class="search-input">
            </div>
            <div class="sort-controls">
                <label class="text-secondary-600 font-medium">Sort by: </label>
                <select id="sortSelect">
                    <option value="newest" ${sortOrder === 'newest' ? 'selected' : ''}>Newest First</option>
                    <option value="oldest" ${sortOrder === 'oldest' ? 'selected' : ''}>Oldest First</option>
                </select>
            </div>
        `;
        casesContainer.appendChild(controls);

        // Add event listener for search input
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                const filteredCases = query ? filterCases(query) : cases;
                updateCaseCards(filteredCases);
            });
        }

        // Add event listener for sort select
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', function() {
                sortOrder = this.value;
                sortCases();
                updateCaseCards(cases);
            });
        }

        sortCases();
        updateCaseCards(filteredCases);
    }

    // Function to update only the case cards
    function updateCaseCards(filteredCases) {
        // Remove existing case cards container if it exists
        const oldCardsContainer = document.querySelector('.case-cards-container');
        if (oldCardsContainer) {
            oldCardsContainer.remove();
        }

        const caseCardsContainer = document.createElement('div');
        caseCardsContainer.className = 'case-cards-container grid grid-cols-1 md:grid-cols-2 gap-4';

        if (filteredCases.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.innerHTML = '<p>No cases found. Create a new case to get started.</p>';
            caseCardsContainer.appendChild(emptyMessage);
        } else {
            filteredCases.forEach((caseItem) => {
                const caseCard = document.createElement('div');
                caseCard.className = 'case-card';
                
                // Get preview of first three lines
                const promptLines = caseItem.prompt.split('\n');
                const previewLines = promptLines.slice(0, 3).join('\n');
                const hasMoreLines = promptLines.length > 3;
                
                caseCard.innerHTML = `
                    <h3 class="case-title">${caseItem.name}</h3>
                    <div class="case-prompt-container">
                        <p class="case-prompt text-sm preview-mode">${previewLines}</p>
                        ${hasMoreLines ? `<p class="case-prompt text-sm full-content hidden">${caseItem.prompt}</p>` : ''}
                        ${hasMoreLines ? `<button class="expand-btn text-xs text-primary-600 hover:text-primary-800 mt-1">Show more</button>` : ''}
                    </div>
                    <p class="timestamp">${new Date(caseItem.timestamp).toLocaleString()}</p>

                    ${[1, 2, 3, 4].map(i => `
                        <button 
                            data-audio="/uploads/${caseItem.name}_spot${i}.wav"
                            data-label="Spot ${i}"
                            class="play-spot-btn bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs transition-colors">
                            ▶ Spot ${i}
                        </button>
                    `).join('')}
                    


                    <div class="flex justify-between mt-3">
                        <div class="flex gap-2">
                            <button class="edit-case-btn bg-secondary-500 hover:bg-secondary-600 text-white px-3 py-1 rounded text-sm transition-colors">
                                Edit
                            </button>
                        </div>
                        <button class="delete-case-btn bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm transition-colors">
                            Delete
                        </button>
                    </div>
                `;



                // Manage audio playback per card
                let currentAudio = null;
                let currentButton = null;

                caseCard.querySelectorAll('.play-spot-btn').forEach(button => {
                    button.addEventListener('click', () => {
                        const audioUrl = button.getAttribute('data-audio');

                        // If same button clicked again, toggle pause
                        if (currentButton === button && currentAudio) {
                            if (!currentAudio.paused) {
                                currentAudio.pause();
                                button.textContent = `▶ ${button.dataset.label}`;
                            } else {
                                currentAudio.play();
                                button.textContent = `⏸ ${button.dataset.label}`;
                            }
                            return;
                        }

                        // Stop previous audio
                        if (currentAudio) {
                            currentAudio.pause();
                            currentButton.textContent = `▶ ${currentButton.textContent.slice(2)}`;
                        }

                        // Play new audio
                        currentAudio = new Audio(audioUrl);
                        currentButton = button;
                        currentAudio.play();
                        button.textContent = `⏸ ${button.dataset.label}`;

                        currentAudio.addEventListener('ended', () => {
                            button.textContent = `▶ ${button.dataset.label}`;
                            currentAudio = null;
                            currentButton = null;
                        });
                    });
                });

                // Add edit button listener
                caseCard.querySelector('.edit-case-btn').addEventListener('click', () => {
                    openEditCaseModal(caseItem);
                });

                caseCard.querySelector('.delete-case-btn').addEventListener('click', () => {
                    if (confirm('Are you sure you want to delete this case?')) {
                        deleteCase(caseItem.name);
                    }
                });
                
                // Add show more/less toggle if there are more than 3 lines
                if (hasMoreLines) {
                    const expandBtn = caseCard.querySelector('.expand-btn');
                    expandBtn.addEventListener('click', () => {
                        const previewElem = caseCard.querySelector('.preview-mode');
                        const fullElem = caseCard.querySelector('.full-content');
                        
                        if (previewElem.classList.contains('hidden')) {
                            // Show preview, hide full
                            previewElem.classList.remove('hidden');
                            fullElem.classList.add('hidden');
                            expandBtn.textContent = 'Show more';
                        } else {
                            // Show full, hide preview
                            previewElem.classList.add('hidden');
                            fullElem.classList.remove('hidden');
                            expandBtn.textContent = 'Show less';
                        }
                    });
                }

                caseCardsContainer.appendChild(caseCard);
            });
        }

        // Append to the container after the controls
        const controls = document.querySelector('.controls');
        if (controls) {
            controls.after(caseCardsContainer);
        } else {
            casesContainer.appendChild(caseCardsContainer);
        }
    }


    // Initialize text-to-speech
    function initTTS() {
        ttsSupported = 'speechSynthesis' in window;
        
        if (ttsSupported) {
            // Load available voices
            loadVoices();
            
            // Chrome loads voices asynchronously
            if (speechSynthesis.onvoiceschanged !== undefined) {
                speechSynthesis.onvoiceschanged = loadVoices;
            }
        }
    }

    function loadVoices() {
        voices = speechSynthesis.getVoices();
        const voiceSelect = document.getElementById('voiceSelect');
        
        // Clear existing options
        voiceSelect.innerHTML = '';
        
        // Add voices to select
        voices.forEach((voice, index) => {
            const option = document.createElement('option');
            option.textContent = `${voice.name} (${voice.lang})`;
            option.setAttribute('data-lang', voice.lang);
            option.setAttribute('data-index', index);
            voiceSelect.appendChild(option);
        });
        
        // Set default voice (first available)
        if (voices.length > 0) {
            // Try to find previously selected voice
            if (selectedVoice) {
                for (let i = 0; i < voices.length; i++) {
                    if (voices[i].name === selectedVoice.name) {
                        voiceSelect.selectedIndex = i;
                        break;
                    }
                }
            }
            
            // If no previously selected voice or not found, use first one
            if (!selectedVoice || voiceSelect.selectedIndex === -1) {
                selectedVoice = voices[0];
                voiceSelect.selectedIndex = 0;
            }
        }
    }

    function speakText(text) {
        if (!ttsSupported || !text) return;
        
        // Cancel any ongoing speech
        speechSynthesis.cancel();
        
        // Create utterance
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Set voice settings
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
        utterance.rate = voiceSettings.rate;
        utterance.pitch = voiceSettings.pitch;
        utterance.volume = voiceSettings.volume;
        
        // Show speech control button
        const speechControlBtn = document.getElementById('speechControlBtn');
        if (speechControlBtn) {
            speechControlBtn.style.display = 'block';
        } else {
            // Create speech control button if it doesn't exist
            const button = document.createElement('button');
            button.id = 'speechControlBtn';
            button.className = 'fixed top-20 right-5 bg-white text-red-500 border border-red-500 rounded-md z-50';
            button.innerHTML = '<i class="fas fa-stop-circle"></i> Stop Reading';
            button.onclick = function() {
                speechSynthesis.cancel();
                this.style.display = 'none';
            };
            document.body.appendChild(button);
        }
        
        // Hide speech control button when done
        utterance.onend = function() {
            const button = document.getElementById('speechControlBtn');
            if (button) {
                button.style.display = 'none';
            }
        };
        
        // Speak the text
        speechSynthesis.speak(utterance);
    }

    // Expose globally
    window.speakText = speakText;

    function testVoice() {
        const testText = "This is a test of the selected voice and settings. How does it sound?";
        speakText(testText);
    }

    function loadVoiceSettings() {
        // Load voice settings from localStorage
        const savedSettings = localStorage.getItem('voiceSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            
            voiceSettings.rate = settings.rate || 1.0;
            voiceSettings.pitch = settings.pitch || 1.0;
            voiceSettings.volume = settings.volume || 1.0;
            
            // Restore selected voice (will be completed when voices are loaded)
            if (settings.voiceName) {
                // We'll match this when voices are available
                selectedVoice = { name: settings.voiceName };
            }
        }
    }

// Function to open chat
    function openChat(caseName, casePrompt) {
        // Prompt for user name if not already set
        currentUserName = localStorage.getItem('userName');
        currentCase = { name: caseName, prompt: casePrompt };
        chatPopup.style.display = 'flex'; // Show the chat popup
        chatPopup.classList.add('active');
        chatTitle.textContent = caseName;

        // Clear previous chat messages
        chatMessages.innerHTML = '';
        // Do not add typing indicator here - we'll add it when needed

        const initialMessage = "Hello doctor!";

        // Reset conversation history and add a system message
        currentConversation = [
            {
                role: "system",
                content: `You are simulating a realistic patient attending the Internal Medicine department of a hospital. A medical student will conduct a clinical interview to reach a preliminary diagnosis.

                Your behavior:

                Remain completely in character as a real human patient throughout the entire conversation.
                Respond only to questions the student asks. Do not offer extra or unsolicited information.
                Never mention or suggest your diagnosis.
                Answer personal questions (like family, occupation, habits, etc.) naturally, based on your patient profile. Do not say things like "I don't know" or "I'm just a simulation."
                If something is uncertain for the patient, express it naturally (e.g., “I think so,” “I’m not sure,” “Maybe 5 years ago,” etc.).
                If a question doesn't apply to you, say so realistically (e.g., “I don't have kids,” “I'm not married,” “I don't drink,” etc.).
                Feel free to include hesitations, emotions, or discomfort if relevant (e.g., pain, embarrassment, frustration).
                Be consistent in your answers with the patient profile below.

                Patient Profile:
                ${casePrompt}

                Instructions for the Student:

                Engage with the patient by asking relevant questions to gather necessary information for a preliminary diagnosis. The patient will respond concisely and only provide information in direct response to your questions.

                Your first message should be: "${initialMessage}"`
            },
            { role: "assistant", content: initialMessage } // Add the initial message to the conversation
        ];

        // Add initial prompt message to UI
        const assistantMessageDiv = document.createElement('div');
        assistantMessageDiv.className = 'message assistant-message';

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.textContent = initialMessage;
        assistantMessageDiv.appendChild(messageContent);

        chatMessages.appendChild(assistantMessageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Speak the initial message if TTS is supported
        if (ttsSupported) {
            speakText(initialMessage);
        }

        setTypingIndicator(false); // Remove typing indicator after initial setup
    }

    // Function to close chat
    window.closeChat = function() {
        // Stop any ongoing speech when closing chat
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        
        finishClosingChat();
    };

    // Function to close chat
    window.finishDiagnosis = function() {
        // Stop any ongoing speech when closing chat
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        
        // Show differential diagnosis modal before saving the chat
        if (currentCase && currentConversation.length > 1) { // Ensure we have a valid case and conversation
            showDifferentialDiagnosisModal();
        } else {
            // If no valid conversation, just close the chat
            finishClosingChat();
        }
    };

    // Function to show the differential diagnosis modal
    function showDifferentialDiagnosisModal() {
        // Check if modal already exists
        let diagnosisModal = document.getElementById('diagnosisModal');
        
        if (!diagnosisModal) {
            // Create the modal
            diagnosisModal = document.createElement('div');
            diagnosisModal.id = 'diagnosisModal';
            diagnosisModal.className = 'modal fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center';
            
            // Create modal content
            const modalContent = `
                <div class="modal-content bg-white dark:bg-gray-800 rounded-lg shadow-xl w-11/12 max-w-2xl p-6" style="color: black !important;">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-bold text-blue-900 dark:text-blue-300" style="color: black !important; font-weight: bold !important;">Add Your Differential Diagnosis</h2>
                        <button id="closeDiagnosisModal" class="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <p class="mb-4 text-blue-900 dark:text-white" style="color: black !important; font-weight: 600 !important;">
                        Based on the conversation, please provide your differential diagnosis for this case.
                        This will be saved with your session and included in AI reviews.
                    </p>
                    <div class="mb-4">
                        <label for="diagnosisInput" class="block text-sm font-medium text-blue-900 dark:text-white mb-1" style="color: black !important; font-weight: 600 !important;">
                            Differential Diagnosis
                        </label>
                        <textarea id="diagnosisInput" rows="6" 
                            class="w-full px-3 py-2 text-black border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-blue-900 text-base font-medium"
                            style="color: black !important; font-weight: 500 !important; font-size: 16px !important;"
                            placeholder="Enter your differential diagnosis here..."></textarea>
                    </div>
                    <div class="flex justify-end space-x-3">
                        <button id="submitDiagnosis" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            Submit & Close Chat
                        </button>
                    </div>
                </div>
            `;
            
            diagnosisModal.innerHTML = modalContent;
            document.body.appendChild(diagnosisModal);
            
            // Add event listeners
            document.getElementById('closeDiagnosisModal').addEventListener('click', () => {
                diagnosisModal.classList.add('hidden');
            });
            
            document.getElementById('submitDiagnosis').addEventListener('click', () => {
                const diagnosisText = document.getElementById('diagnosisInput').value.trim();
                saveChatWithDiagnosis(diagnosisText);
                diagnosisModal.classList.add('hidden');
                finishClosingChat();
            });
        } else {
            // Reset the textarea if modal already exists
            const diagnosisInput = document.getElementById('diagnosisInput');
            if (diagnosisInput) {
                diagnosisInput.value = '';
            }
            diagnosisModal.classList.remove('hidden');
        }
    }

    // Function to save chat with diagnosis
    function saveChatWithDiagnosis(diagnosisText) {
        if (currentCase && currentConversation.length > 1) {
            // Extract the messages from the conversation history
            // Skip the system message which is at position 0
            const messages = currentConversation.slice(1);
            
            // Create a unique ID for the case if it doesn't have one
            const caseId = currentCase.id || Date.now().toString();
            const caseName = currentCase.name;
            const casePrompt = currentCase.prompt || ''; // Get the case prompt
            
            // Call the global saveChatSession function with the userName, casePrompt, and diagnosis
            saveChatSession(caseId, caseName, messages, currentUserName, casePrompt, diagnosisText)
                .then(result => {
                    console.log('Session saved successfully with diagnosis:', result);
                    
                    // Show a notification to the user
                    const notification = document.createElement('div');
                    notification.className = 'save-notification';
                    notification.innerHTML = `
                        <p class="text-blue-900 font-medium">Chat session saved successfully${diagnosisText ? ' with your diagnosis' : ''}!</p>
                        <button onclick="this.parentNode.remove()" class="dismiss-btn">Dismiss</button>
                    `;
                    document.body.appendChild(notification);
                    
                    // Auto-remove after 3 seconds
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.remove();
                        }
                    }, 3000);
                    
                    // Update sessions UI if we're on the sessions page
                    const sessionsSection = document.getElementById('sessions');
                    if (sessionsSection && window.getComputedStyle(sessionsSection).display !== 'none') {
                        loadSessions();
                    }
                })
                .catch(error => {
                    console.error('Error saving session with diagnosis:', error);
                    
                    // Show error notification
                    const notification = document.createElement('div');
                    notification.className = 'error-notification';
                    notification.innerHTML = `
                        <p class="text-red-900 font-medium">Error saving session: ${error.message}</p>
                        <button onclick="this.parentNode.remove()" class="dismiss-btn">Dismiss</button>
                    `;
                    document.body.appendChild(notification);
                    
                    // Auto-remove after 5 seconds
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.remove();
                        }
                    }, 5000);
                });
        }
    }

    // Function to complete the chat closing process
    function finishClosingChat() {
        const chatPopup = document.getElementById('chatPopup');
        if (chatPopup) {
            chatPopup.classList.remove('active');
            setTimeout(() => {
                chatPopup.style.display = 'none'; // Hide after animation
            }, 300);
        }
        
        document.body.style.overflow = 'auto';
        currentCase = null;
        currentConversation = [];
    }

    // Function to send message - Fix the visibility of messages
    window.sendMessage = async function() {
        const message = userInput.value.trim();
        if (message && currentCase && !isTyping) {
            // Add user message to UI
            const userMessageDiv = document.createElement('div');
            userMessageDiv.className = 'message user-message';
            
            // Create a message content div
            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';
            messageContent.textContent = message;
            userMessageDiv.appendChild(messageContent);
            
            chatMessages.appendChild(userMessageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            // Add to conversation history
            currentConversation.push({ role: "user", content: message });
            
            userInput.value = '';
            
            // Show typing indicator at the bottom
            setTypingIndicator(true);
            
            try {
                const response = await callChatGPT(message);
                setTypingIndicator(false);
                
                // Add assistant response to UI
                const assistantMessageDiv = document.createElement('div');
                assistantMessageDiv.className = 'message assistant-message';
                
                // Create a message content div
                const messageContent = document.createElement('div');
                messageContent.className = 'message-content';
                messageContent.textContent = response;
                assistantMessageDiv.appendChild(messageContent);
                
                chatMessages.appendChild(assistantMessageDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                
                // Add to conversation history
                currentConversation.push({ role: "assistant", content: response });
                
                // Speak the response text
                if (ttsSupported) {
                    speakText(response);
                }
            } catch (error) {
                setTypingIndicator(false);
                
                // Add error message to UI
                const errorMessageDiv = document.createElement('div');
                errorMessageDiv.className = 'message assistant-message';
                
                // Create a message content div
                const messageContent = document.createElement('div');
                messageContent.className = 'message-content';
                messageContent.textContent = "Sorry, I encountered an error. Please try again.";
                errorMessageDiv.appendChild(messageContent);
                
                chatMessages.appendChild(errorMessageDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                
                // Add to conversation history
                currentConversation.push({ role: "assistant", content: "Sorry, I encountered an error. Please try again." });
                
                // Speak the error message
                if (ttsSupported) {
                    speakText("Sorry, I encountered an error. Please try again.");
                }
            }
        }
    };

    // Handle form submission
    if (caseForm) {
        caseForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const caseName = document.getElementById('caseName').value.trim();
            const casePrompt = document.getElementById('casePrompt').value.trim();
            const files = [
                document.getElementById('spot1').files[0],
                document.getElementById('spot2').files[0],
                document.getElementById('spot3').files[0],
                document.getElementById('spot4').files[0]
            ];
            
            if (!caseName || !casePrompt || files.some(f => !f)) {
                alert('Please fill in all fields and upload all 4 WAV files.');
                return;
            }
            
            // ✅ Check if the case name already exists in the current list
            const nameTaken = cases.some(c => c.name === caseName);
            if (nameTaken) {
                alert(`Case name "${caseName}" is already used. Please choose a different name.`);
                return;
            }

            const newCase = {
                name: caseName, 
                prompt: casePrompt,
                timestamp: new Date().toISOString(),
            };
            
            addCase(newCase);
            uploadWavFiles(files, caseName);
            // Reset form
            this.reset();
        });
    }

    // Handle Enter key in chat input
    if (userInput) {
        userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Auto-resize textarea
        userInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }

    // Handle menu navigation
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all menu items
            menuItems.forEach(i => i.classList.remove('active'));
            
            // Add active class to clicked menu item
            item.classList.add('active');
            
            // Get the target content ID
            const contentId = item.getAttribute('data-content');
            
            // Hide all content sections
            const allSections = document.querySelectorAll('.content-section');
            allSections.forEach(section => {
                section.style.display = 'none';
                section.classList.add('hidden');
                section.classList.remove('animate-fade-in');
            });
            
            // Show the selected content section
            const contentSection = document.getElementById(contentId);
            if (contentSection) {
                contentSection.style.display = 'block';
                contentSection.classList.remove('hidden');
                contentSection.classList.add('animate-fade-in');
                
                // Load sessions when the sessions section is shown
                if (contentId === 'sessions') {
                    loadSessions();
                    initSessionSearch();
                }
                
                console.log(`Changed to section: ${contentId}`);
            } else {
                console.error(`Content section with id ${contentId} not found`);
            }
        });
    });

    // Add configuration button to page
    const configButton = document.createElement('button');
    configButton.className = 'config-button';
    configButton.innerHTML = '⚙️';
    configButton.title = 'API Configuration';
    configButton.addEventListener('click', openApiKeyModal);
    document.body.appendChild(configButton);


    // Add voice button to page
    const voiceButton = document.createElement('button');
    voiceButton.className = 'config-button';
    voiceButton.innerHTML = '⚙️';
    voiceButton.title = 'Voice Settings';
    voiceButton.addEventListener('click', openVoiceSettingsModal);
    document.body.appendChild(voiceButton);

    // API Modal Functions
    const apiKeyModal = document.getElementById('apiKeyModal');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const modelSelect = document.getElementById('modelSelect');
    const temperatureInput = document.getElementById('temperatureInput');
    const temperatureValue = document.getElementById('temperatureValue');
    
    // Find the settings button in the DOM
    const openConfigButton = document.getElementById('openConfigButton');
    if (openConfigButton) {
        // Remove the inline onclick attribute that might not be working
        openConfigButton.removeAttribute('onclick');
        // Add event listener directly
        openConfigButton.addEventListener('click', openApiKeyModal);
    }

    // Find the settings button in the DOM
    const voiceSettingsButton = document.getElementById('voiceSettingsButton');
    if (voiceSettingsButton) {
        // Remove the inline onclick attribute that might not be working
        voiceSettingsButton.removeAttribute('onclick');
        // Add event listener directly
        voiceSettingsButton.addEventListener('click', openVoiceSettingsModal);
    }

    // Load saved configuration
    function loadApiConfig() {
        const savedConfig = JSON.parse(localStorage.getItem('openai_config') || '{}');
        if (savedConfig.model) {
            CONFIG.model = savedConfig.model;
            if (modelSelect) modelSelect.value = savedConfig.model;
        }
        if (savedConfig.temperature !== undefined) {
            CONFIG.temperature = savedConfig.temperature;
            if (temperatureInput) temperatureInput.value = savedConfig.temperature;
            if (temperatureValue) temperatureValue.textContent = savedConfig.temperature;
        }
    }

    // Update temperature display
    if (temperatureInput && temperatureValue) {
        temperatureInput.addEventListener('input', function() {
            temperatureValue.textContent = this.value;
        });
    }

    // Save API configuration
    window.saveApiConfig = function() {
        console.log("Saving API config");
        try {
            const modelSelect = document.getElementById('modelSelect');
            const temperatureInput = document.getElementById('temperatureInput');
            
            if (!modelSelect || !temperatureInput) {
                throw new Error("API config form elements not found");
            }
            
            const model = modelSelect.value;
            const temperature = parseFloat(temperatureInput.value);
            
            // Update CONFIG object
            CONFIG.model = model;
            CONFIG.temperature = temperature;
            
            // Save to localStorage
            localStorage.setItem('openai_config', JSON.stringify({
                model,
                temperature
            }));
            
            // Close the modal
            window.closeApiKeyModal();
            
            // Check connection
            checkApiConnection();
            
            alert("API configuration saved successfully!");
        } catch (error) {
            console.error("Error saving API config:", error);
            alert("Could not save API settings. Please try again.");
        }
    };

    window.saveVoiceSettings = function() {
        const modal = document.getElementById('voiceSettingsModal');
        if (!modal) {
            console.error('Voice settings modal not found');
            return;
        }

        const rateInput = document.getElementById('rateInput');
        const pitchInput = document.getElementById('pitchInput');
        const volumeInput = document.getElementById('volumeInput');
        const voiceSelect = document.getElementById('voiceSelect');
    
        // Parse values
        const rate = parseFloat(rateInput.value);
        const pitch = parseFloat(pitchInput.value);
        const volume = parseFloat(volumeInput.value);
        const voiceName = voiceSelect.value;

        // Update the global settings object
        voiceSettings.rate = rate;
        voiceSettings.pitch = pitch;
        voiceSettings.volume = volume;
        voiceSettings.voice = voiceName;
    
        // Close modal
        window.closeVoiceSettingsModal();
    
        alert("Voice settings saved successfully!");
    }

    // Open API configuration modal
    function openApiKeyModal() {
        console.log("Opening API key modal");
        try {
            // Load existing values if available
            const model = localStorage.getItem('model') || CONFIG.model || 'gpt-3.5-turbo';
            const temperature = localStorage.getItem('temperature') || CONFIG.temperature || 0.7;
            
            // Set values in the form
            const modelSelect = document.getElementById('modelSelect');
            const temperatureInput = document.getElementById('temperatureInput');
            const temperatureValue = document.getElementById('temperatureValue');
            
            if (modelSelect) modelSelect.value = model;
            if (temperatureInput) temperatureInput.value = temperature;
            if (temperatureValue) temperatureValue.textContent = temperature;
            
            // Show the modal
            const modal = document.getElementById('apiKeyModal');
            if (modal) {
                modal.style.display = 'flex';
                modal.classList.remove('hidden');
            } else {
                throw new Error("API key modal not found");
            }
        } catch (error) {
            console.error("Error opening API key modal:", error);
            alert("Could not open API settings. Please try again.");
        }
    }

    // Open Voice Settings modal
    function openVoiceSettingsModal() {
        const modal = document.getElementById('voiceSettingsModal');
        if (!modal) {
            console.error('Voice settings modal not found');
            return;
        }
        modal.style.display = 'flex';
        modal.classList.remove('hidden'); // Make sure it's not hidden via utility classes
        console.log('Opened voice settings modal');
    }

    // Close API configuration modal
    window.closeApiKeyModal = function() {
        console.log("Closing API key modal");
        try {
            const modal = document.getElementById('apiKeyModal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.add('hidden');
            } else {
                throw new Error("API key modal not found");
            }
        } catch (error) {
            console.error("Error closing API key modal:", error);
        }
    };

    // Show API status
    const statusBar = document.createElement('div');
    statusBar.className = 'api-status';
    statusBar.innerHTML = `
        <p class="m-0">API: <span id="apiStatus" class="font-medium">Checking...</span></p>
        <button id="reconnectButton" class="px-2 py-1 bg-secondary-500 text-white text-xs rounded hover:bg-secondary-600 transition-colors">Reconnect</button>
    `;
    document.body.appendChild(statusBar);
    
    // Add event listener for reconnect button
    document.getElementById('reconnectButton').addEventListener('click', async () => {
        document.getElementById('apiStatus').textContent = 'Connecting...';
        document.getElementById('apiStatus').style.color = '#ffc107';
        
        const isConnected = await checkApiConnection();
        if (isConnected) {
            loadCases();
            alert('Successfully reconnected to the server!');
        } else {
            alert('Failed to connect to the server. Please check if it\'s running.');
        }
    });

    // Check API connection and update status
    async function checkApiConnection() {
        const statusElement = document.getElementById('apiStatus');
        const rpiStatus = document.getElementById('rpiStatus');

        try {
            const response = await fetch(`${API_URL}/health`, { 
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                statusElement.textContent = 'Connected';
                statusElement.style.color = '#28a745';
                console.log('API health check:', data);
            } else {
                statusElement.textContent = 'Error';
                statusElement.style.color = '#dc3545';
            }
        } catch (error) {
            statusElement.textContent = 'Not Connected';
            statusElement.style.color = '#dc3545';
            console.error('API connection error:', error);
        }


        // RPI status
        try {
            const res = await fetch(`${API_URL}/rpi-status`);
            const data = await res.json();
            if (data.online) {
                rpiStatus.textContent = 'Online';
                rpiStatus.style.color = '#28a745';
            } else {
                rpiStatus.textContent = 'Offline';
                rpiStatus.style.color = '#dc3545';
            }
        } catch (e) {
            rpiStatus.textContent = 'Error';
            rpiStatus.style.color = '#dc3545';
        }
    }
    
    // Try to reconnect to API periodically
    setInterval(async () => {
        const wasConnected = document.getElementById('apiStatus').textContent === 'Connected';
        const isConnected = await checkApiConnection();
        
        // If we just reconnected, reload cases from server
        if (!wasConnected && isConnected) {
            console.log('Reconnected to server, reloading cases');
            loadCases();
        }
    }, 10000); // Check every 10 seconds

    // Add keyframe animations
    const keyframes = document.createElement('style');
    keyframes.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeOut {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(10px); }
        }
    `;
    document.head.appendChild(keyframes);

    // Initialize UI components first
    checkUIComponents();
    
    // Then load data and check connections
    loadApiConfig();
    checkApiConnection();
    loadCases();

    // Function to edit a case
    async function editCase(originalName, updatedCase) {
        console.log('Editing case:', originalName, '->', updatedCase.name);
        try {
            // First, update the case on the server
            const response = await fetch(`${API_URL}/cases/${encodeURIComponent(originalName)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatedCase)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch {
                    errorData = { error: errorText };
                }
                throw new Error(errorData.error || `Failed to update case: ${response.status}`);
            }
            
            // Get the updated case from the server
            const savedCase = await response.json();
            console.log('Server returned updated case:', savedCase);
            
            // Update local cases array
            const index = cases.findIndex(c => c.name === originalName);
            if (index !== -1) {
                cases[index] = savedCase;
                console.log('Updated local case at index:', index);
            } else {
                // If the case name changed and we can't find the original, just add it
                cases.push(savedCase);
                console.log('Added new case because original was not found');
            }
            
            // Save to localStorage backup
            localStorage.setItem('cases_backup', JSON.stringify(cases));
            
            // Refresh displays
            displayCases();
            displayCasesGrid();
            updateHomeStats();
            
            alert('Case updated successfully!');
            return true;
        } catch (error) {
            console.error('Error updating case:', error);
            
            // Create a fallback local update
            console.log('Falling back to local update');
            // Update locally if server fails
            const index = cases.findIndex(c => c.name === originalName);
            if (index !== -1) {
                cases[index] = updatedCase;
                localStorage.setItem('cases_backup', JSON.stringify(cases));
                displayCases();
                displayCasesGrid();
                updateHomeStats();
                
                alert(`Case updated locally only. Server error: ${error.message}`);
                return true;
            } else {
                alert(`Failed to update case: Original case "${originalName}" not found.`);
                return false;
            }
        }
    }
    
    // Function to upload the wav files to the backend from edit
    async function editWavFiles(files, caseName) {
        if (!files[0] && !files[1] && !files[2]  && !files[3]) {
            return;
        }
        const formData = new FormData();
        if (files[0]) formData.append('spot1', files[0]);
        if (files[1]) formData.append('spot2', files[1]);
        if (files[2]) formData.append('spot3', files[2]);
        if (files[3]) formData.append('spot4', files[3]);

        try {
            const response = await fetch(`${API_URL}/edit-case/${encodeURIComponent(caseName)}`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Failed to upload WAV files: ${response.status}`);
                } else {
                    const text = await response.text();
                    throw new Error(`Failed to edit WAV files: ${response.status} - ${text}`);
                }
            }

            alert('WAV files edited successfully!');
        } catch (error) {
            console.error('Error uploading WAV files:', error);
            alert(`Failed to edit WAV files: ${error.message}`);
        }
    }


    // Create Edit Case Modal
    function createEditCaseModal() {
        // Check if modal already exists
        let editModal = document.getElementById('editCaseModal');
        if (editModal) {
            // Remove existing modal to prevent duplicate IDs or event listeners
            editModal.remove();
        }
        
        editModal = document.createElement('div');
        editModal.id = 'editCaseModal';
        editModal.className = 'modal fixed inset-0 z-50 bg-black bg-opacity-50 flex justify-center items-center backdrop-blur-sm';
        editModal.style.display = 'none'; // Start hidden, we'll show it later
        editModal.innerHTML = `
            <div class="modal-content glass rounded-2xl shadow-2xl w-11/12 max-w-md max-h-[90vh] overflow-auto animate-fade-in">
                <div class="modal-header flex justify-between items-center p-6 border-b border-gray-200/30">
                    <h3 class="text-xl font-bold text-primary-700">Edit Case</h3>
                    <button id="closeEditModalBtn" class="close-modal text-2xl text-gray-500 hover:text-gray-700 focus:outline-none transition-colors">×</button>
                </div>
                <div class="modal-body p-6 space-y-5">
                    <form id="editCaseForm" class="space-y-6">
                        <input type="hidden" id="originalCaseName">
                        <div class="form-group">
                            <label for="editCaseName" class="block text-sm font-medium text-secondary-700 mb-1">Case Name:</label>
                            <input type="text" id="editCaseName" required
                                class="w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors">
                        </div>
                        <div class="form-group">
                            <label for="editCasePrompt" class="block text-sm font-medium text-secondary-700 mb-1">Case Description:</label>
                            <textarea id="editCasePrompt" rows="6" required
                                class="w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"></textarea>
                        </div>

                        <!-- WAV Uploads -->
                        <div class="form-group">
                            <label class="block text-sm font-medium text-secondary-700 mb-2">
                            Upload New Soundtracks for Spots 1–4 (WAV only). <br>
                            Pay attention - by uploading specific spot soundtrack you will replace the old one with the new one and the original soundtrack will be deleted.
                            </label>
                        
                            <div class="flex gap-4 flex-wrap">
                            <label for="spot1" class="flex flex-col items-start text-sm text-gray-700">
                                Spot 1:
                                <input type="file" name="spot1" id="spot1edit" accept=".wav" required class="file-input mt-1">
                            </label>
                        
                            <label for="spot2" class="flex flex-col items-start text-sm text-gray-700">
                                Spot 2:
                                <input type="file" name="spot2" id="spot2edit" accept=".wav" required class="file-input mt-1">
                            </label>
                        
                            <label for="spot3" class="flex flex-col items-start text-sm text-gray-700">
                                Spot 3:
                                <input type="file" name="spot3" id="spot3edit" accept=".wav" required class="file-input mt-1">
                            </label>
                        
                            <label for="spot4" class="flex flex-col items-start text-sm text-gray-700">
                                Spot 4:
                                <input type="file" name="spot4" id="spot4edit" accept=".wav" required class="file-input mt-1">
                            </label>
                            </div>
                        </div>



                    </form>
                </div>
                <div class="modal-footer border-t border-gray-200/30 p-6 flex justify-end">
                    <button id="cancelEditBtn" class="px-5 py-2.5 bg-gray-400 text-white rounded-lg shadow hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition-all duration-300 mr-3">
                        Cancel
                    </button>
                    <button id="saveEditBtn" class="px-5 py-2.5 bg-primary-600 text-white rounded-lg shadow hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-300">
                        Save Changes
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(editModal);
        
        // Add direct event listeners instead of using onclick attributes
        document.getElementById('closeEditModalBtn').addEventListener('click', closeEditCaseModal);
        document.getElementById('cancelEditBtn').addEventListener('click', closeEditCaseModal);
        document.getElementById('saveEditBtn').addEventListener('click', submitEditCaseForm);
        
        // Also allow clicking outside the modal to close it
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) {
                closeEditCaseModal();
            }
        });
        
        return editModal;
    }
    
    // Function to open edit case modal
    function openEditCaseModal(caseItem) {
        console.log('Opening edit modal for case:', caseItem.name);
        
        const editModal = createEditCaseModal();
        const originalCaseNameInput = document.getElementById('originalCaseName');
        const editCaseNameInput = document.getElementById('editCaseName');
        const editCasePromptInput = document.getElementById('editCasePrompt');
        
        if (editCaseNameInput && editCasePromptInput && originalCaseNameInput) {
            // Populate form fields
            originalCaseNameInput.value = caseItem.name;
            editCaseNameInput.value = caseItem.name;
            editCasePromptInput.value = caseItem.prompt;
            
            // Show modal
            editModal.style.display = 'flex';
            editModal.style.opacity = '0';
            setTimeout(() => {
                editModal.style.opacity = '1';
            }, 10);
            
            // Focus on the name field
            setTimeout(() => {
                editCaseNameInput.focus();
            }, 100);
        } else {
            console.error('Edit form elements not found');
            alert('Could not open edit form. Please try again.');
        }
    }
    
    // Function to close edit case modal
    function closeEditCaseModal() {
        console.log('Closing edit modal');
        const editModal = document.getElementById('editCaseModal');
        if (editModal) {
            editModal.style.opacity = '0';
            setTimeout(() => {
                editModal.style.display = 'none';
            }, 300);
        } else {
            console.error('Edit modal not found for closing');
        }
    }
    
    // Function to submit edit case form
    function submitEditCaseForm() {
        console.log('Submitting edit form');
        const originalCaseName = document.getElementById('originalCaseName').value;
        const caseName = document.getElementById('editCaseName').value.trim();
        const casePrompt = document.getElementById('editCasePrompt').value.trim();
        
        const files = [
            document.getElementById('spot1edit').files[0],
            document.getElementById('spot2edit').files[0],
            document.getElementById('spot3edit').files[0],
            document.getElementById('spot4edit').files[0]
        ];

        if (!caseName || !casePrompt) {
            alert('Please fill in both case name and description');
            return;
        }

        // Check if the case new name already exists in the current list
        const nameTaken = cases.some(c => c.name === caseName);
        if (originalCaseName != caseName && nameTaken) {
            alert(`Case name "${caseName}" is already used. Please choose a different name.`);
            return;
        }

        // Find the original case to preserve timestamp
        const originalCase = cases.find(c => c.name === originalCaseName);
        if (!originalCase) {
            alert('Case not found. Please try again.');
            return;
        }
        
        // Create updated case object, keeping original timestamp
        const updatedCase = {
            name: caseName,
            prompt: casePrompt,
            timestamp: originalCase.timestamp
        };
        
        // Update case
        editCase(originalCaseName, updatedCase);
        editWavFiles(files, caseName);

        // Close modal
        closeEditCaseModal();
    }
    
    // Make these functions available to the window
    window.closeEditCaseModal = closeEditCaseModal;
    window.submitEditCaseForm = submitEditCaseForm;

    // Initialize TTS
    initTTS();
    
    // Load voice settings
    loadVoiceSettings();
    
    // Add event listeners
    initEventListeners();
});

function initEventListeners() {
    // Update username display when the page loads
    updateProfileUserNameDisplay();
    
    // Navigation event listeners for menu items
    const menuItems = document.querySelectorAll('.menu-item');
    const contentSections = document.querySelectorAll('.content-section');
    
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            const contentId = this.getAttribute('data-content');
            
            // Remove active class from all menu items
            menuItems.forEach(menuItem => {
                menuItem.classList.remove('active');
            });
            
            // Add active class to clicked item
            this.classList.add('active');
            
            // Hide all content sections
            contentSections.forEach(section => {
                section.style.display = 'none';
                section.classList.add('hidden');
                section.classList.remove('animate-fade-in');
            });
            
            // Show the selected content section
            const selectedSection = document.getElementById(contentId);
            if (selectedSection) {
                selectedSection.style.display = 'block';
                selectedSection.classList.remove('hidden');
                selectedSection.classList.add('animate-fade-in');
                
                // Load sessions when the sessions section is shown
                if (contentId === 'sessions') {
                    loadSessions();
                    initSessionSearch();
                }
            }
        });
    });
    
    // User profile button
    const userProfileButton = document.getElementById('userProfileButton');
    if (userProfileButton) {
        userProfileButton.addEventListener('click', toggleProfileDrawer);
    }
    
    // Close profile drawer button
    const closeProfileDrawerBtn = document.getElementById('closeProfileDrawer');
    if (closeProfileDrawerBtn) {
        closeProfileDrawerBtn.addEventListener('click', closeProfileDrawer);
    }
    
    // Click outside to close drawer
    document.addEventListener('click', function(event) {
        const drawer = document.getElementById('userProfileDrawer');
        const profileButton = document.getElementById('userProfileButton');
        
        if (drawer && !drawer.classList.contains('translate-x-full')) {
            // If drawer is open
            if (!drawer.contains(event.target) && event.target !== profileButton && !profileButton.contains(event.target)) {
                closeProfileDrawer();
            }
        }
    });
    
    // Direct access to sessions link (for backward compatibility)
    const sessionsLink = document.getElementById('sessions-link');
    if (sessionsLink) {
        sessionsLink.addEventListener('click', function() {
            showSection('sessions');
            loadSessions();
            initSessionSearch();
        });
    }
    
    // Delete all sessions button
    const deleteAllSessionsBtn = document.getElementById('deleteAllSessionsBtn');
    if (deleteAllSessionsBtn) {
        deleteAllSessionsBtn.addEventListener('click', function() {
            deleteAllSessions();
        });
    }
    
    // Voice settings button
    const voiceSettingsBtn = document.getElementById('voiceSettingsButton');
    if (voiceSettingsBtn) {
        voiceSettingsBtn.addEventListener('click', function() {
            console.log('Voice Settings Button Clicked');
            window.openVoiceSettingsModal();
        });
    }
    
    // API settings button
    const openConfigBtn = document.getElementById('openConfigButton');
    if (openConfigBtn) {
        openConfigBtn.addEventListener('click', function() {
            console.log('API Settings Button Clicked');
            window.openApiKeyModal();
        });
    }
    
    // Close voice settings modal
    const closeVoiceSettingsBtn = document.querySelector('#voiceSettingsModal .close-modal');
    if (closeVoiceSettingsBtn) {
        closeVoiceSettingsBtn.addEventListener('click', function() {
            window.closeVoiceSettingsModal();
        });
    }
    
    // Close API settings modal
    const closeApiKeyBtn = document.querySelector('#apiKeyModal .close-modal');
    if (closeApiKeyBtn) {
        closeApiKeyBtn.addEventListener('click', function() {
            window.closeApiKeyModal();
        });
    }
    
    // Save voice settings
    const saveVoiceSettingsBtn = document.querySelector('#voiceSettingsModal .modal-footer button');
    if (saveVoiceSettingsBtn) {
        saveVoiceSettingsBtn.addEventListener('click', function() {
            window.saveVoiceSettings();
        });
    }
    
    // Save API settings
    const saveApiConfigBtn = document.querySelector('#apiKeyModal .modal-footer button');
    if (saveApiConfigBtn) {
        saveApiConfigBtn.addEventListener('click', function() {
            window.saveApiConfig();
        });
    }
    
    // User name update button
    const updateUserNameBtn = document.getElementById('updateUserNameBtn');
    if (updateUserNameBtn) {
        updateUserNameBtn.addEventListener('click', function() {
            updateUserName();
        });
    }
    
    // Also handle Enter keypress in user name input
    const userNameInput = document.getElementById('userNameInput');
    if (userNameInput) {
        userNameInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                updateUserName();
            }
        });
    }
    
    // Case form
    const caseForm = document.getElementById('caseForm');
    if (caseForm) {
        caseForm.addEventListener('submit', function(event) {
            event.preventDefault();
            
            const caseName = document.getElementById('caseName').value.trim();
            const casePrompt = document.getElementById('casePrompt').value.trim();
            const files = [
                document.getElementById('spot1').files[0],
                document.getElementById('spot2').files[0],
                document.getElementById('spot3').files[0],
                document.getElementById('spot4').files[0]
            ];
            
            if (!caseName || !casePrompt || files.some(f => !f)) {
                alert('Please fill in all fields and upload all 4 WAV files.');
                return;
            }
            
            //  Check if the case name already exists in the current list
            const nameTaken = cases.some(c => c.name === caseName);
            if (nameTaken) {
                alert(`Case name "${caseName}" is already used. Please choose a different name.`);
                return;
            }

            const newCase = {
                name: caseName, 
                prompt: casePrompt,
                timestamp: new Date().toISOString(),
            };
            
            addCase(newCase);
            uploadWavFiles(files, caseName);
            // Reset form
            this.reset();
        });
    }


    // Sort select
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', function() {
            sortOrder = this.value;
            sortCases();
            updateCaseCards(cases);
        });
    }
    
    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const query = e.target.value.trim();
            const filteredCases = query ? filterCases(query) : cases;
            updateCaseCards(filteredCases);
        });
    }
    
    // Voice settings modal inputs
    const rateInput = document.getElementById('rateInput');
    if (rateInput) {
        rateInput.addEventListener('input', function() {
            const rateValue = parseFloat(this.value);
            document.getElementById('rateValue').textContent = rateValue.toFixed(1);
            voiceSettings.rate = rateValue;
        });
    }
    
    const pitchInput = document.getElementById('pitchInput');
    if (pitchInput) {
        pitchInput.addEventListener('input', function() {
            const pitchValue = parseFloat(this.value);
            document.getElementById('pitchValue').textContent = pitchValue.toFixed(1);
            voiceSettings.pitch = pitchValue;
        });
    }
    
    const volumeInput = document.getElementById('volumeInput');
    if (volumeInput) {
        volumeInput.addEventListener('input', function() {
            const volumeValue = parseFloat(this.value);
            document.getElementById('volumeValue').textContent = volumeValue.toFixed(1);
            voiceSettings.volume = volumeValue;
        });
    }
    
    // Temperature input for API settings
    const temperatureInput = document.getElementById('temperatureInput');
    if (temperatureInput) {
        temperatureInput.addEventListener('input', function() {
            const tempValue = parseFloat(this.value);
            document.getElementById('temperatureValue').textContent = tempValue.toFixed(1);
        });
    }
    
    // Test voice button
    const testVoiceBtn = document.getElementById('testVoiceButton');
    if (testVoiceBtn) {
        testVoiceBtn.addEventListener('click', function() {
            console.log('Test Voice Button Clicked');
            window.testVoice();
        });
    }
    
    // Voice select change
    const voiceSelect = document.getElementById('voiceSelect');
    if (voiceSelect) {
        voiceSelect.addEventListener('change', function() {
            const selectedIndex = this.selectedIndex;
            if (selectedIndex >= 0 && voices.length > 0) {
                selectedVoice = voices[selectedIndex];
            }
        });
    }
}

// Make these functions available globally with improved error handling
window.openVoiceSettingsModal = function() {
    const modal = document.getElementById('voiceSettingsModal');
    if (!modal) {
        console.error('Voice settings modal not found');
        return;
    }
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    console.log('Opened voice settings modal');
}

window.closeVoiceSettingsModal = function() {
    const modal = document.getElementById('voiceSettingsModal');
    if (!modal) {
        console.error('Voice settings modal not found');
        return;
    }
    modal.style.display = 'none';
    modal.classList.add('hidden');
    console.log('Closed voice settings modal');
}

window.saveVoiceSettings = function() {
    alert("yessssss!");

    const modal = document.getElementById('voiceSettingsModal');
    if (!modal) {
        console.error('Voice settings modal not found');
        return;
    }
    const rateInput = document.getElementById('voiceRate');
    const pitchInput = document.getElementById('voicePitch');
    const volumeInput = document.getElementById('voiceVolume');
    const voiceSelect = document.getElementById('voiceSelect');

    // Parse values
    const rate = parseFloat(rateInput.value);
    const pitch = parseFloat(pitchInput.value);
    const volume = parseFloat(volumeInput.value);
    const voiceName = voiceSelect.value;

    // Update the global settings object
    voiceSettings.rate = rate;
    voiceSettings.pitch = pitch;
    voiceSettings.volume = volume;
    voiceSettings.voice = voiceName;

    // Close modal
    window.closeVoiceSettingsModal();

    alert("Voice settings saved successfully!");
}

window.openApiKeyModal = function() {
    console.log("Opening API key modal");
    try {
        // Load existing values if available
        const apiKey = localStorage.getItem('apiKey') || CONFIG.apiKey || '';
        const model = localStorage.getItem('model') || CONFIG.model || 'gpt-3.5-turbo';
        const temperature = localStorage.getItem('temperature') || CONFIG.temperature || 0.7;
        
        // Set values in the form
        const apiKeyInput = document.getElementById('apiKeyInput');
        const modelSelect = document.getElementById('modelSelect');
        const temperatureInput = document.getElementById('temperatureInput');
        const temperatureValue = document.getElementById('temperatureValue');
        
        if (apiKeyInput) apiKeyInput.value = apiKey;
        if (modelSelect) modelSelect.value = model;
        if (temperatureInput) temperatureInput.value = temperature;
        if (temperatureValue) temperatureValue.textContent = temperature;
        
        // Show the modal
        const modal = document.getElementById('apiKeyModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.remove('hidden');
        } else {
            throw new Error("API key modal not found");
        }
    } catch (error) {
        console.error("Error opening API key modal:", error);
        alert("Could not open API settings. Please try again.");
    }
};

window.closeApiKeyModal = function() {
    console.log("Closing API key modal");
    try {
        const modal = document.getElementById('apiKeyModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.add('hidden');
        } else {
            throw new Error("API key modal not found");
        }
    } catch (error) {
        console.error("Error closing API key modal:", error);
    }
};

window.saveApiConfig = function() {
    console.log("Saving API config");
    try {
        const modelSelect = document.getElementById('modelSelect');
        const temperatureInput = document.getElementById('temperatureInput');
        
        if (!modelSelect || !temperatureInput) {
            throw new Error("API config form elements not found");
        }
        
        const model = modelSelect.value;
        const temperature = parseFloat(temperatureInput.value);
        
        // Update CONFIG object
        CONFIG.model = model;
        CONFIG.temperature = temperature;
        
        // Save to localStorage
        localStorage.setItem('openai_config', JSON.stringify({
            model,
            temperature
        }));
        
        // Close the modal
        window.closeApiKeyModal();
        
        // Check connection
        checkApiConnection();
        
        alert("API configuration saved successfully!");
    } catch (error) {
        console.error("Error saving API config:", error);
        alert("Could not save API settings. Please try again.");
    }
};

// Add testVoice to the global window object
// window.testVoice = function() {
//     console.log("Testing voice settings");
//     try {
//         // Create a sample test sentence
//         const testText = "This is a test of the selected voice and settings. How does it sound?";
        
//         // Use the speakText function to speak the test message
//         if (ttsSupported){
//             speakText(testText);
//         }    
        
//     } catch (error) {
//         console.error("Error testing voice:", error);
//         alert("Could not test voice. Speech synthesis might not be supported in your browser.");
//     }
// };

window.testVoice = function () {
    console.log("Testing voice settings");

    try {
        if (!ttsSupported) {
            alert("Text-to-speech is not supported in this browser.");
            return;
        }

        const testText = "This is a test of the selected voice and settings. How does it sound?";

        const rateInput = document.getElementById('rateInput');
        const pitchInput = document.getElementById('pitchInput');
        const volumeInput = document.getElementById('volumeInput');
        const voiceSelect = document.getElementById('voiceSelect');

        const utterance = new SpeechSynthesisUtterance(testText);

        // Use the selected voice
        const voiceName = voiceSelect.value;
        const testVoice = voices.find(v => v.name === voiceName);
        if (testVoice) {
            utterance.voice = testVoice;
        }

        // Apply temporary settings
        utterance.rate = parseFloat(rateInput.value);
        utterance.pitch = parseFloat(pitchInput.value);
        utterance.volume = parseFloat(volumeInput.value);

        // Cancel any current speech and speak
        speechSynthesis.cancel();
        speechSynthesis.speak(utterance);

    } catch (error) {
        console.error("Error testing voice:", error);
        alert("Could not test voice. Speech synthesis might not be supported in your browser.");
    }
};


// Sessions management functions
async function loadSessions() {
    console.log('Loading sessions...');
    
    // Show loading indicator
    const sessionsGrid = document.getElementById('sessionsGrid');
    if (sessionsGrid) {
        sessionsGrid.innerHTML = `
            <div class="col-span-full flex justify-center items-center py-8">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
        `;
    }
    
    try {
        // First try to fetch from the server
        const response = await fetch(`${API_URL}/get-sessions`);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch sessions: ${response.status}`);
        }
        
        const data = await response.json();
        allSessions = data;
        console.log(`Loaded ${allSessions.length} sessions from server`);
        
        // Update UI with sessions
        updateSessionsUI(allSessions);
        
        // Initialize session search after sessions are loaded
        initSessionSearch();
        
    } catch (error) {
        console.error('Error loading sessions from server:', error);
        
        // Try to load from localStorage backup
        try {
            const backupSessions = localStorage.getItem('sessions_backup');
            if (backupSessions) {
                allSessions = JSON.parse(backupSessions);
                console.log(`Loaded ${allSessions.length} sessions from localStorage backup`);
                
                updateSessionsUI(allSessions);
                
                // Initialize session search after backup sessions are loaded
                initSessionSearch();
                
                // Show info about using backup
                const notification = document.createElement('div');
                notification.className = 'fixed bottom-20 right-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded shadow-md z-50';
                notification.innerHTML = `
                    <div class="flex items-center">
                        <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                        <p>Using cached sessions. Connection to server failed.</p>
                    </div>
                `;
                document.body.appendChild(notification);
                
                // Remove notification after 5 seconds
                setTimeout(() => {
                    notification.remove();
                }, 5000);
            } else {
                throw new Error('No backup sessions available');
            }
        } catch (backupError) {
            console.error('Error loading backup sessions:', backupError);
            
            // Display an empty state with error
            if (sessionsGrid) {
                sessionsGrid.innerHTML = `
                    <div class="col-span-full text-center py-8 bg-white/60 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 class="text-lg font-medium text-gray-900 mb-1">No Sessions Found</h3>
                        <p class="text-gray-500">Start a chat with any case to create a session.</p>
                        <p class="text-red-500 text-sm mt-2">Error: ${error.message}</p>
                    </div>
                `;
            }
            
            // Initialize session search even with empty sessions
            initSessionSearch();
        }
    }
}

// Function to update the sessions UI
function updateSessionsUI(sessions) {
    console.log(`Updating Sessions UI with ${sessions ? sessions.length : 0} sessions`);
    if (sessions) {
        // Log the first few sessions to help with debugging
        sessions.slice(0, 2).forEach((session, index) => {
            console.log(`Session ${index}: ID=${session.id}, Has review=${!!session.review}, Has diagnosis=${!!session.diagnosis}`);
        });
    }

    const sessionsGrid = document.getElementById('sessionsGrid');
    if (!sessionsGrid) return;
    
    // Update the visibility of the delete all button
    const deleteAllSessionsBtn = document.getElementById('deleteAllSessionsBtn');
    if (deleteAllSessionsBtn) {
        deleteAllSessionsBtn.style.display = sessions && sessions.length > 0 ? 'flex' : 'none';
    }
    
    if (!sessions || sessions.length === 0) {
        sessionsGrid.innerHTML = '<div class="col-span-full text-center p-8"><div class="mb-4"><svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg></div><p class="text-xl font-medium text-gray-600">No sessions found</p><p class="mt-2 text-gray-500">Start a new chat to create sessions</p></div>';
        return;
    }
    
    let html = '';
    
    sessions.forEach(session => {
        const date = new Date(session.timestamp);
        const formattedDate = date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
        const formattedTime = date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        let truncatedContent = '';
        if (session.messages && session.messages.length > 0) {
            const lastUserMessage = [...session.messages].reverse().find(msg => msg.role === 'user');
            if (lastUserMessage) {
                truncatedContent = lastUserMessage.content.substring(0, 120) + (lastUserMessage.content.length > 120 ? '...' : '');
            }
        }
        
        const userName = session.userName || 'Anonymous';
        
        // Define the review button style and content based on whether a review exists
        const hasReview = session.review ? true : false;
        const reviewBtnClass = hasReview ? 
            'bg-green-600 hover:bg-green-700' : 
            'bg-indigo-600 hover:bg-indigo-700';
        const reviewBtnText = hasReview ? 'View Review' : 'AI Review';
        const reviewBtnIcon = hasReview ? 
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />' : 
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />';
        
        // Diagnosis badge HTML - only show if session has a diagnosis
        const diagnosisBadge = session.diagnosis && session.diagnosis.trim() !== '' ? 
            `<span class="ml-2 text-xs bg-teal-100 text-teal-800 rounded-full px-2 py-1 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Diagnosis
            </span>` : '';
        
        html += `
        <div class="session-card glass rounded-xl p-5 shadow-md hover:shadow-lg transition-all" data-session-id="${session.id}">
            <div class="flex justify-between items-start mb-3">
                <h3 class="text-lg font-bold text-secondary-700 truncate">${session.caseName || 'Unnamed Case'}</h3>
                <div class="flex items-center">
                    <span class="text-xs bg-secondary-100 text-secondary-800 rounded-full px-2 py-1">${session.messages.length} messages</span>
                    ${diagnosisBadge}
                </div>
            </div>
            <div class="flex items-center mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span class="text-sm text-primary-600 font-medium">${userName}</span>
            </div>
            <p class="text-sm text-gray-600 mb-3 line-clamp-2">${truncatedContent || 'No content available'}</p>
            <div class="flex justify-between items-center mt-4">
                <div class="text-xs text-gray-500">
                    <span>${formattedDate}</span>
                    <span class="mx-1">•</span>
                    <span>${formattedTime}</span>
                </div>
                <div class="flex space-x-2">
                    <button class="view-transcript-btn px-3 py-1.5 bg-secondary-600 hover:bg-secondary-700 text-white text-xs rounded-lg transition-colors flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        View
                    </button>
                    <button class="review-session-btn px-3 py-1.5 ${reviewBtnClass} text-white text-xs rounded-lg transition-colors flex items-center" 
                            data-session-id="${session.id}" 
                            ${hasReview ? 'data-has-review="true"' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            ${reviewBtnIcon}
                        </svg>
                        ${reviewBtnText}
                    </button>
                    <button class="delete-session-btn px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg transition-colors flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                    </button>
                </div>
            </div>
        </div>
        `;
    });
    
    sessionsGrid.innerHTML = html;
    
    // Add click handlers to view transcript buttons
    document.querySelectorAll('.view-transcript-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the card click event
            const sessionCard = button.closest('.session-card');
            const sessionId = sessionCard.getAttribute('data-session-id');
            const session = sessions.find(s => s.id === sessionId);
            if (session) {
                viewSessionTranscript(session);
            }
        });
    });
    
    // Add click handlers to AI review buttons
    document.querySelectorAll('.review-session-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the card click event
            const sessionCard = button.closest('.session-card');
            const sessionId = sessionCard.getAttribute('data-session-id');
            const session = sessions.find(s => s.id === sessionId);
            if (session) {
                showAIReview(session);
            }
        });
    });
    
    // Add click handlers to delete session buttons
    document.querySelectorAll('.delete-session-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the card click event
            const sessionCard = button.closest('.session-card');
            const sessionId = sessionCard.getAttribute('data-session-id');
            const session = sessions.find(s => s.id === sessionId);
            if (session && confirm(`Are you sure you want to delete this session for "${session.caseName}"?`)) {
                deleteSession(sessionId);
            }
        });
    });
    
    // Add click handlers to session cards
    document.querySelectorAll('.session-card').forEach(card => {
        card.addEventListener('click', () => {
            const sessionId = card.getAttribute('data-session-id');
            const session = sessions.find(s => s.id === sessionId);
            if (session) {
                viewSessionTranscript(session);
            }
        });
    });
}

// Function to delete a session
async function deleteSession(sessionId) {
    try {
        // Show loading state for the session card
        const sessionCard = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
        if (sessionCard) {
            sessionCard.classList.add('opacity-50');
            sessionCard.style.pointerEvents = 'none';
        }
        
        // Send request to delete session
        const response = await fetch(`${API_URL}/sessions/${sessionId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to delete session: ${response.status}`);
        }
        
        // Reload sessions after successful deletion
        await loadSessions();
        
        // Show success notification
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-20 right-4 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded shadow-md z-50';
        notification.innerHTML = `
            <div class="flex items-center">
                <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
                <p>Session deleted successfully</p>
            </div>
        `;
        document.body.appendChild(notification);
        
        // Remove notification after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
        
    } catch (error) {
        console.error('Error deleting session:', error);
        
        // Show error notification
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-20 right-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-md z-50';
        notification.innerHTML = `
            <div class="flex items-center">
                <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
                <p>Error: ${error.message}</p>
            </div>
        `;
        document.body.appendChild(notification);
        
        // Remove notification after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
        
        // Reset the session card state
        if (sessionCard) {
            sessionCard.classList.remove('opacity-50');
            sessionCard.style.pointerEvents = 'auto';
        }
    }
}

// Function to load a specific session
function loadSession(session) {
    viewSessionTranscript(session);
}

// Function to view a session transcript in read-only mode
function viewSessionTranscript(session) {
    // Get the transcript popup elements
    const transcriptPopup = document.getElementById('transcriptPopup');
    const transcriptTitle = document.getElementById('transcriptTitle');
    const transcriptMessages = document.getElementById('transcriptMessages');
    
    if (!transcriptPopup || !transcriptTitle || !transcriptMessages) {
        console.error('Transcript elements not found');
        return;
    }
    
    // Format date for display
    const sessionDate = new Date(session.timestamp);
    const formattedDate = sessionDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const userName = session.userName || 'Anonymous';
    
    // Set up the transcript popup
    transcriptPopup.style.display = 'flex';
    transcriptPopup.classList.add('active');
    transcriptTitle.textContent = `${session.caseName} - ${formattedDate}`;
    
    // Clear previous messages
    transcriptMessages.innerHTML = '';
    
    // Add timestamp header
    const timestampHeader = document.createElement('div');
    timestampHeader.className = 'text-center py-3 mb-4 bg-secondary-100 text-secondary-600 rounded-lg text-sm font-medium';
    timestampHeader.innerHTML = `
        <div class="flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Session from ${formattedDate}
        </div>
        <div class="flex items-center justify-center mt-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Created by <span class="font-semibold text-primary-600">${userName}</span>
        </div>
    `;
    transcriptMessages.appendChild(timestampHeader);
    
    // Add all messages from the session
    session.messages.forEach(message => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`;
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.textContent = message.content;
        messageDiv.appendChild(messageContent);
        
        transcriptMessages.appendChild(messageDiv);
    });
    
    // Scroll to top to show the timestamp header
    transcriptMessages.scrollTop = 0;
}

// Function to close the transcript popup
window.closeTranscript = function() {
    const transcriptPopup = document.getElementById('transcriptPopup');
    if (transcriptPopup) {
        transcriptPopup.classList.remove('active');
        setTimeout(() => {
            transcriptPopup.style.display = 'none';
        }, 300);
    }
}

// Initialize search functionality for sessions
function initSessionSearch() {
    const searchInput = document.getElementById('sessionSearch');
    const clearButton = document.getElementById('clearSearchButton');
    
    if (searchInput && clearButton) {
        // Add event listeners for search input
        searchInput.addEventListener('input', () => {
            const searchTerm = searchInput.value.toLowerCase().trim();
            if (searchTerm === '') {
                updateSessionsUI(allSessions);
            } else {
                const filteredSessions = allSessions.filter(session => {
                    // Search in case name
                    if (session.caseName && session.caseName.toLowerCase().includes(searchTerm)) {
                        return true;
                    }
                    
                    // Search in user name
                    if (session.userName && session.userName.toLowerCase().includes(searchTerm)) {
                        return true;
                    }
                    
                    // Search in message content
                    if (session.messages && session.messages.some(msg => 
                        msg.content.toLowerCase().includes(searchTerm))) {
                        return true;
                    }
                    
                    // Search in date
                    const date = new Date(session.timestamp);
                    const formattedDate = date.toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric' 
                    });
                    if (formattedDate.toLowerCase().includes(searchTerm)) {
                        return true;
                    }
                    
                    return false;
                });
                
                updateSessionsUI(filteredSessions);
            }
        });
        
        // Add clear button functionality
        clearButton.addEventListener('click', () => {
            searchInput.value = '';
            updateSessionsUI(allSessions);
        });
    }
}

// Helper function to show a specific section by ID
function showSection(sectionId) {
    const section = document.getElementById(sectionId);
    const menuItem = document.querySelector(`.menu-item[data-content="${sectionId}"]`);
    
    if (!section || !menuItem) {
        console.error(`Section or menu item for ID ${sectionId} not found`);
        return;
    }
    
    // Remove active class from all menu items
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add active class to the target menu item
    menuItem.classList.add('active');
    
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(s => {
        s.style.display = 'none';
        s.classList.add('hidden');
        s.classList.remove('animate-fade-in');
    });
    
    // Show the target section
    section.style.display = 'block';
    section.classList.remove('hidden');
    section.classList.add('animate-fade-in');
    
    console.log(`Switched to section: ${sectionId}`);
}

// Function to delete all sessions
async function deleteAllSessions() {
    try {
        // Check if there are any sessions to delete
        if (allSessions.length === 0) {
            // Show info notification
            const notification = document.createElement('div');
            notification.className = 'fixed bottom-20 right-4 bg-blue-100 border-l-4 border-blue-500 text-blue-700 p-4 rounded shadow-md z-50';
            notification.innerHTML = `
                <div class="flex items-center">
                    <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <p>No sessions to delete</p>
                </div>
            `;
            document.body.appendChild(notification);
            
            // Remove notification after 3 seconds
            setTimeout(() => {
                notification.remove();
            }, 3000);
            return;
        }
        
        // Confirm deletion with the user
        if (!confirm('Are you sure you want to delete ALL session transcripts? This action cannot be undone.')) {
            return;
        }
        
        // Show loading state
        const deleteBtn = document.getElementById('deleteAllSessionsBtn');
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = `
                <svg class="animate-spin h-4 w-4 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Deleting...
            `;
        }
        
        // Send request to delete all sessions
        const response = await fetch(`${API_URL}/sessions`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to delete all sessions: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Reload sessions after successful deletion
        await loadSessions();
        
        // Show success notification
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-20 right-4 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded shadow-md z-50';
        notification.innerHTML = `
            <div class="flex items-center">
                <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
                <p>${data.message}</p>
            </div>
        `;
        document.body.appendChild(notification);
        
        // Remove notification after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
        
    } catch (error) {
        console.error('Error deleting all sessions:', error);
        
        // Show error notification
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-20 right-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-md z-50';
        notification.innerHTML = `
            <div class="flex items-center">
                <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
                <p>Error: ${error.message}</p>
            </div>
        `;
        document.body.appendChild(notification);
        
        // Remove notification after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    } finally {
        // Reset the delete button
        const deleteBtn = document.getElementById('deleteAllSessionsBtn');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete All Sessions
            `;
        }
    }
}

// Function to update the user name display in the profile section
function updateProfileUserNameDisplay() {
    const currentUserNameDisplay = document.getElementById('currentUserNameDisplay');
    const userNameInput = document.getElementById('userNameInput');
    const userNameDisplay = document.getElementById('userNameDisplay');
    
    if (currentUserNameDisplay) {
        currentUserNameDisplay.textContent = currentUserName || 'Anonymous';
    }
    
    if (userNameDisplay) {
        userNameDisplay.textContent = currentUserName || 'Anonymous';
        userNameDisplay.style.display = 'block'; // Make sure it's visible
    }
    
    if (userNameInput) {
        userNameInput.value = currentUserName || '';
        userNameInput.placeholder = 'Enter your name';
    }
}

// Function to update the user name
function updateUserName() {
    const userNameInput = document.getElementById('userNameInput');
    
    if (userNameInput) {
        const newUserName = userNameInput.value.trim();
        
        if (newUserName) {
            currentUserName = newUserName;
            localStorage.setItem('userName', newUserName);
            updateProfileUserNameDisplay();
            
            // Show success notification
            const notification = document.createElement('div');
            notification.className = 'fixed bottom-20 right-4 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded shadow-md z-50';
            notification.innerHTML = `
                <div class="flex items-center">
                    <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                    <p>Your name has been updated to "${newUserName}"</p>
                </div>
            `;
            document.body.appendChild(notification);
            
            // Remove notification after 3 seconds
            setTimeout(() => {
                notification.remove();
            }, 3000);
            
            // Close the drawer after updating the name
            closeProfileDrawer();
        } else {
            // Show error for empty name
            const notification = document.createElement('div');
            notification.className = 'fixed bottom-20 right-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-md z-50';
            notification.innerHTML = `
                <div class="flex items-center">
                    <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                    <p>Please enter a valid name</p>
                </div>
            `;
            document.body.appendChild(notification);
            
            // Remove notification after 3 seconds
            setTimeout(() => {
                notification.remove();
            }, 3000);
        }
    }
}

// Function to toggle the user profile drawer
function toggleProfileDrawer() {
    const drawer = document.getElementById('userProfileDrawer');
    if (drawer) {
        // Check if the drawer is currently visible
        const isVisible = !drawer.classList.contains('translate-x-full');
        
        if (isVisible) {
            // Hide the drawer
            drawer.classList.add('translate-x-full');
        } else {
            // Show the drawer and update the user name display
            drawer.classList.remove('translate-x-full');
            updateProfileUserNameDisplay();
        }
    }
}

// Function to close the user profile drawer
function closeProfileDrawer() {
    const drawer = document.getElementById('userProfileDrawer');
    if (drawer) {
        drawer.classList.add('translate-x-full');
    }
}

// Function to generate AI review for a session
async function generateAIReview(session) {
    try {
        console.log('Generating AI review for session:', session.id);
        
        const reviewBtn = document.querySelector(`.review-session-btn[data-session-id="${session.id}"]`);
        if (reviewBtn) {
            reviewBtn.innerHTML = `
                <svg class="animate-spin h-3 w-3 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Reviewing...
            `;
            reviewBtn.disabled = true;
        }
        
        // Check if the session already has a review
        if (session.review) {
            console.log('Session already has a review, returning existing review');
            
            // Update UI to show review button in normal state
            if (reviewBtn) {
                reviewBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    View Review
                `;
                reviewBtn.disabled = false;
                reviewBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
                reviewBtn.classList.add('bg-green-600', 'hover:bg-green-700');
                reviewBtn.setAttribute('data-has-review', 'true');
            }
            
            return session.review;
        }
        
        // Try to load review.txt
        let reviewGuidelines = '';
        try {
            const reviewResponse = await fetch('review.txt');
            if (reviewResponse.ok) {
                reviewGuidelines = await reviewResponse.text();
                console.log('Loaded review guidelines:', reviewGuidelines.substring(0, 50) + '...');
            } else {
                console.warn('Could not load review.txt (status:', reviewResponse.status, ')');
                reviewGuidelines = 'Please review this conversation and provide constructive feedback.';
            }
        } catch (error) {
            console.warn('Could not load review.txt:', error);
            reviewGuidelines = 'Please review this conversation and provide constructive feedback.';
        }
        
        // Create a formatted transcript of the conversation
        const transcriptText = session.messages.map(message => 
            `${message.role.toUpperCase()}: ${message.content}`
        ).join('\n\n');
        
        // Get the case prompt if available
        const casePrompt = session.casePrompt || 'No case prompt available';
        
        // Get the student's differential diagnosis if available
        const diagnosis = session.diagnosis ? session.diagnosis.trim() : '';
        const diagnosisSection = diagnosis ? 
            `### Student's Differential Diagnosis ###\n\n${diagnosis}\n\n` : 
            'Student did not provide a differential diagnosis.\n\n';
        
        // Prepare the prompt for ChatGPT
        const prompt = `${reviewGuidelines}\n\n### Case Prompt ###\n\n${casePrompt}\n\n${diagnosisSection}### Conversation Transcript ###\n\n${transcriptText}`;
        
        console.log('Sending request to ChatGPT API with model:', CONFIG.model || 'gpt-3.5-turbo');
        
        // Send to ChatGPT using server-side proxy
        const response = await fetch(`${API_URL}/api/openai`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: CONFIG.model || 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: 'You are an AI assistant providing reviews of conversations.' },
                    { role: 'user', content: prompt }
                ],
                temperature: CONFIG.temperature || 0.7
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('ChatGPT API error:', errorData);
            throw new Error(`ChatGPT API error: ${errorData.error?.message || response.statusText}`);
        }
        
        const data = await response.json();
        const reviewText = data.choices[0].message.content;
        console.log('Received review from ChatGPT:', reviewText.substring(0, 50) + '...');
        
        // Save the review to the session
        session.review = reviewText;
        
        // Save sessions to storage (server)
        try {
            console.log('Saving session with review to server');
            const saveResponse = await fetch(`${API_URL}/save-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ...session,
                    lastUpdated: new Date().toISOString()
                })
            });
            
            if (!saveResponse.ok) {
                const errorData = await saveResponse.json();
                console.error('Error saving session with review:', errorData);
                throw new Error(`Failed to save session: ${errorData.error || saveResponse.statusText}`);
            }
            
            const saveResult = await saveResponse.json();
            console.log('Session saved successfully:', saveResult);
            
            // Also update local backup
            const backupSessions = JSON.parse(localStorage.getItem('sessions_backup') || '[]');
            const backupIndex = backupSessions.findIndex(s => s.id === session.id);
            if (backupIndex >= 0) {
                backupSessions[backupIndex] = session;
            }
            localStorage.setItem('sessions_backup', JSON.stringify(backupSessions));
            
            // Also update the allSessions array
            const sessionIndex = allSessions.findIndex(s => s.id === session.id);
            if (sessionIndex >= 0) {
                allSessions[sessionIndex] = session;
            }
            
            // Show success notification
            const notification = document.createElement('div');
            notification.className = 'fixed bottom-20 right-4 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded shadow-md z-50';
            notification.innerHTML = `
                <div class="flex items-center">
                    <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                    <p>AI review generated successfully!</p>
                </div>
            `;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
            
            // Update UI to show review button in normal state
            if (reviewBtn) {
                reviewBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    View Review
                `;
                reviewBtn.disabled = false;
                reviewBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
                reviewBtn.classList.add('bg-green-600', 'hover:bg-green-700');
                reviewBtn.setAttribute('data-has-review', 'true');
            }
            
            // Update the session cards to reflect the change
            updateSessionsUI(allSessions);
            
            return reviewText;
        } catch (error) {
            console.error('Error saving review:', error);
            throw error;
        }
    } catch (error) {
        console.error('Error generating AI review:', error);
        
        // Update UI to show error state
        const reviewBtn = document.querySelector(`.review-session-btn[data-session-id="${session.id}"]`);
        if (reviewBtn) {
            reviewBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Retry
            `;
            reviewBtn.disabled = false;
            reviewBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            reviewBtn.classList.add('bg-red-600', 'hover:bg-red-700');
        }
        
        // Show error notification
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-20 right-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-md z-50';
        notification.innerHTML = `
            <div class="flex items-center">
                <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
                <p>Error generating review: ${error.message}</p>
            </div>
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
        
        throw error;
    }
}

// Function to handle showing AI review - either displaying existing or generating new
function showAIReview(session) {
    console.log('showAIReview called for session:', session.id, 'hasReview:', !!session.review);
    
    if (session.review) {
        // If review exists, display it
        displayReviewModal(session);
        return;
    }
    
    // If no review exists, generate one
    const reviewBtn = document.querySelector(`.review-session-btn[data-session-id="${session.id}"]`);
    if (reviewBtn) {
        // Update button to show loading state
        const originalContent = reviewBtn.innerHTML;
        reviewBtn.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating...`;
        reviewBtn.disabled = true;
        
        // Generate the review
        generateAIReview(session)
            .then(updatedSession => {
                console.log('Review generated successfully', updatedSession);
                // Reset button
                reviewBtn.innerHTML = originalContent;
                reviewBtn.disabled = false;
                reviewBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
                reviewBtn.classList.add('bg-green-600', 'hover:bg-green-700');
                reviewBtn.querySelector('svg').innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />';
                reviewBtn.querySelector('span').textContent = 'View Review';
                reviewBtn.setAttribute('data-has-review', 'true');
                
                // Display the generated review
                displayReviewModal(updatedSession);
            })
            .catch(error => {
                console.error('Error generating review:', error);
                // Reset button
                reviewBtn.innerHTML = originalContent;
                reviewBtn.disabled = false;
                
                // Show error notification
                showNotification('Failed to generate AI review. Please try again.', 'error');
            });
    } else {
        showNotification('Could not find review button for this session.', 'warning');
    }
}

// Function to display the review in a modal
function displayReviewModal(session) {
    // Close any existing review modal first
    const existingModal = document.getElementById('reviewModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const reviewContent = session.review || 'No review available';
    const modalHTML = `
    <div id="reviewModal" class="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                    <div class="sm:flex sm:items-start">
                        <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                            <h3 class="text-lg leading-6 font-medium text-gray-900 mb-4" id="modal-title">
                                Case Review: ${session.caseName || 'Untitled Case'}
                            </h3>
                            <div class="flex flex-col space-y-4">
                                ${session.diagnosis ? `
                                <div class="border-t border-b border-gray-200 py-4">
                                    <h4 class="text-md font-medium text-gray-700 mb-2">Student's Differential Diagnosis:</h4>
                                    <div class="prose max-w-none text-gray-800 whitespace-pre-wrap">${session.diagnosis}</div>
                                </div>
                                ` : ''}
                                <div>
                                    <h4 class="text-md font-medium text-gray-700 mb-2">AI Review:</h4>
                                    <div id="formattedReview" class="prose max-w-none text-gray-700"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                    <button type="button" id="closeReviewBtn" class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:ml-3 sm:w-auto sm:text-sm">
                        Close
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;
    
    // Add the modal to the DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Format the review using markdown
    const reviewElement = document.getElementById('formattedReview');
    if (reviewElement) {
        // Basic markdown formatting for the review
        const formattedReview = reviewContent
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
            .replace(/# (.*?)(\n|$)/g, '<h2 class="text-xl font-bold mt-4 mb-2">$1</h2>') // H1
            .replace(/## (.*?)(\n|$)/g, '<h3 class="text-lg font-semibold mt-3 mb-1">$1</h3>') // H2
            .replace(/### (.*?)(\n|$)/g, '<h4 class="text-md font-medium mt-2 mb-1">$1</h4>') // H3
            .replace(/\n\n/g, '<br><br>') // Double line breaks
            .replace(/\n/g, '<br>'); // Single line breaks
        
        reviewElement.innerHTML = formattedReview;
    }
    
    // Add event listeners
    const closeBtn = document.getElementById('closeReviewBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const modal = document.getElementById('reviewModal');
            if (modal) modal.remove();
        });
    }
    
    // Close modal when clicking outside
    const modal = document.getElementById('reviewModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        // Close modal on Escape key
        document.addEventListener('keydown', function closeOnEscape(e) {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', closeOnEscape);
            }
        });
    }
}

// Add CSS for review modal
const reviewModalStyle = document.createElement('style');
reviewModalStyle.textContent = `
.modal {
    display: flex;
    visibility: visible;
    opacity: 1;
    transition: opacity 0.3s ease, visibility 0.3s ease;
}
.modal.hidden {
    display: none;
    visibility: hidden;
    opacity: 0;
}
.modal-content {
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-radius: 1rem;
    max-width: 800px;
    width: 90%;
    margin: auto;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
}
.prose {
    line-height: 1.7;
    color: #374151;
}
.prose h2 {
    font-weight: 600;
    font-size: 1.25rem;
    margin-top: 1.5rem;
    margin-bottom: 1rem;
    color: #1f2937;
}
.prose h3 {
    font-weight: 600;
    font-size: 1.1rem;
    margin-top: 1.25rem;
    margin-bottom: 0.75rem;
    color: #1f2937;
}
.prose p {
    margin-bottom: 1rem;
}
.prose ul {
    list-style-type: disc;
    padding-left: 1.5rem;
    margin-bottom: 1rem;
}
.prose li {
    margin-bottom: 0.25rem;
}
`;
document.head.appendChild(reviewModalStyle);



/* Login / sign up methodology */
const loginForm = document.getElementById("loginForm");
const loginPage = document.getElementById("loginPage");
const mainContent = document.getElementById("mainContent");
const pageTitle = document.getElementById("pageTitle");
const submitButton = document.getElementById("submitButton");
const toggleLink = document.getElementById("toggleLink");

// Handle login request to the server
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password })
    });

    if (response.ok) {
        const data = await response.json();

        localStorage.setItem('userName', username);

        // Hide login, show app
        loginPage.classList.add("hidden");
        mainContent.classList.remove("hidden");
        document.getElementById("userNameDisplay").textContent = data.user.username;
    } else {
        alert("Invalid username or password");
    }
}

// Handle sign-up request to the server
async function handleSignUp(e) {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password })
    });

    if (response.ok) {
        alert("Account created successfully! Please log in.");
        toggleToLoginPage(); // Switch to login page after sign-up
    } else {
        const data = await response.json();
        alert(data.message); // Show error message
    }
}

function toggleToSignUpPage() {
    pageTitle.textContent = "Sign Up";
    submitButton.textContent = "Sign Up";
    submitButton.removeEventListener("click", handleLogin);
    submitButton.addEventListener("click", handleSignUp);
    toggleLink.textContent = "Already have an account? Log In";
}

function toggleToLoginPage() {
    pageTitle.textContent = "Login";
    submitButton.textContent = "Log In";
    submitButton.removeEventListener("click", handleSignUp);
    submitButton.addEventListener("click", handleLogin);
    toggleLink.textContent = "Don't have an account? Sign Up";
}

// Switch between login and sign-up
toggleLink.addEventListener("click", function () {
    if (pageTitle.textContent === "Login") {
        toggleToSignUpPage();
    } else {
        toggleToLoginPage();
    }
});

loginForm.addEventListener("submit", handleLogin); // Default login on first load



