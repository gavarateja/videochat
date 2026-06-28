import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { 
    getFirestore, doc, setDoc, getDoc, getDocs, collection, query, 
    where, limit, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBxGfB8RckxPoEpPjKK2WX3CEpL9cRENYM",
    authDomain: "video-chat-e9053.firebaseapp.com",
    projectId: "video-chat-e9053",
    storageBucket: "video-chat-e9053.firebasestorage.app",
    messagingSenderId: "325616565557",
    appId: "1:325616565557:web:764f9a6b083fdbcf60207c"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export function getFormattedTimestamp() {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function checkBanStatus(ip) {
    if (!ip) return { isBanned: false, hasAppealed: false };
    
    let isBanned = false;
    let hasAppealed = false;

    const banRef = doc(db, 'banned_users', ip);
    const banSnap = await getDoc(banRef);
    
    if (banSnap.exists()) {
        const data = banSnap.data();
        if (data.isBanned || (data.reports && data.reports.length >= 4)) {
            isBanned = true;
        }
    }

    if (isBanned) {
        const appealRef = doc(db, 'ban_appeals', ip);
        const appealSnap = await getDoc(appealRef);
        if (appealSnap.exists() && appealSnap.data().status === 'pending review') {
            hasAppealed = true;
        }
    }

    return { isBanned, hasAppealed };
}

export async function matchmake(user) {
    const queueRef = collection(db, 'public_queue');

    try {
        const q = query(queueRef, where("id", "!=", user.id), limit(1));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const partnerDoc = querySnapshot.docs[0];
            const partnerData = partnerDoc.data();
            
            await deleteDoc(doc(db, 'public_queue', partnerDoc.id));
            
            return { matched: true, partnerData };
        } else {
            await setDoc(doc(db, 'public_queue', user.id), {
                id: user.id,
                name: user.name,
                peerId: user.peerId,
                gender: user.gender,
                country: user.country,
                ip: user.ip, 
                timestamp: getFormattedTimestamp()
            });
            return { matched: false };
        }
    } catch (error) {
        console.error("Matchmaking Error:", error);
        throw error;
    }
}

export async function leaveQueue(user) {
    if (!user) return;
    try {
        await deleteDoc(doc(db, 'public_queue', user.id));
    } catch (e) {
        console.warn("Error leaving queue:", e);
    }
}

export async function submitReportDB(partnerId, partnerIp, reason, partnerData, chatHistory) {
    if (!partnerIp) return { isBanned: false };

    try {
        const banRef = doc(db, 'banned_users', partnerIp);
        const banSnap = await getDoc(banRef);
        
        let currentReports = [];
        if (banSnap.exists()) {
            currentReports = banSnap.data().reports || [];
        }
        
        currentReports.push({ 
            reportedName: partnerData.name || "Unknown",
            reportedId: partnerId,
            reason: reason,
            hasChat: chatHistory && chatHistory.length > 0,
            chatLogs: chatHistory || [],
            timestamp: getFormattedTimestamp()
        });

        const isBanned = currentReports.length >= 4;

        await setDoc(banRef, { 
            userId: partnerId,
            lastKnownData: partnerData,
            reports: currentReports,
            isBanned: isBanned,
            ...(isBanned && { bannedAt: getFormattedTimestamp() })
        }, { merge: true });

        if (isBanned) {
            await deleteDoc(doc(db, 'public_queue', partnerId));
        }
        
        return { isBanned };
    } catch (error) {
        console.error("Reporting Error:", error);
        return { isBanned: false };
    }
}

export async function submitAppealDB(ip, reason) {
    if (!ip) return;
    try {
        await setDoc(doc(db, 'ban_appeals', ip), {
            ip: ip,
            reason: reason || "No reason provided",
            timestamp: getFormattedTimestamp(),
            status: 'pending review'
        });
    } catch (error) {
        console.error("Appeal Error:", error);
    }
}