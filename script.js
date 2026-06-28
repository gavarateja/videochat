import { matchmake, leaveQueue, reportUserDB } from './firebase.js';

const peer = new Peer();
let currentUser = null;
let currentPartnerData = null;
let localStream = null;
let currentCall = null;
let dataConnection = null;

let isMuted = false;
let isVideoOff = false;
let isChatOpen = false;
let typingTimeout = null;

const UI = {
    views: document.querySelectorAll('.view'),
    loader: document.getElementById('global-loader'),
    loaderText: document.getElementById('loader-text'),
    toastContainer: document.getElementById('toast-container'),
    
    videoGrid: document.getElementById('video-grid'),
    localBox: document.getElementById('local-box'),
    localVideo: document.getElementById('local-video'),
    remoteVideo: document.getElementById('remote-video'),
    remoteStatus: document.getElementById('remote-status'),
    
    localCamOff: document.getElementById('local-cam-off'),
    localMicOff: document.getElementById('local-mic-off'),
    remoteCamOff: document.getElementById('remote-cam-off'),
    remoteMicOff: document.getElementById('remote-mic-off'),
    remoteUserInfo: document.getElementById('remote-user-info'),
    
    btnMute: document.getElementById('btn-mute'),
    btnCamera: document.getElementById('btn-camera'),
    btnNext: document.getElementById('btn-next'),
    btnLeave: document.getElementById('btn-leave'),
    
    // Chat UI Elements
    btnToggleChat: document.getElementById('btn-toggle-chat'),
    btnCloseChat: document.getElementById('btn-close-chat'),
    chatPanel: document.getElementById('chat-panel'),
    chatBadge: document.getElementById('chat-badge'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    btnSendMsg: document.getElementById('btn-send-msg'),
    typingIndicator: document.getElementById('typing-indicator')
};

// --- Initialization & Helpers ---
peer.on('open', (id) => console.log("PeerJS Connected:", id));

function showView(viewId) {
    UI.views.forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); });
    document.getElementById(viewId).classList.remove('hidden');
    document.getElementById(viewId).classList.add('active');
}

function getGenderIcon(gender) {
    if (gender === 'male') return '<i class="fas fa-mars" style="color: #60a5fa;"></i>';
    if (gender === 'female') return '<i class="fas fa-venus" style="color: #f472b6;"></i>';
    return '<i class="fas fa-genderless" style="color: #a78bfa;"></i>';
}

function getRegionIcon(region) {
    switch (region) {
        case 'North America': return '<i class="fas fa-globe-americas" style="color: #4ade80;"></i>';
        case 'South America': return '<i class="fas fa-globe-americas" style="color: #4ade80;"></i>';
        case 'Europe': return '<i class="fas fa-globe-europe" style="color: #60a5fa;"></i>';
        case 'Asia': return '<i class="fas fa-globe-asia" style="color: #f87171;"></i>';
        case 'Africa': return '<i class="fas fa-globe-africa" style="color: #fbbf24;"></i>';
        case 'Oceania': return '<i class="fas fa-globe-oceania" style="color: #38bdf8;"></i>';
        default: return '<i class="fas fa-globe" style="color: #94a3b8;"></i>';
    }
}

function showLoader(text) { UI.loaderText.innerText = text; UI.loader.classList.remove('hidden'); }
function hideLoader() { UI.loader.classList.add('hidden'); }

// --- Entry Form ---
document.getElementById('btn-start-app').addEventListener('click', () => showView('view-auth-choice'));
document.getElementById('btn-show-guest').addEventListener('click', () => showView('view-guest'));

document.getElementById('btn-start-guest').addEventListener('click', async () => {
    const name = document.getElementById('guest-name').value.trim();
    const dob = document.getElementById('guest-dob').value;
    const country = document.getElementById('guest-country').value.trim();
    const gender = document.getElementById('guest-gender').value;
    const errorEl = document.getElementById('guest-error');

    if (!name || !dob || country === '' || gender === 'any') return errorEl.innerText = "Please fill all fields.";
    errorEl.innerText = "";
    showLoader("Accessing Camera & Microphone...");

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        UI.localVideo.srcObject = localStream;
        
        currentUser = {
            id: `guest_${Math.floor(Math.random()*100000)}`,
            name, dob, country, gender,
            mode: 'guest',
            peerId: peer.id
        };

        hideLoader();
        showView('view-chat');
        startMatchmaking();
    } catch (err) {
        hideLoader();
        errorEl.innerText = "Camera/Microphone access denied.";
    }
});

// --- Matchmaking & WebRTC ---
async function startMatchmaking() {
    resetRemoteUI();
    UI.remoteStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching for stranger...';
    UI.remoteStatus.classList.remove('hidden');
    
    cleanupConnections();
    
    try {
        const result = await matchmake(currentUser);
        if (result.matched) {
            UI.remoteStatus.innerText = "Connecting...";
            currentPartnerData = result.partnerData;
            
            const call = peer.call(result.partnerData.peerId, localStream);
            const conn = peer.connect(result.partnerData.peerId);
            setupCallEvents(call);
            setupDataEvents(conn);
        } else {
            UI.remoteStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Waiting in queue...';
        }
    } catch (e) {
        UI.remoteStatus.innerText = "Error. Try skipping.";
    }
}

peer.on('call', async (call) => {
    await leaveQueue(currentUser);
    call.answer(localStream);
    setupCallEvents(call);
});

peer.on('connection', (conn) => { setupDataEvents(conn); });

function setupCallEvents(call) {
    currentCall = call;
    call.on('stream', (remoteStream) => {
        UI.remoteVideo.srcObject = remoteStream;
        UI.remoteStatus.classList.add('hidden');
        
        // Display as Stranger with Icon and Country
        if (currentPartnerData) {
            const genderIcon = getGenderIcon(currentPartnerData.gender);
            const regionIcon = getRegionIcon(currentPartnerData.country);
            // Now we inject both icons into the badge!
            UI.remoteUserInfo.innerHTML = `Stranger ${genderIcon} | ${regionIcon} ${currentPartnerData.country}`;
            UI.remoteUserInfo.classList.remove('hidden');
        }
    });
    call.on('close', () => resetRemoteUI());
}

function setupDataEvents(conn) {
    dataConnection = conn;
    
    conn.on('open', () => {
        conn.send({ type: 'handshake', userData: currentUser, video: !isVideoOff, audio: !isMuted });
        enableChatUI(true);
    });

    conn.on('data', (data) => {
        if (data.type === 'handshake') {
            currentPartnerData = data.userData;
            const icon = getGenderIcon(currentPartnerData.gender);
            UI.remoteUserInfo.innerHTML = `Stranger ${icon} | ${currentPartnerData.country}`;
            UI.remoteUserInfo.classList.remove('hidden');
            updateRemoteMediaState(data.video, data.audio);
        }
        else if (data.type === 'media_state') {
            updateRemoteMediaState(data.video, data.audio);
        } 
        else if (data.type === 'chat') {
            appendMessage(data.text, 'remote');
            if (!isChatOpen) {
                UI.chatBadge.classList.remove('hidden');
                UI.btnToggleChat.classList.add('has-unread');
            }
        }
        else if (data.type === 'typing') {
            UI.typingIndicator.classList.remove('hidden');
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => UI.typingIndicator.classList.add('hidden'), 2000);
        }
        else if (data.type === 'disconnect') {
            resetRemoteUI();
        }
    });
}

// --- Hardware Controls (TRUE Hardware Shutoff) ---
UI.btnCamera.addEventListener('click', async () => {
    try {
        if (!isVideoOff) {
            // Turn OFF: completely stop the track to kill hardware light
            localStream.getVideoTracks().forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
            isVideoOff = true;
        } else {
            // Turn ON: request a new camera track
            const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newTrack = newStream.getVideoTracks()[0];
            localStream.addTrack(newTrack);
            
            // Replace the track in the active WebRTC connection
            if (currentCall && currentCall.peerConnection) {
                const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(newTrack);
            }
            
            // Re-assign stream to video element
            UI.localVideo.srcObject = null;
            UI.localVideo.srcObject = localStream;
            isVideoOff = false;
        }

        UI.btnCamera.classList.toggle('muted', isVideoOff);
        UI.btnCamera.innerHTML = isVideoOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
        isVideoOff ? UI.localCamOff.classList.remove('hidden') : UI.localCamOff.classList.add('hidden');
        
        syncMediaState();
    } catch (err) {
        console.error("Failed to toggle camera:", err);
    }
});

UI.btnMute.addEventListener('click', () => {
    isMuted = !isMuted;
    const audioTrack = localStream.getAudioTracks()[0];
    if(audioTrack) audioTrack.enabled = !isMuted;
    
    UI.btnMute.classList.toggle('muted', isMuted);
    UI.btnMute.innerHTML = isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
    isMuted ? UI.localMicOff.classList.remove('hidden') : UI.localMicOff.classList.add('hidden');
    syncMediaState();
});

function syncMediaState() {
    if (dataConnection && dataConnection.open) {
        dataConnection.send({ type: 'media_state', video: !isVideoOff, audio: !isMuted });
    }
}

function updateRemoteMediaState(videoOn, audioOn) {
    videoOn ? UI.remoteCamOff.classList.add('hidden') : UI.remoteCamOff.classList.remove('hidden');
    audioOn ? UI.remoteMicOff.classList.add('hidden') : UI.remoteMicOff.classList.remove('hidden');
}

// --- Text Chat Logic ---
function toggleChat() {
    isChatOpen = !isChatOpen;
    if (isChatOpen) {
        // Hide only the local video, show chat in its place
        UI.localBox.classList.add('hidden');
        UI.chatPanel.classList.remove('hidden');
        
        UI.chatBadge.classList.add('hidden');
        UI.btnToggleChat.classList.remove('has-unread');
        setTimeout(() => UI.chatInput.focus(), 100);
    } else {
        // Hide chat, bring the local video back
        UI.localBox.classList.remove('hidden');
        UI.chatPanel.classList.add('hidden');
    }
}

UI.btnToggleChat.addEventListener('click', toggleChat);
UI.btnCloseChat.addEventListener('click', toggleChat);

UI.chatInput.addEventListener('input', () => {
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'typing' });
});

UI.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
UI.btnSendMsg.addEventListener('click', sendMessage);

function sendMessage() {
    const text = UI.chatInput.value.trim();
    if (!text || !dataConnection || !dataConnection.open) return;
    
    dataConnection.send({ type: 'chat', text });
    appendMessage(text, 'local');
    UI.chatInput.value = '';
}

function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `msg-bubble msg-${sender}`;
    div.innerText = text;
    UI.chatMessages.appendChild(div);
    UI.chatMessages.scrollTop = UI.chatMessages.scrollHeight;
}

function enableChatUI(enable) {
    UI.chatInput.disabled = !enable;
    UI.btnSendMsg.disabled = !enable;
}

// --- Navigation & Cleanup ---
UI.btnNext.addEventListener('click', () => {
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'disconnect' });
    startMatchmaking();
});

UI.btnLeave.addEventListener('click', async () => {
    showLoader("Disconnecting...");
    await leaveQueue(currentUser);
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'disconnect' });
    cleanupConnections();
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    setTimeout(() => { hideLoader(); showView('view-home'); }, 500);
});

function resetRemoteUI() {
    UI.remoteVideo.srcObject = null;
    UI.remoteUserInfo.classList.add('hidden');
    UI.remoteCamOff.classList.add('hidden');
    UI.remoteMicOff.classList.add('hidden');
    UI.remoteStatus.innerText = "Stranger disconnected.";
    UI.remoteStatus.classList.remove('hidden');
    UI.chatMessages.innerHTML = ''; // Clear chat
    enableChatUI(false);
    if (isChatOpen) toggleChat(); // Auto-close chat on disconnect
    currentPartnerData = null;
}

function cleanupConnections() {
    if (currentCall) { currentCall.close(); currentCall = null; }
    if (dataConnection) { dataConnection.close(); dataConnection = null; }
}

window.addEventListener('beforeunload', () => { if (currentUser) leaveQueue(currentUser); });