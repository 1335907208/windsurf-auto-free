"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
// Storage keys
const SESSIONS_SECRET_KEY = 'windsurf_auth.sessions';
const API_SERVER_URL_KEY = 'apiServerUrl';
const ACCOUNTS_STORAGE_KEY = 'ide-toolkit.accounts';
let accounts = [];
let currentPanel;
function activate(context) {
    console.log('IDE Toolkit is now active');
    // Load saved accounts
    loadAccounts(context);
    // Register WebviewViewProvider for sidebar icon
    const provider = new SidebarProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('ide-toolkit.welcome', provider));
    // Register command to open panel
    context.subscriptions.push(vscode.commands.registerCommand('ide-toolkit.openPanel', () => openWebviewPanel(context)), vscode.commands.registerCommand('ide-toolkit.refreshDevice', () => refreshDevice(context)));
}
// Sidebar provider - shows a button to open the main panel
class SidebarProvider {
    constructor(context) {
        this.context = context;
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'openPanel') {
                vscode.commands.executeCommand('ide-toolkit.openPanel');
            }
            else if (message.command === 'quickSwitch') {
                await this.handleQuickSwitch();
            }
            else if (message.command === 'setBackendUrl') {
                await this.setBackendUrl(message.url);
            }
            else if (message.command === 'clearUsedStatus') {
                await this.clearUsedStatus();
            }
            else if (message.command === 'getStats') {
                await this.updateStats();
            }
        });
    }
    getHtml() {
        const config = vscode.workspace.getConfiguration('ideToolkit');
        const backendUrl = config.get('backendUrl') || 'http://localhost:3001';
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 16px;
}
.header {
    text-align: center;
    margin-bottom: 20px;
}
.header h2 {
    font-size: 18px;
    color: var(--vscode-titleBar-activeForeground);
    margin-bottom: 8px;
}
.header p {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
}
.section {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
}
.section-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--vscode-foreground);
    display: flex;
    align-items: center;
    gap: 6px;
}
.section-title::before {
    content: '';
    width: 3px;
    height: 14px;
    background: #007acc;
    border-radius: 2px;
}
.btn-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.btn {
    padding: 10px 16px;
    font-size: 13px;
    cursor: pointer;
    border: none;
    border-radius: 6px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}
.btn-primary {
    background: linear-gradient(135deg, #007acc, #005a9e);
    color: white;
}
.btn-primary:hover {
    background: linear-gradient(135deg, #0098ff, #007acc);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 122, 204, 0.3);
}
.btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}
.btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
}
.btn-danger {
    background: #d32f2f;
    color: white;
}
.btn-danger:hover {
    background: #f44336;
}
.form-group {
    margin-bottom: 12px;
}
.form-group label {
    display: block;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 6px;
}
.form-group input {
    width: 100%;
    padding: 8px 12px;
    font-size: 13px;
    border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border-radius: 4px;
}
.form-group input:focus {
    outline: 1px solid var(--vscode-focusBorder);
}
.status {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-top: 12px;
    padding: 8px 12px;
    background: var(--vscode-editorInfo-background, rgba(0, 122, 204, 0.1));
    border-radius: 4px;
    text-align: center;
}
.status.success { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
.status.error { background: rgba(244, 67, 54, 0.15); color: #f44336; }
.divider {
    height: 1px;
    background: var(--vscode-input-border);
    margin: 16px 0;
}
.stats {
    display: flex;
    justify-content: space-around;
    margin-bottom: 12px;
}
.stat-item {
    text-align: center;
}
.stat-value {
    font-size: 24px;
    font-weight: bold;
    color: #007acc;
}
.stat-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}
</style>
</head>
<body>
<div class="header">
    <h2>Windsurf Account Switcher</h2>
    <p>Manage and switch between multiple Windsurf accounts</p>
</div>

<div class="section">
    <div class="section-title">Quick Actions</div>
    <div class="btn-group">
        <button class="btn btn-primary" onclick="openPanel()">
            <span>Account Manager</span>
        </button>
        <button class="btn btn-secondary" onclick="quickSwitch()">
            <span>Quick Switch (Next Unused)</span>
        </button>
    </div>
    <div id="status" class="status" style="display:none;"></div>
</div>

<div class="section">
    <div class="section-title">Configuration</div>
    <div class="form-group">
        <label for="backendUrl">Backend URL</label>
        <input type="text" id="backendUrl" value="${backendUrl}" placeholder="http://localhost:3001">
    </div>
    <button class="btn btn-secondary" onclick="saveConfig()" style="width:100%;">Save Configuration</button>
</div>

<div class="section">
    <div class="section-title">Statistics</div>
    <div class="stats">
        <div class="stat-item">
            <div class="stat-value" id="totalAccounts">-</div>
            <div class="stat-label">Total</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="usedAccounts">-</div>
            <div class="stat-label">Used</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="unusedAccounts">-</div>
            <div class="stat-label">Available</div>
        </div>
    </div>
    <button class="btn btn-danger" onclick="clearUsedStatus()" style="width:100%;">Clear All Used Status</button>
</div>

<script>
const vscode = acquireVsCodeApi();

function openPanel() {
    vscode.postMessage({ command: 'openPanel' });
}

function quickSwitch() {
    showStatus('Looking for unused account...', 'info');
    vscode.postMessage({ command: 'quickSwitch' });
}

function saveConfig() {
    const url = document.getElementById('backendUrl').value.trim();
    if (url) {
        vscode.postMessage({ command: 'setBackendUrl', url: url });
        showStatus('Configuration saved!', 'success');
    }
}

function clearUsedStatus() {
    if (confirm('Clear all used status? This will mark all accounts as unused.')) {
        vscode.postMessage({ command: 'clearUsedStatus' });
        showStatus('Used status cleared!', 'success');
    }
}

function showStatus(msg, type) {
    const status = document.getElementById('status');
    status.textContent = msg;
    status.style.display = 'block';
    status.className = 'status ' + (type || '');
}

function updateStats(total, used) {
    document.getElementById('totalAccounts').textContent = total;
    document.getElementById('usedAccounts').textContent = used;
    document.getElementById('unusedAccounts').textContent = total - used;
}

window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'quickSwitchResult') {
        showStatus(message.message, message.success ? 'success' : 'error');
    } else if (message.command === 'updateStats') {
        updateStats(message.total, message.used);
    } else if (message.command === 'configSaved') {
        showStatus('Configuration saved!', 'success');
    } else if (message.command === 'usedStatusCleared') {
        showStatus('Used status cleared!', 'success');
    }
});

// Request stats on load
vscode.postMessage({ command: 'getStats' });
</script>
</body>
</html>`;
    }
    async handleQuickSwitch() {
        const usedAccounts = this.context.globalState.get('ide-toolkit.usedAccounts') || {};
        // Use local cached accounts
        const allAccounts = this.context.globalState.get('ide-toolkit.cachedAccounts') || [];
        if (allAccounts.length === 0) {
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: 'No accounts in cache. Please open Account Manager first.',
                success: false
            });
            return;
        }
        // Find first unused account (with apiKey or password)
        // Check both id and email as usedAccounts key
        const unusedAccount = allAccounts.find(acc => !usedAccounts[acc.id] && !usedAccounts[acc.email] && (acc.apiKey || acc.password));
        if (!unusedAccount) {
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: 'No available unused accounts'
            });
            return;
        }
        // Use apiKey if available, otherwise use password
        let switchResult;
        if (unusedAccount.apiKey) {
            switchResult = await handleSwitchAccountWithApiKey(this.context, unusedAccount.apiKey, unusedAccount.email.split('@')[0], unusedAccount.email, unusedAccount.password);
        }
        else if (unusedAccount.password) {
            switchResult = await handleSwitchAccountWithEmail(this.context, unusedAccount.email, unusedAccount.password);
        }
        else {
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: 'Account has no apiKey or password'
            });
            return;
        }
        if (switchResult.success) {
            // Mark as used (both id and email for consistency)
            usedAccounts[unusedAccount.id] = true;
            usedAccounts[unusedAccount.email] = true;
            await this.context.globalState.update('ide-toolkit.usedAccounts', usedAccounts);
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: 'Switched to: ' + unusedAccount.email,
                success: true
            });
        }
        else {
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: 'Switch failed: ' + (switchResult.error || 'Unknown error'),
                success: false
            });
        }
    }
    async setBackendUrl(url) {
        await vscode.workspace.getConfiguration('ideToolkit').update('backendUrl', url, true);
        this._view?.webview.postMessage({ command: 'configSaved' });
    }
    async clearUsedStatus() {
        await this.context.globalState.update('ide-toolkit.usedAccounts', {});
        this._view?.webview.postMessage({ command: 'usedStatusCleared' });
        await this.updateStats();
    }
    async updateStats() {
        const usedAccounts = this.context.globalState.get('ide-toolkit.usedAccounts') || {};
        const allAccounts = this.context.globalState.get('ide-toolkit.cachedAccounts') || [];
        const total = allAccounts.length;
        const used = Object.keys(usedAccounts).length / 2; // Divide by 2 since we store both id and email
        this._view?.webview.postMessage({
            command: 'updateStats',
            total: total,
            used: Math.floor(used)
        });
    }
}
SidebarProvider.viewType = 'ide-toolkit.welcome';
// Backend API configuration
const DEFAULT_BACKEND_URL = 'http://localhost:3001';
async function fetchFromBackend(endpoint, method = 'GET', body) {
    const config = vscode.workspace.getConfiguration('ideToolkit');
    const baseUrl = config.get('backendUrl') || DEFAULT_BACKEND_URL;
    const https = require('https');
    const http = require('http');
    const url = new URL(`${baseUrl}${endpoint}`);
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            timeout: 5000 // 5 second timeout
        };
        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve(data);
                }
            });
        });
        req.on('error', (e) => {
            console.error('Backend request error:', e);
            reject(e);
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        if (body)
            req.write(JSON.stringify(body));
        req.end();
    });
}
// Webview View Provider for sidebar
class AccountViewProvider {
    constructor(context) {
        this.context = context;
        this.backendAccounts = [];
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: []
        };
        webviewView.webview.html = this.getWebviewContent();
        // Load accounts on open
        this.updateAccounts();
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'setBackendUrl':
                    await this.setBackendUrl(message.url);
                    break;
                case 'addAccount':
                    await this.handleAddAccount(message.email, message.password);
                    break;
                case 'switchAccount':
                    await this.handleSwitchAccount(message.accountId, message.email, message.password, message.apiKey);
                    break;
                case 'removeAccount':
                    await this.handleRemoveAccount(message.accountId);
                    break;
                case 'refreshDevice':
                    await this.refreshDevice();
                    break;
                case 'getAccounts':
                case 'refreshAccounts':
                    await this.updateAccounts();
                    break;
            }
        });
    }
    async setBackendUrl(url) {
        await vscode.workspace.getConfiguration('ideToolkit').update('backendUrl', url, true);
        this._view?.webview.postMessage({
            command: 'backendUrlSaved',
            url: url
        });
        await this.updateAccounts();
    }
    async updateAccounts() {
        const usedAccounts = this.context.globalState.get('ide-toolkit.usedAccounts') || {};
        const cachedAccounts = this.context.globalState.get('ide-toolkit.cachedAccounts') || [];
        try {
            const result = await fetchFromBackend('/api/windsurf/accounts');
            if (result.success && result.data) {
                // Show all accounts in backend order (already sorted by registerAt desc)
                const allAccounts = result.data;
                // Update cache with new data
                await this.context.globalState.update('ide-toolkit.cachedAccounts', allAccounts);
                this.backendAccounts = allAccounts;
                this._view?.webview.postMessage({
                    command: 'updateAccounts',
                    accounts: allAccounts,
                    usedAccounts: usedAccounts,
                    source: 'backend'
                });
            }
            else {
                // Use cached accounts as fallback
                const fallbackAccounts = cachedAccounts.length > 0 ? cachedAccounts : accounts;
                this._view?.webview.postMessage({
                    command: 'updateAccounts',
                    accounts: fallbackAccounts,
                    usedAccounts: usedAccounts,
                    source: 'local'
                });
            }
        }
        catch (error) {
            console.error('Failed to fetch accounts:', error);
            // Use cached accounts as fallback
            const fallbackAccounts = cachedAccounts.length > 0 ? cachedAccounts : accounts;
            this._view?.webview.postMessage({
                command: 'updateAccounts',
                accounts: fallbackAccounts,
                usedAccounts: usedAccounts,
                source: 'local'
            });
        }
    }
    async handleAddAccount(email, password) {
        const account = {
            id: crypto.randomUUID(),
            email: email,
            password: password,
            name: email.split('@')[0]
        };
        accounts.push(account);
        saveAccounts(this.context);
        this.updateAccounts();
        this._view?.webview.postMessage({
            command: 'accountAdded',
            email: email
        });
    }
    async handleSwitchAccount(accountId, email, password, apiKey) {
        // Show loading state
        this._view?.webview.postMessage({
            command: 'switching',
            email: email || 'account'
        });
        vscode.window.showInformationMessage('Switching account...');
        let account = this.backendAccounts.find(a => a.id === accountId);
        if (!account) {
            account = accounts.find(a => a.id === accountId);
        }
        if (!account) {
            this._view?.webview.postMessage({
                command: 'switchError',
                error: 'Account not found'
            });
            vscode.window.showErrorMessage('Account not found');
            return;
        }
        const accEmail = email || account.email;
        const accPassword = password || account.password;
        const accApiKey = apiKey || account.apiKey;
        console.log('[Switch] Account data:', JSON.stringify({
            id: account.id,
            email: account.email,
            hasPassword: !!account.password,
            hasApiKey: !!account.apiKey,
            apiKeyValue: account.apiKey ? account.apiKey.substring(0, 20) + '...' : null
        }));
        // Priority: apiKey > email/password
        let result;
        if (accApiKey) {
            // Use direct apiKey injection (no Firebase login needed)
            console.log('[Switch] Using apiKey for account:', accEmail);
            result = await handleSwitchAccountWithApiKey(this.context, accApiKey, accEmail.split('@')[0]);
        }
        else if (accPassword) {
            // Fallback to Firebase login
            console.log('[Switch] No apiKey, using Firebase login for account:', accEmail);
            result = await handleSwitchAccountWithEmail(this.context, accEmail, accPassword);
        }
        else {
            this._view?.webview.postMessage({
                command: 'switchError',
                error: 'Account has no apiKey or password stored'
            });
            return;
        }
        // Send result message to webview
        if (result.success) {
            this._view?.webview.postMessage({
                command: 'switchSuccess',
                email: accEmail
            });
            // Only mark as used if switch succeeded
            const usedAccounts = this.context.globalState.get('ide-toolkit.usedAccounts') || {};
            usedAccounts[accountId] = true;
            usedAccounts[accEmail] = true;
            await this.context.globalState.update('ide-toolkit.usedAccounts', usedAccounts);
        }
        else {
            this._view?.webview.postMessage({
                command: 'switchError',
                error: result.error || 'Unknown error'
            });
        }
        this.updateAccounts();
    }
    async handleRemoveAccount(accountId) {
        try {
            await fetchFromBackend(`/api/windsurf/accounts/${accountId}`, 'DELETE');
            this._view?.webview.postMessage({
                command: 'accountDeleted',
                id: accountId
            });
        }
        catch {
            accounts = accounts.filter(a => a.id !== accountId);
            saveAccounts(this.context);
            this._view?.webview.postMessage({
                command: 'accountDeleted',
                id: accountId
            });
        }
        await this.updateAccounts();
    }
    async refreshDevice() {
        await refreshDevice(this.context);
    }
    getWebviewContent() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Manager</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 12px;
        }
        h2 { margin: 12px 0 8px; font-size: 14px; font-weight: 600; }
        .form-group { margin-bottom: 8px; }
        label { display: block; margin-bottom: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 13px;
        }
        input:focus { outline: 1px solid var(--vscode-focusBorder); }

        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-right: 4px;
            margin-bottom: 4px;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-primary:disabled { background: #666; color: #999; cursor: not-allowed; }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-danger { background: #d32f2f; color: white; }
        .btn-danger:hover { background: #b71c1c; }
        .btn-small { padding: 4px 8px; font-size: 11px; }
        .btn-used { background: #666; color: #999; cursor: not-allowed; }

        .account-list { margin-top: 8px; }
        .account-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px;
            margin-bottom: 6px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
        }
        .account-item.used { opacity: 0.6; }
        .account-info { flex: 1; min-width: 0; }
        .account-email { font-weight: 500; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .account-status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
        .account-actions { display: flex; gap: 4px; flex-shrink: 0; }

        .collapsible-header { cursor: pointer; display: flex; align-items: center; }
        .collapsible-header::before { content: '>'; margin-right: 4px; transition: transform 0.2s; }
        .collapsible-header.open::before { transform: rotate(90deg); }
        .collapsible-content { display: none; }
        .collapsible-content.open { display: block; }
        
        .pagination { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 12px; }
        .pagination-info { font-size: 11px; color: var(--vscode-descriptionForeground); }
        .used-badge { font-size: 10px; padding: 1px 4px; border-radius: 2px; background: #666; color: #ccc; margin-left: 6px; }
    </style>
</head>
<body>
    <h2 class="collapsible-header open">Settings</h2>
    <div class="collapsible-content open" style="margin-bottom: 12px;">
        <div class="form-group">
            <label for="backendUrl">API URL</label>
            <input type="text" id="backendUrl" placeholder="http://localhost:3001">
        </div>
        <button class="btn btn-secondary" id="saveBackendBtn">Save</button>
    </div>

    <div class="divider"></div>

    <h2>Accounts <span id="sourceBadge" class="source-badge"></span></h2>
    <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
        <button class="btn btn-secondary" id="refreshDeviceBtn">Refresh Device ID</button>
        <button class="btn btn-primary" id="refreshBtn">Refresh</button>
        <button class="btn btn-secondary" id="toggleAddBtn">Add Account</button>
    </div>
    
    <div id="addAccountForm" class="collapsible-content" style="margin-bottom: 12px;">
        <div class="form-group">
            <label for="email">Email</label>
            <input type="text" id="email" placeholder="Enter email">
        </div>
        <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" placeholder="Enter password">
        </div>
        <button class="btn btn-primary" id="addAccountBtn">Add</button>
    </div>
    
    <div id="accountList" class="account-list"></div>
    <div id="pagination" class="pagination"></div>

    <div id="statusMessage" class="status-message"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let accounts = [];
        let usedAccounts = {};
        let dataSource = 'local';
        let currentPage = 1;
        const pageSize = 10;

        // Request accounts on load
        vscode.postMessage({ command: 'getAccounts' });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            showStatus('Refreshing...', 'info');
            vscode.postMessage({ command: 'getAccounts' });
        });

        // Toggle add account form
        document.getElementById('toggleAddBtn').addEventListener('click', () => {
            const form = document.getElementById('addAccountForm');
            form.classList.toggle('open');
        });

        // Add account
        document.getElementById('addAccountBtn').addEventListener('click', () => {
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value.trim();
            if (email && password) {
                vscode.postMessage({ command: 'addAccount', email: email, password: password });
                document.getElementById('email').value = '';
                document.getElementById('password').value = '';
                document.getElementById('addAccountForm').classList.remove('open');
            } else {
                showStatus('Please enter email and password', 'error');
            }
        });

        // Collapsible settings (first header = Settings)
        const settingsHeader = document.querySelector('.collapsible-header');
        const settingsContent = document.querySelector('.collapsible-content');
        if (settingsHeader && settingsContent) {
            settingsHeader.addEventListener('click', function() {
                this.classList.toggle('open');
                settingsContent.classList.toggle('open');
            });
        }

        // Save backend URL
        document.getElementById('saveBackendBtn').addEventListener('click', () => {
            const url = document.getElementById('backendUrl').value.trim();
            if (url) {
                vscode.postMessage({ command: 'setBackendUrl', url: url });
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.command) {
                case 'updateAccounts':
                    accounts = message.accounts || [];
                    usedAccounts = message.usedAccounts || {};
                    dataSource = message.source || 'local';
                    updateSourceBadge();
                    renderAccountList();
                    break;
                case 'backendUrlSaved':
                    showStatus('Backend URL saved: ' + message.url, 'success');
                    break;
                case 'accountAdded':
                    showStatus('Account added: ' + message.email, 'success');
                    break;
                case 'switching':
                    showStatus('Switching to ' + message.email + '...', 'info');
                    break;
                case 'switchSuccess':
                    showStatus('Switched to: ' + message.email, 'success');
                    vscode.postMessage({ command: 'refreshAccounts' });
                    break;
                case 'switchError':
                    showStatus('Switch failed: ' + message.error, 'error');
                    break;
                case 'accountDeleted':
                    showStatus('Account deleted', 'success');
                    break;
                case 'deviceRefreshed':
                    showStatus('Device ID refreshed', 'success');
                    break;
            }
        });

        function updateSourceBadge() {
            const badge = document.getElementById('sourceBadge');
            badge.textContent = dataSource === 'backend' ? 'API' : 'Local';
            badge.className = 'source-badge ' + (dataSource === 'backend' ? 'source-backend' : 'source-local');
        }

        function renderAccountList() {
            const list = document.getElementById('accountList');
            const pagination = document.getElementById('pagination');

            if (accounts.length === 0) {
                list.innerHTML = '<div class="no-accounts">No accounts found</div>';
                pagination.innerHTML = '';
                return;
            }

            const totalPages = Math.ceil(accounts.length / pageSize);
            const start = (currentPage - 1) * pageSize;
            const end = Math.min(start + pageSize, accounts.length);
            const pageAccounts = accounts.slice(start, end);

            let html = '';
            pageAccounts.forEach(acc => {
                const isUsed = usedAccounts[acc.id] === true || usedAccounts[acc.email] === true;
                const usedClass = isUsed ? 'used' : '';
                const usedBadge = isUsed ? '<span class="used-badge">Used</span>' : '';
                const btnClass = isUsed ? 'btn-used' : 'btn-primary';
                const btnDisabled = '';

                html += '<div class="account-item ' + usedClass + '">' +
                    '<div class="account-info">' +
                    '<div class="account-email">' + (acc.email || '') + usedBadge + '</div>' +
                    '<div class="account-status">' + (acc.status || acc.name || '') + '</div>' +
                    '</div>' +
                    '<div class="account-actions">' +
                    '<button class="btn ' + btnClass + ' btn-small" ' + btnDisabled + ' onclick="switchAccount(\\'' + acc.id + '\\', \\'' + (acc.email || '') + '\\', \\'' + (acc.password || '') + '\\', \\'' + (acc.apiKey || '') + '\\')">Switch</button>' +
                    '<button class="btn btn-danger btn-small" onclick="removeAccount(\\'' + acc.id + '\\')">Delete</button>' +
                    '</div>' +
                    '</div>';
            });

            // Pagination
            if (totalPages > 1) {
                let pagHtml = '';
                pagHtml += '<button class="btn btn-secondary btn-small" onclick="goPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>Prev</button>';
                pagHtml += '<span class="pagination-info">Page ' + currentPage + ' / ' + totalPages + ' (Total ' + accounts.length + ')</span>';
                pagHtml += '<button class="btn btn-secondary btn-small" onclick="goPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '>Next</button>';
                pagination.innerHTML = pagHtml;
            } else {
                pagination.innerHTML = '<span class="pagination-info">Total ' + accounts.length + '</span>';
            }
        }

        function goPage(page) {
            const totalPages = Math.ceil(accounts.length / pageSize);
            if (page < 1 || page > totalPages) return;
            currentPage = page;
            renderAccountList();
        }

        function switchAccount(id, email, password, apiKey) {
            vscode.postMessage({ command: 'switchAccount', accountId: id, email: email, password: password, apiKey: apiKey });
        }

        function removeAccount(id) {
            vscode.postMessage({ command: 'removeAccount', accountId: id });
        }

        function showStatus(message, type) {
            const el = document.getElementById('statusMessage');
            el.textContent = message;
            el.className = 'status-message status-' + type;
            setTimeout(() => { el.className = 'status-message'; }, 3000);
        }
    </script>
</body>
</html>`;
    }
}
AccountViewProvider.viewType = 'ide-toolkit.main';
function loadAccounts(context) {
    const saved = context.globalState.get(ACCOUNTS_STORAGE_KEY);
    if (saved) {
        accounts = saved;
    }
}
function saveAccounts(context) {
    context.globalState.update(ACCOUNTS_STORAGE_KEY, accounts);
}
function openWebviewPanel(context) {
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.One);
        return;
    }
    currentPanel = vscode.window.createWebviewPanel('accountManager', 'Account Manager', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true
    });
    currentPanel.webview.html = getWebviewContent(accounts);
    // Handle messages from webview
    currentPanel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'addAccount':
                await handleAddAccount(context, message.email, message.password);
                break;
            case 'switchAccount':
                await handleSwitchAccount(context, message.accountId, message.email, message.password, message.apiKey);
                break;
            case 'removeAccount':
                await handleRemoveAccount(context, message.accountId);
                break;
            case 'refreshDevice':
                await refreshDevice(context);
                break;
            case 'getAccounts':
            case 'refreshAccounts':
                // Fetch from backend
                const usedAccounts = context.globalState.get('ide-toolkit.usedAccounts') || {};
                try {
                    const result = await fetchFromBackend('/api/windsurf/accounts');
                    if (result.success && result.data) {
                        const allAccounts = result.data;
                        // Update cache with new data (already sorted by registerAt desc)
                        await context.globalState.update('ide-toolkit.cachedAccounts', allAccounts);
                        currentPanel?.webview.postMessage({
                            command: 'updateAccounts',
                            accounts: allAccounts,
                            usedAccounts: usedAccounts,
                            source: 'backend'
                        });
                    }
                    else {
                        // Use cached accounts if backend fails
                        const cachedAccounts = context.globalState.get('ide-toolkit.cachedAccounts') || accounts;
                        currentPanel?.webview.postMessage({
                            command: 'updateAccounts',
                            accounts: cachedAccounts,
                            usedAccounts: usedAccounts,
                            source: 'local'
                        });
                    }
                }
                catch {
                    // Use cached accounts if backend fails
                    const cachedAccounts = context.globalState.get('ide-toolkit.cachedAccounts') || accounts;
                    currentPanel?.webview.postMessage({
                        command: 'updateAccounts',
                        accounts: cachedAccounts,
                        usedAccounts: usedAccounts,
                        source: 'local'
                    });
                }
                break;
        }
    }, undefined, context.subscriptions);
    currentPanel.onDidDispose(() => { currentPanel = undefined; }, undefined, context.subscriptions);
}
function getWebviewContent(accounts) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Manager</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 20px;
        }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .header h1 { font-size: 22px; }
        .header-actions { display: flex; gap: 8px; }
        
        .toolbar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
        .search-box { flex: 1; min-width: 200px; position: relative; }
        .search-box input { width: 100%; padding: 8px 12px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; font-size: 13px; }
        .search-box input:focus { outline: 1px solid var(--vscode-focusBorder); }
        
        .stats { font-size: 12px; color: var(--vscode-descriptionForeground); }
        .stats span { margin-right: 16px; }
        
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-danger { background: #d32f2f; color: white; }
        .btn-danger:hover { background: #b71c1c; }
        .btn-small { padding: 4px 8px; font-size: 11px; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .account-list { margin-bottom: 16px; }
        .account-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            margin-bottom: 4px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
        }
        .account-item:hover { background: var(--vscode-list-hoverBackground); }
        .account-info { flex: 1; min-width: 0; }
        .account-email { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .account-status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
        .account-actions { display: flex; gap: 6px; margin-left: 12px; }
        
        .pagination { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 16px; }
        .pagination-info { font-size: 12px; color: var(--vscode-descriptionForeground); }
        
        .status-message { padding: 10px 12px; margin-bottom: 12px; border-radius: 4px; font-size: 13px; display: none; }
        .status-success { background: #2e7d32; color: white; display: block; }
        .status-error { background: #c62828; color: white; display: block; }
        .status-info { background: #1565c0; color: white; display: block; }
        
        .no-accounts { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
        
        .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; }
        .modal.open { display: flex; justify-content: center; align-items: center; }
        .modal-content { background: var(--vscode-editor-background); padding: 20px; border-radius: 8px; width: 400px; max-width: 90%; }
        .modal-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
        .modal-body { margin-bottom: 16px; }
        .form-group { margin-bottom: 12px; }
        .form-group label { display: block; margin-bottom: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
        .form-group input { width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 8px; }
        
        .collapsible { border: 1px solid var(--vscode-widget-border); border-radius: 4px; margin-bottom: 12px; }
        .collapsible-header { padding: 10px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: var(--vscode-editor-background); }
        .collapsible-header:hover { background: var(--vscode-list-hoverBackground); }
        .collapsible-content { display: none; padding: 12px; border-top: 1px solid var(--vscode-widget-border); }
        .collapsible.open .collapsible-content { display: block; }
        .collapsible-icon { transition: transform 0.2s; }
        .collapsible.open .collapsible-icon { transform: rotate(90deg); }
    </style>
</head>
<body>
    <div class="header">
        <h1>Account Manager</h1>
        <div class="header-actions">
            <button class="btn btn-secondary" id="refreshDeviceBtn">Refresh Device ID</button>
            <button class="btn btn-primary" id="refreshBtn">Refresh</button>
            <button class="btn btn-secondary" id="addBtn">Add Account</button>
        </div>
    </div>
    
    <div id="statusMessage" class="status-message"></div>
    
    <div class="toolbar">
        <div class="search-box">
            <input type="text" id="searchInput" placeholder="Search accounts...">
        </div>
        <div class="stats">
            <span id="totalCount">0 accounts</span>
            <span id="sourceBadge"></span>
        </div>
    </div>
    
    <div id="accountList" class="account-list"></div>
    
    <div id="pagination" class="pagination"></div>

    <div class="modal" id="addModal">
        <div class="modal-content">
            <div class="modal-title">Add Account</div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Email</label>
                    <input type="text" id="modalEmail" placeholder="Enter email">
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" id="modalPassword" placeholder="Enter password">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="btn btn-primary" id="modalAddBtn">Add</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let allAccounts = [];
        let filteredAccounts = [];
        let usedAccounts = {};
        let currentPage = 1;
        let pageSize = 10;
        let dataSource = 'local';
        
        // Initialize
        vscode.postMessage({ command: 'getAccounts' });
        
        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            filteredAccounts = allAccounts.filter(acc => 
                (acc.email || '').toLowerCase().includes(query) ||
                (acc.name || '').toLowerCase().includes(query)
            );
            currentPage = 1;
            renderAccountList();
        });
        
        // Refresh
        document.getElementById('refreshBtn').addEventListener('click', () => {
            showStatus('Refreshing...', 'info');
            vscode.postMessage({ command: 'getAccounts' });
        });
        
        // Add account modal
        document.getElementById('addBtn').addEventListener('click', () => {
            document.getElementById('addModal').classList.add('open');
            document.getElementById('modalEmail').focus();
        });
        
        document.getElementById('modalAddBtn').addEventListener('click', () => {
            const email = document.getElementById('modalEmail').value.trim();
            const password = document.getElementById('modalPassword').value;
            if (!email || !password) {
                showStatus('Please enter email and password', 'error');
                return;
            }
            vscode.postMessage({ command: 'addAccount', email, password });
            closeModal();
        });
        
        function closeModal() {
            document.getElementById('addModal').classList.remove('open');
            document.getElementById('modalEmail').value = '';
            document.getElementById('modalPassword').value = '';
        }
        
        // Device
        document.getElementById('refreshDeviceBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refreshDevice' });
        });
        
        function toggleCollapsible() {
            document.getElementById('settingsCollapsible').classList.toggle('open');
        }
        
        // Messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateAccounts':
                    allAccounts = message.accounts || [];
                    filteredAccounts = allAccounts;
                    usedAccounts = message.usedAccounts || {};
                    dataSource = message.source || 'local';
                    currentPage = 1;
                    document.getElementById('sourceBadge').textContent = dataSource === 'backend' ? '(API)' : '(Local)';
                    document.getElementById('totalCount').textContent = allAccounts.length + ' accounts';
                    renderAccountList();
                    break;
                case 'accountAdded':
                    showStatus('Account added: ' + message.email, 'success');
                    break;
                case 'switching':
                    showStatus('Switching to ' + message.email + '...', 'info');
                    break;
                case 'switchSuccess':
                    showStatus('Switched to: ' + message.email, 'success');
                    break;
                case 'switchError':
                    showStatus('Switch failed: ' + message.error, 'error');
                    break;
                case 'deviceRefreshed':
                    showStatus('Device ID refreshed', 'success');
                    break;
            }
        });
        
        function renderAccountList() {
            const container = document.getElementById('accountList');
            const pagination = document.getElementById('pagination');
            
            if (filteredAccounts.length === 0) {
                container.innerHTML = '<div class="no-accounts">No accounts found</div>';
                pagination.innerHTML = '';
                return;
            }
            
            const totalPages = Math.ceil(filteredAccounts.length / pageSize);
            const start = (currentPage - 1) * pageSize;
            const end = Math.min(start + pageSize, filteredAccounts.length);
            const pageAccounts = filteredAccounts.slice(start, end);
            
            let html = '';
            pageAccounts.forEach(acc => {
                const email = (acc.email || '').replace(/'/g, "\\\\'");
                const password = (acc.password || '').replace(/'/g, "\\\\'");
                const hasPassword = !!acc.password;
                const isUsed = usedAccounts[acc.id] === true || usedAccounts[acc.email] === true;
                const usedBadge = isUsed ? ' <span style="font-size:10px;background:#666;color:#ccc;padding:1px 4px;border-radius:2px;">used</span>' : '';
                const btnClass = isUsed ? 'btn-secondary' : 'btn-primary';
                const btnDisabled = '';
                html += '<div class="account-item' + (isUsed ? ' used' : '') + '">' +
                    '<div class="account-info">' +
                    '<div class="account-email">' + (acc.email || '') + usedBadge + '</div>' +
                    '<div class="account-status">' + (hasPassword ? 'has password: ' + (acc.password || '') : 'no password') + '</div>' +
                    '</div>' +
                    '<div class="account-actions">' +
                    '<button class="btn ' + btnClass + ' btn-small" ' + btnDisabled + ' onclick="switchAccount(\\'' + acc.id + '\\',\\'' + email + '\\',\\'' + password + '\\',\\'' + (acc.apiKey || '') + '\\')">switch</button>' +
                    '<button class="btn btn-danger btn-small" onclick="removeAccount(\\'' + acc.id + '\\')">delete</button>' +
                    '</div></div>';
            });
            container.innerHTML = html;

            // Pagination
            if (totalPages > 1) {
                let pagHtml = '';
                pagHtml += '<button class="btn btn-secondary btn-small" onclick="goPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>prev</button>';
                pagHtml += '<span class="pagination-info">page ' + currentPage + ' / ' + totalPages + ' (total ' + filteredAccounts.length + ')</span>';
                pagHtml += '<button class="btn btn-secondary btn-small" onclick="goPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '>next</button>';
                pagination.innerHTML = pagHtml;
            } else {
                pagination.innerHTML = '';
            }
        }

        function goPage(page) {
            const totalPages = Math.ceil(filteredAccounts.length / pageSize);
            if (page < 1 || page > totalPages) return;
            currentPage = page;
            renderAccountList();
        }

        function switchAccount(id, email, password, apiKey) {
            if (!password && !apiKey) {
                showStatus('no password or apiKey', 'error');
                return;
            }
            showStatus('switching...', 'info');
            vscode.postMessage({ command: 'switchAccount', accountId: id, email: email, password: password, apiKey: apiKey });
        }

        function removeAccount(id) {
            vscode.postMessage({ command: 'removeAccount', accountId: id });
        }

        function showStatus(message, type) {
            const el = document.getElementById('statusMessage');
            el.textContent = message;
            el.className = 'status-message status-' + type;
            setTimeout(() => { el.className = 'status-message'; }, 3000);
        }
    </script>
</body>
</html>`;
}
async function handleAddAccount(context, email, password) {
    const account = {
        id: crypto.randomUUID(),
        email: email,
        password: password,
        name: email.split('@')[0]
    };
    accounts.push(account);
    saveAccounts(context);
    currentPanel?.webview.postMessage({
        command: 'updateAccounts',
        accounts: accounts
    });
    currentPanel?.webview.postMessage({
        command: 'accountAdded',
        email: email
    });
}
async function handleRemoveAccount(context, accountId) {
    accounts = accounts.filter(a => a.id !== accountId);
    saveAccounts(context);
    currentPanel?.webview.postMessage({
        command: 'updateAccounts',
        accounts: accounts
    });
    currentPanel?.webview.postMessage({
        command: 'accountRemoved'
    });
}
async function handleSwitchAccount(context, accountId, email, password, apiKey) {
    // Priority: apiKey > email/password
    let result;
    let accEmail = email;
    // If apiKey provided directly, use it
    if (apiKey) {
        result = await handleSwitchAccountWithApiKey(context, apiKey, email?.split('@')[0] || 'user', email, password);
    }
    else if (email && password) {
        // If email and password provided directly (from API accounts), use Firebase login
        result = await handleSwitchAccountWithEmail(context, email, password);
    }
    else {
        // Otherwise look in local accounts
        const account = accounts.find(a => a.id === accountId);
        if (!account) {
            currentPanel?.webview.postMessage({
                command: 'switchError',
                error: 'Account not found'
            });
            return;
        }
        accEmail = account.email;
        if (account.apiKey) {
            result = await handleSwitchAccountWithApiKey(context, account.apiKey, account.email.split('@')[0], account.email, account.password);
        }
        else if (account.password) {
            result = await handleSwitchAccountWithEmail(context, account.email, account.password);
        }
        else {
            currentPanel?.webview.postMessage({
                command: 'switchError',
                error: 'Account has no apiKey or password stored'
            });
            return;
        }
    }
    // Only mark as used if switch succeeded
    if (result.success) {
        const usedAccounts = context.globalState.get('ide-toolkit.usedAccounts') || {};
        // Use accountId if available, otherwise use email as key
        const usedKey = accountId || accEmail || email;
        if (usedKey) {
            usedAccounts[usedKey] = true;
            await context.globalState.update('ide-toolkit.usedAccounts', usedAccounts);
        }
        currentPanel?.webview.postMessage({
            command: 'switchSuccess',
            email: accEmail || email || 'account'
        });
    }
    else {
        currentPanel?.webview.postMessage({
            command: 'switchError',
            error: result.error || 'Unknown error'
        });
    }
}
async function handleSwitchAccountWithEmail(context, email, password) {
    try {
        // Step 1: Firebase login, get idToken
        const result = await loginWithFirebase(email, password);
        if (!result.idToken) {
            throw new Error(`Firebase login failed: ${result.error || 'Unknown error'}`);
        }
        const idToken = result.idToken;
        console.log('[Switch] Firebase login success, token length:', idToken.length);
        // Step 2: Use Firebase idToken directly with windsurf.loginWithAuthToken
        // (same as codepool - it uses access_token which is Firebase ID token)
        await logoutCurrent();
        await vscode.commands.executeCommand('windsurf.loginWithAuthToken', idToken);
        console.log('[Switch] windsurf.loginWithAuthToken succeeded');
        vscode.window.showInformationMessage(`Switched to: ${email}`);
        return { success: true, email };
    }
    catch (error) {
        console.error('[Switch] Switch failed:', error.message);
        return { success: false, error: error.message };
    }
}
// Direct apiKey injection - use windsurf.loginWithAuthToken (apiKey is actually Firebase id_token)
async function handleSwitchAccountWithApiKey(context, apiKey, name, email, password) {
    try {
        console.log('[Switch] Using apiKey (id_token), calling windsurf.loginWithAuthToken');
        // Logout current session first
        await logoutCurrent();
        // Use Windsurf's built-in loginWithAuthToken command (same as codepool)
        // apiKey is actually Firebase id_token
        await vscode.commands.executeCommand('windsurf.loginWithAuthToken', apiKey);
        console.log('[Switch] windsurf.loginWithAuthToken succeeded');
        vscode.window.showInformationMessage(`Switched to account: ${name}`);
        return { success: true, email: name };
    }
    catch (error) {
        console.error('[Switch] windsurf.loginWithAuthToken failed:', error.message);
        // If apiKey failed (expired), fallback to email/password if available
        if (email && password) {
            console.log('[Switch] apiKey may be expired, falling back to email/password');
            return await handleSwitchAccountWithEmail(context, email, password);
        }
        return { success: false, error: error.message };
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// 补丁方案二：给语言服务器 augment 文件打补丁（刷新 sessionId + 拦截 saveSession）
// ─────────────────────────────────────────────────────────────────────────────
/** Windsurf augment file path */
function getAugmentFilepath() {
    // Use vscode.env.appRoot (same as codepool)
    const appRoot = vscode.env?.appRoot;
    if (appRoot) {
        const candidate = path.join(appRoot, 'extensions', 'windsurf', 'dist', 'extension.js');
        if (fs.existsSync(candidate))
            return candidate;
    }
    // Fallback: find from loaded extension
    const windsurfExt = vscode.extensions.all.find(e => e.id.startsWith('codeium.windsurf'));
    if (windsurfExt) {
        const candidate = path.join(windsurfExt.extensionPath, 'dist', 'extension.js');
        if (fs.existsSync(candidate))
            return candidate;
    }
    return null;
}
const AUGMENT_GUARD = '/* __augment_patch_guard__ */';
/**
 * 补丁方案二：修改 augment 文件。
 * A. 在 registerUriHandler 前注入 sessionId 刷新，防止多账号 session 冲突。
 * B. 拦截 saveSession.apply() 调用。
 * @returns true = 打了补丁（需要重启），false = 无需操作
 */
async function applyAugmentPatch() {
    const augmentPath = getAugmentFilepath();
    if (!augmentPath) {
        console.warn('[AugmentPatch] 未找到 augment 文件，跳过');
        return false;
    }
    let code;
    try {
        code = fs.readFileSync(augmentPath, 'utf-8');
    }
    catch (e) {
        console.error('[AugmentPatch] 读取失败:', e.message);
        return false;
    }
    // 已打过补丁则跳过
    if (code.startsWith(AUGMENT_GUARD)) {
        console.log('[AugmentPatch] 已打补丁，跳过');
        return false;
    }
    let changed = false;
    // ── 补丁 A：registerUriHandler 前刷新 sessionId ──────────────────────────
    // 匹配：(<VAR>.window.registerUriHandler
    // 同时找到 <SESSION_VAR>.authRedirectURI.path 确定 session 变量名
    const uriHandlerRegex = /\((\w+)\.window\.registerUriHandler/;
    const sessionVarMatch = /(\w+)\.authRedirectURI\.path/.exec(code);
    if (sessionVarMatch && uriHandlerRegex.test(code)) {
        const sessionVar = sessionVarMatch[1];
        code = code.replace(uriHandlerRegex, `(${sessionVar}._authSession && ${sessionVar}._authSession._context && ` +
            `${sessionVar}._authSession._context.globalState.update("sessionId", require("crypto").randomUUID()), ` +
            `$1.window.registerUriHandler`);
        changed = true;
        console.log('[AugmentPatch] sessionId 刷新补丁已应用');
    }
    // ── 补丁 B：拦截 saveSession ──────────────────────────────────────────────
    const SAVE_ORIGINAL = '._authSession.saveSession.apply(L,arguments)';
    const SAVE_HOOKED = '._authSession.saveSession.apply(L,arguments);' +
        '(typeof __onSessionSaved === "function") && __onSessionSaved(...arguments)';
    if (code.includes(SAVE_ORIGINAL)) {
        code = code.replace(SAVE_ORIGINAL, SAVE_HOOKED);
        changed = true;
        console.log('[AugmentPatch] saveSession 拦截补丁已应用');
    }
    // ── 补丁 C：头部加 guard 防止重复打补丁 ──────────────────────────────────
    code = AUGMENT_GUARD + '\nvar __onSessionSaved;\n' + code;
    changed = true;
    if (!changed) {
        console.log('[AugmentPatch] 无可应用的变更');
        return false;
    }
    try {
        fs.writeFileSync(augmentPath, code, 'utf-8');
    }
    catch {
        try {
            fs.chmodSync(augmentPath, 0o644);
            fs.writeFileSync(augmentPath, code, 'utf-8');
        }
        catch (e) {
            console.error('[AugmentPatch] 写入失败:', e.message);
            return false;
        }
    }
    console.log('[AugmentPatch] augment 文件补丁完成');
    return true;
}
// ─────────────────────────────────────────────────────────────────────────────
// 补丁方案三的核心：执行账号切换（token → 覆盖 → 刷新状态）
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 登出当前账号，清除旧 session。
 */
async function logoutCurrent() {
    try {
        await vscode.commands.executeCommand('windsurf.signOut');
        console.log('[AutoLogin] 登出完成');
    }
    catch (e) {
        // 未登录时 signOut 会抛错，忽略即可
        console.warn('[AutoLogin] 登出跳过（可能已是未登录状态）');
    }
}
/**
 * 补丁方案三：拿到 apiKey → 通过注入命令覆盖 token → 刷新 Windsurf 状态。
 * 这是方案一补丁生效后的实际调用入口。
 */
async function injectTokenViaCommand(apiKey, name, apiServerUrl) {
    // 调用方案一注入的自定义命令
    await vscode.commands.executeCommand('windsurf.provideAuthTokenToAuthProviderWithShit', { apiKey, name, apiServerUrl });
    console.log('[AutoLogin] 新 token 已注入:', name);
}
// Register user with Windsurf server to get apiKey
async function registerUser(idToken) {
    const https = require('https');
    const registerData = JSON.stringify({
        firebase_id_token: idToken
    });
    console.log('Registering user with token length:', idToken?.length);
    const registerOptions = {
        hostname: 'api.codeium.com',
        port: 443,
        path: '/register_user/',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(registerData)
        }
    };
    return new Promise((resolve) => {
        const registerReq = https.request(registerOptions, (registerRes) => {
            let registerRespData = '';
            registerRes.on('data', (chunk) => { registerRespData += chunk; });
            registerRes.on('end', () => {
                try {
                    console.log('Register response status:', registerRes.statusCode);
                    console.log('Register response:', registerRespData);
                    const registerJson = JSON.parse(registerRespData);
                    if (registerJson.api_key) {
                        resolve({
                            apiKey: registerJson.api_key,
                            name: registerJson.name || 'user',
                            apiServerUrl: registerJson.api_server_url
                        });
                    }
                    else {
                        const errorMsg = registerJson.error?.message || registerJson.message || JSON.stringify(registerJson);
                        console.error('Register user error:', errorMsg);
                        // Return error message for display
                        registerJson.errorMessage = errorMsg;
                        resolve(registerJson);
                    }
                }
                catch (e) {
                    console.error('Parse register response error:', e, registerRespData);
                    resolve({ apiKey: '', name: '', errorMessage: 'Parse error: ' + registerRespData });
                }
            });
        });
        registerReq.on('error', (e) => {
            console.error('Register request error:', e);
            resolve({ apiKey: '', name: '', errorMessage: e.message });
        });
        registerReq.write(registerData);
        registerReq.end();
    });
}
// Write token directly to Windsurf's storage.json
async function writeTokenToStorageJson(apiKey, name, apiServerUrl) {
    try {
        const appData = process.env.APPDATA || process.env.HOME || '';
        const storagePath = path.join(appData, 'Windsurf', 'User', 'globalStorage', 'storage.json');
        if (!fs.existsSync(storagePath)) {
            console.error('Storage path not found:', storagePath);
            return false;
        }
        let storage = {};
        // Read existing storage
        const content = fs.readFileSync(storagePath, 'utf-8');
        try {
            storage = JSON.parse(content);
        }
        catch {
            storage = {};
        }
        // Update auth session
        const session = {
            id: Date.now().toString(),
            accessToken: apiKey,
            account: { label: name, id: name },
            scopes: []
        };
        if (apiServerUrl) {
            session.apiServerUrl = apiServerUrl;
        }
        storage['windsurf_auth.sessions'] = JSON.stringify([session]);
        // Write back
        fs.writeFileSync(storagePath, JSON.stringify(storage, null, 2), 'utf-8');
        console.log('Token written to storage.json');
        return true;
    }
    catch (e) {
        console.error('Failed to write storage:', e);
        return false;
    }
}
// Get Firebase idToken from email/password
async function loginWithFirebase(email, password) {
    const https = require('https');
    const FIREBASE_API_KEY = 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY';
    const firebaseData = JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true
    });
    const firebaseOptions = {
        hostname: 'identitytoolkit.googleapis.com',
        port: 443,
        path: `/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(firebaseData),
            'Referer': 'https://windsurf.com/',
            'Origin': 'https://windsurf.com'
        }
    };
    return new Promise((resolve) => {
        const firebaseReq = https.request(firebaseOptions, (firebaseRes) => {
            let firebaseRespData = '';
            firebaseRes.on('data', (chunk) => { firebaseRespData += chunk; });
            firebaseRes.on('end', () => {
                try {
                    const firebaseJson = JSON.parse(firebaseRespData);
                    if (firebaseJson.idToken) {
                        resolve({ idToken: firebaseJson.idToken });
                    }
                    else {
                        const errorMsg = firebaseJson.error?.message || 'Unknown Firebase error';
                        console.error('Firebase auth error:', errorMsg);
                        resolve({ idToken: null, error: errorMsg });
                    }
                }
                catch (e) {
                    console.error('Parse Firebase response error:', e);
                    resolve({ idToken: null, error: 'Failed to parse Firebase response' });
                }
            });
        });
        firebaseReq.on('error', (e) => {
            console.error('Firebase request error:', e);
            resolve({ idToken: null, error: e.message });
        });
        firebaseReq.write(firebaseData);
        firebaseReq.end();
    });
}
async function loginWithEmailPassword(email, password) {
    // Step 1: Firebase login to get idToken
    const https = require('https');
    const FIREBASE_API_KEY = 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY';
    const firebaseData = JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true
    });
    const firebaseOptions = {
        hostname: 'identitytoolkit.googleapis.com',
        port: 443,
        path: `/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(firebaseData)
        }
    };
    return new Promise((resolve) => {
        // Step 1: Get Firebase idToken
        const firebaseReq = https.request(firebaseOptions, (firebaseRes) => {
            let firebaseRespData = '';
            firebaseRes.on('data', (chunk) => { firebaseRespData += chunk; });
            firebaseRes.on('end', () => {
                try {
                    const firebaseJson = JSON.parse(firebaseRespData);
                    if (!firebaseJson.idToken) {
                        const errorMsg = firebaseJson.error?.message || firebaseRespData;
                        console.error('Firebase auth error:', errorMsg);
                        // Return detailed error
                        resolve({ apiKey: '', name: '', error: 'Firebase: ' + errorMsg });
                        return;
                    }
                    const idToken = firebaseJson.idToken;
                    // Step 2: Exchange idToken for apiKey via register_user API
                    const registerData = JSON.stringify({
                        firebase_id_token: idToken
                    });
                    const registerOptions = {
                        hostname: 'api.codeium.com',
                        port: 443,
                        path: '/register_user/',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(registerData)
                        }
                    };
                    const registerReq = https.request(registerOptions, (registerRes) => {
                        let registerRespData = '';
                        registerRes.on('data', (chunk) => { registerRespData += chunk; });
                        registerRes.on('end', () => {
                            try {
                                const registerJson = JSON.parse(registerRespData);
                                if (registerJson.api_key) {
                                    resolve({
                                        apiKey: registerJson.api_key,
                                        name: registerJson.name || email
                                    });
                                }
                                else {
                                    console.error('Register user error:', registerRespData);
                                    resolve({ apiKey: '', name: '', error: 'Codeium: ' + registerRespData });
                                }
                            }
                            catch (e) {
                                console.error('Parse register response error:', e);
                                resolve(null);
                            }
                        });
                    });
                    registerReq.on('error', (e) => {
                        console.error('Register request error:', e);
                        resolve(null);
                    });
                    registerReq.write(registerData);
                    registerReq.end();
                }
                catch (e) {
                    console.error('Parse Firebase response error:', e);
                    resolve(null);
                }
            });
        });
        firebaseReq.on('error', (e) => {
            console.error('Firebase request error:', e);
            resolve(null);
        });
        firebaseReq.write(firebaseData);
        firebaseReq.end();
    });
}
async function refreshDevice(context) {
    try {
        // Generate new device ID
        const newDeviceId = crypto.randomUUID();
        // Find Windsurf's storage.json
        const appDataPath = process.env.APPDATA || process.env.HOME || '';
        const possiblePaths = [
            path.join(appDataPath, 'Windsurf', 'User', 'globalStorage', 'storage.json'),
            path.join(appDataPath, '.windsurf', 'User', 'globalStorage', 'storage.json'),
        ];
        let storagePath;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                storagePath = p;
                break;
            }
        }
        if (storagePath && fs.existsSync(storagePath)) {
            const storage = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
            storage.deviceId = newDeviceId;
            fs.writeFileSync(storagePath, JSON.stringify(storage, null, 2));
        }
        currentPanel?.webview.postMessage({
            command: 'deviceRefreshed'
        });
    }
    catch (error) {
        currentPanel?.webview.postMessage({
            command: 'switchError',
            error: error.message
        });
    }
}
function deactivate() {
    console.log('IDE Toolkit deactivated');
}
//# sourceMappingURL=extension_en.js.map