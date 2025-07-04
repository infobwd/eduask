
const CONFIG = {
    // Google Apps Script Web App URL - ⭐ อัพเดท URL ของคุณที่นี่
    GAS_URL: 'https://script.google.com/macros/s/AKfycby-MF-sKUGvlpz1Xewtor1Ji7R91oe9a3PBvuafD1uK2MCssjhB00Md4h9A7_Zim2OM/exec',
    
    // Local storage keys
    STORAGE_KEYS: {
        ADMIN_SESSION: 'qa_admin_session',
        RATED_QUESTIONS: 'qa_rated_questions',
        USER_PREFERENCES: 'qa_user_preferences'
    },
    
    // File upload limits
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_FILE_TYPES: [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
        'application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ],
    
    // UI settings
    ITEMS_PER_PAGE: 10,
    SEARCH_DEBOUNCE: 300,
    NOTIFICATION_DURATION: 5000,
    
    // ⭐ API timeout settings
    REQUEST_TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3
};

// ===== GLOBAL VARIABLES =====
let currentQuestions = [];
let allQuestions = [];
let isAdminLoggedIn = false;
let adminInfo = null;
let currentSearchTerm = '';
let currentSearchTopic = '';

// ===== IMPROVED JSONP REQUEST FUNCTION =====

/**
 * ⭐ ปรับปรุง JSONP request ให้รองรับ response format ใหม่
 * @param {string} action - The action to perform
 * @param {Object} params - Parameters to send
 * @param {number} retries - Number of retry attempts
 * @returns {Promise} - Promise that resolves with the response
 */
function makeJSONPRequest(action, params = {}, retries = CONFIG.RETRY_ATTEMPTS) {
    return new Promise((resolve, reject) => {
        // Create unique callback name
        const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Add callback to global scope
        window[callbackName] = function(response) {
            // Clean up
            delete window[callbackName];
            if (script.parentNode) {
                document.head.removeChild(script);
            }
            
            console.log(`API Response for ${action}:`, response);
            
            // ⭐ Handle new response format
            if (response) {
                if (response.status === 'success') {
                    // Return data if available, otherwise return the whole response
                    resolve(response.data !== undefined ? response.data : response);
                } else if (response.status === 'error') {
                    reject(new Error(response.message || response.error || 'Request failed'));
                } else if (response.success !== false) {
                    // Backward compatibility for old format
                    resolve(response);
                } else {
                    reject(new Error(response.error || 'Request failed'));
                }
            } else {
                reject(new Error('No response received'));
            }
        };
        
        // Prepare URL with parameters
        const url = new URL(CONFIG.GAS_URL);
        url.searchParams.set('action', action);
        url.searchParams.set('callback', callbackName);
        
        // Add other parameters
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                const value = typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key];
                url.searchParams.set(key, value);
            }
        });
        
        console.log(`Making JSONP request: ${action}`, params);
        
        // Create script tag
        const script = document.createElement('script');
        script.src = url.toString();
        script.onerror = () => {
            delete window[callbackName];
            if (script.parentNode) {
                document.head.removeChild(script);
            }
            
            // ⭐ Retry logic
            if (retries > 0) {
                console.log(`Retrying request ${action}, ${retries} attempts left`);
                setTimeout(() => {
                    makeJSONPRequest(action, params, retries - 1)
                        .then(resolve)
                        .catch(reject);
                }, 1000 * (CONFIG.RETRY_ATTEMPTS - retries + 1)); // Exponential backoff
            } else {
                reject(new Error('Network error - all retry attempts failed'));
            }
        };
        
        // Add timeout
        const timeoutId = setTimeout(() => {
            if (window[callbackName]) {
                delete window[callbackName];
                if (script.parentNode) {
                    document.head.removeChild(script);
                }
                
                // ⭐ Retry on timeout
                if (retries > 0) {
                    console.log(`Request timeout for ${action}, retrying...`);
                    makeJSONPRequest(action, params, retries - 1)
                        .then(resolve)
                        .catch(reject);
                } else {
                    reject(new Error('Request timeout - all retry attempts failed'));
                }
            }
        }, CONFIG.REQUEST_TIMEOUT);
        
        // Clear timeout when request completes
        const originalCallback = window[callbackName];
        window[callbackName] = function(response) {
            clearTimeout(timeoutId);
            originalCallback(response);
        };
        
        document.head.appendChild(script);
    });
}

/**
 * ⭐ Test API connection
 */
async function testAPIConnection() {
    try {
        console.log('Testing API connection...');
        const response = await makeJSONPRequest('testAPI');
        console.log('API test successful:', response);
        showNotification('success', 'เชื่อมต่อกับเซิร์ฟเวอร์สำเร็จ', 2000);
        return true;
    } catch (error) {
        console.error('API test failed:', error);
        showNotification('error', `ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้: ${error.message}`);
        return false;
    }
}

/**
 * ⭐ Get system status
 */
async function getSystemStatus() {
    try {
        const status = await makeJSONPRequest('getSystemStatus');
        console.log('System status:', status);
        return status;
    } catch (error) {
        console.error('Get system status error:', error);
        return null;
    }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Show loading overlay
 * @param {string} message - Loading message
 */
function showLoading(message = "กำลังดำเนินการ...") {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    if (text) text.textContent = message;
    if (overlay) overlay.classList.add('visible');
}

/**
 * Hide loading overlay
 */
function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('visible');
}

/**
 * Show notification
 * @param {string} type - success, error, info, warning
 * @param {string} message - Message to show
 * @param {number} duration - Duration in milliseconds
 */
function showNotification(type, message, duration = CONFIG.NOTIFICATION_DURATION) {
    const notification = document.getElementById('status-notification');
    const icon = document.getElementById('status-icon');
    const messageEl = document.getElementById('status-message');

    if (!notification || !icon || !messageEl) {
        // Fallback to console and alert
        console.log(`${type.toUpperCase()}: ${message}`);
        if (type === 'error') {
            alert(`เกิดข้อผิดพลาด: ${message}`);
        }
        return;
    }

    // Reset classes
    notification.className = 'status-notification';
    
    // Add type class
    notification.classList.add(type);
    
    // Set icon based on type
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle',
        warning: 'fas fa-exclamation-triangle'
    };
    
    icon.innerHTML = `<i class="${icons[type] || icons.info}"></i>`;
    messageEl.textContent = message;
    
    // Show notification
    notification.classList.add('show');
    
    // Auto hide
    if (duration > 0) {
        setTimeout(() => {
            hideNotification();
        }, duration);
    }
}

/**
 * Hide notification
 */
function hideNotification() {
    const notification = document.getElementById('status-notification');
    if (notification) {
        notification.classList.remove('show');
    }
}

/**
 * Format date to Thai locale
 * @param {string|Date} dateStr - Date string or Date object
 * @returns {string} - Formatted date string
 */
function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    
    try {
        return date.toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
}

/**
 * Sanitize HTML to prevent XSS
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Highlight search terms in text
 * @param {string} text - Text to highlight
 * @param {string} searchTerm - Term to highlight
 * @returns {string} - Text with highlighted terms
 */
function highlightSearchTerms(text, searchTerm) {
    if (!searchTerm || !text) return sanitizeHTML(text);
    
    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    
    return sanitizeHTML(text).replace(regex, '<span class="search-highlight">$1</span>');
}

// ===== POLYFILLS =====

/**
 * Polyfill for Element.closest()
 */
if (!Element.prototype.closest) {
    Element.prototype.closest = function(s) {
        var el = this;
        do {
            if (Element.prototype.matches.call(el, s)) return el;
            el = el.parentElement || el.parentNode;
        } while (el !== null && el.nodeType === 1);
        return null;
    };
}

/**
 * Polyfill for Element.matches()
 */
if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.matchesSelector ||
        Element.prototype.mozMatchesSelector ||
        Element.prototype.msMatchesSelector ||
        Element.prototype.oMatchesSelector ||
        Element.prototype.webkitMatchesSelector ||
        function(s) {
            var matches = (this.document || this.ownerDocument).querySelectorAll(s),
                i = matches.length;
            while (--i >= 0 && matches.item(i) !== this) {}
            return i > -1;
        };
}

// ===== INITIALIZATION =====

/**
 * ⭐ Initialize the application with improved error handling
 */
async function initializeApp() {
    console.log('Initializing Q&A Application...');
    
    try {
        // Show loading
        showLoading("กำลังเริ่มต้นระบบ...");
        
        // Test API connection first
        const apiConnected = await testAPIConnection();
        if (!apiConnected) {
            throw new Error('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
        }
        
        // Set up event listeners
        setupEventListeners();
        
        // Check admin login status first
        await checkAdminLogin();
        
        // Load initial data in parallel
        const loadPromises = [
            loadTopics(),
            loadQuestions()
        ];
        
        await Promise.allSettled(loadPromises);
        
        // Setup additional functionality
        setupSearch();
        setupRating();
        setupFormValidation();
        
        // Get system status for admin
        if (isAdminLoggedIn) {
            getSystemStatus();
        }
        
        console.log('Application initialized successfully');
        showNotification('success', 'ระบบพร้อมใช้งาน', 2000);
        
    } catch (error) {
        console.error('Initialization error:', error);
        showNotification('error', `เกิดข้อผิดพลาดในการเริ่มต้นระบบ: ${error.message}`);
        
        // Try to continue with minimal functionality
        setupEventListeners();
        setupFormValidation();
        
    } finally {
        hideLoading();
    }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Anonymous checkbox toggle
    const isAnonymousCheckbox = document.getElementById('isAnonymous');
    if (isAnonymousCheckbox) {
        isAnonymousCheckbox.addEventListener('change', togglePersonalInfo);
    }

    // File upload handling
    const attachmentInput = document.getElementById('attachment');
    if (attachmentInput) {
        attachmentInput.addEventListener('change', handleFileUpload);
    }

    // Remove file button
    const removeFileBtn = document.getElementById('remove-file');
    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', removeFile);
    }

    // Form submissions
    const questionForm = document.getElementById('questionForm');
    if (questionForm) {
        questionForm.addEventListener('submit', handleQuestionSubmit);
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleAdminLogin);
    }

    const answerForm = document.getElementById('answer-form');
    if (answerForm) {
        answerForm.addEventListener('submit', handleAnswerSubmit);
    }

    const ratingForm = document.getElementById('rating-form');
    if (ratingForm) {
        ratingForm.addEventListener('submit', handleRatingSubmit);
    }

    // Modal controls
    setupModalControls();

    // Admin controls
    const openLoginBtn = document.getElementById('open-login-modal');
    if (openLoginBtn) {
        openLoginBtn.addEventListener('click', openLoginModal);
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleAdminLogout);
    }

    // Refresh and filter controls
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadQuestions();
        });
    }

    const filterStatus = document.getElementById('filter-status');
    if (filterStatus) {
        filterStatus.addEventListener('change', filterQuestions);
    }

    // Global click handler for admin buttons (event delegation)
    document.addEventListener('click', handleGlobalClicks);
    
    // ⭐ Add escape key handler for modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });
}

/**
 * ⭐ Close all modals
 */
function closeAllModals() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.classList.add('hidden');
    });
}

/**
 * Setup modal controls
 */
function setupModalControls() {
    // Login modal
    const closeLoginBtns = document.querySelectorAll('#close-login-modal, .close-login-modal');
    closeLoginBtns.forEach(btn => {
        btn.addEventListener('click', closeLoginModal);
    });

    // Answer modal
    const closeAnswerBtns = document.querySelectorAll('#close-answer-modal, .close-answer-modal');
    closeAnswerBtns.forEach(btn => {
        btn.addEventListener('click', closeAnswerModal);
    });

    // Rating modal
    const closeRatingBtns = document.querySelectorAll('#close-rating-modal, .close-rating-modal');
    closeRatingBtns.forEach(btn => {
        btn.addEventListener('click', closeRatingModal);
    });

    // Close modal on background click
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
}

/**
 * Handle global clicks (event delegation)
 */
function handleGlobalClicks(e) {
    // Check if target exists and has closest method
    if (!e.target || typeof e.target.closest !== 'function') return;
    
    const target = e.target.closest('button');
    if (!target) return;

    // Admin action buttons
    if (target.classList && target.classList.contains('answer-btn')) {
        const questionId = target.dataset.id;
        if (questionId) openAnswerModal(questionId);
    }

    if (target.classList && target.classList.contains('toggle-public-btn')) {
        const questionId = target.dataset.id;
        if (questionId) togglePublicDisplay(questionId);
    }

    if (target.classList && target.classList.contains('delete-question-btn')) {
        const questionId = target.dataset.id;
        if (questionId) deleteQuestion(questionId);
    }

    if (target.classList && target.classList.contains('rate-answer-btn')) {
        const questionId = target.dataset.id;
        if (questionId) openRatingModal(questionId);
    }
}

// ===== DATA LOADING =====

/**
 * ⭐ Load topics from server with improved error handling
 */
// ===== 🔧 แก้ไขปัญหา Admin Login =====

/**
 * ⭐ แก้ไข handleAdminLogin function (แทนที่บรรทัด 1380-1448)
 */
async function handleAdminLogin(e) {
    e.preventDefault();
    
    showLoading("กำลังเข้าสู่ระบบ...");
    
    try {
        const formData = new FormData(e.target);
        
        // ⭐ แก้ไข: ดึงข้อมูลจาก form อย่างถูกต้อง
        const adminIdInput = document.getElementById('adminId');
        const passwordInput = document.getElementById('password');
        
        let adminId, password;
        
        // ลองดึงจาก input elements ก่อน
        if (adminIdInput && passwordInput) {
            adminId = adminIdInput.value?.trim();
            password = passwordInput.value;
        } else {
            // fallback ไปใช้ FormData
            adminId = formData.get('adminId')?.trim();
            password = formData.get('password');
        }
        
        console.log('Login attempt:', { adminId: adminId ? 'present' : 'missing', password: password ? 'present' : 'missing' });
        
        if (!adminId || !password) {
            throw new Error('กรุณากรอกรหัสผู้ดูแลและรหัสผ่าน');
        }

        const loginData = {
            adminId: adminId,
            password: password
        };

        console.log('Sending login request...');
        const response = await makeJSONPRequest('adminLogin', {
            loginData: JSON.stringify(loginData)
        });

        console.log('Login response:', response);

        // ⭐ ปรับปรุง response handling
        if (response) {
            let sessionToken, adminInfo;
            
            // Handle different response formats
            if (response.success || response.status === 'success') {
                sessionToken = response.sessionToken || response.data?.sessionToken;
                adminInfo = response.adminInfo || response.data?.adminInfo;
            } else if (response.sessionToken) {
                // Direct response format
                sessionToken = response.sessionToken;
                adminInfo = response.adminInfo;
            }
            
            if (sessionToken && adminInfo) {
                // Store session data
                const sessionData = {
                    sessionToken: sessionToken,
                    adminInfo: adminInfo,
                    loginTime: new Date().toISOString()
                };
                
                localStorage.setItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION, JSON.stringify(sessionData));
                
                setAdminLoggedIn(adminInfo);
                closeLoginModal();
                
                // Reload questions with admin privileges
                await loadQuestions();
                
                if (window.Swal) {
                    Swal.fire({
                        icon: 'success',
                        title: 'เข้าสู่ระบบสำเร็จ',
                        text: `ยินดีต้อนรับ ${adminInfo.name}`,
                        confirmButtonText: 'ตกลง',
                        confirmButtonColor: '#1e40af'
                    });
                } else {
                    showNotification('success', `เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${adminInfo.name}`);
                }
            } else {
                throw new Error('ข้อมูลการเข้าสู่ระบบไม่ครบถ้วน');
            }
        } else {
            throw new Error('รหัสผู้ดูแลหรือรหัสผ่านไม่ถูกต้อง');
        }
        
    } catch (error) {
        console.error('Login error:', error);
        
        // ⭐ แยกประเภทข้อผิดพลาด
        let errorMessage = error.message;
        if (errorMessage.includes('Network') || errorMessage.includes('timeout')) {
            errorMessage = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง';
        } else if (errorMessage.includes('ไม่พบข้อมูลผู้ดูแล') || errorMessage.includes('ไม่สามารถเข้าสู่ระบบได้')) {
            errorMessage = 'รหัสผู้ดูแลหรือรหัสผ่านไม่ถูกต้อง';
        }
        
        showNotification('error', errorMessage);
        
        // ⭐ เคลียร์ form เมื่อเกิดข้อผิดพลาด
        const passwordInput = document.getElementById('password');
        if (passwordInput) passwordInput.value = '';
        
    } finally {
        hideLoading();
    }
}

// ===== 🚀 ปรับปรุงประสิทธิภาพการอ่านข้อมูล =====

/**
 * ⭐ ปรับปรุง loadQuestions ให้เร็วขึ้น (แทนที่บรรทัด 650-690)
 */
async function loadQuestions() {
    // ⭐ แสดง loading เฉพาะเมื่อจำเป็น
    const isFirstLoad = allQuestions.length === 0;
    if (isFirstLoad) {
        showLoading("กำลังโหลดคำถาม-คำตอบ...");
    }
    
    try {
        console.log('Loading questions...');
        
        // ⭐ เพิ่ม cache mechanism
        const cacheKey = `qa_cache_${isAdminLoggedIn ? 'admin' : 'public'}`;
        const cacheTime = 30000; // 30 seconds cache
        const cached = getFromCache(cacheKey, cacheTime);
        
        let questions;
        
        if (cached && !isFirstLoad) {
            console.log('Using cached questions');
            questions = cached;
        } else {
            console.log('Fetching fresh questions');
            questions = await makeJSONPRequest('getQuestions', {
                includePrivate: isAdminLoggedIn
            }, 1); // ⭐ ลด retry attempts สำหรับความเร็ว
            
            // Cache the result
            setToCache(cacheKey, questions);
        }
        
        if (Array.isArray(questions)) {
            allQuestions = questions;
            currentQuestions = allQuestions.filter(q => isAdminLoggedIn || q.publicDisplay);
            
            displayQuestions(currentQuestions);
            updateStatistics(allQuestions);
            
            console.log(`Loaded ${questions.length} questions`);
        } else {
            throw new Error('Invalid questions data format');
        }
        
    } catch (error) {
        console.error('Load questions error:', error);
        
        // ⭐ Fallback to cached data if available
        const cacheKey = `qa_cache_${isAdminLoggedIn ? 'admin' : 'public'}`;
        const fallbackCache = getFromCache(cacheKey, 300000); // 5 minutes old cache as fallback
        
        if (fallbackCache) {
            console.log('Using fallback cache');
            allQuestions = fallbackCache;
            currentQuestions = allQuestions.filter(q => isAdminLoggedIn || q.publicDisplay);
            displayQuestions(currentQuestions);
            updateStatistics(allQuestions);
            showNotification('warning', 'ใช้ข้อมูลที่เก็บไว้ เนื่องจากไม่สามารถโหลดข้อมูลใหม่ได้');
        } else {
            showNotification('error', `ไม่สามารถโหลดคำถามได้: ${error.message}`);
            showNoQuestions();
            allQuestions = [];
            currentQuestions = [];
        }
        
    } finally {
        if (isFirstLoad) {
            hideLoading();
        }
    }
}

/**
 * ⭐ ปรับปรุง loadTopics ให้เร็วขึ้น
 */
async function loadTopics() {
    try {
        console.log('Loading topics...');
        
        // ⭐ เพิ่ม cache mechanism
        const cacheKey = 'qa_topics_cache';
        const cacheTime = 300000; // 5 minutes cache for topics
        const cached = getFromCache(cacheKey, cacheTime);
        
        let topics;
        
        if (cached) {
            console.log('Using cached topics');
            topics = cached;
        } else {
            console.log('Fetching fresh topics');
            topics = await makeJSONPRequest('getTopics', {}, 1); // ⭐ ลด retry attempts
            setToCache(cacheKey, topics);
        }
        
        if (Array.isArray(topics)) {
            populateTopicSelects(topics);
            console.log(`Loaded ${topics.length} topics`);
        } else {
            throw new Error('Invalid topics data format');
        }
        
    } catch (error) {
        console.error('Load topics error:', error);
        
        // ⭐ Fallback to cached data
        const cacheKey = 'qa_topics_cache';
        const fallbackCache = getFromCache(cacheKey, 3600000); // 1 hour old cache as fallback
        
        if (fallbackCache) {
            console.log('Using fallback topics cache');
            populateTopicSelects(fallbackCache);
        } else {
            showNotification('warning', 'ไม่สามารถโหลดหมวดหมู่ได้ จะใช้ข้อมูลเริ่มต้น');
            
            // Fallback to default topics
            const defaultTopics = [
                { topicName: 'การรับนักเรียน' },
                { topicName: 'การขอเอกสาร' },
                { topicName: 'การย้ายนักเรียน' },
                { topicName: 'กิจกรรมนักเรียน' },
                { topicName: 'การเรียนการสอน' },
                { topicName: 'ทั่วไป' }
            ];
            populateTopicSelects(defaultTopics);
        }
    }
}

/**
 * Populate topic select elements
 * @param {Array} topics - Array of topic objects
 */
function populateTopicSelects(topics) {
    const questionTopicSelect = document.getElementById('questionTopic');
    const searchTopicSelect = document.getElementById('search-topic');

    if (questionTopicSelect) {
        // Clear existing options except the first one
        const firstOption = questionTopicSelect.querySelector('option[disabled]');
        questionTopicSelect.innerHTML = '';
        if (firstOption) {
            questionTopicSelect.appendChild(firstOption);
        } else {
            // Add default first option if not found
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.disabled = true;
            defaultOption.selected = true;
            defaultOption.textContent = 'เลือกหมวดหมู่';
            questionTopicSelect.appendChild(defaultOption);
        }

        topics.forEach(topic => {
            const option = document.createElement('option');
            option.value = topic.topicName;
            option.textContent = topic.topicName;
            questionTopicSelect.appendChild(option);
        });
    }

    if (searchTopicSelect) {
        // Clear existing options except the first one
        const firstOption = searchTopicSelect.querySelector('option[value=""]');
        searchTopicSelect.innerHTML = '';
        if (firstOption) {
            searchTopicSelect.appendChild(firstOption);
        } else {
            // Add default first option if not found
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'ทุกหมวดหมู่';
            searchTopicSelect.appendChild(defaultOption);
        }

        topics.forEach(topic => {
            const option = document.createElement('option');
            option.value = topic.topicName;
            option.textContent = topic.topicName;
            searchTopicSelect.appendChild(option);
        });
    }
}

/**
 * ⭐ Load questions from server with improved error handling
 */
// ===== 🔧 แก้ไขปัญหา Admin Login =====

/**
 * ⭐ แก้ไข handleAdminLogin function (แทนที่บรรทัด 1380-1448)
 */
async function handleAdminLogin(e) {
    e.preventDefault();
    
    showLoading("กำลังเข้าสู่ระบบ...");
    
    try {
        const formData = new FormData(e.target);
        
        // ⭐ แก้ไข: ดึงข้อมูลจาก form อย่างถูกต้อง
        const adminIdInput = document.getElementById('adminId');
        const passwordInput = document.getElementById('password');
        
        let adminId, password;
        
        // ลองดึงจาก input elements ก่อน
        if (adminIdInput && passwordInput) {
            adminId = adminIdInput.value?.trim();
            password = passwordInput.value;
        } else {
            // fallback ไปใช้ FormData
            adminId = formData.get('adminId')?.trim();
            password = formData.get('password');
        }
        
        console.log('Login attempt:', { adminId: adminId ? 'present' : 'missing', password: password ? 'present' : 'missing' });
        
        if (!adminId || !password) {
            throw new Error('กรุณากรอกรหัสผู้ดูแลและรหัสผ่าน');
        }

        const loginData = {
            adminId: adminId,
            password: password
        };

        console.log('Sending login request...');
        const response = await makeJSONPRequest('adminLogin', {
            loginData: JSON.stringify(loginData)
        });

        console.log('Login response:', response);

        // ⭐ ปรับปรุง response handling
        if (response) {
            let sessionToken, adminInfo;
            
            // Handle different response formats
            if (response.success || response.status === 'success') {
                sessionToken = response.sessionToken || response.data?.sessionToken;
                adminInfo = response.adminInfo || response.data?.adminInfo;
            } else if (response.sessionToken) {
                // Direct response format
                sessionToken = response.sessionToken;
                adminInfo = response.adminInfo;
            }
            
            if (sessionToken && adminInfo) {
                // Store session data
                const sessionData = {
                    sessionToken: sessionToken,
                    adminInfo: adminInfo,
                    loginTime: new Date().toISOString()
                };
                
                localStorage.setItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION, JSON.stringify(sessionData));
                
                setAdminLoggedIn(adminInfo);
                closeLoginModal();
                
                // Reload questions with admin privileges
                await loadQuestions();
                
                if (window.Swal) {
                    Swal.fire({
                        icon: 'success',
                        title: 'เข้าสู่ระบบสำเร็จ',
                        text: `ยินดีต้อนรับ ${adminInfo.name}`,
                        confirmButtonText: 'ตกลง',
                        confirmButtonColor: '#1e40af'
                    });
                } else {
                    showNotification('success', `เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${adminInfo.name}`);
                }
            } else {
                throw new Error('ข้อมูลการเข้าสู่ระบบไม่ครบถ้วน');
            }
        } else {
            throw new Error('รหัสผู้ดูแลหรือรหัสผ่านไม่ถูกต้อง');
        }
        
    } catch (error) {
        console.error('Login error:', error);
        
        // ⭐ แยกประเภทข้อผิดพลาด
        let errorMessage = error.message;
        if (errorMessage.includes('Network') || errorMessage.includes('timeout')) {
            errorMessage = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง';
        } else if (errorMessage.includes('ไม่พบข้อมูลผู้ดูแล') || errorMessage.includes('ไม่สามารถเข้าสู่ระบบได้')) {
            errorMessage = 'รหัสผู้ดูแลหรือรหัสผ่านไม่ถูกต้อง';
        }
        
        showNotification('error', errorMessage);
        
        // ⭐ เคลียร์ form เมื่อเกิดข้อผิดพลาด
        const passwordInput = document.getElementById('password');
        if (passwordInput) passwordInput.value = '';
        
    } finally {
        hideLoading();
    }
}

// ===== 🚀 ปรับปรุงประสิทธิภาพการอ่านข้อมูล =====

/**
 * ⭐ ปรับปรุง loadQuestions ให้เร็วขึ้น (แทนที่บรรทัด 650-690)
 */
async function loadQuestions() {
    // ⭐ แสดง loading เฉพาะเมื่อจำเป็น
    const isFirstLoad = allQuestions.length === 0;
    if (isFirstLoad) {
        showLoading("กำลังโหลดคำถาม-คำตอบ...");
    }
    
    try {
        console.log('Loading questions...');
        
        // ⭐ เพิ่ม cache mechanism
        const cacheKey = `qa_cache_${isAdminLoggedIn ? 'admin' : 'public'}`;
        const cacheTime = 30000; // 30 seconds cache
        const cached = getFromCache(cacheKey, cacheTime);
        
        let questions;
        
        if (cached && !isFirstLoad) {
            console.log('Using cached questions');
            questions = cached;
        } else {
            console.log('Fetching fresh questions');
            questions = await makeJSONPRequest('getQuestions', {
                includePrivate: isAdminLoggedIn
            }, 1); // ⭐ ลด retry attempts สำหรับความเร็ว
            
            // Cache the result
            setToCache(cacheKey, questions);
        }
        
        if (Array.isArray(questions)) {
            allQuestions = questions;
            currentQuestions = allQuestions.filter(q => isAdminLoggedIn || q.publicDisplay);
            
            displayQuestions(currentQuestions);
            updateStatistics(allQuestions);
            
            console.log(`Loaded ${questions.length} questions`);
        } else {
            throw new Error('Invalid questions data format');
        }
        
    } catch (error) {
        console.error('Load questions error:', error);
        
        // ⭐ Fallback to cached data if available
        const cacheKey = `qa_cache_${isAdminLoggedIn ? 'admin' : 'public'}`;
        const fallbackCache = getFromCache(cacheKey, 300000); // 5 minutes old cache as fallback
        
        if (fallbackCache) {
            console.log('Using fallback cache');
            allQuestions = fallbackCache;
            currentQuestions = allQuestions.filter(q => isAdminLoggedIn || q.publicDisplay);
            displayQuestions(currentQuestions);
            updateStatistics(allQuestions);
            showNotification('warning', 'ใช้ข้อมูลที่เก็บไว้ เนื่องจากไม่สามารถโหลดข้อมูลใหม่ได้');
        } else {
            showNotification('error', `ไม่สามารถโหลดคำถามได้: ${error.message}`);
            showNoQuestions();
            allQuestions = [];
            currentQuestions = [];
        }
        
    } finally {
        if (isFirstLoad) {
            hideLoading();
        }
    }
}

/**
 * ⭐ เพิ่ม Cache Management สำหรับความเร็ว
 */
function getFromCache(key, maxAge = 30000) {
    try {
        const cached = localStorage.getItem(`cache_${key}`);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;
        
        if (age < maxAge) {
            return data;
        } else {
            localStorage.removeItem(`cache_${key}`);
            return null;
        }
    } catch (e) {
        return null;
    }
}

function setToCache(key, data) {
    try {
        const cacheData = {
            data: data,
            timestamp: Date.now()
        };
        localStorage.setItem(`cache_${key}`, JSON.stringify(cacheData));
    } catch (e) {
        console.warn('Failed to cache data:', e);
    }
}

function clearCache(key) {
    try {
        if (key) {
            localStorage.removeItem(`cache_${key}`);
        } else {
            // Clear all cache
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('cache_')) {
                    localStorage.removeItem(k);
                }
            });
        }
    } catch (e) {
        console.warn('Failed to clear cache:', e);
    }
}

// ===== SEARCH FUNCTIONALITY =====

/**
 * Setup search functionality
 */
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    const searchTopic = document.getElementById('search-topic');
    const clearSearchBtn = document.getElementById('clear-search');

    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                performSearch();
            }, CONFIG.SEARCH_DEBOUNCE);
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });
    }

    if (searchTopic) {
        searchTopic.addEventListener('change', performSearch);
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', clearSearch);
    }
}

/**
 * Perform search
 */
function performSearch() {
    const searchInput = document.getElementById('search-input');
    const searchTopic = document.getElementById('search-topic');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const searchTopicValue = searchTopic ? searchTopic.value : '';
    
    currentSearchTerm = searchTerm;
    currentSearchTopic = searchTopicValue;

    let filteredQuestions = [...allQuestions];

    // Filter by visibility (non-admin users)
    if (!isAdminLoggedIn) {
        filteredQuestions = filteredQuestions.filter(q => q.publicDisplay);
    }

    // Filter by topic
    if (searchTopicValue) {
        filteredQuestions = filteredQuestions.filter(q => 
            q.questionTopic === searchTopicValue
        );
    }

    // Filter by search term
    if (searchTerm) {
        filteredQuestions = filteredQuestions.filter(q => 
            q.questionContent.toLowerCase().includes(searchTerm) ||
            q.answerContent.toLowerCase().includes(searchTerm) ||
            q.questionTopic.toLowerCase().includes(searchTerm) ||
            (!q.isAnonymous && q.fullName && q.fullName.toLowerCase().includes(searchTerm))
        );
    }

    // Show search results count
    const searchResults = document.getElementById('search-results');
    const searchCount = document.getElementById('search-count');
    
    if (searchResults && searchCount) {
        if (searchTerm || searchTopicValue) {
            searchCount.textContent = filteredQuestions.length;
            searchResults.classList.remove('hidden');
        } else {
            searchResults.classList.add('hidden');
        }
    }

    displayQuestions(filteredQuestions);
}

/**
 * Clear search
 */
function clearSearch() {
    const searchInput = document.getElementById('search-input');
    const searchTopic = document.getElementById('search-topic');
    const searchResults = document.getElementById('search-results');

    if (searchInput) searchInput.value = '';
    if (searchTopic) searchTopic.value = '';
    if (searchResults) searchResults.classList.add('hidden');

    currentSearchTerm = '';
    currentSearchTopic = '';

    // Filter by visibility for non-admin users
    const visibleQuestions = isAdminLoggedIn ? allQuestions : allQuestions.filter(q => q.publicDisplay);
    displayQuestions(visibleQuestions);
}

// ===== RATING SYSTEM =====

/**
 * Setup rating system
 */
function setupRating() {
    // Rating stars hover and click using event delegation
    document.addEventListener('mouseenter', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('rating-star')) {
            const rating = parseInt(e.target.dataset.rating);
            if (!isNaN(rating)) {
                highlightStars(rating);
            }
        }
    }, true);

    document.addEventListener('mouseleave', (e) => {
        if (e.target && e.target.closest && e.target.closest('#rating-stars')) {
            const ratingValue = document.getElementById('rating-value');
            const currentRating = ratingValue ? parseInt(ratingValue.value) : 0;
            highlightStars(currentRating);
        }
    }, true);

    document.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('rating-star')) {
            const rating = parseInt(e.target.dataset.rating);
            if (!isNaN(rating)) {
                const ratingValue = document.getElementById('rating-value');
                if (ratingValue) ratingValue.value = rating;
                highlightStars(rating);
                updateRatingText(rating);
            }
        }
    });
}

/**
 * Highlight rating stars
 * @param {number} rating - Rating value (1-5)
 */
function highlightStars(rating) {
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.classList.add('active');
        } else {
            star.classList.remove('active');
        }
    });
}

/**
 * Update rating text description
 * @param {number} rating - Rating value (1-5)
 */
function updateRatingText(rating) {
    const ratingText = document.getElementById('rating-text');
    if (!ratingText) return;

    const ratingTexts = {
        1: 'ไม่มีประโยชน์',
        2: 'มีประโยชน์น้อย',
        3: 'มีประโยชน์ปานกลาง',
        4: 'มีประโยชน์มาก',
        5: 'มีประโยชน์มากที่สุด'
    };

    ratingText.textContent = ratingTexts[rating] || '';
}

// ===== FORM VALIDATION =====

/**
 * Setup form validation
 */
function setupFormValidation() {
    // Simple validation for required fields
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', (e) => {
            if (!validateForm(form)) {
                e.preventDefault();
                showNotification('error', 'กรุณากรอกข้อมูลให้ครบถ้วน');
            }
        });
    });
}

/**
 * Validate form
 * @param {HTMLFormElement} form - Form to validate
 * @returns {boolean} - True if valid
 */
function validateForm(form) {
    const requiredFields = form.querySelectorAll('[required]');
    let isValid = true;

    requiredFields.forEach(field => {
        if (!field.value.trim()) {
            field.classList.add('error');
            isValid = false;
        } else {
            field.classList.remove('error');
        }
    });

    return isValid;
}

// ===== PERSONAL INFO TOGGLE =====

/**
 * Toggle personal info section based on anonymous checkbox
 */
function togglePersonalInfo() {
    const isAnonymous = document.getElementById('isAnonymous');
    const personalInfo = document.getElementById('personalInfo');
    const fullNameInput = document.getElementById('fullName');
    const emailInput = document.getElementById('email');

    if (!isAnonymous || !personalInfo) return;

    if (isAnonymous.checked) {
        personalInfo.style.display = 'none';
        if (fullNameInput) {
            fullNameInput.removeAttribute('required');
            fullNameInput.value = '';
        }
        if (emailInput) {
            emailInput.removeAttribute('required');
            emailInput.value = '';
        }
    } else {
        personalInfo.style.display = 'grid';
        if (fullNameInput) {
            fullNameInput.setAttribute('required', 'required');
        }
        if (emailInput) {
            emailInput.setAttribute('required', 'required');
        }
    }
}

// ===== FILE UPLOAD =====

/**
 * Handle file upload
 */
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) {
        hideFilePreview();
        return;
    }

    // Validate file size
    if (file.size > CONFIG.MAX_FILE_SIZE) {
        showNotification('error', 'ขนาดไฟล์เกิน 5MB กรุณาเลือกไฟล์ใหม่');
        e.target.value = '';
        hideFilePreview();
        return;
    }

    // Validate file type
    if (!CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
        showNotification('error', 'ประเภทไฟล์ไม่รองรับ กรุณาเลือกไฟล์ประเภท JPG, PNG, GIF, PDF, DOC, DOCX หรือ TXT');
        e.target.value = '';
        hideFilePreview();
        return;
    }

    showFilePreview(file);
}

/**
 * Show file preview
 * @param {File} file - Selected file
 */
function showFilePreview(file) {
    const preview = document.getElementById('file-preview');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');

    if (preview && fileName && fileSize) {
        fileName.textContent = file.name;
        fileSize.textContent = `(${(file.size / 1024).toFixed(1)} KB)`;
        preview.classList.remove('hidden');
    }
}

/**
 * Hide file preview
 */
function hideFilePreview() {
    const preview = document.getElementById('file-preview');
    if (preview) {
        preview.classList.add('hidden');
    }
}

/**
 * Remove selected file
 */
function removeFile() {
    const attachmentInput = document.getElementById('attachment');
    if (attachmentInput) {
        attachmentInput.value = '';
    }
    hideFilePreview();
}

// ===== QUESTION DISPLAY =====

/**
 * Display questions in the UI
 * @param {Array} questions - Array of question objects
 */
function displayQuestions(questions) {
    const container = document.getElementById('questions-container');
    const noQuestions = document.getElementById('no-questions');
    
    if (!container) return;

    container.innerHTML = '';

    if (!questions || questions.length === 0) {
        if (noQuestions) noQuestions.style.display = 'block';
        return;
    }

    if (noQuestions) noQuestions.style.display = 'none';

    questions.forEach(question => {
        const questionElement = createQuestionElement(question);
        container.appendChild(questionElement);
    });
}

/**
 * Create question HTML element
 * @param {Object} question - Question object
 * @returns {HTMLElement} - Question element
 */
function createQuestionElement(question) {
    const div = document.createElement('div');
    div.className = 'question-item';
    div.setAttribute('data-question-id', question.questionId); // ⭐ เพิ่ม data attribute
    
    // ⭐ แก้ไขการแสดงชื่อผู้ส่ง
    let displayName;
    if (question.isAnonymous) {
        displayName = 'ไม่ระบุชื่อ';
    } else {
        // ตรวจสอบ fullName หลายรูปแบบ
        displayName = question.fullName || question.name || question.submitterName || 'ไม่ระบุชื่อ';
        
        // ถ้าเป็นสตริงว่าง ให้แสดงเป็น ไม่ระบุชื่อ
        if (!displayName.trim()) {
            displayName = 'ไม่ระบุชื่อ';
        }
    }
    
    console.log('Question display name:', {
        questionId: question.questionId,
        isAnonymous: question.isAnonymous,
        fullName: question.fullName,
        displayName: displayName
    });
    
    const isPublic = question.publicDisplay;

    // Status badge
    let statusClass = '';
    let statusText = '';
    if (question.answerStatus === 'รอตอบ') {
        statusClass = 'status-waiting';
        statusText = 'รอตอบ';
    } else if (question.answerStatus === 'ตอบแล้ว') {
        statusClass = 'status-answered';
        statusText = 'ตอบแล้ว';
    } else {
        statusClass = 'status-rejected';
        statusText = 'ปฏิเสธ';
    }

    // Highlight search terms
    let questionContent = question.questionContent;
    let answerContent = question.answerContent;
    if (currentSearchTerm) {
        questionContent = highlightSearchTerms(questionContent, currentSearchTerm);
        answerContent = highlightSearchTerms(answerContent, currentSearchTerm);
    } else {
        questionContent = sanitizeHTML(questionContent);
        answerContent = sanitizeHTML(answerContent);
    }

    // ⭐ ปรับปรุง Admin controls - เพิ่ม data attributes
    let adminControls = '';
    if (isAdminLoggedIn) {
        adminControls = `
            <div class="admin-controls">
                ${question.answerStatus === 'รอตอบ' ? `
                    <button class="admin-btn answer-btn" data-id="${question.questionId}">
                        <i class="fas fa-reply"></i> ตอบคำถาม
                    </button>
                ` : ''}
                <button class="admin-btn toggle-public-btn ${isPublic ? '' : 'private'}" 
                        data-id="${question.questionId}"
                        data-current-status="${isPublic}">
                    <i class="fas ${isPublic ? 'fa-eye' : 'fa-eye-slash'}"></i> 
                    <span class="toggle-text">${isPublic ? 'แสดงสาธารณะ' : 'ไม่แสดงสาธารณะ'}</span>
                </button>
                <button class="admin-btn delete-question-btn" data-id="${question.questionId}">
                    <i class="fas fa-trash-alt"></i> ลบ
                </button>
            </div>
        `;
    }

    // Answer section
    let answerSection = '';
    if (question.answerStatus === 'ตอบแล้ว' && question.answerContent) {
        const ratingDisplay = question.averageRating > 0 ? `
            <div class="rating-display">
                <div class="rating-stars">
                    ${[1,2,3,4,5].map(i => `<i class="fas fa-star ${i <= Math.round(question.averageRating) ? 'text-yellow-400' : 'text-gray-300'}"></i>`).join('')}
                </div>
                <span>${question.averageRating.toFixed(1)} (${question.totalRatings} คะแนน)</span>
            </div>
        ` : '';

        // Check if user has already rated this question
        const ratedQuestions = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.RATED_QUESTIONS) || '[]');
        const hasRated = ratedQuestions.includes(question.questionId);

        answerSection = `
            <div class="answer-section">
                <div class="answer-header">
                    <div class="answer-title">
                        <i class="fas fa-reply"></i>
                        <span>คำตอบ</span>
                    </div>
                    ${!hasRated ? `
                        <button class="rate-answer-btn" data-id="${question.questionId}">
                            <i class="fas fa-star"></i> ให้คะแนน
                        </button>
                    ` : `
                        <span class="rated-badge">
                            <i class="fas fa-check"></i> ให้คะแนนแล้ว
                        </span>
                    `}
                </div>
                <div class="answer-content">${answerContent}</div>
                <div class="answer-meta">
                    <div>
                        <span><strong>ตอบโดย:</strong> ${sanitizeHTML(question.answeredBy)}</span> | 
                        <span><strong>วันที่:</strong> ${formatDate(question.answerDate)}</span>
                    </div>
                </div>
                ${ratingDisplay}
            </div>
        `;
    }

    div.innerHTML = `
        <div class="question-header">
            <div class="question-info">
                <div class="question-meta">
                    <span class="question-topic">${sanitizeHTML(question.questionTopic)}</span>
                    ${question.isAnonymous ? '<span class="anonymous-badge">ไม่ระบุชื่อ</span>' : ''}
                    ${!isPublic && isAdminLoggedIn ? '<span class="private-badge">ไม่แสดงสาธารณะ</span>' : ''}
                </div>
                <h3 class="question-title">
                    <i class="fas fa-question-circle"></i>
                    ${questionContent}
                </h3>
                <div class="question-details">
                    <span><strong>ผู้ถาม:</strong> ${sanitizeHTML(displayName)}</span> | 
                    <span><strong>รหัส:</strong> ${sanitizeHTML(question.questionId)}</span>
                    ${question.attachmentLink ? ` | <a href="${question.attachmentLink}" target="_blank" class="attachment-link"><i class="fas fa-paperclip"></i> ไฟล์แนบ</a>` : ''}
                </div>
                <div class="question-details">
                    <span><strong>วันที่ถาม:</strong> ${formatDate(question.timestamp)}</span>
                </div>
            </div>
            <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        ${answerSection}
        ${adminControls}
    `;

    return div;
}

// ===== 🚀 Real-time UI Update Functions =====

/**
 * ⭐ อัพเดท UI แบบ real-time สำหรับ toggle public display
 */
function updateQuestionDisplayStatus(questionId, newStatus) {
    // หา question element
    const questionElement = document.querySelector(`[data-question-id="${questionId}"]`);
    if (!questionElement) return;

    // หา toggle button
    const toggleBtn = questionElement.querySelector('.toggle-public-btn');
    if (!toggleBtn) return;

    // อัพเดท button
    const icon = toggleBtn.querySelector('i');
    const text = toggleBtn.querySelector('.toggle-text');
    const privateBadge = questionElement.querySelector('.private-badge');

    if (newStatus) {
        // เปลี่ยนเป็นแสดงสาธารณะ
        toggleBtn.classList.remove('private');
        toggleBtn.setAttribute('data-current-status', 'true');
        
        if (icon) {
            icon.className = 'fas fa-eye';
        }
        if (text) {
            text.textContent = 'แสดงสาธารณะ';
        }
        
        // ลบ private badge
        if (privateBadge) {
            privateBadge.remove();
        }
        
    } else {
        // เปลี่ยนเป็นไม่แสดงสาธารณะ
        toggleBtn.classList.add('private');
        toggleBtn.setAttribute('data-current-status', 'false');
        
        if (icon) {
            icon.className = 'fas fa-eye-slash';
        }
        if (text) {
            text.textContent = 'ไม่แสดงสาธารณะ';
        }
        
        // เพิ่ม private badge
        if (!privateBadge && isAdminLoggedIn) {
            const questionMeta = questionElement.querySelector('.question-meta');
            if (questionMeta) {
                const badge = document.createElement('span');
                badge.className = 'private-badge';
                badge.textContent = 'ไม่แสดงสาธารณะ';
                questionMeta.appendChild(badge);
            }
        }
    }

    // อัพเดทข้อมูลใน memory
    const questionIndex = allQuestions.findIndex(q => q.questionId === questionId);
    if (questionIndex !== -1) {
        allQuestions[questionIndex].publicDisplay = newStatus;
    }

    const currentIndex = currentQuestions.findIndex(q => q.questionId === questionId);
    if (currentIndex !== -1) {
        currentQuestions[currentIndex].publicDisplay = newStatus;
    }

    console.log(`Updated question ${questionId} display status to: ${newStatus}`);
}

/**
 * Show no questions message
 */
function showNoQuestions() {
    const container = document.getElementById('questions-container');
    const noQuestions = document.getElementById('no-questions');
    
    if (container) container.innerHTML = '';
    if (noQuestions) noQuestions.style.display = 'block';
}

/**
 * Filter questions by status
 */
function filterQuestions() {
    const filterSelect = document.getElementById('filter-status');
    if (!filterSelect) return;

    const filter = filterSelect.value;
    let filteredQuestions = [...allQuestions];

    // Filter by visibility first
    if (!isAdminLoggedIn) {
        filteredQuestions = filteredQuestions.filter(q => q.publicDisplay);
    }

    if (filter === 'answered') {
        filteredQuestions = filteredQuestions.filter(q => q.answerStatus === 'ตอบแล้ว');
    } else if (filter === 'waiting') {
        filteredQuestions = filteredQuestions.filter(q => q.answerStatus === 'รอตอบ');
    }

    displayQuestions(filteredQuestions);
}

/**
 * Update statistics (for admin)
 */
function updateStatistics(questions) {
    if (!isAdminLoggedIn) {
        const adminStats = document.getElementById('admin-stats');
        if (adminStats) adminStats.classList.add('hidden');
        return;
    }

    const adminStats = document.getElementById('admin-stats');
    if (adminStats) adminStats.classList.remove('hidden');
    
    const total = questions.length;
    const answered = questions.filter(q => q.answerStatus === 'ตอบแล้ว').length;
    const waiting = questions.filter(q => q.answerStatus === 'รอตอบ').length;
    const publicQuestions = questions.filter(q => q.publicDisplay).length;

    const totalEl = document.getElementById('total-questions');
    const answeredEl = document.getElementById('answered-questions');
    const waitingEl = document.getElementById('waiting-questions');
    const publicEl = document.getElementById('public-questions');

    if (totalEl) totalEl.textContent = total;
    if (answeredEl) answeredEl.textContent = answered;
    if (waitingEl) waitingEl.textContent = waiting;
    if (publicEl) publicEl.textContent = publicQuestions;
}

// ===== FORM SUBMISSIONS =====

/**
 * ⭐ Handle question form submission with improved error handling
 */
async function handleQuestionSubmit(e) {
    e.preventDefault();
    
    showLoading("กำลังส่งคำถาม...");

    try {
        const formData = new FormData(e.target);
        const isAnonymous = formData.get('isAnonymous') === 'on';
        
        // Validate required fields
        const questionTopic = formData.get('questionTopic');
        const questionContent = formData.get('questionContent');
        
        if (!questionTopic || !questionContent?.trim()) {
            throw new Error('กรุณากรอกหมวดหมู่และคำถาม');
        }
        
        if (!isAnonymous) {
            const fullName = formData.get('fullName');
            if (!fullName?.trim()) {
                throw new Error('กรุณากรอกชื่อ-นามสกุล');
            }
        }
        
        // Prepare question data
        const questionData = {
            questionTopic: questionTopic,
            questionContent: questionContent.trim(),
            isAnonymous: isAnonymous,
            fullName: isAnonymous ? '' : (formData.get('fullName') || '').trim(),
            email: isAnonymous ? '' : (formData.get('email') || '').trim()
        };

        // ⭐ แก้ไขการจัดการไฟล์แนบ - ลบ Glitch specific code
        const fileInput = document.getElementById('attachment');
        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            
            try {
                // ⭐ ตรวจสอบขนาดไฟล์อีกครั้ง
                if (file.size > CONFIG.MAX_FILE_SIZE) {
                    throw new Error(`ขนาดไฟล์เกิน ${(CONFIG.MAX_FILE_SIZE / (1024 * 1024)).toFixed(1)}MB`);
                }
                
                // ⭐ ตรวจสอบประเภทไฟล์
                if (!CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
                    throw new Error('ประเภทไฟล์ไม่รองรับ');
                }
                
                console.log('Processing file:', file.name, file.type, file.size);
                showLoading("กำลังประมวลผลไฟล์...");
                
                const fileData = await fileToBase64(file);
                questionData.attachment = {
                    name: file.name,
                    type: file.type,
                    base64: fileData
                };
                
                console.log('File processed successfully');
                
            } catch (fileError) {
                console.error('File processing error:', fileError);
                throw new Error(`ไม่สามารถประมวลผลไฟล์แนบได้: ${fileError.message}`);
            }
        }

        console.log('Submitting question...');
        showLoading("กำลังส่งคำถาม...");
        
        const response = await makeJSONPRequest('submitQuestion', {
            questionData: JSON.stringify(questionData)
        });

        console.log('Submit response:', response);

        // ⭐ Handle response based on new format
        if (response && (response.success || response.questionId)) {
            const questionId = response.questionId || response.data?.questionId;
            
            // ⭐ Clear form and UI
            e.target.reset();
            hideFilePreview();
            togglePersonalInfo(); // Reset personal info visibility
            
            // ⭐ Clear cache to force refresh
            clearCache('qa_cache_public');
            clearCache('qa_cache_admin');
            
            showNotification('success', `ส่งคำถามสำเร็จ หมายเลขติดตาม: ${questionId}`);
            
            // Show success dialog
            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    title: 'ส่งคำถามสำเร็จ',
                    html: `หมายเลขติดตาม: <strong>${questionId}</strong><br>คำถามของคุณจะได้รับการตอบภายใน 3-5 วันทำการ`,
                    confirmButtonText: 'ตกลง',
                    confirmButtonColor: '#1e40af'
                });
            }
            
            // ⭐ Reload questions after delay
            setTimeout(() => {
                loadQuestions();
            }, 1000);
        } else {
            throw new Error(response?.error || response?.message || 'ไม่สามารถส่งคำถามได้');
        }
        
    } catch (error) {
        console.error('Submit question error:', error);
        
        // ⭐ แยกประเภทข้อผิดพลาด
        let errorMessage = error.message;
        if (errorMessage.includes('ขนาดไฟล์เกิน')) {
            errorMessage = `ขนาดไฟล์เกิน ${(CONFIG.MAX_FILE_SIZE / (1024 * 1024)).toFixed(1)}MB กรุณาเลือกไฟล์ที่เล็กกว่า`;
        } else if (errorMessage.includes('ประเภทไฟล์ไม่รองรับ')) {
            errorMessage = 'ประเภทไฟล์ไม่รองรับ กรุณาเลือกไฟล์ประเภท JPG, PNG, PDF, DOC, DOCX หรือ TXT';
        }
        
        showNotification('error', `เกิดข้อผิดพลาด: ${errorMessage}`);
    } finally {
        hideLoading();
    }
}

/**
 * Convert file to base64
 * @param {File} file - File to convert
 * @returns {Promise<string>} - Base64 string
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        // ⭐ ตรวจสอบขนาดไฟล์ก่อน
        if (file.size > CONFIG.MAX_FILE_SIZE) {
            reject(new Error(`ขนาดไฟล์เกิน ${(CONFIG.MAX_FILE_SIZE / (1024 * 1024)).toFixed(1)}MB`));
            return;
        }
        
        const reader = new FileReader();
        
        // ⭐ เพิ่ม progress tracking สำหรับไฟล์ใหญ่
        if (file.size > 1024 * 1024) { // > 1MB
            reader.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    showLoading(`กำลังประมวลผลไฟล์... ${percentComplete.toFixed(0)}%`);
                }
            };
        }
        
        reader.onload = () => {
            try {
                const base64 = reader.result.split(',')[1]; // Remove data URL prefix
                console.log(`File converted to base64: ${base64.length} characters`);
                resolve(base64);
            } catch (error) {
                reject(new Error('ไม่สามารถแปลงไฟล์ได้'));
            }
        };
        
        reader.onerror = () => {
            reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
        };
        
        reader.readAsDataURL(file);
    });
}

// ===== ADMIN FUNCTIONALITY =====

/**
 * ⭐ Check admin login status with improved validation
 */
async function checkAdminLogin() {
    const sessionData = localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION);
    if (!sessionData) return;

    try {
        const session = JSON.parse(sessionData);
        
        // Check if session is still valid (24 hours)
        const now = new Date().getTime();
        const sessionTime = new Date(session.loginTime).getTime();
        const hoursDiff = (now - sessionTime) / (1000 * 60 * 60);
        
        if (hoursDiff < 24 && session.adminInfo) {
            // Validate session with server
            try {
                await testAPIConnection(); // Quick test
                setAdminLoggedIn(session.adminInfo);
                showNotification('info', `ยินดีต้อนรับกลับ ${session.adminInfo.name}`, 3000);
            } catch (error) {
                console.error('Session validation failed:', error);
                handleAdminLogout();
            }
        } else {
            handleAdminLogout();
        }
    } catch (e) {
        console.error('Session parsing error:', e);
        handleAdminLogout();
    }
}

/**
 * ⭐ Handle admin login with improved response handling
 */
async function handleAdminLogin(e) {
    e.preventDefault();
    
    showLoading("กำลังเข้าสู่ระบบ...");
    
    try {
        const formData = new FormData(e.target);
        
        // ⭐ แก้ไข: ดึงข้อมูลจาก form อย่างถูกต้อง
        const adminIdInput = document.getElementById('adminId');
        const passwordInput = document.getElementById('password');
        
        let adminId, password;
        
        // ลองดึงจาก input elements ก่อน
        if (adminIdInput && passwordInput) {
            adminId = adminIdInput.value?.trim();
            password = passwordInput.value;
        } else {
            // fallback ไปใช้ FormData
            adminId = formData.get('adminId')?.trim();
            password = formData.get('password');
        }
        
        console.log('Login attempt:', { adminId: adminId ? 'present' : 'missing', password: password ? 'present' : 'missing' });
        
        if (!adminId || !password) {
            throw new Error('กรุณากรอกรหัสผู้ดูแลและรหัสผ่าน');
        }

        const loginData = {
            adminId: adminId,
            password: password
        };

        console.log('Sending login request...');
        const response = await makeJSONPRequest('adminLogin', {
            loginData: JSON.stringify(loginData)
        });

        console.log('Login response:', response);

        // ⭐ ปรับปรุง response handling
        if (response) {
            let sessionToken, adminInfo;
            
            // Handle different response formats
            if (response.success || response.status === 'success') {
                sessionToken = response.sessionToken || response.data?.sessionToken;
                adminInfo = response.adminInfo || response.data?.adminInfo;
            } else if (response.sessionToken) {
                // Direct response format
                sessionToken = response.sessionToken;
                adminInfo = response.adminInfo;
            }
            
            if (sessionToken && adminInfo) {
                // Store session data
                const sessionData = {
                    sessionToken: sessionToken,
                    adminInfo: adminInfo,
                    loginTime: new Date().toISOString()
                };
                
                localStorage.setItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION, JSON.stringify(sessionData));
                
                setAdminLoggedIn(adminInfo);
                closeLoginModal();
                
                // Reload questions with admin privileges
                await loadQuestions();
                
                if (window.Swal) {
                    Swal.fire({
                        icon: 'success',
                        title: 'เข้าสู่ระบบสำเร็จ',
                        text: `ยินดีต้อนรับ ${adminInfo.name}`,
                        confirmButtonText: 'ตกลง',
                        confirmButtonColor: '#1e40af'
                    });
                } else {
                    showNotification('success', `เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${adminInfo.name}`);
                }
            } else {
                throw new Error('ข้อมูลการเข้าสู่ระบบไม่ครบถ้วน');
            }
        } else {
            throw new Error('รหัสผู้ดูแลหรือรหัสผ่านไม่ถูกต้อง');
        }
        
    } catch (error) {
        console.error('Login error:', error);
        
        // ⭐ แยกประเภทข้อผิดพลาด
        let errorMessage = error.message;
        if (errorMessage.includes('Network') || errorMessage.includes('timeout')) {
            errorMessage = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง';
        } else if (errorMessage.includes('ไม่พบข้อมูลผู้ดูแล') || errorMessage.includes('ไม่สามารถเข้าสู่ระบบได้')) {
            errorMessage = 'รหัสผู้ดูแลหรือรหัสผ่านไม่ถูกต้อง';
        }
        
        showNotification('error', errorMessage);
        
        // ⭐ เคลียร์ form เมื่อเกิดข้อผิดพลาด
        const passwordInput = document.getElementById('password');
        if (passwordInput) passwordInput.value = '';
        
    } finally {
        hideLoading();
    }
}

/**
 * Handle admin logout
 */
async function handleAdminLogout() {
    showLoading("กำลังออกจากระบบ...");
    
    try {
        // Clear session data
        localStorage.removeItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION);
        
        setAdminLoggedOut();
        
        // Reload questions without admin privileges
        await loadQuestions();
        
        showNotification('info', 'ออกจากระบบแล้ว', 3000);
        
    } catch (error) {
        console.error('Logout error:', error);
        setAdminLoggedOut();
    } finally {
        hideLoading();
    }
}

/**
 * Set admin logged in state
 * @param {Object} adminInfo - Admin information
 */
function setAdminLoggedIn(adminInfo) {
    isAdminLoggedIn = true;
    window.adminInfo = adminInfo; // Use window to avoid confusion
    
    const adminLoginButton = document.getElementById('admin-login-button');
    const adminInfoPanel = document.getElementById('admin-info-panel');
    const adminStatusBar = document.getElementById('admin-status-bar');
    const adminName = document.getElementById('admin-name');
    const adminLoginTime = document.getElementById('admin-login-time');
    
    if (adminLoginButton) adminLoginButton.classList.add('hidden');
    if (adminInfoPanel) adminInfoPanel.classList.remove('hidden');
    if (adminStatusBar) adminStatusBar.classList.remove('hidden');
    if (adminName) adminName.textContent = adminInfo.name;
    if (adminLoginTime) adminLoginTime.textContent = `เข้าสู่ระบบเมื่อ: ${new Date().toLocaleString('th-TH')}`;
    
    // Show admin-only elements
    document.body.classList.add('admin-logged-in');
    const adminOnlyElements = document.querySelectorAll('.admin-only');
    adminOnlyElements.forEach(el => el.classList.remove('hidden'));
}

/**
 * Set admin logged out state
 */
function setAdminLoggedOut() {
    isAdminLoggedIn = false;
    window.adminInfo = null;
    
    const adminLoginButton = document.getElementById('admin-login-button');
    const adminInfoPanel = document.getElementById('admin-info-panel');
    const adminStatusBar = document.getElementById('admin-status-bar');
    const adminStats = document.getElementById('admin-stats');
    
    if (adminLoginButton) adminLoginButton.classList.remove('hidden');
    if (adminInfoPanel) adminInfoPanel.classList.add('hidden');
    if (adminStatusBar) adminStatusBar.classList.add('hidden');
    if (adminStats) adminStats.classList.add('hidden');
    
    // Hide admin-only elements
    document.body.classList.remove('admin-logged-in');
    const adminOnlyElements = document.querySelectorAll('.admin-only');
    adminOnlyElements.forEach(el => el.classList.add('hidden'));
}

// ===== MODAL FUNCTIONS =====

/**
 * Open login modal
 */
function openLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
        modal.classList.remove('hidden');
        const adminIdInput = document.getElementById('adminId');
        if (adminIdInput) adminIdInput.focus();
    }
}

/**
 * Close login modal
 */
function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
        modal.classList.add('hidden');
        const form = document.getElementById('login-form');
        if (form) form.reset();
    }
}

/**
 * Open answer modal
 * @param {string} questionId - Question ID
 */
function openAnswerModal(questionId) {
    const question = allQuestions.find(q => q.questionId === questionId);
    if (!question) {
        showNotification('error', 'ไม่พบคำถามที่ระบุ');
        return;
    }

    const modal = document.getElementById('answer-modal');
    const questionDetails = document.getElementById('question-details');
    const answerQuestionId = document.getElementById('answer-question-id');

    if (answerQuestionId) answerQuestionId.value = questionId;
    
    if (questionDetails) {
        questionDetails.innerHTML = `
            <div class="form-group">
                <label class="form-label">รหัส:</label>
                <div>${sanitizeHTML(question.questionId)}</div>
            </div>
            <div class="form-group">
                <label class="form-label">หมวดหมู่:</label>
                <div>${sanitizeHTML(question.questionTopic)}</div>
            </div>
            <div class="form-group">
                <label class="form-label">ผู้ถาม:</label>
                <div>${question.isAnonymous ? 'ไม่ระบุชื่อ' : sanitizeHTML(question.fullName)}</div>
            </div>
            <div class="form-group">
                <label class="form-label">คำถาม:</label>
                <div class="question-details-content">${sanitizeHTML(question.questionContent)}</div>
            </div>
            ${question.attachmentLink ? `
                <div class="form-group">
                    <label class="form-label">ไฟล์แนบ:</label>
                    <div>
                        <a href="${question.attachmentLink}" target="_blank" class="attachment-link">
                            <i class="fas fa-paperclip"></i> ดูไฟล์
                        </a>
                    </div>
                </div>
            ` : ''}
        `;
    }
    
    if (modal) {
        modal.classList.remove('hidden');
        const answerContent = document.getElementById('answer-content');
        if (answerContent) answerContent.focus();
    }
}

/**
 * Close answer modal
 */
function closeAnswerModal() {
    const modal = document.getElementById('answer-modal');
    if (modal) {
        modal.classList.add('hidden');
        const form = document.getElementById('answer-form');
        if (form) form.reset();
    }
}

/**
 * ⭐ Handle answer submission with improved error handling
 */
async function handleAnswerSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const questionId = formData.get('answer-question-id') || document.getElementById('answer-question-id')?.value;
    const answerContent = formData.get('answer-content') || document.getElementById('answer-content')?.value;
    const publicDisplay = document.getElementById('public-display')?.checked;

    if (!questionId) {
        showNotification('error', 'ไม่พบรหัสคำถาม');
        return;
    }

    if (!answerContent?.trim()) {
        showNotification('error', 'กรุณาระบุคำตอบ');
        return;
    }

    showLoading("กำลังส่งคำตอบ...");

    try {
        const answerData = {
            questionId: questionId,
            answerContent: answerContent.trim(),
            answeredBy: (window.adminInfo && window.adminInfo.name) || 'ผู้ดูแลระบบ',
            publicDisplay: publicDisplay || false
        };

        const response = await makeJSONPRequest('answerQuestion', {
            answerData: answerData
        });

        if (response && (response.success || response.status === 'success')) {
            closeAnswerModal();
            
            // ⭐ อัพเดท UI แบบ real-time
            updateQuestionAfterAnswer(questionId, answerData);
            
            // ⭐ อัพเดทสถานะการแสดงผล
            if (publicDisplay) {
                updateQuestionDisplayStatus(questionId, true);
            }
            
            // ⭐ Clear cache
            clearCache('qa_cache_public');
            clearCache('qa_cache_admin');
            
            // ⭐ อัพเดทสถิติ
            updateStatistics(allQuestions);
            
            showNotification('success', 'ส่งคำตอบสำเร็จ');
            
            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    title: 'ส่งคำตอบสำเร็จ',
                    text: 'คำตอบได้ถูกบันทึกแล้ว',
                    confirmButtonText: 'ตกลง',
                    confirmButtonColor: '#1e40af'
                });
            }
        } else {
            throw new Error(response?.error || response?.message || 'ไม่สามารถส่งคำตอบได้');
        }
        
    } catch (error) {
        console.error('Submit answer error:', error);
        showNotification('error', `เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * ⭐ ลบ question element แบบ real-time
 */
function removeQuestionElement(questionId) {
    const questionElement = document.querySelector(`[data-question-id="${questionId}"]`);
    if (questionElement) {
        // เพิ่ม animation ก่อนลบ
        questionElement.style.transition = 'opacity 0.3s ease-out';
        questionElement.style.opacity = '0';
        
        setTimeout(() => {
            questionElement.remove();
            
            // ตรวจสอบว่ายังมีคำถามหรือไม่
            const container = document.getElementById('questions-container');
            if (container && container.children.length === 0) {
                showNoQuestions();
            }
        }, 300);
    }

    // อัพเดทข้อมูลใน memory
    allQuestions = allQuestions.filter(q => q.questionId !== questionId);
    currentQuestions = currentQuestions.filter(q => q.questionId !== questionId);
    
    console.log(`Removed question ${questionId} from UI and memory`);
}

/**
 * Open rating modal
 * @param {string} questionId - Question ID
 */
function openRatingModal(questionId) {
    const question = allQuestions.find(q => q.questionId === questionId);
    if (!question || question.answerStatus !== 'ตอบแล้ว') {
        showNotification('error', 'ไม่สามารถให้คะแนนคำถามที่ยังไม่ได้รับคำตอบ');
        return;
    }

    // Check if already rated
    const ratedQuestions = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.RATED_QUESTIONS) || '[]');
    if (ratedQuestions.includes(questionId)) {
        showNotification('info', 'คุณได้ให้คะแนนคำตอบนี้แล้ว');
        return;
    }

    const modal = document.getElementById('rating-modal');
    const ratingQuestionId = document.getElementById('rating-question-id');
    const ratingValue = document.getElementById('rating-value');
    const ratingComment = document.getElementById('rating-comment');
    const ratingText = document.getElementById('rating-text');

    if (ratingQuestionId) ratingQuestionId.value = questionId;
    if (ratingValue) ratingValue.value = '';
    if (ratingComment) ratingComment.value = '';
    if (ratingText) ratingText.textContent = '';
    
    // Reset stars
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach(star => star.classList.remove('active'));
    
    if (modal) modal.classList.remove('hidden');
}

/**
 * Close rating modal
 */
function closeRatingModal() {
    const modal = document.getElementById('rating-modal');
    if (modal) {
        modal.classList.add('hidden');
        const form = document.getElementById('rating-form');
        if (form) form.reset();
        
        // Reset stars
        const stars = document.querySelectorAll('.rating-star');
        stars.forEach(star => star.classList.remove('active'));
        
        // Reset rating text
        const ratingText = document.getElementById('rating-text');
        if (ratingText) ratingText.textContent = '';
    }
}

/**
 * ⭐ Handle rating submission with improved error handling
 */
async function handleRatingSubmit(e) {
    e.preventDefault();
    
    const questionId = document.getElementById('rating-question-id')?.value;
    const rating = parseInt(document.getElementById('rating-value')?.value);
    const comment = document.getElementById('rating-comment')?.value;

    if (!questionId) {
        showNotification('error', 'ไม่พบรหัสคำถาม');
        return;
    }

    if (!rating || rating < 1 || rating > 5) {
        showNotification('error', 'กรุณาให้คะแนน 1-5 ดาว');
        return;
    }

    showLoading("กำลังบันทึกคะแนน...");

    try {
        const ratingData = {
            questionId: questionId,
            rating: rating,
            comment: comment?.trim() || ''
        };

        const response = await makeJSONPRequest('submitRating', {
            ratingData: ratingData
        });

        if (response && (response.success || response.status === 'success')) {
            // Store rated question locally
            const ratedQuestions = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.RATED_QUESTIONS) || '[]');
            if (!ratedQuestions.includes(questionId)) {
                ratedQuestions.push(questionId);
                localStorage.setItem(CONFIG.STORAGE_KEYS.RATED_QUESTIONS, JSON.stringify(ratedQuestions));
            }
            
            closeRatingModal();
            await loadQuestions(); // Reload to show updated rating
            showNotification('success', 'ขอบคุณสำหรับการให้คะแนน');
            
            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    title: 'ส่งคะแนนสำเร็จ',
                    text: 'ขอบคุณที่ให้คะแนนและความคิดเห็น',
                    confirmButtonText: 'ตกลง',
                    confirmButtonColor: '#1e40af'
                });
            }
        } else {
            throw new Error(response?.error || response?.message || 'ไม่สามารถบันทึกคะแนนได้');
        }
        
    } catch (error) {
        console.error('Submit rating error:', error);
        showNotification('error', `เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// ===== ADMIN ACTIONS =====

/**
 * ⭐ Toggle public display status with improved error handling
 * @param {string} questionId - Question ID
 */
async function togglePublicDisplay(questionId) {
    if (!isAdminLoggedIn) {
        showNotification('error', 'ต้องเข้าสู่ระบบผู้ดูแลก่อน');
        return;
    }

    // ⭐ หาสถานะปัจจุบัน
    const toggleBtn = document.querySelector(`[data-id="${questionId}"].toggle-public-btn`);
    const currentStatus = toggleBtn ? toggleBtn.getAttribute('data-current-status') === 'true' : false;
    const newStatus = !currentStatus;

    // ⭐ อัพเดท UI ทันที (Optimistic Update)
    updateQuestionDisplayStatus(questionId, newStatus);

    try {
        showLoading("กำลังอัพเดทสถานะ...");
        
        const response = await makeJSONPRequest('togglePublicDisplay', {
            questionId: questionId
        });

        if (response && (response.success || response.status === 'success')) {
            showNotification('success', `${newStatus ? 'แสดงสาธารณะ' : 'ซ่อนจากสาธารณะ'}แล้ว`, 2000);
            
            // ⭐ Clear cache เพื่อให้ข้อมูลอัพเดท
            clearCache('qa_cache_public');
            clearCache('qa_cache_admin');
            
            // ⭐ อัพเดทสถิติ
            updateStatistics(allQuestions);
            
        } else {
            // ⭐ หากผิดพลาด ให้ revert การเปลี่ยนแปลง
            updateQuestionDisplayStatus(questionId, currentStatus);
            throw new Error(response?.error || response?.message || 'ไม่สามารถอัพเดทสถานะได้');
        }
        
    } catch (error) {
        console.error('Toggle public display error:', error);
        
        // ⭐ Revert การเปลี่ยนแปลง UI
        updateQuestionDisplayStatus(questionId, currentStatus);
        
        showNotification('error', `เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * ⭐ อัพเดท question element หลังจากตอบคำถาม
 */
function updateQuestionAfterAnswer(questionId, answerData) {
    const questionElement = document.querySelector(`[data-question-id="${questionId}"]`);
    if (!questionElement) return;

    // อัพเดทสถานะเป็น "ตอบแล้ว"
    const statusBadge = questionElement.querySelector('.status-badge');
    if (statusBadge) {
        statusBadge.className = 'status-badge status-answered';
        statusBadge.textContent = 'ตอบแล้ว';
    }

    // ลบปุ่ม "ตอบคำถาม"
    const answerBtn = questionElement.querySelector('.answer-btn');
    if (answerBtn) {
        answerBtn.remove();
    }

    // เพิ่ม answer section
    const questionHeader = questionElement.querySelector('.question-header');
    if (questionHeader && !questionElement.querySelector('.answer-section')) {
        const answerSection = document.createElement('div');
        answerSection.className = 'answer-section';
        answerSection.innerHTML = `
            <div class="answer-header">
                <div class="answer-title">
                    <i class="fas fa-reply"></i>
                    <span>คำตอบ</span>
                </div>
                <button class="rate-answer-btn" data-id="${questionId}">
                    <i class="fas fa-star"></i> ให้คะแนน
                </button>
            </div>
            <div class="answer-content">${sanitizeHTML(answerData.answerContent)}</div>
            <div class="answer-meta">
                <div>
                    <span><strong>ตอบโดย:</strong> ${sanitizeHTML(answerData.answeredBy)}</span> | 
                    <span><strong>วันที่:</strong> ${formatDate(new Date().toISOString())}</span>
                </div>
            </div>
        `;
        questionHeader.insertAdjacentElement('afterend', answerSection);
    }

    // อัพเดทข้อมูลใน memory
    const questionIndex = allQuestions.findIndex(q => q.questionId === questionId);
    if (questionIndex !== -1) {
        allQuestions[questionIndex].answerStatus = 'ตอบแล้ว';
        allQuestions[questionIndex].answerContent = answerData.answerContent;
        allQuestions[questionIndex].answeredBy = answerData.answeredBy;
        allQuestions[questionIndex].answerDate = new Date().toISOString();
    }

    console.log(`Updated question ${questionId} after answer`);
}

/**
 * ⭐ Delete question with improved confirmation and error handling
 * @param {string} questionId - Question ID
 */
async function deleteQuestion(questionId) {
    if (!isAdminLoggedIn) {
        showNotification('error', 'ต้องเข้าสู่ระบบผู้ดูแลก่อน');
        return;
    }

    const question = allQuestions.find(q => q.questionId === questionId);
    const questionPreview = question ? 
        question.questionContent.substring(0, 50) + (question.questionContent.length > 50 ? '...' : '') : 
        questionId;

    const confirmed = window.Swal ? 
        await Swal.fire({
            title: 'ยืนยันการลบ',
            html: `คุณต้องการลบคำถามนี้ใช่หรือไม่?<br><br><strong>"${questionPreview}"</strong><br><br><small class="text-red-600">⚠️ การลบจะรวมไฟล์แนบและคะแนนที่เกี่ยวข้องด้วย</small>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'ลบ',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            focusCancel: true
        }).then(result => result.isConfirmed) :
        confirm(`คุณต้องการลบคำถาม "${questionPreview}" ใช่หรือไม่?\n\n⚠️ การลบจะรวมไฟล์แนบและคะแนนที่เกี่ยวข้องด้วย`);

    if (!confirmed) return;

    showLoading("กำลังลบคำถาม...");
    
    try {
        const response = await makeJSONPRequest('deleteQuestion', {
            questionId: questionId
        });

        if (response && (response.success || response.status === 'success')) {
            // ⭐ ลบ element แบบ real-time
            removeQuestionElement(questionId);
            
            // ⭐ Clear cache
            clearCache('qa_cache_public');
            clearCache('qa_cache_admin');
            
            // ⭐ อัพเดทสถิติ
            updateStatistics(allQuestions);
            
            showNotification('success', 'ลบคำถามสำเร็จ');
            
            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    title: 'ลบคำถามสำเร็จ',
                    text: 'ลบคำถาม ไฟล์แนบ และคะแนนที่เกี่ยวข้องแล้ว',
                    confirmButtonText: 'ตกลง',
                    confirmButtonColor: '#1e40af'
                });
            }
        } else {
            throw new Error(response?.error || response?.message || 'ไม่สามารถลบคำถามได้');
        }
        
    } catch (error) {
        console.error('Delete question error:', error);
        showNotification('error', `เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// ===== ADDITIONAL UTILITY FUNCTIONS =====

/**
 * ⭐ Refresh data manually
 */
async function refreshData() {
    showLoading("กำลังรีเฟรชข้อมูล...");
    
    try {
        // ⭐ Clear cache ก่อน
        clearCache();
        
        // ⭐ Load data in parallel
        await Promise.all([
            loadTopics(),
            loadQuestions()
        ]);
        
        showNotification('success', 'รีเฟรชข้อมูลสำเร็จ', 2000);
        
    } catch (error) {
        console.error('Refresh data error:', error);
        showNotification('error', `ไม่สามารถรีเฟรชข้อมูลได้: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * ⭐ เพิ่ม debug function สำหรับ troubleshooting
 */
function debugAdminLogin() {
    console.log('=== Admin Login Debug ===');
    
    const adminIdInput = document.getElementById('adminId');
    const passwordInput = document.getElementById('password');
    const loginForm = document.getElementById('login-form');
    
    console.log('Admin ID Input:', adminIdInput ? adminIdInput.value : 'NOT FOUND');
    console.log('Password Input:', passwordInput ? (passwordInput.value ? 'HAS VALUE' : 'EMPTY') : 'NOT FOUND');
    console.log('Login Form:', loginForm ? 'FOUND' : 'NOT FOUND');
    console.log('Session Data:', localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION));
    console.log('Admin Logged In:', isAdminLoggedIn);
    console.log('==========================');
}

// ⭐ Export เพิ่มเติม
window.QASystem = {
    ...window.QASystem,
    // Cache functions
    getFromCache,
    setToCache,
    clearCache,
    // Debug functions
    debugAdminLogin,
    // Refresh function
    refreshData
};

/**
 * ⭐ Check if user has rated a question
 * @param {string} questionId - Question ID
 * @returns {boolean} - True if already rated
 */
function hasUserRatedQuestion(questionId) {
    const ratedQuestions = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.RATED_QUESTIONS) || '[]');
    return ratedQuestions.includes(questionId);
}

/**
 * ⭐ Get user preferences
 * @returns {Object} - User preferences
 */
function getUserPreferences() {
    try {
        const prefs = localStorage.getItem(CONFIG.STORAGE_KEYS.USER_PREFERENCES);
        return prefs ? JSON.parse(prefs) : {};
    } catch (e) {
        return {};
    }
}

/**
 * ⭐ Save user preferences
 * @param {Object} preferences - Preferences to save
 */
function saveUserPreferences(preferences) {
    try {
        const current = getUserPreferences();
        const updated = { ...current, ...preferences };
        localStorage.setItem(CONFIG.STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(updated));
    } catch (e) {
        console.error('Failed to save user preferences:', e);
    }
}

/**
 * ⭐ Handle network errors gracefully
 * @param {Error} error - Error object
 * @returns {string} - User-friendly error message
 */
function getNetworkErrorMessage(error) {
    if (error.message.includes('timeout')) {
        return 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง';
    } else if (error.message.includes('Network error')) {
        return 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต';
    } else if (error.message.includes('retry attempts failed')) {
        return 'ไม่สามารถเชื่อมต่อได้หลังจากพยายามหลายครั้ง กรุณาลองใหม่ภายหลัง';
    }
    return error.message;
}

/**
 * ⭐ Debug function for troubleshooting
 */
function debugInfo() {
    console.log('=== Q&A System Debug Info ===');
    console.log('Config:', CONFIG);
    console.log('Admin logged in:', isAdminLoggedIn);
    console.log('Admin info:', window.adminInfo);
    console.log('All questions count:', allQuestions.length);
    console.log('Current questions count:', currentQuestions.length);
    console.log('Search term:', currentSearchTerm);
    console.log('Search topic:', currentSearchTopic);
    console.log('Rated questions:', JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.RATED_QUESTIONS) || '[]'));
    console.log('===============================');
}

// ===== ERROR HANDLING FOR UNEXPECTED ERRORS =====

/**
 * ⭐ Global error handler
 */
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    
    // Don't show notification for script loading errors
    if (event.filename && event.filename.includes('script')) {
        return;
    }
    
    showNotification('error', 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณารีเฟรชหน้าเว็บ');
});

/**
 * ⭐ Global unhandled promise rejection handler
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    
    // Don't show notification for network errors (already handled)
    if (event.reason && event.reason.message && 
        (event.reason.message.includes('Network') || event.reason.message.includes('timeout'))) {
        return;
    }
    
    showNotification('warning', 'เกิดข้อผิดพลาดในการประมวลผล', 3000);
});


// ===== 🎨 CSS Styles for Better UI =====

/**
 * ⭐ เพิ่ม CSS styles สำหรับ UI improvements
 */
function addCustomStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* Private badge styling */
        .private-badge {
            background-color: #ef4444;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.75rem;
            margin-left: 8px;
        }
        
        /* Toggle button states */
        .toggle-public-btn.private {
            background-color: #ef4444;
            border-color: #dc2626;
        }
        
        .toggle-public-btn.private:hover {
            background-color: #dc2626;
        }
        
        /* Smooth transitions */
        .question-item {
            transition: opacity 0.3s ease-out;
        }
        
        .admin-btn {
            transition: all 0.2s ease;
        }
        
        /* Loading states */
        .admin-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        /* Better spacing for badges */
        .question-meta span {
            margin-right: 8px;
        }
        
        .question-meta span:last-child {
            margin-right: 0;
        }
    `;
    document.head.appendChild(style);
}

// ===== 🚀 Initialize Custom Styles =====

/**
 * ⭐ เรียกใช้เมื่อ DOM โหลดเสร็จ
 */
document.addEventListener('DOMContentLoaded', () => {
    addCustomStyles();
});

// ⭐ เพิ่มฟังก์ชันใน QASystem object
window.QASystem = {
    ...window.QASystem,
    // UI Update functions
    updateQuestionDisplayStatus,
    updateQuestionAfterAnswer,
    removeQuestionElement,
    addCustomStyles
};
// ===== INITIALIZATION =====

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM is already ready
    initializeApp();
}

// ⭐ Export functions for global access and debugging
window.QASystem = {
    // Core functions
    testAPIConnection,
    getSystemStatus,
    refreshData,
    
    // Admin functions
    checkAdminLogin,
    handleAdminLogout,
    
    // Utility functions
    showNotification,
    hideNotification,
    debugInfo,
    
    // Data functions
    loadQuestions,
    loadTopics,
    
    // Modal functions
    openLoginModal,
    closeLoginModal,
    closeAllModals,
    
    // Admin actions
    togglePublicDisplay,
    deleteQuestion,
    
    // Config access
    config: CONFIG
};

// Make hideNotification available globally (for backward compatibility)
window.hideNotification = hideNotification;
