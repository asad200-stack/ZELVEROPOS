// Firebase Configuration
// Replace these values with your actual Firebase project credentials
const firebaseConfig = {
    apiKey: "AIzaSyBShQw-Thn8YVZ7CgMwlaKGHED_JQ6gH2M",
    authDomain: "pos-catch.firebaseapp.com",
    projectId: "pos-catch",
    storageBucket: "pos-catch.firebasestorage.app",
    messagingSenderId: "891436013106",
    appId: "1:891436013106:web:ef963a91d3b61d44364e2b"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    
    // Initialize services
    const auth = firebase.auth();
    const db = firebase.firestore();
    try {
        // Transport: avoid forcing long-polling always (can worsen WebChannel 400 / Yn on some networks).
        // Auto-detect switches to long-polling only when needed; merge keeps defaults (host/ssl).
        db.settings({
            experimentalAutoDetectLongPolling: true,
            useFetchStreams: false,
            merge: true
        });
    } catch (_) {}
    const storage = (typeof firebase.storage !== 'undefined' && firebase.app) ? firebase.storage() : null;
    const functions = (typeof firebase.functions !== 'undefined' && firebase.app) ? firebase.app().functions('us-central1') : null;
    
    // Export for use in other files
    window.firebaseAuth = auth;
    window.firebaseDb = db;
    window.firebaseStorage = storage;
    window.firebaseFunctions = functions;
} else {
    console.error('Firebase SDK not loaded. Please include Firebase scripts in your HTML.');
}

