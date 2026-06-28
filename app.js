import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { 
    getFirestore, doc, setDoc, getDoc, collection, query, 
    where, limit, getDocs, deleteDoc, updateDoc, increment 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// 1. FIREBASE CONFIGURATION
const firebaseConfig = {
    apiKey: "AIzaSyBxGfB8RckxPoEpPjKK2WX3CEpL9cRENYM",
    authDomain: "video-chat-e9053.firebaseapp.com",
    projectId: "video-chat-e9053",
    storageBucket: "video-chat-e9053.firebasestorage.app",
    messagingSenderId: "325616565557",
    appId: "1:325616565557:web:764f9a6b083fdbcf60207c"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const peer = new Peer(); 

// 2. STATE VARIABLES
let currentUser = null; 
let currentPartnerDbId = null; 
let localStream, currentCall, currentDataConnection;

peer.on('open', (id) => console.log("PeerJS Connected. ID:", id));

// 3. UI HELPER FUNCTIONS
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
        v.classList.add('hidden');
    });
    const target = document.getElementById(viewId);
    target.classList.remove('hidden');
    target.classList.add('active');
}

function getGenderIcon(gender) {
    if (gender === 'male') return '<i class="fas fa-mars gender-male"></i>';
    if (gender === 'female') return '<i class="fas fa-venus gender-female"></i>';
    return '<i class="fas fa-genderless gender-any"></i>';
}

function showLoader(message = "Loading...") {
    document.getElementById('loader-text').innerText = message;
    document.getElementById('global-loader').classList.remove('hidden');
}

function hideLoader() {
    document.getElementById('global-loader').classList.add('hidden');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message; // allows icons if needed
    container.appendChild(toast);
    
    setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 3900);
}

// 4. NAVIGATION LISTENERS
document.getElementById('btn-start-app').addEventListener('click', () => showView('view-auth-choice'));
document.getElementById('btn-show-guest').addEventListener('click', () => showView('view-guest'));

// 5. GUEST LOGIN & INITIALIZATION
document.getElementById('btn-start-guest').addEventListener('click', async () => {
    const name = document.getElementById('guest-name').value.trim();
    const gender = document.getElementById('guest-gender').value;
    const country = document.getElementById('guest-country').value.trim();
    const errorEl = document.getElementById('guest-error');

    if(!name || !country || gender === 'any') {
        return errorEl.innerText = "Please fill all fields accurately.";
    }

    showLoader("Creating guest profile & accessing camera...");
    errorEl.innerText = "";

    try {
        // Validate uniqueness in DB
        const docRef = doc(db, "public_users", name);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            hideLoader();
            if(docSnap.data().blocked) return errorEl.innerText = "This account is blocked due to reports.";
            return errorEl.innerText = "Name already taken. Choose another.";
        }

        // 1. Hardware access first (if it fails, don't write to DB)
        await startCamera();

        // 2. Save user
        currentUser = {
            mode: 'guest',
            id: name,
            name: name,
            gender: gender,
            country: country,
            peerId: peer.id,
            reports: 0,
            blocked: false,
            loginTime: new Date().toISOString()
        };
        await setDoc(docRef, currentUser);
        
        // 3. Update UI
        document.getElementById('header-name').innerText = `Logged in as: ${name}`;
        document.getElementById('header-user-info').classList.remove('hidden');
        document.getElementById('filter-container').style.display = 'none'; 
        
        const localInfo = document.getElementById('local-user-info');
        localInfo.innerHTML = `${name} ${getGenderIcon(gender)} | ${country}`;
        localInfo.classList.remove('hidden');

        hideLoader();
        showView('view-chat');
        findMatch();

    } catch (error) {
        hideLoader();
        console.error(error);
        if(error.name === "NotAllowedError") errorEl.innerText = "Camera/Microphone access denied.";
        else errorEl.innerText = "Database connection error occurred.";
    }
});

async function startCamera() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-video').srcObject = localStream;
}

// 6. MATCHMAKING QUEUE LOGIC
async function findMatch() {
    const status = document.getElementById('remote-status');
    const remoteInfo = document.getElementById('remote-user-info');
    
    status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching for a partner...';
    status.style.display = 'block';
    remoteInfo.classList.add('hidden');
    document.getElementById('remote-video').srcObject = null;
    
    if (currentCall) currentCall.close();
    if (currentDataConnection) currentDataConnection.close();

    const queueName = currentUser.mode === 'guest' ? 'public_queue' : 'private_queue';
    const queueRef = collection(db, queueName);

    try {
        const q = query(queueRef, where("id", "!=", currentUser.id), limit(1));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            // MATCH FOUND!
            const partnerData = querySnapshot.docs[0].data();
            const partnerDocId = querySnapshot.docs[0].id;

            await deleteDoc(doc(db, queueName, partnerDocId));

            status.innerHTML = "Connecting...";
            currentPartnerDbId = partnerData.id; 
            
            remoteInfo.innerHTML = `${partnerData.id} ${getGenderIcon(partnerData.gender)} | ${partnerData.country}`;
            remoteInfo.classList.remove('hidden');
            
            // WebRTC Call & Data Setup
            const call = peer.call(partnerData.peerId, localStream);
            const conn = peer.connect(partnerData.peerId);
            handleCall(call);
            handleDataConnection(conn);

        } else {
            // NO MATCH - Inform user and wait
            status.innerHTML = "No users available right now.<br><span style='font-size:0.85rem; color:#94a3b8;'>Please wait or try again later.</span>";
            showToast("Waiting room joined. You will connect automatically when someone arrives.", "info");
            
            await setDoc(doc(db, queueName, currentUser.id), {
                id: currentUser.id,
                peerId: peer.id,
                gender: currentUser.gender, 
                country: currentUser.country,
                filter: "" 
            });
        }
    } catch (e) {
        console.error("Matchmaking error", e);
        status.innerText = "Error finding match. Try again.";
    }
}

// 7. HANDLING INCOMING CALLS & DATA
peer.on('call', async (call) => {
    const queueName = currentUser.mode === 'guest' ? 'public_queue' : 'private_queue';
    await deleteDoc(doc(db, queueName, currentUser.id));

    const collectionName = currentUser.mode === 'guest' ? 'public_users' : 'users';
    const q = query(collection(db, collectionName), where("peerId", "==", call.peer));
    const snap = await getDocs(q);
    
    if(!snap.empty) {
        const callerData = snap.docs[0].data();
        currentPartnerDbId = callerData.id;
        
        const remoteInfo = document.getElementById('remote-user-info');
        remoteInfo.innerHTML = `${callerData.name || callerData.id} ${getGenderIcon(callerData.gender)} | ${callerData.country}`;
        remoteInfo.classList.remove('hidden');
        showToast("Connected to a new stranger!", "success");
    }

    call.answer(localStream);
    handleCall(call);
});

peer.on('connection', (conn) => {
    handleDataConnection(conn);
});

function handleCall(call) {
    currentCall = call;
    call.on('stream', (remoteStream) => {
        document.getElementById('remote-video').srcObject = remoteStream;
        document.getElementById('remote-status').style.display = 'none';
    });

    call.on('close', () => {
        document.getElementById('remote-video').srcObject = null;
        document.getElementById('remote-status').innerText = "Stranger disconnected.";
        document.getElementById('remote-status').style.display = 'block';
        document.getElementById('remote-user-info').classList.add('hidden');
        currentPartnerDbId = null;
    });
}

function handleDataConnection(conn) {
    currentDataConnection = conn;
    conn.on('data', (data) => {
        if(data.type === 'audio') {
            showToast(data.isEnabled ? "Stranger unmuted their mic." : "Stranger muted their mic.", "warning");
        }
        else if(data.type === 'video') {
            showToast(data.isEnabled ? "Stranger turned their camera back on." : "Stranger turned off their camera.", "warning");
        }
        else if(data.type === 'reported') {
            showToast("You have been reported. Disconnecting...", "danger");
        }
    });
}

// 8. IN-CHAT CONTROLS
document.getElementById('btn-next').addEventListener('click', findMatch);

document.getElementById('btn-leave').addEventListener('click', async () => {
    showLoader("Leaving chat...");
    if (currentCall) currentCall.close();
    if (currentDataConnection) currentDataConnection.close();
    
    const queueName = currentUser.mode === 'guest' ? 'public_queue' : 'private_queue';
    await deleteDoc(doc(db, queueName, currentUser.id));
    
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('remote-user-info').classList.add('hidden');
    
    setTimeout(() => {
        hideLoader();
        showView('view-home');
    }, 800);
});

// Hardware Toggles with Real-time Signaling
let isMuted = false, isVideoOff = false;

document.getElementById('btn-mute').addEventListener('click', (e) => {
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    e.currentTarget.classList.toggle('muted');
    e.currentTarget.innerHTML = isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
    
    if(currentDataConnection?.open) currentDataConnection.send({ type: 'audio', isEnabled: !isMuted });
});

document.getElementById('btn-camera').addEventListener('click', (e) => {
    isVideoOff = !isVideoOff;
    localStream.getVideoTracks()[0].enabled = !isVideoOff;
    e.currentTarget.classList.toggle('muted');
    e.currentTarget.innerHTML = isVideoOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
    
    if(currentDataConnection?.open) currentDataConnection.send({ type: 'video', isEnabled: !isVideoOff });
});

// Reporting Logic
document.getElementById('btn-report').addEventListener('click', async () => {
    if (!currentPartnerDbId) return showToast("No one is connected to report.", "warning");
    
    showLoader("Submitting report...");
    const collectionName = currentUser.mode === 'guest' ? 'public_users' : 'users';
    const reportLimit = currentUser.mode === 'guest' ? 3 : 5;

    try {
        if(currentDataConnection?.open) currentDataConnection.send({ type: 'reported' });

        const partnerRef = doc(db, collectionName, currentPartnerDbId);
        await updateDoc(partnerRef, { reports: increment(1) });

        const snap = await getDoc(partnerRef);
        if (snap.data().reports >= reportLimit) {
            await updateDoc(partnerRef, { blocked: true });
        }

        hideLoader();
        showToast("User reported successfully. Finding a new match...", "danger");
        findMatch();

    } catch (e) {
        hideLoader();
        console.error("Failed to report", e);
        showToast("Failed to submit report. Please try again.", "danger");
    }
});