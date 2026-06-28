import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { 
    getFirestore, doc, setDoc, getDocs, collection, query, 
    where, limit, deleteDoc, updateDoc, increment 
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

/**
 * Attempts to find an existing user in the queue. 
 * If found, deletes them from the queue (claiming the match) and returns their data.
 * If not found, places the current user into the queue to wait.
 */
export async function matchmake(user) {
    // Separate queues for guests vs logged-in users
    const queueName = user.mode === 'guest' ? 'public_queue' : 'private_queue';
    const queueRef = collection(db, queueName);

    try {
        // 1. Look for someone else in the queue
        const q = query(queueRef, where("id", "!=", user.id), limit(1));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            // Match found! Claim them by deleting their queue document
            const partnerDoc = querySnapshot.docs[0];
            const partnerData = partnerDoc.data();
            await deleteDoc(doc(db, queueName, partnerDoc.id));
            
            return { matched: true, partnerData };
        } else {
            // No match found. Put ourselves in the queue.
            await setDoc(doc(db, queueName, user.id), {
                id: user.id,
                name: user.name,
                peerId: user.peerId,
                gender: user.gender,
                country: user.country,
                timestamp: Date.now()
            });
            return { matched: false };
        }
    } catch (error) {
        console.error("Matchmaking Error:", error);
        throw error;
    }
}

/**
 * Ensures the user is removed from the queue if they cancel or disconnect
 */
export async function leaveQueue(user) {
    if (!user) return;
    const queueName = user.mode === 'guest' ? 'public_queue' : 'private_queue';
    try {
        await deleteDoc(doc(db, queueName, user.id));
    } catch (e) {
        console.warn("Error leaving queue:", e);
    }
}

/**
 * Submits a report. For guests, we only have temporary IDs, so reporting 
 * relies on matching sessions or IP bans in a real production environment.
 * Here we increment a block counter in 'reported_users' for simplicity.
 */
export async function reportUserDB(partnerId, partnerMode) {
    try {
        // Guests aren't permanently stored, so we log their ID in a moderation collection
        const reportRef = doc(db, 'reported_users', partnerId);
        await setDoc(reportRef, { reports: increment(1) }, { merge: true });
        return true;
    } catch (error) {
        console.error("Reporting Error:", error);
        return false;
    }
}