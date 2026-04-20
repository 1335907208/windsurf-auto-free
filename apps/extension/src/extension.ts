import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Account data structure
interface AccountInfo {
    id: string;
    email: string;
    password?: string;
    name?: string;
    apiKey?: string;
    accessToken?: string;
}

// Session structure (matches Windsurf's internal format)
interface AuthSession {
    id: string;
    accessToken: string;
    account: {
        label: string;
        id: string;
    };
    scopes: string[];
}

// Storage keys
const SESSIONS_SECRET_KEY = 'windsurf_auth.sessions';
const API_SERVER_URL_KEY = 'apiServerUrl';
const ACCOUNTS_STORAGE_KEY = 'ide-toolkit.accounts';

let accounts: AccountInfo[] = [];
let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('IDE Toolkit is now active');

    // Load saved accounts
    loadAccounts(context);

    // Auto apply Windsurf patch on activate (like CodePool)
    applyWindsurfPatch(context, true).catch(err => {
        console.error('[WindsurfPatch] Auto patch failed:', err);
    });

    // Register WebviewViewProvider for sidebar icon
    const provider = new SidebarProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('ide-toolkit.welcome', provider)
    );

    // Register command to open panel
    context.subscriptions.push(
        vscode.commands.registerCommand('ide-toolkit.openPanel', () => openWebviewPanel(context)),
        vscode.commands.registerCommand('ide-toolkit.refreshDevice', () => refreshDevice(context)),
        vscode.commands.registerCommand('ide-toolkit.patchWindsurf', async () => {
            const patched = await applyWindsurfPatch(context, true);
            if (patched) {
                const action = await vscode.window.showInformationMessage('Windsurf 扩展补丁已应用，需要重启窗口生效。', '重启窗口');
                if (action === '重启窗口') {
                    await vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            } else {
                vscode.window.showInformationMessage('Windsurf 扩展无需修改（可能已打过补丁或未找到扩展文件）。');
            }
        })
    );
}

const WINDSURF_HOOK_START = '/*__CODEPOOL_HOOK_START__*/';
const WINDSURF_HOOK_END = '/*__CODEPOOL_HOOK_END__*/';

function getWindsurfExtensionFilepath(): string | null {
    // Same as codepool: use vscode.env.appRoot
    const appRoot = (vscode as any).env?.appRoot;
    if (!appRoot) {
        console.warn('[WindsurfPatch] vscode.env.appRoot not available');
        return null;
    }
    
    const candidate = path.join(appRoot, 'extensions', 'windsurf', 'dist', 'extension.js');
    if (fs.existsSync(candidate)) {
        return candidate;
    }
    
    console.warn('[WindsurfPatch] Windsurf extension not found at:', candidate);
    return null;
}

function readWindsurfHookCode(context: vscode.ExtensionContext): string | null {
    try {
        const hookPath = path.join(context.extensionPath, 'hook_code.js');
        if (!fs.existsSync(hookPath)) return null;
        let code = fs.readFileSync(hookPath, 'utf-8');
        code = code.replace(WINDSURF_HOOK_START, '').replace(WINDSURF_HOOK_END, '');
        return code;
    } catch (e: any) {
        console.error('[WindsurfPatch] 读取 hook_code.js 失败:', e?.message || String(e));
        return null;
    }
}

async function applyWindsurfPatch(context: vscode.ExtensionContext, injectIfMissing: boolean): Promise<boolean> {
    const windsurfPath = getWindsurfExtensionFilepath();
    if (!windsurfPath) {
        console.warn('[WindsurfPatch] 未找到 windsurf 扩展文件，跳过');
        return false;
    }

    const hookCode = readWindsurfHookCode(context);
    if (!hookCode) {
        console.warn('[WindsurfPatch] 未找到 hook_code.js，跳过');
        return false;
    }

    let src: string;
    try {
        src = fs.readFileSync(windsurfPath, 'utf-8');
    } catch (e: any) {
        console.error('[WindsurfPatch] 读取失败:', e?.message || String(e));
        return false;
    }

    let changed = false;

    if (src.includes(WINDSURF_HOOK_START) && src.includes(WINDSURF_HOOK_END)) {
        const startIdx = src.indexOf(WINDSURF_HOOK_START);
        const endIdx = src.indexOf(WINDSURF_HOOK_END, startIdx + WINDSURF_HOOK_START.length);
        if (endIdx > startIdx) {
            const existing = src.slice(startIdx + WINDSURF_HOOK_START.length, endIdx);
            if (existing !== hookCode) {
                src = src.slice(0, startIdx + WINDSURF_HOOK_START.length) + hookCode + src.slice(endIdx);
                changed = true;
                console.log('[WindsurfPatch] 已更新 hook 代码');
            }
        }
    } else if (injectIfMissing) {
        src = `${WINDSURF_HOOK_START}${hookCode}${WINDSURF_HOOK_END}` + src;
        changed = true;
        console.log('[WindsurfPatch] 已注入 hook 代码到文件开头');
    }

    // Patch 1: LOGIN_WITH_AUTH_TOKEN handler - use getInstance()
    const loginHandlerRegex = /\.LOGIN_WITH_AUTH_TOKEN,\([^)]*\)=>\{[^}]+\}/;
    const correctHandler = '.LOGIN_WITH_AUTH_TOKEN,(acc)=>{const w=f.WindsurfAuthProvider.getInstance();acc?w.handleAuthToken(acc):w.provideAuthToken()}';
    
    if (loginHandlerRegex.test(src)) {
        const original = src.match(loginHandlerRegex)?.[0];
        if (original !== correctHandler) {
            src = src.replace(loginHandlerRegex, correctHandler);
            changed = true;
            console.log('[WindsurfPatch] 已更新 LOGIN_WITH_AUTH_TOKEN 处理器');
        }
    }

    // Patch 2: handleAuthToken function - for auth1 tokens, just pass through to let extension handle it
    // The extension will fail with registerUser, but we've tried our best
    // Real solution requires Windsurf official support for auth1 tokens

    if (!changed) return false;

    try {
        fs.writeFileSync(windsurfPath, src, 'utf-8');
        return true;
    } catch {
        try {
            fs.chmodSync(windsurfPath, 0o644);
            fs.writeFileSync(windsurfPath, src, 'utf-8');
            return true;
        } catch (e: any) {
            console.error('[WindsurfPatch] 写入失败:', e?.message || String(e));
            return false;
        }
    }
}

// Sidebar provider - shows a button to open the main panel
class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ide-toolkit.welcome';

    private _view: vscode.WebviewView | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();
        
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'openPanel') {
                vscode.commands.executeCommand('ide-toolkit.openPanel');
            } else if (message.command === 'quickSwitch') {
                await this.handleQuickSwitch();
            } else if (message.command === 'setBackendUrl') {
                await this.setBackendUrl(message.url);
            } else if (message.command === 'clearUsedStatus') {
                await this.clearUsedStatus();
            } else if (message.command === 'getStats') {
                await this.updateStats();
            } else if (message.command === 'importAccounts') {
                await this.handleImportAccounts();
            } else if (message.command === 'clearAllAccounts') {
                await this.clearAllAccounts();
            }
        });
    }

    private getHtml(): string {
        const config = vscode.workspace.getConfiguration('ideToolkit');
        const backendUrl = config.get<string>('backendUrl') || 'http://localhost:3001';

        return `<!DOCTYPE html>
<html lang="zh-CN">
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
    <h2>Windsurf 账号切换器</h2>
    <p>管理并切换多个 Windsurf 账号</p>
</div>

<div class="section">
    <div class="section-title">快捷操作</div>
    <div class="btn-group">
        <button class="btn btn-primary" onclick="openPanel()">
            <span>账号管理器</span>
        </button>
        <button class="btn btn-secondary" onclick="quickSwitch()">
            <span>快速切换（下一个未使用）</span>
        </button>
    </div>
    <div id="status" class="status" style="display:none;"></div>
</div>

<div class="section">
    <div class="section-title">配置</div>
    <div class="form-group">
        <label for="backendUrl">后端地址</label>
        <input type="text" id="backendUrl" value="${backendUrl}" placeholder="http://localhost:3001">
    </div>
    <button class="btn btn-secondary" onclick="saveConfig()" style="width:100%;">保存配置</button>
</div>

<div class="section">
    <div class="section-title">统计</div>
    <div class="stats">
        <div class="stat-item">
            <div class="stat-value" id="totalAccounts">-</div>
            <div class="stat-label">总数</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="usedAccounts">-</div>
            <div class="stat-label">已使用</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="unusedAccounts">-</div>
            <div class="stat-label">可用</div>
        </div>
    </div>
    <button class="btn btn-danger" onclick="clearUsedStatus()" style="width:100%;">清空全部“已使用”标记</button>
    <button class="btn btn-danger" onclick="clearAllAccounts()" style="width:100%;margin-top:8px;">清空全部账号</button>
    <div class="divider" style="margin: 12px 0;"></div>
    <button class="btn btn-primary" onclick="importAccounts()" style="width:100%;">导入账号(可从前端导出成功账号)</button>
</div>

<script>
const vscode = acquireVsCodeApi();

function openPanel() {
    vscode.postMessage({ command: 'openPanel' });
}

function quickSwitch() {
    showStatus('正在查找未使用的账号...', 'info');
    vscode.postMessage({ command: 'quickSwitch' });
}

function saveConfig() {
    const url = document.getElementById('backendUrl').value.trim();
    if (url) {
        vscode.postMessage({ command: 'setBackendUrl', url: url });
        showStatus('配置已保存！', 'success');
    }
}

function clearUsedStatus() {
    vscode.postMessage({ command: 'clearUsedStatus' });
}

function importAccounts() {
    vscode.postMessage({ command: 'importAccounts' });
}

function clearAllAccounts() {
    vscode.postMessage({ command: 'clearAllAccounts' });
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
        showStatus('配置已保存！', 'success');
    } else if (message.command === 'usedStatusCleared') {
        showStatus('"Used" status cleared!', 'success');
    } else if (message.command === 'importResult') {
        showStatus(message.message, message.success ? 'success' : 'error');
    } else if (message.command === 'accountsCleared') {
        showStatus('账号已清空！', 'success');
    }
});

// Request stats on load
vscode.postMessage({ command: 'getStats' });
</script>
</body>
</html>`;
    }

    private async handleQuickSwitch() {
        const usedAccounts = this.context.globalState.get<Record<string, boolean>>('ide-toolkit.usedAccounts') || {};

        // Use local cached accounts
        const allAccounts = this.context.globalState.get<AccountInfo[]>('ide-toolkit.cachedAccounts') || [];

        if (allAccounts.length === 0) {
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: '缓存中没有账号，请先打开“账号管理器”。',
                success: false
            });
            return;
        }

        // Find first unused account (with apiKey or password)
        // Check both id and email as usedAccounts key
        const unusedAccount = allAccounts.find(acc =>
            !usedAccounts[acc.id] && !usedAccounts[acc.email] && (acc.apiKey || acc.password)
        );

        if (!unusedAccount) {
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: '没有可用的未使用账号'
            });
            return;
        }

        // Use apiKey if available, otherwise use password
        let switchResult: { success: boolean; error?: string; email?: string };
        if (unusedAccount.apiKey) {
            switchResult = await handleSwitchAccountWithApiKey(this.context, unusedAccount.apiKey, unusedAccount.email.split('@')[0], unusedAccount.email, unusedAccount.password);
        } else if (unusedAccount.password) {
            switchResult = await handleSwitchAccountWithEmail(this.context, unusedAccount.email, unusedAccount.password);
        } else {
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: '该账号未保存 apiKey 或密码'
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
                message: '已切换到：' + unusedAccount.email,
                success: true
            });
        } else {
            this._view?.webview.postMessage({
                command: 'quickSwitchResult',
                message: '切换失败：' + (switchResult.error || '未知错误'),
                success: false
            });
        }
    }

    private async setBackendUrl(url: string) {
        await vscode.workspace.getConfiguration('ideToolkit').update('backendUrl', url, true);
        this._view?.webview.postMessage({ command: 'configSaved' });
    }

    private async clearUsedStatus() {
        const confirm = await vscode.window.showWarningMessage(
            '确定清空全部“已使用”标记吗？',
            { modal: true },
            '确定'
        );
        if (confirm !== '确定') return;

        await this.context.globalState.update('ide-toolkit.usedAccounts', {});
        this._view?.webview.postMessage({ command: 'usedStatusCleared' });
        await this.updateStats();
    }

    private async clearAllAccounts() {
        const confirm = await vscode.window.showWarningMessage(
            '确定清空全部账号吗？这会删除所有本地缓存的账号数据。',
            { modal: true },
            '确定'
        );
        if (confirm !== '确定') return;

        await this.context.globalState.update('ide-toolkit.cachedAccounts', []);
        await this.context.globalState.update('ide-toolkit.usedAccounts', {});
        this._view?.webview.postMessage({ command: 'accountsCleared' });
        await this.updateStats();
    }

    private async updateStats() {
        const usedAccounts = this.context.globalState.get<Record<string, boolean>>('ide-toolkit.usedAccounts') || {};
        let allAccounts = this.context.globalState.get<AccountInfo[]>('ide-toolkit.cachedAccounts') || [];

        // If local cache is empty, try to fetch from backend
        if (allAccounts.length === 0) {
            try {
                const result = await fetchFromBackend('/api/windsurf/accounts');
                if (result.success && result.data && result.data.length > 0) {
                    allAccounts = result.data;
                    // Update cache
                    await this.context.globalState.update('ide-toolkit.cachedAccounts', allAccounts);
                }
            } catch (e) {
                console.error('Failed to fetch accounts from backend:', e);
            }
        }

        const total = allAccounts.length;
        const used = Object.keys(usedAccounts).length / 2; // Divide by 2 since we store both id and email
        this._view?.webview.postMessage({
            command: 'updateStats',
            total: total,
            used: Math.floor(used)
        });
    }

    private async handleImportAccounts() {
        // Open file picker
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Text Files': ['txt'] },
            title: 'Select account file (format: email:password)'
        });

        if (!uris || uris.length === 0) return;

        const fileUri = uris[0];
        const content = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(content).toString('utf-8');

        // Parse accounts (format: email:password or email:password:apiKey per line)
        const lines = text.split(/\r?\n/).filter((line: string) => line.trim());
        const importAccounts: AccountInfo[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(':');
            const email = parts[0]?.trim();
            if (email && email.includes('@')) {
                let password = parts[1]?.trim();
                // Remove trailing colons from password (in case of malformed export)
                while (password && password.endsWith(':')) {
                    password = password.slice(0, -1).trim();
                }
                const apiKey = parts[2]?.trim();
                importAccounts.push({
                    id: crypto.randomUUID(),
                    email: email,
                    password: password || undefined,
                    apiKey: apiKey || undefined,
                    name: email.split('@')[0]
                });
            }
        }

        if (importAccounts.length === 0) {
            this._view?.webview.postMessage({
                command: 'importResult',
                success: false,
                message: 'No valid accounts found (format: email:password)'
            });
            return;
        }

        // Get existing cached accounts
        const cachedAccounts = this.context.globalState.get<AccountInfo[]>('ide-toolkit.cachedAccounts') || [];
        let imported = 0;
        let skipped = 0;

        for (const acc of importAccounts) {
            // Check if already exists
            const exists = cachedAccounts.some(c => c.email === acc.email);
            if (exists) {
                skipped++;
                continue;
            }
            cachedAccounts.push(acc);
            imported++;
        }

        // Save to cache
        await this.context.globalState.update('ide-toolkit.cachedAccounts', cachedAccounts);

        this._view?.webview.postMessage({
            command: 'importResult',
            success: true,
            message: `Imported: ${imported}, skipped (duplicates): ${skipped}`
        });

        await this.updateStats();
    }
}

// Backend API configuration
const DEFAULT_BACKEND_URL = 'http://localhost:3001';

async function fetchFromBackend(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    const config = vscode.workspace.getConfiguration('ideToolkit');
    const baseUrl = config.get<string>('backendUrl') || DEFAULT_BACKEND_URL;

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

        const req = client.request(options, (res: any) => {
            let data = '';
            res.on('data', (chunk: string) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });

        req.on('error', (e: Error) => {
            console.error('Backend request error:', e);
            reject(e);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// Webview View Provider for sidebar
class AccountViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ide-toolkit.main';

    private _view: vscode.WebviewView | undefined;
    private backendAccounts: any[] = [];

    constructor(private context: vscode.ExtensionContext) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
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

    private async setBackendUrl(url: string) {
        await vscode.workspace.getConfiguration('ideToolkit').update('backendUrl', url, true);
        this._view?.webview.postMessage({
            command: 'backendUrlSaved',
            url: url
        });
        await this.updateAccounts();
    }

    private async updateAccounts() {
        const usedAccounts = this.context.globalState.get<Record<string, boolean>>('ide-toolkit.usedAccounts') || {};
        const cachedAccounts = this.context.globalState.get<AccountInfo[]>('ide-toolkit.cachedAccounts') || [];
        
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
            } else {
                // Use cached accounts as fallback
                const fallbackAccounts = cachedAccounts.length > 0 ? cachedAccounts : accounts;
                this._view?.webview.postMessage({
                    command: 'updateAccounts',
                    accounts: fallbackAccounts,
                    usedAccounts: usedAccounts,
                    source: 'local'
                });
            }
        } catch (error) {
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

    private async handleAddAccount(email: string, password: string) {
        const account: AccountInfo = {
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

    private async handleSwitchAccount(accountId: string, email?: string, password?: string, apiKey?: string) {
        // Show loading state
        this._view?.webview.postMessage({
            command: 'switching',
            email: email || 'account'
        });
        vscode.window.showInformationMessage('正在切换账号...');

        let account = this.backendAccounts.find(a => a.id === accountId);
        if (!account) {
            account = accounts.find(a => a.id === accountId);
        }

        if (!account) {
            this._view?.webview.postMessage({
                command: 'switchError',
                error: '未找到账号'
            });
            vscode.window.showErrorMessage('未找到账号');
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
        let result: { success: boolean; error?: string; email?: string };
        
        if (accApiKey) {
            // Use direct apiKey injection (no Firebase login needed)
            console.log('[Switch] Using apiKey for account:', accEmail);
            result = await handleSwitchAccountWithApiKey(this.context, accApiKey, accEmail.split('@')[0]);
        } else if (accPassword) {
            // Fallback to Firebase login
            console.log('[Switch] No apiKey, using Firebase login for account:', accEmail);
            result = await handleSwitchAccountWithEmail(this.context, accEmail, accPassword);
        } else {
            this._view?.webview.postMessage({
                command: 'switchError',
                error: '该账号未保存 apiKey 或密码'
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
            const usedAccounts = this.context.globalState.get<Record<string, boolean>>('ide-toolkit.usedAccounts') || {};
            usedAccounts[accountId] = true;
            usedAccounts[accEmail] = true;
            await this.context.globalState.update('ide-toolkit.usedAccounts', usedAccounts);
        } else {
            this._view?.webview.postMessage({
                command: 'switchError',
                error: result.error || '未知错误'
            });
        }
        
        this.updateAccounts();
    }

    private async handleRemoveAccount(accountId: string) {
        try {
            await fetchFromBackend(`/api/windsurf/accounts/${accountId}`, 'DELETE');
            this._view?.webview.postMessage({
                command: 'accountDeleted',
                id: accountId
            });
        } catch {
            accounts = accounts.filter(a => a.id !== accountId);
            saveAccounts(this.context);
            this._view?.webview.postMessage({
                command: 'accountDeleted',
                id: accountId
            });
        }
        await this.updateAccounts();
    }

    private async refreshDevice() {
        await refreshDevice(this.context);
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>账号管理器</title>
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
    <h2 class="collapsible-header open">设置</h2>
    <div class="collapsible-content open" style="margin-bottom: 12px;">
        <div class="form-group">
            <label for="backendUrl">API 地址</label>
            <input type="text" id="backendUrl" placeholder="http://localhost:3001">
        </div>
        <button class="btn btn-secondary" id="saveBackendBtn">保存地址</button>
    </div>

    <div class="divider"></div>

    <h2>账号 <span id="sourceBadge" class="source-badge"></span></h2>
    <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
        <button class="btn btn-secondary" id="refreshDeviceBtn">刷新设备ID</button>
        <button class="btn btn-primary" id="refreshBtn">刷新</button>
        <button class="btn btn-secondary" id="toggleAddBtn">添加账号</button>
        <button class="btn btn-secondary" id="importBtn">导入账号</button>
    </div>
    
    <div id="addAccountForm" class="collapsible-content" style="margin-bottom: 12px;">
        <div class="form-group">
            <label for="email">邮箱</label>
            <input type="text" id="email" placeholder="输入邮箱">
        </div>
        <div class="form-group">
            <label for="password">密码</label>
            <input type="password" id="password" placeholder="输入密码">
        </div>
        <button class="btn btn-primary" id="addAccountBtn">添加</button>
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
            showStatus('刷新中...', 'info');
            vscode.postMessage({ command: 'getAccounts' });
        });

        // Toggle add account form
        document.getElementById('toggleAddBtn').addEventListener('click', () => {
            const form = document.getElementById('addAccountForm');
            form.classList.toggle('open');
        });

        // Import accounts
        document.getElementById('importBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'importAccounts' });
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
                showStatus('请输入邮箱和密码', 'error');
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
                    showStatus('后端地址已保存：' + message.url, 'success');
                    break;
                case 'accountAdded':
                    showStatus('账号已添加：' + message.email, 'success');
                    break;
                case 'switching':
                    showStatus('正在切换到 ' + message.email + '...', 'info');
                    break;
                case 'switchSuccess':
                    showStatus('已切换到：' + message.email, 'success');
                    vscode.postMessage({ command: 'refreshAccounts' });
                    break;
                case 'switchError':
                    showStatus('切换失败：' + message.error, 'error');
                    break;
                case 'accountDeleted':
                    showStatus('账号已删除', 'success');
                    break;
                case 'deviceRefreshed':
                    showStatus('设备ID已刷新', 'success');
                    break;
            }
        });

        function updateSourceBadge() {
            const badge = document.getElementById('sourceBadge');
            badge.textContent = dataSource === 'backend' ? 'API' : '本地';
            badge.className = 'source-badge ' + (dataSource === 'backend' ? 'source-backend' : 'source-local');
        }

        function renderAccountList() {
            const list = document.getElementById('accountList');
            const pagination = document.getElementById('pagination');

            if (accounts.length === 0) {
                list.innerHTML = '<div class="no-accounts">未找到账号</div>';
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
                const usedBadge = isUsed ? '<span class="used-badge">已使用</span>' : '';
                const btnClass = isUsed ? 'btn-used' : 'btn-primary';
                const btnDisabled = '';

                html += '<div class="account-item ' + usedClass + '">' +
                    '<div class="account-info">' +
                    '<div class="account-email">' + (acc.email || '') + usedBadge + '</div>' +
                    '<div class="account-status">' + (acc.status || acc.name || '') + '</div>' +
                    '</div>' +
                    '<div class="account-actions">' +
                    '<button class="btn ' + btnClass + ' btn-small" ' + btnDisabled + ' onclick="switchAccount(\\'' + acc.id + '\\', \\'' + (acc.email || '') + '\\', \\'' + (acc.password || '') + '\\', \\'' + (acc.apiKey || '') + '\\')">切换</button>' +
                    '<button class="btn btn-danger btn-small" onclick="removeAccount(\\'' + acc.id + '\\')">删除</button>' +
                    '</div>' +
                    '</div>';
            });

            // Pagination
            if (totalPages > 1) {
                let pagHtml = '';
                pagHtml += '<button class="btn btn-secondary btn-small" onclick="goPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>上一页</button>';
                pagHtml += '<span class="pagination-info">第 ' + currentPage + ' / ' + totalPages + ' 页（共 ' + accounts.length + ' 个）</span>';
                pagHtml += '<button class="btn btn-secondary btn-small" onclick="goPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '>下一页</button>';
                pagination.innerHTML = pagHtml;
            } else {
                pagination.innerHTML = '<span class="pagination-info">共 ' + accounts.length + ' 个账号</span>';
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

function loadAccounts(context: vscode.ExtensionContext) {
    const saved = context.globalState.get<AccountInfo[]>(ACCOUNTS_STORAGE_KEY);
    if (saved) {
        accounts = saved;
    }
}

function saveAccounts(context: vscode.ExtensionContext) {
    context.globalState.update(ACCOUNTS_STORAGE_KEY, accounts);
}

function openWebviewPanel(context: vscode.ExtensionContext) {
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.One);
        return;
    }

    currentPanel = vscode.window.createWebviewPanel(
        'accountManager',
        '账号管理器',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    currentPanel.webview.html = getWebviewContent(accounts);

    // Handle messages from webview
    currentPanel.webview.onDidReceiveMessage(
        async (message) => {
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
                case 'importAccounts':
                    await handleImportAccountsMain(context);
                    break;
                case 'getAccounts':
                case 'refreshAccounts':
                    // Fetch from backend
                    const usedAccounts = context.globalState.get<Record<string, boolean>>('ide-toolkit.usedAccounts') || {};
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
                        } else {
                            // Use cached accounts if backend fails
                            const cachedAccounts = context.globalState.get<AccountInfo[]>('ide-toolkit.cachedAccounts') || accounts;
                            currentPanel?.webview.postMessage({
                                command: 'updateAccounts',
                                accounts: cachedAccounts,
                                usedAccounts: usedAccounts,
                                source: 'local'
                            });
                        }
                    } catch {
                        // Use cached accounts if backend fails
                        const cachedAccounts = context.globalState.get<AccountInfo[]>('ide-toolkit.cachedAccounts') || accounts;
                        currentPanel?.webview.postMessage({
                            command: 'updateAccounts',
                            accounts: cachedAccounts,
                            usedAccounts: usedAccounts,
                            source: 'local'
                        });
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    currentPanel.onDidDispose(
        () => { currentPanel = undefined; },
        undefined,
        context.subscriptions
    );
}

function getWebviewContent(accounts: AccountInfo[]): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>账号管理器</title>
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
        <h1>账号管理器</h1>
        <div class="header-actions">
            <button class="btn btn-secondary" id="refreshDeviceBtn">刷新设备ID</button>
            <button class="btn btn-primary" id="refreshBtn">刷新</button>
            <button class="btn btn-secondary" id="addBtn">添加账号</button>
            <button class="btn btn-secondary" id="importBtn">导入账号</button>
        </div>
    </div>
    
    <div id="statusMessage" class="status-message"></div>
    
    <div class="toolbar">
        <div class="search-box">
            <input type="text" id="searchInput" placeholder="搜索账号...">
        </div>
        <div class="stats">
            <span id="totalCount">0 个账号</span>
            <span id="sourceBadge"></span>
        </div>
    </div>
    
    <div id="accountList" class="account-list"></div>
    
    <div id="pagination" class="pagination"></div>

    <div class="modal" id="addModal">
        <div class="modal-content">
            <div class="modal-title">添加账号</div>
            <div class="modal-body">
                <div class="form-group">
                    <label>邮箱</label>
                    <input type="text" id="modalEmail" placeholder="输入邮箱">
                </div>
                <div class="form-group">
                    <label>密码</label>
                    <input type="password" id="modalPassword" placeholder="输入密码">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal()">取消</button>
                <button class="btn btn-primary" id="modalAddBtn">添加</button>
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
            showStatus('刷新中...', 'info');
            vscode.postMessage({ command: 'getAccounts' });
        });
        
        // Add account modal
        document.getElementById('addBtn').addEventListener('click', () => {
            document.getElementById('addModal').classList.add('open');
            document.getElementById('modalEmail').focus();
        });
        
        // Import accounts
        document.getElementById('importBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'importAccounts' });
        });
        
        document.getElementById('modalAddBtn').addEventListener('click', () => {
            const email = document.getElementById('modalEmail').value.trim();
            const password = document.getElementById('modalPassword').value;
            if (!email || !password) {
                showStatus('请输入邮箱和密码', 'error');
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
                    document.getElementById('sourceBadge').textContent = dataSource === 'backend' ? '(API)' : '(本地)';
                    document.getElementById('totalCount').textContent = allAccounts.length + ' 个账号';
                    renderAccountList();
                    break;
                case 'accountAdded':
                    showStatus('账号已添加: ' + message.email, 'success');
                    break;
                case 'switching':
                    showStatus('正在切换到 ' + message.email + '...', 'info');
                    break;
                case 'switchSuccess':
                    showStatus('已切换到: ' + message.email, 'success');
                    break;
                case 'switchError':
                    showStatus('切换失败: ' + message.error, 'error');
                    break;
                case 'deviceRefreshed':
                    showStatus('设备ID已刷新', 'success');
                    break;
                case 'importResult':
                    showStatus(message.message, message.success ? 'success' : 'error');
                    if (message.success) {
                        vscode.postMessage({ command: 'getAccounts' });
                    }
                    break;
            }
        });
        
        function renderAccountList() {
            const container = document.getElementById('accountList');
            const pagination = document.getElementById('pagination');
            
            if (filteredAccounts.length === 0) {
                container.innerHTML = '<div class="no-accounts">未找到账号</div>';
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
                const usedBadge = isUsed ? ' <span style="font-size:10px;background:#666;color:#ccc;padding:1px 4px;border-radius:2px;">已使用</span>' : '';
                const btnClass = isUsed ? 'btn-secondary' : 'btn-primary';
                const btnDisabled = '';
                html += '<div class="account-item' + (isUsed ? ' used' : '') + '">' +
                    '<div class="account-info">' +
                    '<div class="account-email">' + (acc.email || '') + usedBadge + '</div>' +
                    '<div class="account-status">' + (hasPassword ? '已保存密码' : '未保存密码') + '</div>' +
                    '</div>' +
                    '<div class="account-actions">' +
                    '<button class="btn ' + btnClass + ' btn-small" ' + btnDisabled + ' onclick="switchAccount(\\'' + acc.id + '\\',\\'' + email + '\\',\\'' + password + '\\',\\'' + (acc.apiKey || '') + '\\')">切换</button>' +
                    '<button class="btn btn-danger btn-small" onclick="removeAccount(\\'' + acc.id + '\\')">删除</button>' +
                    '</div></div>';
            });
            container.innerHTML = html;

            // Pagination
            if (totalPages > 1) {
                let pagHtml = '';
                pagHtml += '<button class="btn btn-secondary btn-small" onclick="goPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>上一页</button>';
                pagHtml += '<span class="pagination-info">第 ' + currentPage + ' / ' + totalPages + ' 页（共 ' + filteredAccounts.length + ' 个）</span>';
                pagHtml += '<button class="btn btn-secondary btn-small" onclick="goPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '>下一页</button>';
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
                showStatus('未保存密码或 apiKey', 'error');
                return;
            }
            showStatus('切换中...', 'info');
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

async function handleAddAccount(context: vscode.ExtensionContext, email: string, password: string) {
    const account: AccountInfo = {
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

async function handleRemoveAccount(context: vscode.ExtensionContext, accountId: string) {
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

async function handleImportAccountsMain(context: vscode.ExtensionContext) {
    // Open file picker
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Text Files': ['txt'] },
        title: 'Select account file (format: email:password)'
    });

    if (!uris || uris.length === 0) return;

    const fileUri = uris[0];
    const content = await vscode.workspace.fs.readFile(fileUri);
    const text = Buffer.from(content).toString('utf-8');

    // Parse accounts (format: email:password or email:password:apiKey per line)
    const lines = text.split(/\r?\n/).filter((line: string) => line.trim());
    const importAccounts: AccountInfo[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(':');
        const email = parts[0]?.trim();
        if (email && email.includes('@')) {
            let password = parts[1]?.trim();
            // Remove trailing colons from password (in case of malformed export)
            while (password && password.endsWith(':')) {
                password = password.slice(0, -1).trim();
            }
            const apiKey = parts[2]?.trim();
            importAccounts.push({
                id: crypto.randomUUID(),
                email: email,
                password: password || undefined,
                apiKey: apiKey || undefined,
                name: email.split('@')[0]
            });
        }
    }

    if (importAccounts.length === 0) {
        currentPanel?.webview.postMessage({
            command: 'importResult',
            success: false,
            message: 'No valid accounts found (format: email:password)'
        });
        return;
    }

    // Get existing cached accounts
    const cachedAccounts = context.globalState.get<AccountInfo[]>('ide-toolkit.cachedAccounts') || [];
    let imported = 0;
    let skipped = 0;

    for (const acc of importAccounts) {
        // Check if already exists
        const exists = cachedAccounts.some(c => c.email === acc.email);
        if (exists) {
            skipped++;
            continue;
        }
        cachedAccounts.push(acc);
        imported++;
    }

    // Save to cache
    await context.globalState.update('ide-toolkit.cachedAccounts', cachedAccounts);

    currentPanel?.webview.postMessage({
        command: 'importResult',
        success: true,
        message: `Imported: ${imported}, skipped (duplicates): ${skipped}`
    });
}

async function handleSwitchAccount(context: vscode.ExtensionContext, accountId: string, email?: string, password?: string, apiKey?: string) {
    // Priority: apiKey > email/password
    let result: { success: boolean; error?: string; email?: string };
    let accEmail = email;
    
    // If apiKey provided directly, use it
    if (apiKey) {
        result = await handleSwitchAccountWithApiKey(context, apiKey, email?.split('@')[0] || 'user', email, password);
    } else if (email && password) {
        // If email and password provided directly (from API accounts), use Firebase login
        result = await handleSwitchAccountWithEmail(context, email, password);
    } else {
        // Otherwise look in local accounts
        const account = accounts.find(a => a.id === accountId);
        if (!account) {
            currentPanel?.webview.postMessage({
                command: 'switchError',
                error: '未找到账号'
            });
            return;
        }
        accEmail = account.email;

        if (account.apiKey) {
            result = await handleSwitchAccountWithApiKey(context, account.apiKey, account.email.split('@')[0], account.email, account.password);
        } else if (account.password) {
            result = await handleSwitchAccountWithEmail(context, account.email, account.password);
        } else {
            currentPanel?.webview.postMessage({
                command: 'switchError',
                error: '该账号未保存 apiKey 或密码'
            });
            return;
        }
    }
    
    // Only mark as used if switch succeeded
    if (result.success) {
        const usedAccounts = context.globalState.get<Record<string, boolean>>('ide-toolkit.usedAccounts') || {};
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
    } else {
        currentPanel?.webview.postMessage({
            command: 'switchError',
            error: result.error || '未知错误'
        });
    }
}

async function handleSwitchAccountWithEmail(context: vscode.ExtensionContext, email: string, password: string): Promise<{ success: boolean; error?: string; email?: string }> {
    try {
        // Debug: log email and password length
        console.log('[Switch] Firebase login attempt:');
        console.log('[Switch]   email:', email);
        console.log('[Switch]   password length:', password?.length);
        console.log('[Switch]   password:', password);

        // Step 1: Firebase login, get idToken
        let result = await loginWithFirebase(email, password);

        // Step 2: If Firebase fails with INVALID_LOGIN_CREDENTIALS, try Windsurf API
        if (!result.idToken && result.error === 'INVALID_LOGIN_CREDENTIALS') {
            console.log('[Switch] Firebase login failed with INVALID_LOGIN_CREDENTIALS, trying Windsurf API...');
            const windsurfResult = await loginWithWindsurfAPI(email, password);
            if (windsurfResult.token) {
                console.log('[Switch] Windsurf API login success, auth1_token length:', windsurfResult.token.length);
                
                // Get session token with prefix via WindsurfPostAuth
                console.log('[Switch] Getting session token via WindsurfPostAuth...');
                const sessionResult = await getWindsurfSessionToken(windsurfResult.token);
                if (!sessionResult.sessionToken) {
                    throw new Error(`WindsurfPostAuth failed: ${sessionResult.error || 'Unknown error'}`);
                }
                console.log('[Switch] Got session token (with prefix), length:', sessionResult.sessionToken.length);
                
                // Use session token with prefix for login
                await logoutCurrent();
                console.log('[Switch] Using session token for loginWithAuthToken...');
                try {
                    await vscode.commands.executeCommand('windsurf.loginWithAuthToken', sessionResult.sessionToken);
                    console.log('[Switch] windsurf.loginWithAuthToken succeeded with session token');
                    vscode.window.showInformationMessage(`已切换到：${email}`);
                    return { success: true, email };
                } catch (sessionError: any) {
                    console.log('[Switch] Session token failed:', sessionError.message);
                    throw sessionError;
                }
            } else {
                throw new Error(`Windsurf login failed: ${windsurfResult.error || 'Unknown error'}`);
            }
        }

        if (!result.idToken) {
            throw new Error(`Firebase login failed: ${result.error || 'Unknown error'}`);
        }

        const idToken = result.idToken;
        console.log('[Switch] Firebase login success, token length:', idToken.length);

        // Step 3: Use Firebase idToken directly with windsurf.loginWithAuthToken
        await logoutCurrent();
        await vscode.commands.executeCommand('windsurf.loginWithAuthToken', idToken);
        console.log('[Switch] windsurf.loginWithAuthToken succeeded');

        vscode.window.showInformationMessage(`已切换到：${email}`);
        return { success: true, email };

    } catch (error: any) {
        console.error('[Switch] Switch failed:', error.message);
        return { success: false, error: error.message };
    }
}

// Direct apiKey injection - use windsurf.loginWithAuthToken (apiKey is actually Firebase id_token)
async function handleSwitchAccountWithApiKey(context: vscode.ExtensionContext, apiKey: string, name: string, email?: string, password?: string): Promise<{ success: boolean; error?: string; email?: string }> {
    try {
        console.log('[Switch] Using apiKey (id_token), calling windsurf.loginWithAuthToken');

        // Logout current session first
        await logoutCurrent();

        // Use Windsurf's built-in loginWithAuthToken command (same as codepool)
        // apiKey is actually Firebase id_token
        await vscode.commands.executeCommand('windsurf.loginWithAuthToken', apiKey);
        console.log('[Switch] windsurf.loginWithAuthToken succeeded');
        vscode.window.showInformationMessage(`已切换到账号：${name}`);
        return { success: true, email: name };

    } catch (error: any) {
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
function getAugmentFilepath(): string | null {
    // Use vscode.env.appRoot (same as codepool)
    const appRoot = (vscode as any).env?.appRoot;
    if (appRoot) {
        const candidate = path.join(appRoot, 'extensions', 'windsurf', 'dist', 'extension.js');
        if (fs.existsSync(candidate)) return candidate;
    }
    // Fallback: find from loaded extension
    const windsurfExt = vscode.extensions.all.find(e => e.id.startsWith('codeium.windsurf'));
    if (windsurfExt) {
        const candidate = path.join(windsurfExt.extensionPath, 'dist', 'extension.js');
        if (fs.existsSync(candidate)) return candidate;
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
async function applyAugmentPatch(): Promise<boolean> {
    const augmentPath = getAugmentFilepath();
    if (!augmentPath) {
        console.warn('[AugmentPatch] 未找到 augment 文件，跳过');
        return false;
    }

    let code: string;
    try {
        code = fs.readFileSync(augmentPath, 'utf-8');
    } catch (e: any) {
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
    const sessionVarMatch  = /(\w+)\.authRedirectURI\.path/.exec(code);

    if (sessionVarMatch && uriHandlerRegex.test(code)) {
        const sessionVar = sessionVarMatch[1];
        code = code.replace(
            uriHandlerRegex,
            `(${sessionVar}._authSession && ${sessionVar}._authSession._context && ` +
            `${sessionVar}._authSession._context.globalState.update("sessionId", require("crypto").randomUUID()), ` +
            `$1.window.registerUriHandler`
        );
        changed = true;
        console.log('[AugmentPatch] sessionId 刷新补丁已应用');
    }

    // ── 补丁 B：拦截 saveSession ──────────────────────────────────────────────
    const SAVE_ORIGINAL = '._authSession.saveSession.apply(L,arguments)';
    const SAVE_HOOKED   =
        '._authSession.saveSession.apply(L,arguments);' +
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
    } catch {
        try {
            fs.chmodSync(augmentPath, 0o644);
            fs.writeFileSync(augmentPath, code, 'utf-8');
        } catch (e: any) {
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
async function logoutCurrent(): Promise<void> {
    try {
        await vscode.commands.executeCommand('windsurf.signOut');
        console.log('[AutoLogin] 登出完成');
    } catch (e) {
        // 未登录时 signOut 会抛错，忽略即可
        console.warn('[AutoLogin] 登出跳过（可能已是未登录状态）');
    }
}

/**
 * 补丁方案三：拿到 apiKey → 通过注入命令覆盖 token → 刷新 Windsurf 状态。
 * 这是方案一补丁生效后的实际调用入口。
 */
async function injectTokenViaCommand(
    apiKey: string,
    name: string,
    apiServerUrl: string
): Promise<void> {
    // 调用方案一注入的自定义命令
    await vscode.commands.executeCommand(
        'windsurf.provideAuthTokenToAuthProviderWithShit',
        { apiKey, name, apiServerUrl }
    );
    console.log('[AutoLogin] 新 token 已注入:', name);
}

// Register user with Windsurf server to get apiKey
async function registerUser(idToken: string): Promise<{ apiKey: string; name: string; apiServerUrl?: string } | null> {
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
        const registerReq = https.request(registerOptions, (registerRes: any) => {
            let registerRespData = '';
            registerRes.on('data', (chunk: string) => { registerRespData += chunk; });
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
                    } else {
                        const errorMsg = registerJson.error?.message || registerJson.message || JSON.stringify(registerJson);
                        console.error('Register user error:', errorMsg);
                        // Return error message for display
                        (registerJson as any).errorMessage = errorMsg;
                        resolve(registerJson as any);
                    }
                } catch (e) {
                    console.error('Parse register response error:', e, registerRespData);
                    resolve({ apiKey: '', name: '', errorMessage: 'Parse error: ' + registerRespData } as any);
                }
            });
        });

        registerReq.on('error', (e: Error) => {
            console.error('Register request error:', e);
            resolve({ apiKey: '', name: '', errorMessage: e.message } as any);
        });

        registerReq.write(registerData);
        registerReq.end();
    });
}

// Write token directly to Windsurf's storage.json
async function writeTokenToStorageJson(apiKey: string, name: string, apiServerUrl?: string): Promise<boolean> {
    try {
        const appData = process.env.APPDATA || process.env.HOME || '';
        const storagePath = path.join(appData, 'Windsurf', 'User', 'globalStorage', 'storage.json');

        if (!fs.existsSync(storagePath)) {
            console.error('Storage path not found:', storagePath);
            return false;
        }

        let storage: any = {};

        // Read existing storage
        const content = fs.readFileSync(storagePath, 'utf-8');
        try {
            storage = JSON.parse(content);
        } catch {
            storage = {};
        }

        // Update auth session
        const session: any = {
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
    } catch (e: any) {
        console.error('Failed to write storage:', e);
        return false;
    }
}

// Get auth token from Windsurf API using email/password
async function loginWithWindsurfAPI(email: string, password: string): Promise<{ token: string | null; error?: string }> {
    const https = require('https');

    const loginData = JSON.stringify({
        email: email,
        password: password
    });

    const loginOptions = {
        hostname: 'windsurf.com',
        port: 443,
        path: '/_devin-auth/password/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Origin': 'https://windsurf.com',
            'Referer': 'https://windsurf.com/'
        }
    };

    return new Promise((resolve) => {
        const loginReq = https.request(loginOptions, (loginRes: any) => {
            let loginRespData = '';
            loginRes.on('data', (chunk: string) => { loginRespData += chunk; });
            loginRes.on('end', () => {
                try {
                    const loginJson = JSON.parse(loginRespData);
                    const authToken = loginJson.token || loginJson.auth_token;
                    if (authToken) {
                        console.log('[WindsurfLogin] Got auth token, length:', authToken.length);
                        resolve({ token: authToken });
                    } else {
                        console.error('[WindsurfLogin] No token in response:', loginJson);
                        resolve({ token: null, error: loginJson.error || 'No token in response' });
                    }
                } catch (e) {
                    console.error('[WindsurfLogin] Parse error:', e);
                    resolve({ token: null, error: 'Failed to parse login response' });
                }
            });
        });

        loginReq.on('error', (e: Error) => {
            console.error('[WindsurfLogin] Request error:', e);
            resolve({ token: null, error: e.message });
        });

        loginReq.write(loginData);
        loginReq.end();
    });
}

// Get session token via gRPC-web WindsurfPostAuth
async function getWindsurfSessionToken(auth1Token: string): Promise<{ sessionToken: string | null; error?: string }> {
    const https = require('https');

    // Build protobuf payload: message { string token = 1; }
    // Field 1, wire type 2 (length-delimited)
    const tag = Buffer.from([0x0a]); // (1 << 3) | 2 = 10
    const tokenBytes = Buffer.from(auth1Token, 'utf-8');
    const length = Buffer.from([tokenBytes.length]);
    const protoPayload = Buffer.concat([tag, length, tokenBytes]);

    // gRPC-web frame: flags (1 byte) + length (4 bytes big-endian) + payload
    const flags = Buffer.from([0x00]); // uncompressed
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(protoPayload.length, 0);
    const grpcFrame = Buffer.concat([flags, lengthBuf, protoPayload]);

    const postAuthOptions = {
        hostname: 'windsurf.com',
        port: 443,
        path: '/_backend/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth',
        method: 'POST',
        headers: {
            'Content-Type': 'application/grpc-web+proto',
            'Accept': 'application/grpc-web+proto',
            'X-Grpc-Web': '1',
            'X-User-Agent': 'grpc-web-javascript/0.1',
            'Origin': 'https://windsurf.com',
            'Referer': 'https://windsurf.com/'
        }
    };

    return new Promise((resolve) => {
        const postReq = https.request(postAuthOptions, (postRes: any) => {
            let respData: Buffer[] = [];
            postRes.on('data', (chunk: Buffer) => { respData.push(chunk); });
            postRes.on('end', () => {
                try {
                    const fullResponse = Buffer.concat(respData);

                    if (postRes.statusCode !== 200) {
                        console.error('[WindsurfPostAuth] HTTP error:', postRes.statusCode);
                        resolve({ sessionToken: null, error: `HTTP ${postRes.statusCode}` });
                        return;
                    }

                    // Parse gRPC-web response
                    // Skip first 5 bytes (flags + length), extract devin-session-token
                    if (fullResponse.length <= 5) {
                        resolve({ sessionToken: null, error: 'Empty response' });
                        return;
                    }

                    const bodyStart = 5;
                    const body = fullResponse.slice(bodyStart);

                    // Extract devin-session-token from response
                    // Response format: devin-session-token${JWT}${more data}
                    const responseStr = body.toString('utf-8');
                    
                    // IMPORTANT: Must include 'devin-session-token$' prefix!
                    // Full format: devin-session-token$header.payload.signature
                    const tokenMatch = responseStr.match(/(devin-session-token\$[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);

                    if (tokenMatch && tokenMatch[1]) {
                        const sessionToken = tokenMatch[1];  // Full token with prefix
                        console.log('[WindsurfPostAuth] Got session token (with prefix), length:', sessionToken.length);
                        console.log('[WindsurfPostAuth] Token preview:', sessionToken.substring(0, 50) + '...');
                        resolve({ sessionToken });
                    } else {
                        console.error('[WindsurfPostAuth] Could not extract session token from:', responseStr.substring(0, 300));
                        resolve({ sessionToken: null, error: 'Failed to extract session token' });
                    }
                } catch (e: any) {
                    console.error('[WindsurfPostAuth] Parse error:', e);
                    resolve({ sessionToken: null, error: e.message });
                }
            });
        });

        postReq.on('error', (e: Error) => {
            console.error('[WindsurfPostAuth] Request error:', e);
            resolve({ sessionToken: null, error: e.message });
        });

        postReq.write(grpcFrame);
        postReq.end();
    });
}

// Get Firebase idToken from email/password
async function loginWithFirebase(email: string, password: string): Promise<{ idToken: string | null; error?: string }> {
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
        const firebaseReq = https.request(firebaseOptions, (firebaseRes: any) => {
            let firebaseRespData = '';
            firebaseRes.on('data', (chunk: string) => { firebaseRespData += chunk; });
            firebaseRes.on('end', () => {
                try {
                    const firebaseJson = JSON.parse(firebaseRespData);
                    if (firebaseJson.idToken) {
                        resolve({ idToken: firebaseJson.idToken });
                    } else {
                        const errorMsg = firebaseJson.error?.message || 'Unknown Firebase error';
                        console.error('Firebase auth error:', errorMsg);
                        resolve({ idToken: null, error: errorMsg });
                    }
                } catch (e) {
                    console.error('Parse Firebase response error:', e);
                    resolve({ idToken: null, error: 'Failed to parse Firebase response' });
                }
            });
        });

        firebaseReq.on('error', (e: Error) => {
            console.error('Firebase request error:', e);
            resolve({ idToken: null, error: e.message });
        });

        firebaseReq.write(firebaseData);
        firebaseReq.end();
    });
}

async function loginWithEmailPassword(email: string, password: string): Promise<{ apiKey: string; name: string; error?: string } | null> {
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
        const firebaseReq = https.request(firebaseOptions, (firebaseRes: any) => {
            let firebaseRespData = '';
            firebaseRes.on('data', (chunk: string) => { firebaseRespData += chunk; });
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

                    const registerReq = https.request(registerOptions, (registerRes: any) => {
                        let registerRespData = '';
                        registerRes.on('data', (chunk: string) => { registerRespData += chunk; });
                        registerRes.on('end', () => {
                            try {
                                const registerJson = JSON.parse(registerRespData);
                                if (registerJson.api_key) {
                                    resolve({
                                        apiKey: registerJson.api_key,
                                        name: registerJson.name || email
                                    });
                                } else {
                                    console.error('Register user error:', registerRespData);
                                    resolve({ apiKey: '', name: '', error: 'Codeium: ' + registerRespData });
                                }
                            } catch (e) {
                                console.error('Parse register response error:', e);
                                resolve(null);
                            }
                        });
                    });

                    registerReq.on('error', (e: Error) => {
                        console.error('Register request error:', e);
                        resolve(null);
                    });

                    registerReq.write(registerData);
                    registerReq.end();

                } catch (e) {
                    console.error('Parse Firebase response error:', e);
                    resolve(null);
                }
            });
        });

        firebaseReq.on('error', (e: Error) => {
            console.error('Firebase request error:', e);
            resolve(null);
        });

        firebaseReq.write(firebaseData);
        firebaseReq.end();
    });
}

async function refreshDevice(context: vscode.ExtensionContext) {
    try {
        const windsurfPath = getWindsurfExtensionFilepath();
        if (!windsurfPath) {
            vscode.window.showErrorMessage('未找到 windsurf 扩展文件，无法刷新设备码');
            return;
        }

        let src = fs.readFileSync(windsurfPath, 'utf-8');

        // codepool: replace generateFingerprint implementation to return a new random fingerprint
        const fingerprint = crypto.randomBytes(64).toString('hex'); // 128 hex chars
        const re = /(generateFingerprint=async\s+function\(\)\{)[\s\S\n]*?return[^}]+/;
        if (!re.test(src)) {
            vscode.window.showErrorMessage('未找到 generateFingerprint，无法刷新设备码（windsurf 版本可能不匹配）');
            return;
        }

        src = src.replace(re, `$1return "${fingerprint}"`);

        try {
            fs.writeFileSync(windsurfPath, src, 'utf-8');
        } catch {
            fs.chmodSync(windsurfPath, 0o644);
            fs.writeFileSync(windsurfPath, src, 'utf-8');
        }

        currentPanel?.webview.postMessage({ command: 'deviceRefreshed' });
        const action = await vscode.window.showInformationMessage('设备码已刷新，需要重启窗口生效。', '重启窗口');
        if (action === '重启窗口') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } catch (error: any) {
        currentPanel?.webview.postMessage({
            command: 'switchError',
            error: error.message
        });
    }
}

export function deactivate() {
    console.log('IDE Toolkit deactivated');
}