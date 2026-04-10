"""
Windsurf Login Automation using DrissionPage
Automates the OAuth login flow to get access_token
"""

import sys
import time
import urllib.parse

try:
    from DrissionPage import ChromiumPage, ChromiumOptions
except ImportError:
    print("ERROR: DrissionPage not installed. Run: pip install DrissionPage")
    sys.exit(1)


def login_windsurf(email: str, password: str) -> str | None:
    """
    Automate Windsurf login and return access_token
    """
    # Configure browser options
    co = ChromiumOptions()
    co.headless(False)  # Cloudflare blocks headless
    co.set_argument('--incognito')  # Use incognito mode
    
    page = ChromiumPage(co)
    
    try:
        # Navigate to Windsurf signin page
        login_url = (
            "https://windsurf.com/windsurf/signin?"
            "response_type=token&"
            "client_id=3GUryQ7ldAeKEuD2obYnppsnmj58eP5u&"
            "redirect_uri=show-auth-token&"
            "state=automation&"
            "prompt=login&"
            "redirect_parameters_type=query"
        )
        
        print("Navigating to login page...")
        page.get(login_url)
        
        # Wait for email input
        print("Waiting for login form...")
        email_input = page.ele('css:input[type="email"]', timeout=30)
        
        if email_input:
            print("Filling email...")
            email_input.input(email, clear=True)
            
            # Find and fill password
            password_input = page.ele('css:input[type="password"]', timeout=10)
            if password_input:
                print("Filling password...")
                password_input.input(password, clear=True)
                
                # Find and click submit button
                submit_btn = page.ele('css:button[type="submit"]', timeout=10) or \
                            page.ele('text:Sign in', timeout=5) or \
                            page.ele('text:Continue', timeout=5)
                
                if submit_btn:
                    print("Submitting login form...")
                    submit_btn.click()
                    
                    # Wait for redirect with access_token
                    print("Waiting for authentication...")
                    
                    # Check for Cloudflare challenge
                    time.sleep(3)
                    try:
                        cf_frame = page.ele('css:iframe[src*="challenges.cloudflare.com"]', timeout=5)
                        if cf_frame:
                            print("Cloudflare challenge detected, please complete it manually...")
                            # Wait for user to complete
                            for i in range(60):
                                time.sleep(1)
                                try:
                                    if 'access_token=' in page.url:
                                        break
                                except:
                                    break
                    except:
                        pass
                    
                    # Wait for the token to appear in URL
                    # Handle page disconnection by checking all tabs
                    for i in range(120):
                        try:
                            # Try to get URL from current page
                            current_url = page.url
                            
                            # Check if we're on show-auth-token page
                            if 'show-auth-token' in current_url:
                                # Token is displayed on the page - look for readonly input
                                time.sleep(2)  # Wait for page to fully load
                                
                                # Try to find token in readonly input (ott$ format)
                                token_input = page.ele('css:input[readonly]', timeout=5)
                                if token_input:
                                    token = token_input.attr('value')
                                    if token and token.startswith('ott$'):
                                        print(f"ACCESS_TOKEN:{token}")
                                        return token
                                
                                # Try to find token in code/pre element
                                token_ele = page.ele('css:code', timeout=3) or page.ele('css:pre', timeout=3)
                                if token_ele:
                                    token = token_ele.text.strip()
                                    if token and len(token) > 20:
                                        print(f"ACCESS_TOKEN:{token}")
                                        return token
                                
                                # Try to find ott$ token in page HTML
                                page_content = page.html
                                import re
                                token_match = re.search(r'ott\$[a-zA-Z0-9\-_]+', page_content)
                                if token_match:
                                    print(f"ACCESS_TOKEN:{token_match.group(0)}")
                                    return token_match.group(0)
                            
                            if 'access_token=' in current_url:
                                parsed = urllib.parse.urlparse(current_url)
                                params = urllib.parse.parse_qs(parsed.query)
                                if 'access_token' in params:
                                    token = params['access_token'][0]
                                    print(f"ACCESS_TOKEN:{token}")
                                    return token
                        except:
                            # Page disconnected, check all tabs
                            try:
                                for tab in page.tabs():
                                    if 'access_token=' in tab.url:
                                        parsed = urllib.parse.urlparse(tab.url)
                                        params = urllib.parse.parse_qs(parsed.query)
                                        if 'access_token' in params:
                                            token = params['access_token'][0]
                                            print(f"ACCESS_TOKEN:{token}")
                                            return token
                            except:
                                pass
                        time.sleep(1)
                    
                    # Check if token is displayed on page
                    try:
                        token_element = page.ele('css:pre', timeout=5) or page.ele('css:code', timeout=5)
                        if token_element:
                            token = token_element.text
                            if token and len(token) > 50:
                                print(f"ACCESS_TOKEN:{token}")
                                return token
                    except:
                        pass
        
        print("Login failed - could not get access token")
        return None
        
    except Exception as e:
        print(f"ERROR: {e}")
        return None
        
    finally:
        try:
            page.quit()
        except:
            pass


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python login_automation.py <email> <password>")
        sys.exit(1)
    
    email = sys.argv[1]
    password = sys.argv[2]
    
    token = login_windsurf(email, password)
    
    if token:
        sys.exit(0)
    else:
        sys.exit(1)
