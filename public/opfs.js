// OPFS (Origin Private File System) Stub
// This file provides a minimal implementation to prevent ERR_FILE_NOT_FOUND errors
// Replace this with a full OPFS implementation if needed

// Check if OPFS is available
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
    console.log('OPFS API available');
} else {
    console.warn('OPFS API not available in this browser');
}

// Export a minimal API if needed by other scripts
window.opfsAPI = window.opfsAPI || {
    isAvailable: function() {
        return typeof navigator !== 'undefined' && 
               navigator.storage && 
               navigator.storage.getDirectory !== undefined;
    }
};


