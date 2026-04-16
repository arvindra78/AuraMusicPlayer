// preload.js — runs in renderer context with Node access limited
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Expose platform so CSS/JS can do OS-specific tweaks
    platform: process.platform,

    // ── Window controls ──────────────────────────────────────────────────────
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    toggleFullscreen: () => ipcRenderer.send('window-toggle-fullscreen'),
    close: () => ipcRenderer.send('window-close'),

    // ── File handling ────────────────────────────────────────────────────────
    getPathForFile: (file) => {
        if (!file) return '';
        try {
            if (webUtils?.getPathForFile) return webUtils.getPathForFile(file) || '';
        } catch (_) {}
        return file.path || '';
    },
    getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
    onOpenFile: (cb) => ipcRenderer.on('open-file', (_, filePath) => cb(filePath)),

    // ── Fullscreen events ────────────────────────────────────────────────────
    onFullscreenChange: (cb) => ipcRenderer.on('fullscreen-change', (_, isFS) => cb(isFS)),

    // ── Mini Player (main window side) ───────────────────────────────────────
    // Main window calls this to push its current playback state to mini player
    sendMiniPlayerState: (state) => ipcRenderer.send('mini-player-state', state),
    // Main window listens for when mini player needs a state refresh
    onRequestMiniState: (cb) => ipcRenderer.on('request-mini-state', () => cb()),
    // Main window listens for control commands FROM mini player
    onMiniControl: (cb) => ipcRenderer.on('mini-control', (_, action) => cb(action)),

    // ── Mini Player (mini-player.html side) ──────────────────────────────────
    // Mini player sends control commands to main window
    miniControl: (action) => ipcRenderer.send('mini-control', action),
    // Mini player receives state updates
    onMiniPlayerState: (cb) => ipcRenderer.on('mini-player-state', (_, state) => cb(state)),
    // Mini player requests main window restore
    restoreMain: () => ipcRenderer.send('restore-main'),
});
