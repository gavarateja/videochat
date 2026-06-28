// Global Variables
let localStream;
let currentPeerCall;
let currentDataConnection;
const peer = new Peer(); // Initializes a new PeerJS instance connected to their public cloud

// DOM Elements
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const remoteStatus = document.getElementById('remote-status');
const myIdDisplay = document.getElementById('my-id');
const peerIdInput = document.getElementById('peer-id-input');
const connectBtn = document.getElementById('connect-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const muteBtn = document.getElementById('mute-btn');
const cameraBtn = document.getElementById('camera-btn');
const nextBtn = document.getElementById('next-btn');

// 1. Initialize Peer and Media
peer.on('open', (id) => {
    myIdDisplay.innerText = id;
});

// Get user webcam and mic
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        localStream = stream;
        localVideo.srcObject = stream;
    })
    .catch(err => {
        console.error("Failed to get local stream", err);
        addChatMessage('System', 'Camera/Microphone access denied.', 'system');
    });

// 2. Handle Incoming Connections
peer.on('call', (call) => {
    // Answer the call, providing our mediaStream
    call.answer(localStream); 
    setupCallEvents(call);
});

peer.on('connection', (conn) => {
    setupDataConnection(conn);
});

// 3. Initiate Outgoing Connections (Manual ID for now)
connectBtn.addEventListener('click', () => {
    const remoteId = peerIdInput.value.trim();
    if (!remoteId) return;

    // Start Video Call
    const call = peer.call(remoteId, localStream);
    setupCallEvents(call);

    // Start Data (Chat) Connection
    const conn = peer.connect(remoteId);
    setupDataConnection(conn);
});

// 4. Call and Data Helpers
function setupCallEvents(call) {
    if (currentPeerCall) currentPeerCall.close();
    currentPeerCall = call;

    call.on('stream', (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
        remoteStatus.style.display = 'none';
    });

    call.on('close', () => {
        remoteVideo.srcObject = null;
        remoteStatus.style.display = 'block';
        remoteStatus.innerText = 'Peer disconnected.';
    });
}

function setupDataConnection(conn) {
    if (currentDataConnection) currentDataConnection.close();
    currentDataConnection = conn;

    conn.on('open', () => {
        chatInput.disabled = false;
        sendBtn.disabled = false;
        addChatMessage('System', 'Connected to a stranger!', 'system');
    });

    conn.on('data', (data) => {
        addChatMessage('Stranger', data, 'them');
    });

    conn.on('close', () => {
        chatInput.disabled = true;
        sendBtn.disabled = true;
        addChatMessage('System', 'Stranger left the chat.', 'system');
    });
}

// 5. Chat UI Logic
function sendMessage() {
    const text = chatInput.value.trim();
    if (text && currentDataConnection && currentDataConnection.open) {
        currentDataConnection.send(text);
        addChatMessage('You', text, 'me');
        chatInput.value = '';
    }
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function addChatMessage(sender, text, type) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', type);
    msgDiv.innerText = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll
}

// 6. Hardware Controls
let isAudioMuted = false;
let isVideoStopped = false;

muteBtn.addEventListener('click', () => {
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks()[0].enabled = !isAudioMuted;
    muteBtn.innerHTML = isAudioMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
    muteBtn.classList.toggle('danger');
});

cameraBtn.addEventListener('click', () => {
    isVideoStopped = !isVideoStopped;
    localStream.getVideoTracks()[0].enabled = !isVideoStopped;
    cameraBtn.innerHTML = isVideoStopped ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
    cameraBtn.classList.toggle('danger');
});

// 7. "Next" Logic (Requires backend for actual random pairing)
nextBtn.addEventListener('click', () => {
    if (currentPeerCall) currentPeerCall.close();
    if (currentDataConnection) currentDataConnection.close();
    remoteStatus.style.display = 'block';
    remoteStatus.innerText = 'Looking for someone...';
    
    // NOTE: In a real app, you would emit a socket.io event here to your server 
    // saying "I need a new partner", and the server would send back a new Peer ID.
    addChatMessage('System', 'Disconnected. (Backend required to find next random peer)', 'system');
});