"""
Windsurf registration script using DrissionPage
DrissionPage uses Windows API instead of CDP to control browser, bypassing Cloudflare detection
"""

import sys
import os
import time
import random
import string
import requests
import json
import threading
import signal
import subprocess
import uuid
import ctypes
from ctypes import wintypes
from DrissionPage import ChromiumPage, ChromiumOptions

# Windows API for focus management
user32 = ctypes.windll.user32
GetForegroundWindow = user32.GetForegroundWindow
SetForegroundWindow = user32.SetForegroundWindow

# API base URL
API_BASE = "http://localhost:3001"

# Check for headless mode argument
HEADLESS = '--headless' in sys.argv


def get_api_key_from_browser(page, email):
    """
    Get Firebase ID token from IndexedDB (firebaseLocalStorageDb).
    Browser must be already logged in (page should be at /download after registration).
    Returns: (api_key, name) or (None, error_message)
    """
    import re
    try:
        print("Getting Firebase ID token from IndexedDB...", flush=True)
        
        # Wait a moment for IndexedDB to be written
        time.sleep(2)
        
        # Extract Firebase ID token from IndexedDB with retry
        # Use a simpler synchronous approach - store result in window and retrieve
        js_setup = """
        // Store result in window for retrieval
        window.__tokenResult = null;

        (function() {
            try {
                var request = indexedDB.open('firebaseLocalStorageDb');
                request.onerror = function() {
                    window.__tokenResult = { error: 'Failed to open DB' };
                };
                request.onsuccess = function(event) {
                    var db = event.target.result;
                    try {
                        var transaction = db.transaction('firebaseLocalStorage', 'readonly');
                        var store = transaction.objectStore('firebaseLocalStorage');
                        var getAllRequest = store.getAll();
                        getAllRequest.onerror = function() {
                            window.__tokenResult = { error: 'Failed to read store' };
                            db.close();
                        };
                        getAllRequest.onsuccess = function(e) {
                            var data = e.target.result;
                            db.close();
                            if (data && data.length > 0) {
                                for (var i = 0; i < data.length; i++) {
                                    var item = data[i];
                                    if (item && item.value && item.value.stsTokenManager) {
                                        var token = item.value.stsTokenManager.accessToken;
                                        var email = item.value.email;
                                        if (token) {
                                            window.__tokenResult = { token: token, email: email };
                                            return;
                                        }
                                    }
                                }
                                window.__tokenResult = { error: 'No token in data', dataLen: data.length };
                            } else {
                                window.__tokenResult = { error: 'No data', dataLen: data ? data.length : 0 };
                            }
                        };
                    } catch(e) {
                        window.__tokenResult = { error: e.toString() };
                        db.close();
                    }
                };
            } catch(e) {
                window.__tokenResult = { error: e.toString() };
            }
        })();
        """

        js_get_result = "return window.__tokenResult;"
        
        # Retry logic - Firebase may take time to write to IndexedDB
        max_retries = 5
        for attempt in range(max_retries):
            print(f"Attempt {attempt + 1}/{max_retries}...", flush=True)
            
            # Execute the async setup
            page.run_js(js_setup)

            # Wait for the async operation to complete
            time.sleep(1)

            # Retrieve the result
            result = page.run_js(js_get_result)
            
            # Debug output
            if result:
                print(f"JS result: {result}", flush=True)
            
            if result and result.get('token'):
                id_token = result['token']
                print(f"Got Firebase ID token, length: {len(id_token)}", flush=True)
                print(f"Email: {result.get('email')}", flush=True)
                
                # Store Firebase id_token directly (will be used with windsurf.loginWithAuthToken)
                name = result.get('email', email).split("@")[0]
                print(f"Returning id_token as api_key, name: {name}", flush=True)
                return id_token, name
            
            if attempt < max_retries - 1:
                print("Token not found, waiting 2s and retrying...", flush=True)
                time.sleep(2)
        
        print("Failed to extract Firebase ID token from IndexedDB after all retries", flush=True)
        return None, "No Firebase token found"
            
    except Exception as e:
        print(f"Error getting api_key: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return None, str(e)


def exchange_token_for_api_key(id_token):
    """
    Exchange Firebase ID token for Codeium API key.
    Returns: (api_key, name) or (None, None)
    """
    try:
        import urllib.request
        import json
        
        url = "https://api.codeium.com/register_user/"
        data = json.dumps({"firebase_id_token": id_token}).encode('utf-8')
        
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method='POST'
        )
        
        print(f"Calling register_user API...", flush=True)
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            print(f"API response: {str(result)[:200]}", flush=True)
            
            if result.get('api_key'):
                return result['api_key'], result.get('name', 'user')
            else:
                print(f"API error: {result.get('error', result)}", flush=True)
                return None, None
                
    except Exception as e:
        print(f"Error exchanging token: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return None, None

# Global timeout (total time for entire registration)
GLOBAL_TIMEOUT = 180  # seconds (3 minutes total)
STEP_TIMEOUT = 30  # seconds per step
current_step = "initializing"
page = None
timeout_timer = None
timed_out = False
step_start_time = None

# Unique ID for this registration instance
INSTANCE_ID = str(uuid.uuid4())[:8]
CHROME_PID = None

def cleanup():
    """Clean up resources - close browser"""
    global page, CHROME_PID
    if page:
        try:
            page.quit()
            print("Browser closed (cleanup)", flush=True)
        except:
            pass
    # Kill Chrome by PID if we have it
    if CHROME_PID:
        try:
            subprocess.run(['taskkill', '/F', '/PID', str(CHROME_PID)], capture_output=True, timeout=5)
            print(f"Killed Chrome PID: {CHROME_PID}", flush=True)
        except:
            pass

def signal_handler(signum, frame):
    """Handle termination signal - close browser and exit"""
    print(f"Received signal {signum}, cleaning up...", flush=True)
    cleanup()
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

def timeout_handler():
    """Handle timeout - kill browser and exit"""
    global page, current_step, timed_out
    timed_out = True
    error_msg = f"Timeout at step: {current_step}"
    print(f"TIMEOUT: {error_msg}", flush=True)
    cleanup()
    # Force exit
    os._exit(1)

def set_timeout():
    """Set up global timeout using threading.Timer"""
    global timeout_timer
    timeout_timer = threading.Timer(GLOBAL_TIMEOUT, timeout_handler)
    timeout_timer.daemon = True
    timeout_timer.start()

def cancel_timeout():
    """Cancel the timeout"""
    global timeout_timer
    if timeout_timer:
        timeout_timer.cancel()
        timeout_timer = None

def close_browser():
    """Close browser safely"""
    global page
    if page:
        try:
            page.quit()
            print("Browser closed", flush=True)
        except Exception as e:
            print(f"Failed to close browser: {e}", flush=True)
        page = None

def start_step(step_name):
    """Start a new step and record start time"""
    global current_step, step_start_time
    current_step = step_name
    step_start_time = time.time()
    print(f"STEP START: {step_name}", flush=True)

def check_step_timeout():
    """Check if current step has exceeded STEP_TIMEOUT"""
    global step_start_time, current_step, timed_out
    if step_start_time is None:
        return False
    elapsed = time.time() - step_start_time
    if elapsed > STEP_TIMEOUT:
        timed_out = True
        error_msg = f"Timeout at step: {current_step}"
        print(f"TIMEOUT: {error_msg} (elapsed: {elapsed:.1f}s)", flush=True)
        return True
    return False

def wait_for_element(page, selector, timeout=5):
    """Wait for element using DrissionPage built-in wait"""
    try:
        # Use DrissionPage's built-in wait.ele_displayed() for faster detection
        page.wait.ele_displayed(selector, timeout=timeout)
        return page.ele(selector)
    except:
        return None

def wait_for_url_change(page, timeout=10):
    """Wait for URL to change using built-in wait"""
    try:
        page.wait.url_change(page.url, timeout=timeout)
        return True
    except:
        return False

def wait_and_click_button(page, timeout=10):
    """Wait for button to be enabled and click it"""
    for _ in range(int(timeout * 10)):
        btn = page.ele('text:Continue') or page.ele('css:button.bg-sk-aqua')
        if btn:
            disabled = btn.attr('disabled')
            if disabled is None or disabled == '' or disabled == 'false':
                btn.click()
                return True
        time.sleep(0.1)
    return False

def human_type(element, text):
    """Type text with human-like delays"""
    for char in text:
        element.input(char, clear=False)
        time.sleep(random.uniform(0.05, 0.15))

def generate_password():
    """Generate password meeting requirements: 8-64 chars, letters and numbers"""
    random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"Wind{random_str}123"

def create_temp_email(max_retries=3):
    """Create temporary email using mail.tm API"""
    for attempt in range(max_retries):
        try:
            # Get domains
            response = requests.get("https://api.mail.tm/domains", timeout=10)
            domains = response.json().get("hydra:member", [])
            if not domains:
                raise Exception("No domains available")
            
            domain = domains[0]["domain"]
            
            # Create account
            local_part = ''.join(random.choices(string.ascii_lowercase, k=10))
            email = f"{local_part}@{domain}"
            password = "TempPass123!"
            
            response = requests.post("https://api.mail.tm/accounts", json={
                "address": email,
                "password": password
            }, timeout=10)
            
            if response.status_code != 201:
                raise Exception(f"Failed to create email: {response.text}")
            
            # Get token
            token_response = requests.post("https://api.mail.tm/token", json={
                "address": email,
                "password": password
            }, timeout=10)
            token = token_response.json().get("token")
            
            return email, password, token
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"Email creation attempt {attempt + 1} failed, retrying...", flush=True)
                time.sleep(1 * (attempt + 1))  # Exponential backoff
            else:
                raise e

def get_verification_code(email_token, timeout=30):
    """Get verification code from email with timeout"""
    headers = {"Authorization": f"Bearer {email_token}"}
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        response = requests.get("https://api.mail.tm/messages", headers=headers)
        messages = response.json().get("hydra:member", [])
        
        for msg in messages:
            if "windsurf" in msg.get("subject", "").lower() or "verification" in msg.get("subject", "").lower():
                # Get full message
                msg_id = msg["id"]
                msg_response = requests.get(f"https://api.mail.tm/messages/{msg_id}", headers=headers)
                msg_data = msg_response.json()
                
                # Extract code from text or html
                text = msg_data.get("text", "") or ""
                html_content = msg_data.get("html", "")
                # html might be a list or string
                if isinstance(html_content, list):
                    html_content = " ".join(html_content)
                elif not html_content:
                    html_content = ""
                combined_text = text + " " + html_content
                
                # Find 6-digit code
                import re
                codes = re.findall(r'\b(\d{6})\b', combined_text)
                if codes:
                    return codes[0]
        
        time.sleep(2)  # Check every 2 seconds
    
    return None

def register_windsurf():
    """Main registration function with global timeout and step tracking"""
    global page, current_step
    
    print("Starting Windsurf registration with DrissionPage...", flush=True)
    set_timeout()
    
    # Configure browser options with unique user data dir
    co = ChromiumOptions()
    
    # Use unique user data directory to identify this instance
    user_data_dir = os.path.join(os.environ.get('TEMP', '/tmp'), f'windsurf_reg_{INSTANCE_ID}')
    co.set_argument(f'--user-data-dir={user_data_dir}')
    co.set_argument('--incognito')
    co.auto_port()  # Auto assign debug port to avoid conflicts in parallel
    
    if HEADLESS:
        print("Note: Headless mode may not work with Cloudflare verification", flush=True)
        co.headless(True)
    # Normal window mode for Cloudflare to work
    
    # Create browser page
    current_step = "creating_browser"
    
    # Save current foreground window (user's active window)
    saved_hwnd = GetForegroundWindow()
    
    page = ChromiumPage(co)
    
    # Set small window at corner (don't disturb user, but keep visible for Cloudflare)
    try:
        page.set.window.size(600, 400)
        # Move to bottom-right corner (use large coords, will clamp to screen)
        page.set.window.location(9999, 9999)
        print("Window set to corner (600x400)", flush=True)
    except Exception as e:
        print(f"Could not set window: {e}", flush=True)
    
    # Restore focus to user's original window immediately
    try:
        if saved_hwnd:
            SetForegroundWindow(saved_hwnd)
            print("Focus restored to original window", flush=True)
    except:
        pass
    
    # Get Chrome PID - DrissionPage stores it in page.process_id or we find it
    global CHROME_PID
    try:
        # Try to get PID from DrissionPage
        if hasattr(page, 'process_id'):
            CHROME_PID = page.process_id
        else:
            # Find Chrome process with our user data dir
            result = subprocess.run(['wmic', 'process', 'where', f'name="chrome.exe"', 'get', 'processid,commandline'], 
                          capture_output=True, text=True, timeout=5)
            for line in result.stdout.split('\n'):
                if 'windsurf_reg' in line and 'chrome.exe' in line:
                    parts = line.strip().split()
                    for part in reversed(parts):
                        if part.isdigit():
                            CHROME_PID = int(part)
                            break
                    if CHROME_PID:
                        break
        
        if CHROME_PID:
            print(f"Chrome PID: {CHROME_PID}", flush=True)
            # Save PID to temp file for backend to read
            pid_file = os.path.join(os.environ.get('TEMP', '/tmp'), f'windsurf_reg_{INSTANCE_ID}.pid')
            with open(pid_file, 'w') as f:
                f.write(str(CHROME_PID))
    except Exception as e:
        print(f"Could not get Chrome PID: {e}", flush=True)
    
    try:
        # Step 1: Create temporary email
        start_step("creating_email")
        print("Creating temporary email...", flush=True)
        email, email_password, email_token = create_temp_email()
        print(f"Email created: {email}", flush=True)
        
        # Step 2: Navigate to registration page
        start_step("opening_page")
        print("Opening Windsurf registration page...", flush=True)
        page.get("https://windsurf.com/account/register")
        
        # Wait for form to load (fast detection) - use flexible selectors
        start_step("waiting_for_form")
        # Try multiple selectors for first name input
        first_name_input = (
            wait_for_element(page, 'css:input[autocomplete="given-name"]', timeout=5) or
            wait_for_element(page, 'css:input[placeholder*="first name"]', timeout=1) or
            wait_for_element(page, 'css:input[placeholder*="First name"]', timeout=1) or
            wait_for_element(page, 'css:input#firstName', timeout=1)
        )
        if not first_name_input:
            raise Exception("Form not loaded - firstName input not found (tried multiple selectors)")

        # Step 3: Fill registration form
        start_step("filling_form")
        print("Filling registration form...", flush=True)

        # First name
        if first_name_input:
            first_name_input.click()
            first_name_input.input("User", clear=True)
            print("Filled first name", flush=True)


        # Last name - try multiple selectors
        last_name = "Test" + ''.join(random.choices(string.ascii_lowercase, k=2))
        last_name_input = (
            page.ele('css:input[autocomplete="family-name"]') or
            page.ele('css:input[placeholder*="last name"]') or
            page.ele('css:input[placeholder*="Last name"]') or
            page.ele('css:input#lastName') or
            page.ele('css:input[name="lastName"]')
        )
        if last_name_input:
            last_name_input.click()
            last_name_input.input(last_name, clear=True)
            print(f"Filled last name: {last_name}", flush=True)


        # Email - try multiple selectors
        email_input = (
            page.ele('css:input[type="email"]') or
            page.ele('css:input[name="email"]') or
            page.ele('css:input[placeholder*="email"]') or
            page.ele('css:input#email')
        )
        if email_input:
            email_input.click()
            email_input.input(email, clear=True)
            print(f"Filled email: {email}", flush=True)
        
        
        # Terms checkbox
        checkbox = page.ele('css:input[type="checkbox"]')
        if checkbox:
            checkbox.click()
            print("Checked terms checkbox", flush=True)
        
        
        # Submit button - click and wait for password input to appear
        start_step("submitting_form")
        print("Waiting for submit button to be enabled...", flush=True)
        for attempt in range(10):
            btn = page.ele('text:Continue') or page.ele('css:button.bg-sk-aqua')
            if btn:
                disabled = btn.attr('disabled')
                if disabled is None or disabled == '' or disabled == 'false':
                    btn.click()
                    print(f"Clicked submit button (attempt {attempt+1})", flush=True)
                    # Wait for password input to appear (means page transitioned)
                    time.sleep(0.1)
                    if page.ele('css:input[type="password"]', timeout=0.3):
                        print("Password page reached!", flush=True)
                        break
                    print("Password input not found, retrying click...", flush=True)
            time.sleep(0.05)
        
        # Step 4: Set password - find password input
        start_step("setting_password")
        print("Setting password...", flush=True)
        password = generate_password()
        
        # Retry loop for finding password input - try multiple selectors
        for _ in range(20):
            password_input = (
                page.ele('css:input[type="password"]', timeout=0.2) or
                page.ele('css:input[autocomplete="new-password"]', timeout=0.1) or
                page.ele('css:input[placeholder*="password"]', timeout=0.1) or
                page.ele('css:input[placeholder*="Password"]', timeout=0.1)
            )
            if password_input:
                password_input.click()
                password_input.input(password, clear=True)
                print(f"Filled password: {password}", flush=True)
                break
            time.sleep(0.05)


        # Confirm password - use specific selector from real DOM
        confirm_input = (
            page.ele('css:input[name="confirmPassword"]', timeout=1) or
            page.ele('css:input[placeholder="Confirm password"]', timeout=0.5)
        )

        if confirm_input:
            confirm_input.click()
            confirm_input.input(password, clear=True)
            print("Filled confirm password", flush=True)
        else:
            print("Warning: Could not find confirm password input", flush=True)
        
        
        # Submit password - click and wait for Cloudflare page or verification code page
        start_step("submitting_password")
        print("Waiting for password submit button...", flush=True)
        cloudflare_detected = False
        verification_code_detected = False
        for attempt in range(10):
            btn = page.ele('css:button[type="submit"]', timeout=0.5)
            if btn and not btn.attr('disabled'):
                btn.click()
                print(f"Clicked password submit (attempt {attempt+1})", flush=True)
                time.sleep(1)  # Wait for page transition
                # Check for Cloudflare page - has "Please verify that you are human" text
                if page.ele('text:Please verify that you are human', timeout=0.5):
                    print("Cloudflare verification page reached!", flush=True)
                    cloudflare_detected = True
                    break
                # Check for verification code page - has "Check your inbox" text
                if page.ele('text:Check your inbox', timeout=0.5):
                    print("Verification code page reached!", flush=True)
                    verification_code_detected = True
                    break
                print(f"Page state unknown after click {attempt+1}", flush=True)
            time.sleep(0.1)
        
        print(f"cloudflare_detected={cloudflare_detected}, verification_code_detected={verification_code_detected}", flush=True)
        
        
        # Wait for Cloudflare verification only if Cloudflare was detected (not if verification code already reached)
        if cloudflare_detected and not verification_code_detected:
            start_step("cloudflare_verification")
            for attempt in range(100):
                # Check step timeout
                if check_step_timeout():
                    break
                
                # Check if already on verification code page
                if page.ele('text:Check your inbox', timeout=0.3):
                    print("Verification code page reached!", flush=True)
                    verification_code_detected = True
                    break
                
                btn = page.ele('text:Continue', timeout=0.5)
                if btn:
                    disabled = btn.attr('disabled')
                    if disabled is None or disabled == '' or disabled == 'false':
                        # Button is enabled, try click
                        try:
                            btn.click()
                        except:
                            # Fallback to JavaScript click
                            page.run_js("document.querySelector('button.bg-sk-aqua').click()")
                        print(f"Cloudflare verification passed! Clicked Continue (attempt {attempt+1})", flush=True)
                        time.sleep(1)  # Wait for page transition
                        # Check for verification code page
                        if page.ele('text:Check your inbox', timeout=1):
                            print("Verification code page reached!", flush=True)
                            verification_code_detected = True
                            break
                        print("Waiting for verification code page...", flush=True)
                    else:
                        print(f"Cloudflare still verifying... (attempt {attempt+1})", flush=True)
                time.sleep(0.3)
        
        
        # Check if we're on verification code page
        start_step("verification_code")
        if check_step_timeout():
            raise Exception(f"Timeout at step: verification_code")
        
        if page.ele('text:Check your inbox', timeout=1):
            print("Verification code page detected!", flush=True)
            
            # Get verification code from email (30 second timeout)
            print("Fetching verification code from email (30s timeout)...", flush=True)
            code = get_verification_code(email_token, timeout=30)
            
            # Initialize code_inputs
            code_inputs = []
            
            if code:
                print(f"Verification code: {code}", flush=True)
                
                # Fill code inputs quickly
                code_inputs = page.eles('css:input[type="text"]')
                for i, digit in enumerate(code[:6]):
                    if i < len(code_inputs):
                        code_inputs[i].input(digit, clear=True)
                
                print("Filled verification code", flush=True)
                
                # Click Create account button and verify success
                registration_success = False
                api_key = None
                api_name = None
                
                try:
                    for attempt in range(15):
                        try:
                            # Wait for page to stabilize
                            time.sleep(0.5)
                            
                            # Check URL first - might have already succeeded
                            current_url = page.url
                            print(f"Checking URL (attempt {attempt+1}): {current_url}", flush=True)
                            
                            if "download" in current_url or "success" in current_url or "welcome" in current_url:
                                print(f"Registration successful! (URL changed to {current_url})", flush=True)
                                registration_success = True
                                break
                            
                            btn = page.ele('text:Create account') or page.ele('css:button[type="submit"]')
                            if btn and not btn.attr('disabled'):
                                btn.click()
                                print(f"Clicked Create account (attempt {attempt+1})", flush=True)
                                time.sleep(1)  # Wait for page transition
                            else:
                                print(f"Button not found or disabled (attempt {attempt+1})", flush=True)
                                # Check URL again after button not found
                                current_url = page.url
                                if "download" in current_url:
                                    print(f"Registration successful! (URL is {current_url})", flush=True)
                                    registration_success = True
                                    break
                        except Exception as inner_e:
                            print(f"Error in loop attempt {attempt+1}: {inner_e}", flush=True)
                            # Page might have changed/closed, check if we can still access
                            try:
                                current_url = page.url
                                if "download" in current_url:
                                    registration_success = True
                            except:
                                pass
                            break
                        time.sleep(0.3)
                except Exception as loop_e:
                    print(f"Loop exception: {loop_e}", flush=True)
                
                # Always try to get apiKey after the loop
                print(f"Loop ended, registration_success={registration_success}", flush=True)

                # Temporarily skip Firebase token retrieval (TODO: fix Firebase IndexedDB access)
                api_key = None
                api_name = None
                # try:
                #     api_key, api_name = get_api_key_from_browser(page, email)
                #     if api_key:
                #         print(f"Successfully got apiKey! (length: {len(api_key)})", flush=True)
                # except Exception as api_e:
                #     print(f"Failed to get apiKey: {api_e}", flush=True)
                
                # Close browser
                try:
                    page.quit()
                    print("Browser closed", flush=True)
                except:
                    pass
                
                # Return success if we got apiKey or registration appeared successful
                if api_key:
                    # Print explicit message for backend parsing
                    print(f"API key obtained! (length: {len(api_key)})", flush=True)
                    print(f"api_key: {api_key}", flush=True)
                    return {"success": True, "email": email, "password": password, "api_key": api_key, "name": api_name}
                elif registration_success:
                    return {"success": True, "email": email, "password": password, "api_key": None, "name": None}
                else:
                    return {"success": False, "email": email, "error": "Failed to get apiKey", "step": "api_key"}
            else:
                print("Failed to get verification code from email (timeout)", flush=True)
                try:
                    page.quit()
                    print("Browser closed", flush=True)
                except:
                    pass
                return {"success": False, "email": email, "error": "Verification code timeout (30s)", "step": "verification_code"}
        
        
        # Check registration result
        current_step = "checking_result"
        print("Checking registration result...", flush=True)
        page_url = page.url
        print(f"Final URL: {page_url}", flush=True)
        
        # Check URL for success indicators
        if "download" in page_url or "success" in page_url or "welcome" in page_url:
            print("Registration successful! (URL)", flush=True)
            # Get apiKey before closing browser
            api_key, api_name = get_api_key_from_browser(page, email)
            try:
                page.quit()
                print("Browser closed before return", flush=True)
            except:
                pass
            return {"success": True, "email": email, "password": password, "api_key": api_key, "name": api_name}
        
        # Check page content
        page_html = page.html.lower()
        if "welcome" in page_html or "get started" in page_html or "download windsurf" in page_html:
            print("Registration successful! (Content)", flush=True)
            # Get apiKey before closing browser
            api_key, api_name = get_api_key_from_browser(page, email)
            try:
                page.quit()
                print("Browser closed before return", flush=True)
            except:
                pass
            return {"success": True, "email": email, "password": password, "api_key": api_key, "name": api_name}
        
        # Check if verification was filled, assume success
        try:
            if code_inputs and len(code_inputs) >= 6:
                print("Registration likely successful (verification code filled)", flush=True)
                # Get apiKey before closing browser
                api_key, api_name = get_api_key_from_browser(page, email)
                try:
                    page.quit()
                    print("Browser closed", flush=True)
                except:
                    pass
                return {"success": True, "email": email, "password": password, "api_key": api_key, "name": api_name}
        except NameError:
            pass  # code_inputs not defined
        
        print("Registration status unclear", flush=True)
        print(f"Current URL: {page_url}", flush=True)
        try:
            page.quit()
            print("Browser closed", flush=True)
        except:
            pass
        return {"success": False, "email": email, "error": "Status unclear", "step": "checking_result"}
    
    except Exception as e:
        error_msg = f"Error at step '{current_step}': {str(e)}"
        print(f"ERROR: {error_msg}", flush=True)
        return {"success": False, "error": error_msg, "step": current_step}
    
    finally:
        cancel_timeout()
        cleanup()

if __name__ == "__main__":
    result = register_windsurf()
    print(f"\nResult: {json.dumps(result, indent=2)}", flush=True)
