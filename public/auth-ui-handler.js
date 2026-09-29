// Authentication UI Handler
// Manages the UI interactions for login, signup, and password reset

class AuthUIHandler {
    constructor() {
        this.currentMode = 'login';
        this.pendingSignup = null; // { email, password } after Send OTP, until Verify
        this.init();
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
        } else {
            this.setupEventListeners();
        }
    }

    setupEventListeners() {
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const mode = e.currentTarget.getAttribute('data-mode');
                this.switchMode(mode);
            });
        });

        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        const signupForm = document.getElementById('signupForm');
        if (signupForm) {
            signupForm.addEventListener('submit', (e) => this.handleSignup(e));

            const storeNameInput = document.getElementById('signupStoreName');
            if (storeNameInput) {
                storeNameInput.addEventListener('input', () => {
                    this.updateSubdomainPreview();
                    this.validateSignupForm();
                });
            }

            [
                'signupFullName',
                'signupEmail',
                'signupPhoneNational',
                'signupCountryCode',
                'signupPassword',
                'signupPasswordConfirm'
            ].forEach((id) => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('input', () => this.validateSignupForm());
                    el.addEventListener('change', () => this.validateSignupForm());
                }
            });

            this.validateSignupForm();
        }

        document.querySelectorAll('.auth-password-toggle').forEach((btn) => {
            btn.addEventListener('click', () => this.togglePasswordVisibility(btn));
        });

        const resendCodeLink = document.getElementById('resendCodeLink');
        if (resendCodeLink) {
            resendCodeLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleResendCode();
            });
        }

        const forgotPasswordForm = document.getElementById('forgotPasswordForm');
        if (forgotPasswordForm) {
            forgotPasswordForm.addEventListener('submit', (e) => this.handleForgotPassword(e));
        }

        const forgotPasswordLink = document.getElementById('forgotPasswordLink');
        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchMode('forgot');
            });
        }

        const backToLoginLink = document.getElementById('backToLoginLink');
        if (backToLoginLink) {
            backToLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchMode('login');
            });
        }

        const backToLoginFromVerify = document.getElementById('backToLoginFromVerify');
        if (backToLoginFromVerify) {
            backToLoginFromVerify.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchMode('login');
            });
        }
    }

    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
    }

    getSignupPhoneDigits() {
        const phoneNationalRaw = document.getElementById('signupPhoneNational')?.value?.trim() || '';
        let digits = String(phoneNationalRaw).replace(/[^\d]/g, '');
        if (digits.startsWith('0') && digits.length > 6) digits = digits.replace(/^0+/, '');
        return digits;
    }

    validateSignupForm() {
        const submitBtn = document.getElementById('signupSubmitBtn');
        if (!submitBtn) return false;

        const fullName = document.getElementById('signupFullName')?.value.replace(/\s+/g, ' ').trim() || '';
        const email = document.getElementById('signupEmail')?.value.trim().toLowerCase() || '';
        const countryCode = document.getElementById('signupCountryCode')?.value?.trim() || '';
        const digits = this.getSignupPhoneDigits();
        const storeName = document.getElementById('signupStoreName')?.value.replace(/\s+/g, ' ').trim() || '';
        const password = document.getElementById('signupPassword')?.value || '';
        const passwordConfirm = document.getElementById('signupPasswordConfirm')?.value || '';

        const phoneValid = /^\+\d{1,4}$/.test(countryCode) && digits.length >= 6 && digits.length <= 14;
        const valid = !!(
            fullName &&
            email &&
            this.isValidEmail(email) &&
            phoneValid &&
            storeName &&
            password.length >= 6 &&
            passwordConfirm &&
            password === passwordConfirm
        );

        submitBtn.disabled = !valid;
        return valid;
    }

    togglePasswordVisibility(btn) {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.classList.toggle('is-visible', isPassword);

        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
        }

        const label = isPassword ? 'Hide password' : 'Show password';
        btn.setAttribute('aria-label', label);
    }

    switchMode(mode) {
        this.currentMode = mode;

        document.querySelectorAll('.auth-tab').forEach(tab => {
            const isActive = tab.getAttribute('data-mode') === mode;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });

        if (mode === 'login') {
            document.getElementById('loginForm')?.classList.add('active');
        } else if (mode === 'signup') {
            document.getElementById('signupForm')?.classList.add('active');
            this.updateSubdomainPreview();
            this.validateSignupForm();
        } else if (mode === 'forgot') {
            document.getElementById('forgotPasswordForm')?.classList.add('active');
        } else if (mode === 'verification') {
            document.getElementById('emailVerificationForm')?.classList.add('active');
            document.querySelectorAll('.auth-tab').forEach(tab => tab.style.display = 'none');
        } else {
            document.querySelectorAll('.auth-tab').forEach(tab => tab.style.display = 'flex');
        }

        this.hideMessage();
    }

    async handleLogin(e) {
        e.preventDefault();
        this.hideMessage();

        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        if (!email || !password) {
            this.showMessage('Please enter email and password.', 'error');
            return;
        }

        if (!this.isValidEmail(email)) {
            this.showMessage('Invalid email or password.', 'error');
            return;
        }

        let keepLoadingUntilRedirect = false;
        try {
            this.showLoading(true);
            const result = await window.firebaseAuthInstance.signIn(email, password);

            if (result.success) {
                keepLoadingUntilRedirect = true;
                this.showMessage('Login successful, redirecting...', 'success');
            }
        } catch (error) {
            let errorMessage = 'Invalid email or password.';

            if (error.code === 'auth/network-request-failed') {
                errorMessage = 'Network error. Please check your internet connection and try again.';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Too many attempts. Please wait a moment and try again.';
            } else if (error.code !== 'auth/invalid-credential' &&
                error.code !== 'auth/user-not-found' &&
                error.code !== 'auth/wrong-password') {
                errorMessage = error.message || 'Invalid email or password.';
            }

            this.showMessage(errorMessage, 'error');
            keepLoadingUntilRedirect = false;
        } finally {
            if (!keepLoadingUntilRedirect) {
                this.showLoading(false);
            }
        }
    }

    async handleSignup(e) {
        e.preventDefault();
        this.hideMessage();

        if (!this.validateSignupForm()) {
            this.showMessage('Please complete all required fields correctly.', 'error');
            return;
        }

        const fullName = document.getElementById('signupFullName').value.replace(/\s+/g, ' ').trim();
        const email = document.getElementById('signupEmail').value.trim().toLowerCase();
        const countryCode = document.getElementById('signupCountryCode')?.value?.trim() || '+961';
        const digits = this.getSignupPhoneDigits();
        const storeName = document.getElementById('signupStoreName').value.replace(/\s+/g, ' ').trim();
        const password = document.getElementById('signupPassword').value;
        const passwordConfirm = document.getElementById('signupPasswordConfirm').value;

        if (!this.isValidEmail(email)) {
            this.showMessage('Please enter a valid email address.', 'error');
            return;
        }

        if (password !== passwordConfirm) {
            this.showMessage('Confirm Password must match Password.', 'error');
            return;
        }

        const phoneE164 = `${countryCode}${digits}`;

        try {
            this.showLoading(true);

            if (!window.firebaseAuthInstance) {
                throw new Error('Firebase is not initialized. Please check Firebase configuration.');
            }

            const result = await window.firebaseAuthInstance.signUp(fullName, email, storeName, password, {
                phoneE164,
                phoneCountryCode: countryCode,
                phoneNationalNumber: digits
            });

            if (result && result.success) {
                const baseUrl = window.location.origin;
                const storeUrl = `${baseUrl}/${result.subdomain}`;
                this.pendingSignup = { email, password };
                if (window.firebaseAuthInstance) {
                    await window.firebaseAuthInstance.signOut();
                }
                this.showMessage('OTP sent successfully.', 'success');
                const storeUrlDiv = document.getElementById('verificationStoreUrl');
                const storeUrlText = document.getElementById('verificationStoreUrlText');
                if (storeUrlDiv && storeUrlText) {
                    storeUrlText.textContent = storeUrl;
                    storeUrlDiv.style.display = 'block';
                }
                this.switchMode('verification');
                this.showLoading(false);
            } else {
                throw new Error('Failed to create account');
            }
        } catch (error) {
            let errorMessage = 'Failed to send OTP. Please check your phone number.';

            if (error.code === 'auth/network-request-failed') {
                errorMessage = 'Network error. Please check your internet connection and try again.';
            } else if (error.code === 'auth/email-already-in-use') {
                errorMessage = 'This email is already registered.';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Please enter a valid email address.';
            } else if (error.code === 'auth/weak-password') {
                errorMessage = 'Password must be at least 6 characters.';
            } else if (error.code === 'subdomain-taken') {
                errorMessage = 'This store name is already taken.';
            } else if (error.code === 'phone-taken' || error.code === 'invalid-phone') {
                errorMessage = 'Failed to send OTP. Please check your phone number.';
            } else if (error.message && !/phone/i.test(error.message)) {
                errorMessage = error.message;
            }

            this.showMessage(errorMessage, 'error');
            this.showLoading(false);
        }
    }

    async handleResendCode() {
        const signedIn = window.firebaseAuthInstance && window.firebaseAuthInstance.getCurrentUser();
        if (!this.pendingSignup && !signedIn) {
            this.showMessage('Please use the signup form and click Send OTP again.', 'error');
            return;
        }
        try {
            this.showLoading(true);
            if (!signedIn) {
                await window.firebaseAuthInstance.signIn(this.pendingSignup.email, this.pendingSignup.password);
            }
            await window.firebaseAuthInstance.resendVerificationCode();
            if (!signedIn) {
                await window.firebaseAuthInstance.signOut();
            }
            this.showMessage('OTP sent successfully.', 'success');
        } catch (error) {
            this.showMessage((error && error.message) || 'Failed to send OTP. Please check your phone number.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async handleForgotPassword(e) {
        e.preventDefault();
        this.hideMessage();

        const email = document.getElementById('resetEmail').value.trim();

        if (!email) {
            this.showMessage('Please enter your email', 'error');
            return;
        }

        try {
            this.showLoading(true);
            const result = await window.firebaseAuthInstance.sendPasswordReset(email);

            if (result.success) {
                this.showMessage('Password reset link has been sent to your email', 'success');
                setTimeout(() => {
                    this.switchMode('login');
                }, 3000);
            }
        } catch (error) {
            let errorMessage = error.message || 'An error occurred while sending reset link';

            if (error.code === 'auth/network-request-failed') {
                errorMessage = 'Network error. Please check your internet connection and try again.';
            } else if (error.code === 'auth/user-not-found') {
                errorMessage = 'Email is not registered in the system.';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email address. Please check your email.';
            }

            this.showMessage(errorMessage, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    updateSubdomainPreview() {
        const storeName = document.getElementById('signupStoreName')?.value.trim();
        const preview = document.getElementById('subdomainPreview');
        const subdomainText = document.getElementById('subdomainText');

        if (storeName && preview && subdomainText && window.firebaseAuthInstance) {
            const subdomain = window.firebaseAuthInstance.generateSubdomain(storeName);
            const baseUrl = window.location.origin;
            subdomainText.textContent = `${baseUrl}/${subdomain}`;
            preview.style.display = 'flex';
        } else if (preview) {
            preview.style.display = 'none';
        }
    }

    showMessage(message, type = 'info') {
        const messageEl = document.getElementById('authMessage');
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.className = `auth-message ${type}`;
            messageEl.style.display = 'block';
        }
    }

    hideMessage() {
        const messageEl = document.getElementById('authMessage');
        if (messageEl) {
            messageEl.style.display = 'none';
        }
    }

    getSubmitButtonLabel(formId) {
        if (formId === 'loginForm') return 'Login';
        if (formId === 'signupForm') return 'Send OTP';
        if (formId === 'forgotPasswordForm') return 'Send Reset Link';
        return 'Submit';
    }

    showLoading(show) {
        const forms = document.querySelectorAll('.auth-form.active');
        forms.forEach(form => {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (!submitBtn) return;

            if (show) {
                submitBtn.disabled = true;
                submitBtn.classList.add('is-loading');
                if (form.id === 'loginForm') {
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Logging in...</span>';
                } else if (form.id === 'signupForm') {
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Sending OTP...</span>';
                } else if (form.id === 'forgotPasswordForm') {
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Sending...</span>';
                } else {
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Processing...</span>';
                }
            } else {
                submitBtn.classList.remove('is-loading');
                const label = this.getSubmitButtonLabel(form.id);
                const iconClass = form.id === 'loginForm'
                    ? 'fa-sign-in-alt'
                    : 'fa-paper-plane';
                submitBtn.innerHTML = `<i class="fas ${iconClass}" aria-hidden="true"></i><span>${label}</span>`;
                if (form.id === 'signupForm') {
                    this.validateSignupForm();
                } else {
                    submitBtn.disabled = false;
                }
            }
        });
    }
}

let authUIHandler = null;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        authUIHandler = new AuthUIHandler();
    });
} else {
    authUIHandler = new AuthUIHandler();
}
