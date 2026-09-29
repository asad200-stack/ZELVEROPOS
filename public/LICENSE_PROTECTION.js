// ============================================
// License protection system - preventing code sharing
// ============================================

// API settings
const LICENSE_API_CONFIG = {
    baseUrl: 'https://pos-catch.web.app/', // Change this to your server address
    verifyInterval: 24 * 60 * 60 * 1000, // Every 24 hours
    maxOfflineDays: 7 // Maximum days without contact
};

// ============================================
// 1. Create a unique Hardware ID for the device
// ============================================
async function generateHardwareId() {
    try {
        const components = [];
        
        // Browser information
        if (navigator.userAgent) {
            components.push(navigator.userAgent);
        }
        
        // Language information
        if (navigator.language) {
            components.push(navigator.language);
        }
        
        // Screen information
        if (screen.width && screen.height) {
            components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);
        }
        
        // Time information
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        components.push(timezone);
        
        // localStorage information (if present)
        try {
            const storedId = localStorage.getItem('device_hardware_id');
            if (storedId) {
                return storedId; // Returns the stored identifier
            }
        } catch (e) {}
        
        // Create a hash from components
        const combined = components.join('|');
        const encoder = new TextEncoder();
        const data = encoder.encode(combined);
        
        let hashHex;
        if (window.crypto && window.crypto.subtle) {
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
            // Fallback is simple
            hashHex = btoa(combined).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
        }
        
        // Save the ID
        try {
            localStorage.setItem('device_hardware_id', hashHex);
        } catch (e) {}
        
        return hashHex;
        
    } catch (error) {
        console.error('Error generating hardware ID:', error);
        // Fallback ID
        const fallbackId = 'DEVICE_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        try {
            localStorage.setItem('device_hardware_id', fallbackId);
        } catch (e) {}
        return fallbackId;
    }
}

// ============================================
// 2. Activate the license online with Hardware ID
// ============================================
async function activateLicenseOnline(licenseKey, clientName, contactEmail) {
    try {
        const hardwareId = await generateHardwareId();
        
        const response = await fetch(`${LICENSE_API_CONFIG.baseUrl}/activate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                license_key: licenseKey,
                client_name: clientName || 'عميل',
                contact_email: contactEmail || '',
                hardware_id: hardwareId
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return {
                ok: false,
                msg: errorData.message || 'فشل التفعيل عبر الإنترنت'
            };
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Save license data
            const licenseData = {
                activated: true,
                type: data.license.type,
                license_key: licenseKey,
                client_id: data.client_id,
                hardware_id: hardwareId,
                expires_at: data.license.expires_at,
                features: data.license.features,
                activated_at: new Date().toISOString(),
                last_verification: new Date().toISOString(),
                api_url: data.api_url
            };
            
            // Save to localStorage
            localStorage.setItem('license_data', JSON.stringify(licenseData));
            localStorage.setItem('client_id', data.client_id);
            localStorage.setItem('api_url', data.api_url);
            localStorage.setItem('hardware_id', hardwareId);
            
            // Save to your current licensing system
            const state = {
                activated: true,
                type: data.license.type,
                code: licenseKey.substring(0, 10) + '***', // Hide the full code
                start_at: new Date().toISOString(),
                end_at: data.license.expires_at,
                lifetime: data.license.type === 'lifetime',
                days_left: data.license.days_left || null,
                last_tick_utc: new Date().toISOString(),
                used_codes: [],
                hardware_id: hardwareId,
                client_id: data.client_id
            };
            
            // Save in the licensing system
            if (typeof saveLicenseState === 'function') {
                saveLicenseState(state);
            } else {
                localStorage.setItem('license_state', JSON.stringify(state));
            }
            
            return {
                ok: true,
                state: state,
                license: data.license
            };
        } else {
            return {
                ok: false,
                msg: data.message || 'فشل التفعيل'
            };
        }
        
    } catch (error) {
        console.error('Online activation error:', error);
        return {
            ok: false,
            msg: 'خطأ في الاتصال بالخادم. يرجى التحقق من الاتصال بالإنترنت.'
        };
    }
}

// ============================================
// 3. Check the license online
// ============================================
async function verifyLicenseOnline() {
    try {
        const licenseData = JSON.parse(localStorage.getItem('license_data') || '{}');
        const hardwareId = await generateHardwareId();
        const storedHardwareId = localStorage.getItem('hardware_id');
        
        // If license_data is not enabled, check other activation system (activation code / Firebase)
        if (!licenseData.license_key) {
            try {
                if (typeof isActivated === 'function' && (await isActivated())) {
                    return { valid: true, offline: false, message: 'مفعّل عبر كود/اشتراك' };
                }
                const token = JSON.parse(localStorage.getItem('delta_activation_token') || '{}');
                if (token && token.activated) {
                    if (token.lifetime) return { valid: true, offline: false };
                    if (token.end_at && new Date(token.end_at) > new Date()) return { valid: true, offline: false };
                }
            } catch (_) {}
            return {
                valid: false,
                message: 'لا توجد ترخيص مفعّل'
            };
        }
        
        // Verify that the Hardware ID has changed (only when using license_data)
        if (storedHardwareId && storedHardwareId !== hardwareId) {
            console.warn('⚠️ Hardware ID changed!');
            return {
                valid: false,
                message: 'تم اكتشاف تغيير في الجهاز. يرجى إعادة التفعيل.',
                hardware_mismatch: true
            };
        }
        
        const response = await fetch(`${LICENSE_API_CONFIG.baseUrl}/verify/${licenseData.license_key}?hardware_id=${encodeURIComponent(hardwareId)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Hardware-ID': hardwareId
            }
        });
        
        if (!response.ok) {
            // If there is no connection, we check the last verification
            const lastVerification = new Date(licenseData.last_verification || 0);
            const daysSinceVerification = (Date.now() - lastVerification.getTime()) / (1000 * 60 * 60 * 24);
            
            if (daysSinceVerification > LICENSE_API_CONFIG.maxOfflineDays) {
                return {
                    valid: false,
                    message: 'انتهت صلاحية الترخيص. يرجى الاتصال بالإنترنت للتحقق.',
                    offline: true,
                    days_offline: daysSinceVerification
                };
            }
            
            // Allow local use temporarily
            return {
                valid: true,
                offline: true,
                message: 'يعمل في وضع عدم الاتصال'
            };
        }
        
        const data = await response.json();
        
        if (data.valid) {
            // Update license data
            licenseData.last_verification = new Date().toISOString();
            licenseData.expires_at = data.license.expires_at;
            licenseData.days_left = data.license.days_left;
            localStorage.setItem('license_data', JSON.stringify(licenseData));
            
            return {
                valid: true,
                license: data.license,
                offline: false
            };
        } else {
            // The license is invalid
            return {
                valid: false,
                message: data.message || 'الترخيص غير صالح'
            };
        }
        
    } catch (error) {
        console.error('License verification error:', error);
        
        // In case of connection error, we check the last verification
        try {
            const licenseData = JSON.parse(localStorage.getItem('license_data') || '{}');
            const lastVerification = new Date(licenseData.last_verification || 0);
            const daysSinceVerification = (Date.now() - lastVerification.getTime()) / (1000 * 60 * 60 * 24);
            
            if (daysSinceVerification > LICENSE_API_CONFIG.maxOfflineDays) {
                return {
                    valid: false,
                    message: 'انتهت صلاحية الترخيص. يرجى الاتصال بالإنترنت.',
                    offline: true
                };
            }
            
            return {
                valid: true,
                offline: true,
                message: 'يعمل في وضع عدم الاتصال'
            };
        } catch (e) {
            return {
                valid: false,
                message: 'خطأ في التحقق من الترخيص'
            };
        }
    }
}

// ============================================
// 4. Start periodic verification
// ============================================
function startPeriodicVerification() {
    // Verify immediately
    verifyLicenseOnline().then(result => {
        if (!result.valid && !result.offline) {
            console.error('❌ License verification failed:', result.message);
            // Disable the system
            if (typeof deactivateSystem === 'function') {
                deactivateSystem();
            }
        }
    });
    
    // Check every 24 hours
    setInterval(() => {
        verifyLicenseOnline().then(result => {
            if (!result.valid && !result.offline) {
                console.error('❌ License verification failed:', result.message);
                if (typeof deactivateSystem === 'function') {
                    deactivateSystem();
                }
            }
        });
    }, LICENSE_API_CONFIG.verifyInterval);
    
    // Check when page loads
    window.addEventListener('load', () => {
        const licenseData = JSON.parse(localStorage.getItem('license_data') || '{}');
        const lastVerification = licenseData.last_verification;
        
        if (lastVerification) {
            const lastCheck = new Date(lastVerification);
            const now = new Date();
            const hoursSinceCheck = (now - lastCheck) / (1000 * 60 * 60);
            
            // If more than 24 hours have passed, check immediately
            if (hoursSinceCheck >= 24) {
                verifyLicenseOnline();
            }
        }
    });
}

// ============================================
// 5. System disable function
// ============================================
function deactivateSystem() {
    // Hide the main interface
    const mainScreen = document.getElementById('mainScreen');
    if (mainScreen) {
        mainScreen.style.display = 'none';
    }
    
    // Show the activation screen
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
        loginScreen.classList.add('active');
    }
    
    // Show message
    if (typeof showMessage === 'function') {
        showMessage('انتهت صلاحية الترخيص. يرجى التفعيل مرة أخرى.', 'error');
    } else {
        // No browser alert fallback: show a simple in-app banner
        try {
            const existing = document.getElementById('licenseExpiredBanner');
            if (existing) existing.remove();
            const banner = document.createElement('div');
            banner.id = 'licenseExpiredBanner';
            banner.textContent = 'انتهت صلاحية الترخيص. يرجى التفعيل مرة أخرى.';
            banner.style.position = 'fixed';
            banner.style.left = '12px';
            banner.style.right = '12px';
            banner.style.bottom = '12px';
            banner.style.zIndex = '99999';
            banner.style.padding = '12px 14px';
            banner.style.borderRadius = '12px';
            banner.style.background = '#fee2e2';
            banner.style.color = '#991b1b';
            banner.style.boxShadow = '0 12px 30px rgba(0,0,0,0.18)';
            banner.style.fontWeight = '700';
            banner.style.textAlign = 'center';
            document.body.appendChild(banner);
            setTimeout(() => { try { banner.remove(); } catch(_) {} }, 6000);
        } catch (_) {}
    }
    
    // Clear license data
    localStorage.removeItem('license_data');
    localStorage.removeItem('license_state');
    localStorage.removeItem('client_id');
}

// ============================================
// 6. Export functions for use
// ============================================
if (typeof window !== 'undefined') {
    window.generateHardwareId = generateHardwareId;
    window.activateLicenseOnline = activateLicenseOnline;
    window.verifyLicenseOnline = verifyLicenseOnline;
    window.startPeriodicVerification = startPeriodicVerification;
    window.deactivateSystem = deactivateSystem;
}

