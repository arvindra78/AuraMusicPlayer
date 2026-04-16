const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let miniPlayerWindow = null;
let miniPlayerBounds = null; // Store mini player position
let flaskProcess = null;
let pendingOpenFilePath = null;
let FLASK_PORT = 5000;

// Fix Electron cache errors: use temp dir (always writable) + disable GPU shader cache
const os = require('os');
const cacheDir = path.join(os.tmpdir(), 'aura-music-player-cache', String(process.pid));
try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Load miniplayer bounds
app.whenReady().then(() => {
    try {
        const configPath = path.join(app.getPath('userData'), 'miniplayer-config.json');
        if (fs.existsSync(configPath)) {
            miniPlayerBounds = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (e) {
        console.error("Failed to load miniplayer config", e);
    }
});

// Dev vs production: packaged app from electron-builder
const isDev = !app.isPackaged;

// ── Python/Flask path resolution ─────────────────────────────────────────────

/**
 * Resolves the executable and script path for the Flask backend.
 * Production: prefers PyInstaller .exe, falls back to venv.
 * Development: prefers local venv, falls back to system python.
 * @returns {{ exe: string, args: string[], cwd: string } | null}
 */
function resolveFlaskLauncher() {
    const resourcesPath = isDev ? __dirname : process.resourcesPath;
    const platform = process.platform;
    const isWin = platform === 'win32';

    // ── Production (packaged) ─────────────────────────────────────────────────
    if (!isDev) {
        // 1. PyInstaller exe (production-safe, recommended)
        const pyinstallerExe = path.join(resourcesPath, 'flask-backend.exe');
        if (fs.existsSync(pyinstallerExe)) {
            return {
                exe: pyinstallerExe,
                args: [],
                cwd: resourcesPath,
            };
        }

        // 2. Fallback: venv (may fail - venvs are not portable)
        const venvPython = isWin
            ? path.join(resourcesPath, 'venv', 'Scripts', 'python.exe')
            : path.join(resourcesPath, 'venv', 'bin', 'python');
        const appPy = path.join(resourcesPath, 'app.py');

        if (fs.existsSync(venvPython) && fs.existsSync(appPy)) {
            return {
                exe: venvPython,
                args: [appPy],
                cwd: resourcesPath,
            };
        }

        console.error('[Flask] Production: No flask-backend.exe and no valid venv found.');
        console.error('[Flask] Run "npm run build:python" before "npm run build" to create flask-backend.exe');
        return null;
    }

    // ── Development ──────────────────────────────────────────────────────────
    const appPy = path.join(__dirname, 'app.py');
    const venvPython = isWin
        ? path.join(__dirname, 'venv', 'Scripts', 'python.exe')
        : path.join(__dirname, 'venv', 'bin', 'python');

    if (fs.existsSync(venvPython)) {
        return {
            exe: venvPython,
            args: [appPy],
            cwd: __dirname,
        };
    }

    // Fallback: system python
    return {
        exe: 'python',
        args: [appPy],
        cwd: __dirname,
    };
}

function startFlask() {
    const launcher = resolveFlaskLauncher();
    if (!launcher) {
        console.error('[Flask] Cannot start: no valid Python/Flask backend found.');
        return;
    }

    const { exe, args, cwd } = launcher;

    // Validate executable exists (except for 'python' which is in PATH)
    if (exe !== 'python' && !fs.existsSync(exe)) {
        console.error(`[Flask] ENOENT: Executable not found at ${exe}`);
        return;
    }

    const cmd = args.length ? `${exe} ${args.join(' ')}` : exe;
    console.log(`[Flask] Starting: ${cmd} (cwd: ${cwd})`);

    try {
        flaskProcess = spawn(exe, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
                ...process.env,
                FLASK_APP: 'app.py',
                FLASK_ENV: isDev ? 'development' : 'production',
                FLASK_PORT: FLASK_PORT.toString(),
            },
        });
    } catch (err) {
        console.error('[Flask] spawn failed:', err.message);
        return;
    }

    flaskProcess.stdout.on('data', (d) => console.log(`[Flask] ${d.toString().trim()}`));
    flaskProcess.stderr.on('data', (d) => console.log(`[Flask] ${d.toString().trim()}`));

    flaskProcess.on('error', (err) => {
        console.error('[Flask] Process error:', err.message);
    });

    flaskProcess.on('close', (code, signal) => {
        console.log(`[Flask] Process exited with code ${code}, signal ${signal}`);
    });
}

function stopFlask() {
    if (flaskProcess) {
        flaskProcess.kill('SIGTERM');
        flaskProcess = null;
    }
}

// ── Wait for Flask to be ready ───────────────────────────────────────────────

function waitForFlask(retries = 30, delay = 300) {
    return new Promise((resolve, reject) => {
        let attempts = 0;

        function try_connect() {
            const req = http.get(`http://localhost:${FLASK_PORT}/`, (res) => {
                if (res.statusCode === 200 || res.statusCode === 302) {
                    resolve();
                } else {
                    retry();
                }
            });
            req.on('error', retry);
            req.setTimeout(500, () => { req.destroy(); retry(); });
        }

        function retry() {
            attempts++;
            if (attempts >= retries) {
                reject(new Error('Flask did not start in time'));
            } else {
                setTimeout(try_connect, delay);
            }
        }

        try_connect();
    });
}

// ── Handle file association (open MP3 with app) ──────────────────────────────

function handleOpenFile(filePath) {
    if (!filePath || !filePath.toLowerCase().endsWith('.mp3') && !filePath.toLowerCase().match(/\.(flac|wav|m4a|ogg)$/)) return;
    const ext = path.extname(filePath).toLowerCase();
    if (!['.mp3', '.flac', '.wav', '.m4a', '.ogg'].includes(ext)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-file', filePath);
        mainWindow.focus();
    } else {
        pendingOpenFilePath = filePath;
    }
}

// Single instance: if user opens another mp3 while app runs, focus our window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', (_, commandLine) => {
        if (mainWindow) mainWindow.focus();
        let fileArg = null;
        const quoted = commandLine.match(/"([^"]+\.(mp3|flac|wav|m4a|ogg))"/i);
        if (quoted) fileArg = quoted[1];
        else {
            const parts = commandLine.split(/\s+/);
            fileArg = parts.find(p => /\.(mp3|flac|wav|m4a|ogg)$/i.test(p));
        }
        if (fileArg && fs.existsSync(fileArg)) handleOpenFile(fileArg);
    });
}

// ── Mini Player Window ───────────────────────────────────────────────────────

function createMiniPlayer() {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.show();
        return;
    }

    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const W = 360, H = 90;

    let x = sw - W - 20;
    let y = sh - H - 20;
    
    if (miniPlayerBounds) {
        x = miniPlayerBounds.x;
        y = miniPlayerBounds.y;
    }

    miniPlayerWindow = new BrowserWindow({
        width: W,
        height: H,
        minWidth: W,
        maxWidth: W,
        minHeight: H,
        maxHeight: H,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        type: 'toolbar', // Helps with Windows z-order
        resizable: true, // Fix for -webkit-app-region: drag on some Windows environments
        movable: true,
        skipTaskbar: true,
        roundedCorners: true,
        show: false,
        icon: path.join(__dirname, 'static', 'img', 'logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
    });

    miniPlayerWindow.on('moved', () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerBounds = miniPlayerWindow.getBounds();
            try {
                const configPath = path.join(app.getPath('userData'), 'miniplayer-config.json');
                fs.writeFileSync(configPath, JSON.stringify(miniPlayerBounds));
            } catch (e) {
                console.error("Failed to save miniplayer config", e);
            }
        }
    });

    const templatePath = path.join(__dirname, 'templates', 'mini-player.html');
    miniPlayerWindow.loadFile(templatePath);

    miniPlayerWindow.once('ready-to-show', () => {
        miniPlayerWindow.show();
        miniPlayerWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        miniPlayerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        // Push current state to mini player
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('request-mini-state');
        }
    });

    miniPlayerWindow.on('focus', () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        }
    });

    miniPlayerWindow.on('blur', () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        }
    });

    miniPlayerWindow.on('closed', () => {
        miniPlayerWindow = null;
    });
}

function destroyMiniPlayer() {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.close();
        miniPlayerWindow = null;
    }
}

// ── Create Main Window ────────────────────────────────────────────────────────

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 780,
        minWidth: 800,
        minHeight: 550,
        frame: false,           // Custom title bar
        titleBarStyle: 'hidden',
        transparent: true,      // Enable transparency
        backgroundColor: '#00000000', // Set to fully transparent
        vibrancy: 'under-window',    // for macOS
        backgroundMaterial: 'acrylic', // for Windows 11
        show: false,            // Show only after page loads
        icon: path.join(__dirname, 'static', 'img', 'logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
    });

    // Load the Flask app
    mainWindow.loadURL(`http://localhost:${FLASK_PORT}/`);

    // Show window gracefully once DOM is ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        destroyMiniPlayer();
        mainWindow = null;
    });

    // ── Fullscreen events ──
    mainWindow.on('enter-full-screen', () => {
        mainWindow.webContents.send('fullscreen-change', true);
    });
    mainWindow.on('leave-full-screen', () => {
        mainWindow.webContents.send('fullscreen-change', false);
    });

    // ── Mini Player on minimize/restore ──
    mainWindow.on('minimize', () => {
        mainWindow.webContents.send('request-mini-state');
        createMiniPlayer();
    });

    mainWindow.on('restore', () => {
        destroyMiniPlayer();
    });
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-initial-file', () => {
    const file = pendingOpenFilePath;
    pendingOpenFilePath = null;
    return file;
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow?.maximize();
    }
});
ipcMain.on('window-toggle-fullscreen', () => {
    if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
});
ipcMain.on('window-close', () => mainWindow?.close());

// Mini player state relay: main → mini
ipcMain.on('mini-player-state', (_, state) => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.webContents.send('mini-player-state', state);
    }
});

// Mini player controls: mini → main
ipcMain.on('mini-control', (_, action) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mini-control', action);
    }
});

// Restore main window from mini player
ipcMain.on('restore-main', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.restore();
        mainWindow.focus();
    }
    destroyMiniPlayer();
});

// ── App Lifecycle ───────────────────────────────────────────────────────────

app.on('open-file', (e, filePath) => {
    e.preventDefault();
    handleOpenFile(filePath);
});

app.whenReady().then(async () => {
    FLASK_PORT = await new Promise((resolve) => {
        const srv = require('net').createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });

    // Check argv for file path (launched via "Open with" / double-click .mp3)
    const args = process.argv.slice(process.defaultApp ? 2 : 1);
    const fileArg = args.find(p => typeof p === 'string' && /\.(mp3|flac|wav|m4a|ogg)$/i.test(p));
    if (fileArg && fs.existsSync(fileArg)) pendingOpenFilePath = path.resolve(fileArg);

    startFlask();

    try {
        await waitForFlask();
        console.log('[Electron] Flask ready — opening window');
        createWindow();
    } catch (err) {
        console.error('[Electron] Flask failed to start:', err.message);
        createWindow();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    stopFlask();
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    stopFlask();
});
