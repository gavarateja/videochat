import { startChatProtocol } from './webrtc.js';
import { checkBanStatus, submitAppealDB } from './firebase.js';

const UI = {
    dobInput: document.getElementById("guest-dob"),
    errorEl: document.getElementById("guest-error"),
    btnEnterChat: document.getElementById("btn-start-guest"),
    loader: document.getElementById("global-loader"),
    loaderText: document.getElementById("loader-text")
};

let userIp = 'unknown';

// Fetch IP on load
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        userIp = data.ip;
    } catch (e) { console.warn("IP fetch failed"); }

    const savedData = localStorage.getItem('userData');
    if (savedData) {
        const data = JSON.parse(savedData);
        document.getElementById('guest-name').value = data.name || '';
        document.getElementById('guest-dob').value = data.dob || '';
        document.getElementById('guest-country').value = data.country || '';
        if (data.gender) {
            const radio = document.querySelector(`input[name="guest-gender"][value="${data.gender}"]`);
            if (radio) radio.checked = true;
        }
    }
});

// Auto-format DOB
UI.dobInput.addEventListener("input", function (e) {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 2 && value.length <= 4) {
        value = value.slice(0, 2) + "/" + value.slice(2);
    } else if (value.length > 4) {
        value = value.slice(0, 2) + "/" + value.slice(2, 4) + "/" + value.slice(4, 8);
    }
    e.target.value = value;
});

function calculateAge(dobString) {
    const parts = dobString.split('/');
    if (parts.length !== 3) return -1;
    const dob = new Date(parts[2], parts[1] - 1, parts[0]);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    return age;
}

// Enter Chat & Ban Check
UI.btnEnterChat.addEventListener('click', async () => {
    const name = document.getElementById('guest-name').value.trim();
    const dob = UI.dobInput.value;
    const country = document.getElementById('guest-country').value.trim();
    const tncChecked = document.getElementById('guest-tnc').checked;
    const selectedGender = document.querySelector('input[name="guest-gender"]:checked');

    if (!name || !dob || country === '' || !selectedGender) {
        return UI.errorEl.innerText = "Please fill out all fields.";
    }
    const age = calculateAge(dob);
    
    if (age < 18) {
        return UI.errorEl.innerText = "You must be at least 18 years old to use this app.";
    }
    if (age > 100 || age < 0) {
        return UI.errorEl.innerText = "Please enter a valid, realistic Date of Birth.";
    }
    if (!tncChecked) {
        return UI.errorEl.innerText = "You must agree to the Terms & Conditions.";
    }

    UI.errorEl.innerText = "";
    showLoader("Connecting to network...");

    const banStatus = await checkBanStatus(userIp);
    
    if (banStatus.isBanned) {
        hideLoader();
        const modal = document.getElementById('modal-banned');
        const title = modal.querySelector('h2');
        const desc = modal.querySelector('p');
        const appealBtn = document.getElementById('btn-appeal-ban');
        const appealInput = document.getElementById('appeal-reason');

        // Dynamically style the UI based on appeal status
        if (banStatus.hasAppealed) {
            title.innerHTML = 'Appeal Pending';
            desc.innerText = "Ban-Appeal sent, please be patient. We are reviewing your case.";
            appealBtn.classList.add('hidden'); 
            if (appealInput) appealInput.classList.add('hidden');
        } else {
            title.innerHTML = 'Access Blocked';
            desc.innerText = "You have been permanently banned due to multiple reports of policy violations.";
            appealBtn.classList.remove('hidden'); 
            appealBtn.disabled = false;
            appealBtn.innerText = "Submit Appeal Request";
            if (appealInput) {
                appealInput.classList.remove('hidden');
                appealInput.value = ''; // Clear previous input
            }
        }
        
        modal.classList.remove('hidden');
        return;
    }

    const currentUser = {
        id: `user_${Math.floor(Math.random() * 1000000)}`,
        name, dob, age, country, 
        gender: selectedGender.value,
        ip: userIp
    };

    localStorage.setItem('userData', JSON.stringify({ name, dob, country, gender: selectedGender.value }));

    showLoader("Accessing Camera & Microphone...");
    await startChatProtocol(currentUser);
});

// Appeal Unban Logic with Reason Validation
document.getElementById('btn-appeal-ban').addEventListener('click', async () => {
    const btn = document.getElementById('btn-appeal-ban');
    const modal = document.getElementById('modal-banned');
    const appealInput = document.getElementById('appeal-reason');
    
    const reason = appealInput ? appealInput.value.trim() : "";
    
    if (appealInput && !reason) {
        return alert("Please provide a reason for your appeal before submitting.");
    }

    btn.disabled = true;
    btn.innerText = "Submitting...";
    
    await submitAppealDB(userIp, reason);
    
    // Instantly transform the modal UI to the pending state
    modal.querySelector('h2').innerHTML = 'Appeal Pending';
    modal.querySelector('p').innerText = "Appeal sent, please be patient. We are reviewing your case.";
    btn.classList.add('hidden');
    if (appealInput) appealInput.classList.add('hidden');
    
    showToast("Your appeal has been submitted for review.", "info");
});

export function showLoader(text) { 
    UI.loaderText.innerText = text; 
    UI.loader.classList.remove('hidden'); 
}
export function hideLoader() { 
    UI.loader.classList.add('hidden'); 
}
export function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => { 
        v.classList.remove('active'); 
        v.classList.add('hidden'); 
    });
    const target = document.getElementById(viewId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
}
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3300);
}