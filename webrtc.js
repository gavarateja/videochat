import { matchmake, leaveQueue, submitReportDB, getFormattedTimestamp, checkBanStatus } from './firebase.js'; 
import { showLoader, hideLoader, showView, showToast } from './app.js';

const peer = new Peer();
let currentUser = null;
let currentPartnerData = null;
let localStream = null;
let currentCall = null;
let dataConnection = null;

let isMuted = false;
let isVideoOff = false;
let isChatOpen = false;
let isManuallyLeaving = false; 
let isWarned = false; 
let typingTimeout = null;
let lastTypingToast = 0;

let reportablePartnerData = null; 
let sessionChatHistory = [];
let handshakeInterval = null;
let partnerDataLoaded = false;

const UI = {
    chatInput: document.getElementById('chat-input'),
    btnSendMsg: document.getElementById('btn-send-msg'),
    chatMessages: document.getElementById('chat-messages'),
    typingIndicator: document.getElementById('typing-indicator'),
    btnToggleChat: document.getElementById('btn-toggle-chat'),
    btnCloseChat: document.getElementById('btn-close-chat'),
    chatPanel: document.getElementById('chat-panel'),
    localBox: document.getElementById('local-box'),
    btnReport: document.getElementById('btn-report'),
    chatBadge: document.getElementById('chat-badge'),
    localVideo: document.getElementById('local-video'),
    btnCamera: document.getElementById('btn-camera'),
    btnMute: document.getElementById('btn-mute'),
    localCamOff: document.getElementById('local-cam-off'),
    localMicOff: document.getElementById('local-mic-off')
};

function renderStrangerBadge(partner) {
    if (!partner || !partner.name) return;
    const gIcon = partner.gender === 'male' ? '♂️' : partner.gender === 'female' ? '♀️' : '⚧️';
    const userInfoEl = document.getElementById('remote-user-info');
    userInfoEl.innerHTML = `${partner.name} | ${gIcon} | ${partner.country}`;
    userInfoEl.classList.remove('hidden');
}

export async function startChatProtocol(userObj) {
    currentUser = userObj;
    currentUser.peerId = peer.id;
    isManuallyLeaving = false;
    isWarned = false;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        UI.localVideo.srcObject = localStream;
        
        const localBadge = document.getElementById('local-user-info');
        const gIcon = currentUser.gender === 'male' ? '♂️' : currentUser.gender === 'female' ? '♀️' : '⚧️';
        localBadge.innerHTML = `${currentUser.name} | ${gIcon} | ${currentUser.country}`;
        localBadge.classList.remove('hidden');

        hideLoader();
        showView('view-chat');
        startMatchmaking();
    } catch (err) {
        hideLoader();
        document.getElementById('guest-error').innerText = "Camera/Microphone access denied. We need this to connect you.";
    }
}

async function startMatchmaking() {
    isManuallyLeaving = false;
    resetRemoteUI();
    
    reportablePartnerData = null;
    sessionChatHistory = [];
    partnerDataLoaded = false;
    if(handshakeInterval) clearInterval(handshakeInterval);

    const banStatus = await checkBanStatus(currentUser.ip);
    if (banStatus.isBanned) {
        const modal = document.getElementById('modal-banned');
        const title = modal.querySelector('h2');
        const desc = modal.querySelector('p');
        const appealBtn = document.getElementById('btn-appeal-ban');
        const appealInput = document.getElementById('appeal-reason');

        if (banStatus.hasAppealed) {
            title.innerHTML = '<i class="fas fa-clock"></i> Appeal Pending';
            desc.innerText = "Appeal sent, please be patient. We are reviewing your case.";
            appealBtn.classList.add('hidden');
            if (appealInput) appealInput.classList.add('hidden');
        } else {
            title.innerHTML = '<i class="fas fa-ban text-danger"></i> Access Revoked';
            desc.innerText = "You have been permanently banned due to multiple reports of policy violations.";
            appealBtn.classList.remove('hidden');
            appealBtn.disabled = false;
            appealBtn.innerText = "Submit Appeal Request";
            if (appealInput) {
                appealInput.classList.remove('hidden');
                appealInput.value = ''; 
            }
        }
        
        modal.classList.remove('hidden');
        cleanupConnections();
        return; 
    }

    const statusEl = document.getElementById('remote-status');
    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching for stranger...';
    statusEl.classList.remove('hidden');
    
    cleanupConnections();
    
    try {
        const result = await matchmake(currentUser);
        if (result.matched) {
            statusEl.innerText = "Connecting...";
            
            // Set BOTH data variables immediately for the Caller
            currentPartnerData = result.partnerData; 
            reportablePartnerData = result.partnerData; 
            
            const call = peer.call(result.partnerData.peerId, localStream);
            const conn = peer.connect(result.partnerData.peerId, { reliable: true });
            
            setupCallEvents(call);
            setupDataEvents(conn);
        } else {
            statusEl.innerHTML = '<i class="fas fa-hourglass-half"></i> No one is here right now... please wait.';
        }
    } catch (e) {
        statusEl.innerText = "Connecting... Retrying...";
    }
}

peer.on('call', async (call) => {
    // Ignore duplicate overlapping calls
    if (currentCall) {
        call.close();
        return;
    }
    
    await leaveQueue(currentUser);
    call.answer(localStream);
    setupCallEvents(call);
});

peer.on('connection', (conn) => { 
    if (dataConnection && dataConnection.open) return;
    setupDataEvents(conn); 
});

function setupCallEvents(call) {
    currentCall = call;
    call.on('stream', (remoteStream) => {
        document.getElementById('remote-video').srcObject = remoteStream;
        document.getElementById('remote-status').classList.add('hidden');
        
        if (currentPartnerData) {
            renderStrangerBadge(currentPartnerData);
        }
    });
    call.on('close', () => handleStrangerDisconnect());
}

function setupDataEvents(conn) {
    dataConnection = conn;
    
    const startHandshake = () => {
        partnerDataLoaded = false;
        if(handshakeInterval) clearInterval(handshakeInterval);
        
        handshakeInterval = setInterval(() => {
            if (!partnerDataLoaded && dataConnection && dataConnection.open) {
                dataConnection.send({ type: 'handshake', userData: currentUser, video: !isVideoOff, audio: !isMuted });
            } else if (partnerDataLoaded) {
                clearInterval(handshakeInterval);
            }
        }, 500); 
        
        enableChatUI(true);
        showToast('Connected with a stranger!', 'success');
    };

    if (conn.open) {
        startHandshake();
    } else {
        conn.on('open', startHandshake);
    }

    conn.on('data', (data) => {
        if (data.type === 'handshake') {
            partnerDataLoaded = true;
            clearInterval(handshakeInterval);

            currentPartnerData = data.userData;
            reportablePartnerData = currentPartnerData; 

            renderStrangerBadge(currentPartnerData);
            updateRemoteMediaState(data.video, data.audio);
            
            dataConnection.send({ type: 'handshake_ack', userData: currentUser, video: !isVideoOff, audio: !isMuted });
        } 
        else if (data.type === 'handshake_ack') {
            partnerDataLoaded = true;
            clearInterval(handshakeInterval);
            
            if (!currentPartnerData && data.userData) {
                currentPartnerData = data.userData;
                reportablePartnerData = currentPartnerData;
                renderStrangerBadge(currentPartnerData);
            }
            updateRemoteMediaState(data.video, data.audio);
        }
        else if (data.type === 'media_state') {
            updateRemoteMediaState(data.video, data.audio);
        }
        else if (data.type === 'chat') {
            appendMessage(data.text, 'remote');
            sessionChatHistory.push({ sender: 'Stranger', text: data.text, time: getFormattedTimestamp() });

            if (!isChatOpen) {
                showToast('Stranger sent a message', 'info');
                UI.chatBadge.classList.remove('hidden');
                UI.btnToggleChat.classList.remove('pop-anim'); 
                void UI.btnToggleChat.offsetWidth; 
                UI.btnToggleChat.classList.add('pop-anim');
            }
        }
        else if (data.type === 'typing') {
            UI.typingIndicator.classList.remove('hidden');
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => UI.typingIndicator.classList.add('hidden'), 2000);
            
            if (!isChatOpen && (Date.now() - lastTypingToast > 8000)) {
                showToast('Stranger is typing...', 'info');
                lastTypingToast = Date.now();
            }
        }
        else if (data.type === 'reported') {
            isWarned = true; 
            leaveQueue(currentUser); 
            
            showToast('Stranger reported you!', 'danger');
            document.getElementById('warning-reason').innerText = data.reason;
            document.getElementById('modal-reported-warning').classList.remove('hidden');
            document.getElementById('agree-rules').checked = false;
        }
        else if (data.type === 'disconnect') {
            handleStrangerDisconnect();
        }
    });
}

function handleStrangerDisconnect() {
    if (isManuallyLeaving || isWarned) return; 
    
    resetRemoteUI();
    const statusEl = document.getElementById('remote-status');
    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Stranger left. Reconnecting...';
    statusEl.classList.remove('hidden');
    
    const delay = Math.floor(Math.random() * 4000) + 1000;
    setTimeout(() => {
        if (!isManuallyLeaving && !isWarned) {
            startMatchmaking();
        }
    }, delay);
}

function updateRemoteMediaState(videoOn, audioOn) {
    const rCam = document.getElementById('remote-cam-off');
    const rMic = document.getElementById('remote-mic-off');
    videoOn ? rCam.classList.add('hidden') : rCam.classList.remove('hidden');
    audioOn ? rMic.classList.add('hidden') : rMic.classList.remove('hidden');
}

UI.btnCamera.addEventListener('click', async () => {
    try {
        if (!isVideoOff) {
            localStream.getVideoTracks().forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
            isVideoOff = true;
        } else {
            const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newTrack = newStream.getVideoTracks()[0];
            localStream.addTrack(newTrack);
            
            if (currentCall && currentCall.peerConnection) {
                const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(newTrack);
            }
            UI.localVideo.srcObject = localStream;
            isVideoOff = false;
        }

        UI.btnCamera.classList.toggle('muted', isVideoOff);
        UI.btnCamera.innerHTML = isVideoOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
        isVideoOff ? UI.localCamOff.classList.remove('hidden') : UI.localCamOff.classList.add('hidden');
        
        if (dataConnection && dataConnection.open) {
            dataConnection.send({ type: 'media_state', video: !isVideoOff, audio: !isMuted });
        }
    } catch (err) { console.error("Camera error:", err); }
});

UI.btnMute.addEventListener('click', () => {
    isMuted = !isMuted;
    const audioTrack = localStream.getAudioTracks()[0];
    if(audioTrack) audioTrack.enabled = !isMuted;
    
    UI.btnMute.classList.toggle('muted', isMuted);
    UI.btnMute.innerHTML = isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
    isMuted ? UI.localMicOff.classList.remove('hidden') : UI.localMicOff.classList.add('hidden');
    
    if (dataConnection && dataConnection.open) {
        dataConnection.send({ type: 'media_state', video: !isVideoOff, audio: !isMuted });
    }
});

function toggleChat() {
    isChatOpen = !isChatOpen;
    if (isChatOpen) {
        UI.localBox.classList.add('hidden');
        UI.chatPanel.classList.remove('hidden');
        UI.chatBadge.classList.add('hidden');
        UI.btnToggleChat.classList.remove('has-unread');
        setTimeout(() => UI.chatInput.focus(), 100);
    } else {
        UI.localBox.classList.remove('hidden');
        UI.chatPanel.classList.add('hidden');
    }
}

UI.btnToggleChat.addEventListener('click', toggleChat);
UI.btnCloseChat.addEventListener('click', toggleChat);

function enableChatUI(enable) {
    UI.chatInput.disabled = !enable;
    UI.btnSendMsg.disabled = !enable;
    UI.btnToggleChat.disabled = !enable;
    UI.btnReport.disabled = !enable;
    UI.chatInput.placeholder = enable ? "Type a message..." : "Waiting for connection...";
}

function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `msg-bubble msg-${sender}`;
    div.innerText = text;
    UI.chatMessages.appendChild(div);
    UI.chatMessages.scrollTop = UI.chatMessages.scrollHeight;
}

UI.btnSendMsg.addEventListener('click', sendMessage);
UI.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
UI.chatInput.addEventListener('input', () => {
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'typing' });
});

function sendMessage() {
    const text = UI.chatInput.value.trim();
    if (!text || !dataConnection || !dataConnection.open) return;
    
    dataConnection.send({ type: 'chat', text });
    appendMessage(text, 'local');
    
    sessionChatHistory.push({ sender: 'You', text: text, time: getFormattedTimestamp() });
    UI.chatInput.value = '';
}

document.getElementById('btn-next').addEventListener('click', () => {
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'disconnect' });
    startMatchmaking(); 
});

document.getElementById('btn-leave').addEventListener('click', async () => {
    isManuallyLeaving = true; 
    showLoader("Disconnecting...");
    await leaveQueue(currentUser);
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'disconnect' });
    cleanupConnections();
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    setTimeout(() => { hideLoader(); showView('view-guest'); }, 500);
});

function resetRemoteUI() {
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('remote-user-info').classList.add('hidden');
    document.getElementById('remote-cam-off').classList.add('hidden');
    document.getElementById('remote-mic-off').classList.add('hidden');
    
    UI.chatMessages.innerHTML = '';
    enableChatUI(false); 
    
    if (isChatOpen) toggleChat(); 
    
    currentPartnerData = null;
}

function cleanupConnections() {
    if (currentCall) { currentCall.close(); currentCall = null; }
    if (dataConnection) { dataConnection.close(); dataConnection = null; }
}

UI.btnReport.addEventListener('click', () => {
    if (!reportablePartnerData) {
        return showToast("No stranger data available to report.", "warning");
    }
    document.getElementById('modal-report').classList.remove('hidden');
    document.getElementById('report-reason').value = '';
    document.getElementById('report-include-chat').checked = true; 
});

document.getElementById('btn-cancel-report').addEventListener('click', () => {
    document.getElementById('modal-report').classList.add('hidden');
});

document.getElementById('btn-submit-report').addEventListener('click', async () => {
    const reason = document.getElementById('report-reason').value.trim();
    if (!reason) return alert("Please enter a reason.");
    
    const includeChat = document.getElementById('report-include-chat').checked;
    const finalChatLogs = includeChat ? sessionChatHistory : [];

    document.getElementById('modal-report').classList.add('hidden');
    
    if (reportablePartnerData) {
        showToast("Submitting report...", "info");

        if (dataConnection && dataConnection.open) {
            dataConnection.send({ type: 'reported', reason: reason });
            dataConnection.send({ type: 'disconnect' });
        }
        cleanupConnections();

        await submitReportDB(
            reportablePartnerData.id, 
            reportablePartnerData.ip, 
            reason, 
            reportablePartnerData,
            finalChatLogs
        );
        
        showToast("Report submitted successfully.", "success");
        startMatchmaking(); 
    }
});

document.getElementById('btn-agree-warning').addEventListener('click', () => {
    const isChecked = document.getElementById('agree-rules').checked;
    if (!isChecked) return alert("You must agree to the Terms to continue.");
    
    document.getElementById('modal-reported-warning').classList.add('hidden');
    
    isWarned = false; 
    startMatchmaking(); 
});