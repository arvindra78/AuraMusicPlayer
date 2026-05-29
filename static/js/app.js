// Aura Music Player 3.3.2 - app.js
// Using global musicMetadata from unpkg

// State
let songs = [];
let currentSongIndex = -1;
let isPlaying = false;
let isShuffle = true;
let repeatMode = 0; // 0 = none, 1 = all, 2 = one

const audio = new Audio();
const audioEngine = new AudioEngine(audio);
let hologramEngine = null;
let isHologramActive = false;
let originalOrder = []; // for shuffle toggle

// DOM Elements
const elements = {
    playlist: document.getElementById('playlist'),
    playBtn: document.getElementById('playPauseBtn'),
    playIcon: document.getElementById('playIcon'),
    nextBtn: document.getElementById('nextBtn'),
    prevBtn: document.getElementById('prevBtn'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    repeatBtn: document.getElementById('repeatBtn'),
    randomizeBtn: document.getElementById('randomizeBtn'),
    muteBtn: document.getElementById('muteBtn'),
    volumeIcon: document.getElementById('volumeIcon'),
    
    progressBar: document.getElementById('progressBar'),
    progress: document.getElementById('progress'),
    currentTimeLabel: document.getElementById('currentTime'),
    durationLabel: document.getElementById('duration'),
    
    volumeBar: document.getElementById('volumeBar'),
    volumeProgress: document.getElementById('volumeProgress'),
    
    searchInput: document.getElementById('searchInput'),
    addFolderBtn: document.getElementById('addFolderBtn'),
    folderInput: document.getElementById('folderInput'),
    
    // Artwork & Info
    albumArtLarge: document.getElementById('albumArtLarge'),
    trackTitleLarge: document.getElementById('trackTitleLarge'),
    trackArtistLarge: document.getElementById('trackArtistLarge'),
    artworkWrapper: document.querySelector('.artwork-wrapper'),
    artworkShadow: document.getElementById('artworkShadow'),
    appBg: document.getElementById('appBg'),
    
    albumArtMini: document.getElementById('albumArtMini'),
    trackTitleMini: document.getElementById('trackTitleMini'),
    trackArtistMini: document.getElementById('trackArtistMini'),
    miniArtworkContainer: document.getElementById('miniArtworkContainer'),
    miniInfoContainer: document.getElementById('miniInfoContainer'),
    playlistEmpty: document.getElementById('playlistEmpty'),
    artworkShowcase: document.getElementById('artworkShowcase'),

    // Hologram Elements
    hologramBtn: document.getElementById('hologramBtn'),
    hologramContainer: document.getElementById('hologramContainer'),
    hologramCanvas: document.getElementById('hologramCanvas'),
    hologramTitle: document.getElementById('hologramTitle'),
    hologramArtist: document.getElementById('hologramArtist'),
    hologramAlbum: document.getElementById('hologramAlbum'),
    holoCloseBtn: document.getElementById('holoCloseBtn'),
    holoMinimalBtn: document.getElementById('holoMinimalBtn'),
    holoEnvBtn: document.getElementById('holoEnvBtn'),
};

// Add fallbacks for broken images
elements.albumArtLarge.onerror = () => { elements.albumArtLarge.src = '/static/img/default-art.png'; };
elements.albumArtMini.onerror = () => { elements.albumArtMini.src = '/static/img/default-art.png'; };

// Mini player state — track the current art URL so we can send it
let currentArtUrl = '';

// Build and return current playback state object for mini player
function getMiniPlayerState() {
    const song = songs[currentSongIndex];
    const title = song ? elements.trackTitleLarge.textContent : 'No song playing';
    const artist = song ? elements.trackArtistLarge.textContent : '—';
    const progress = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    let artUrl = currentArtUrl;
    if (artUrl && artUrl.startsWith('/')) {
        artUrl = `${window.location.origin}${artUrl}`;
    }
    return { title, artist, artUrl, isPlaying, progress, currentTime: audio.currentTime || 0, duration: audio.duration || 0 };
}

// Push state to mini player window
function pushMiniPlayerState() {
    const state = getMiniPlayerState();
    if (window.electronAPI && window.electronAPI.sendMiniPlayerState) {
        window.electronAPI.sendMiniPlayerState(state);
    }
    if (window.electronAPI && window.electronAPI.updateMediaState) {
        window.electronAPI.updateMediaState({
            isPlaying: state.isPlaying,
            title: state.title,
            artist: state.artist,
            progress: state.progress,
            duration: state.duration,
            currentTime: state.currentTime
        });
    }
    updateMediaSession(state);
}

function updateMediaSession(state) {
    if (!('mediaSession' in navigator)) return;

    let artworkUrl = state.artUrl || '';
    if (artworkUrl.startsWith('blob:')) {
        artworkUrl = `${window.location.origin}/static/img/logo-icon.png`;
    } else if (artworkUrl && artworkUrl.startsWith('/')) {
        artworkUrl = `${window.location.origin}${artworkUrl}`;
    }

    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: state.title || 'Unknown Title',
            artist: state.artist || 'Unknown Artist',
            album: 'Aura Music Library',
            artwork: [
                { src: artworkUrl || `${window.location.origin}/static/img/logo-icon.png`, sizes: '512x512', type: 'image/png' }
            ]
        });
    } catch (e) {
        console.error('[MediaSession] Metadata update failed:', e);
    }

    if (state.duration > 0 && isFinite(state.duration) && isFinite(state.currentTime)) {
        try {
            navigator.mediaSession.setPositionState({
                duration: state.duration,
                playbackRate: audio.playbackRate || 1.0,
                position: Math.max(0, Math.min(state.currentTime, state.duration))
            });
        } catch (e) {
            console.warn('[MediaSession] setPositionState failed:', e);
        }
    }
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
}

function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;

    const actions = [
        ['play', () => togglePlay()],
        ['pause', () => pause()],
        ['previoustrack', () => prevSong()],
        ['nexttrack', () => nextSong()],
        ['seekbackward', (details) => {
            const skipTime = details.seekOffset || 10;
            audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
        }],
        ['seekforward', (details) => {
            const skipTime = details.seekOffset || 10;
            audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
        }],
        ['seekto', (details) => {
            if (details.fastSeek && 'fastSeek' in audio) {
                audio.fastSeek(details.seekTime);
                return;
            }
            audio.currentTime = details.seekTime;
        }],
        ['stop', () => {
            pause();
            audio.currentTime = 0;
        }]
    ];

    for (const [action, handler] of actions) {
        try {
            navigator.mediaSession.setActionHandler(action, handler);
        } catch (error) {
            console.warn(`[MediaSession] action "${action}" not supported.`);
        }
    }
}

// Initialization
async function init() {
    loadSettings();
    
    // Initialize Hologram Engine (Isolated Layer)
    if (elements.hologramCanvas) {
        hologramEngine = new HologramEngine(elements.hologramCanvas);
    }

    let initialFile = null;
    if (window.electronAPI && window.electronAPI.getInitialFile) {
        initialFile = await window.electronAPI.getInitialFile();
    }
    
    if (initialFile) {
        await handleExternalFile(initialFile);
    } else {
        if (window.electronAPI && window.electronAPI.getConfig) {
            let config = await window.electronAPI.getConfig();
            if (!config.musicDir) {
                const selectedDir = await window.electronAPI.selectFolder();
                if (selectedDir) {
                    config = await window.electronAPI.saveConfig({ musicDir: selectedDir });
                }
            }
            if (config.musicDir) {
                await setMusicDirectory(config.musicDir);
            }
        }
        await fetchSongs();
        if (songs.length > 0 && currentSongIndex !== -1) {
            loadSong(currentSongIndex, false);
        }
    }
    
    setupEventListeners();
    setupOpenFileHandler();
    setupMediaSessionHandlers();

    // ── Mini Player IPC ──
    if (window.electronAPI) {
        if (window.electronAPI.onRequestMiniState) {
            window.electronAPI.onRequestMiniState(() => pushMiniPlayerState());
        }
        if (window.electronAPI.onMiniControl) {
            window.electronAPI.onMiniControl((action) => {
                if (action === 'play')   togglePlay();
                if (action === 'next')   nextSong();
                if (action === 'prev')   prevSong();
                if (action === 'random') randomizeSong();
                if (action === 'hologram') toggleHologramMode();
                if (action === 'stop') {
                    pause();
                    audio.currentTime = 0;
                }
            });
        }
    }
}

function toggleHologramMode() {
    isHologramActive = !isHologramActive;
    document.body.classList.toggle('hologram-active', isHologramActive);
    document.body.classList.toggle('fullscreen-mode', isHologramActive);
    elements.hologramContainer.classList.toggle('hidden', !isHologramActive);
    elements.hologramBtn.classList.toggle('active', isHologramActive);

    if (isHologramActive) {
        // Init engine with the black-box audio element
        hologramEngine.init(audio);
        hologramEngine.start();
        
        // Sync visuals
        if (currentArtUrl) hologramEngine.updateArtwork(currentArtUrl);
        elements.hologramTitle.textContent = elements.trackTitleLarge.textContent;
        elements.hologramArtist.textContent = elements.trackArtistLarge.textContent;
    } else {
        hologramEngine.stop();
    }
}

async function setMusicDirectory(dir) {
    try {
        await fetch('/api/set-directory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ directory: dir })
        });
    } catch (e) {
        console.error('Failed to set directory', e);
    }
}

async function handleExternalFile(filePath) {
    if (!filePath) return;
    const ext = filePath.split('.').pop().toLowerCase();
    if (!['mp3', 'flac', 'wav', 'm4a', 'ogg'].includes(ext)) return;
    
    if (window.electronAPI && window.electronAPI.dirname) {
        const dir = window.electronAPI.dirname(filePath);
        await setMusicDirectory(dir);
        if (window.electronAPI.saveConfig) {
            await window.electronAPI.saveConfig({ musicDir: dir });
        }
        await fetchSongs();
        const filename = filePath.split(/[/\\]/).pop();
        const index = songs.findIndex(s => s.filename === filename);
        if (index !== -1) {
            loadSong(index);
        } else {
            const playUrl = `/api/serve-file?path=${encodeURIComponent(filePath)}`;
            const newSong = { url: playUrl, filename, path: filePath };
            songs = [newSong, ...songs];
            renderPlaylist(songs);
            loadSong(0);
        }
    }
}

function setupOpenFileHandler() {
    if (!window.electronAPI?.onOpenFile) return;
    window.electronAPI.onOpenFile((filePath) => {
        handleExternalFile(filePath);
    });
}

async function fetchSongs() {
    try {
        const response = await fetch('/api/songs');
        const data = await response.json();
        songs = [...data];
        originalOrder = [...data];
        if (isShuffle) {
            songs.sort(() => Math.random() - 0.5);
        }
        renderPlaylist(songs);
    } catch (error) {
        console.error('Failed to fetch songs:', error);
    }
}

function loadSettings() {
    const savedVol = localStorage.getItem('aura-volume');
    if (savedVol !== null) {
        audio.volume = parseFloat(savedVol);
        updateVolumeUI(audio.volume);
    } else {
        audio.volume = 0.5;
        updateVolumeUI(0.5);
    }
    isShuffle = localStorage.getItem('aura-shuffle') !== 'false';
    repeatMode = parseInt(localStorage.getItem('aura-repeat') || '0');
    currentSongIndex = parseInt(localStorage.getItem('aura-last-song') || '-1');
    updateShuffleUI();
    updateRepeatUI();
}

function saveSettings() {
    localStorage.setItem('aura-volume', audio.volume);
    localStorage.setItem('aura-shuffle', isShuffle);
    localStorage.setItem('aura-repeat', repeatMode);
    localStorage.setItem('aura-last-song', currentSongIndex);
}

function renderPlaylist(listToRender) {
    elements.playlist.innerHTML = '';
    if (elements.playlistEmpty) {
        elements.playlistEmpty.classList.toggle('hidden', listToRender.length > 0);
    }
    listToRender.forEach((song, idx) => {
        const actualIndex = songs.findIndex(s => s.url === song.url);
        const li = document.createElement('li');
        li.className = 'playlist-item';
        li.dataset.index = actualIndex;
        if (actualIndex === currentSongIndex) li.classList.add('active');
        li.innerHTML = `
            <i class="ri-music-2-line track-icon"></i>
            <div class="track-number">${idx + 1}</div>
            <i class="ri-play-mini-fill play-icon"></i>
            <div class="track-details">
                <div class="track-name">${song.filename.replace(/\.[^/.]+$/, "")}</div>
                <div class="track-artist">${song.artist || "Unknown Artist"}</div>
            </div>
        `;
        li.addEventListener('click', () => {
            if (currentSongIndex === actualIndex && isPlaying) pause();
            else loadSong(actualIndex);
        });
        elements.playlist.appendChild(li);
    });
}

async function loadSong(index, autoPlay = true) {
    if (index < 0 || index >= songs.length) return;
    if (elements.artworkShowcase && currentSongIndex >= 0 && currentSongIndex !== index) {
        elements.artworkShowcase.classList.add('track-changing');
        setTimeout(() => elements.artworkShowcase?.classList.remove('track-changing'), 400);
    }
    currentSongIndex = index;
    saveSettings();
    const song = songs[currentSongIndex];
    audio.pause();
    isPlaying = false;
    audio.src = song.url;
    audio.load();
    resetUI();
    elements.trackTitleLarge.textContent = song.filename.replace(/\.[^/.]+$/, "");
    elements.trackTitleMini.textContent = song.filename.replace(/\.[^/.]+$/, "");
    updatePlaylistHighlight();
    checkMarquee();
    if (autoPlay) await play();
    await fetchMetadata(song);
    
    if (window.electronAPI && window.electronAPI.notifyTrackChange) {
        let artUrl = currentArtUrl;
        if (artUrl && artUrl.startsWith('/')) artUrl = `${window.location.origin}${artUrl}`;
        window.electronAPI.notifyTrackChange({ title: elements.trackTitleLarge.textContent, artist: elements.trackArtistLarge.textContent, artUrl });
    }
}

async function play() {
    try {
        // Only init engine if not already active to prevent duplicate source nodes
        if (audioEngine && !audioEngine.ctx) {
            await audioEngine.init();
        }
        await audio.play();
        isPlaying = true;
        elements.playIcon.className = 'ri-pause-fill';
        elements.artworkWrapper.classList.add('playing');
        
        elements.miniArtworkContainer.classList.remove('hidden');
        elements.miniInfoContainer.classList.remove('hidden');
        pushMiniPlayerState();
    } catch (err) {
        if (err.name !== 'AbortError') {
            isPlaying = false;
            elements.playIcon.className = 'ri-play-fill';
            elements.artworkWrapper.classList.remove('playing');
        }
    }
}

function pause() {
    audio.pause();
    isPlaying = false;
    elements.playIcon.className = 'ri-play-fill';
    elements.artworkWrapper.classList.remove('playing');
    pushMiniPlayerState();
}

function togglePlay() {
    if (currentSongIndex === -1) {
        if (songs.length > 0) loadSong(0);
        return;
    }
    isPlaying ? pause() : play();
}

function nextSong() {
    if (repeatMode === 2) { audio.currentTime = 0; play(); return; }
    let nextIndex = (currentSongIndex + 1) % songs.length;
    if (nextIndex === 0 && repeatMode === 0) { loadSong(nextIndex, false); return; }
    loadSong(nextIndex);
}

function prevSong() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    let prevIndex = (currentSongIndex - 1 + songs.length) % songs.length;
    loadSong(prevIndex);
}

function randomizeSong() {
    if (songs.length < 2) return;
    let randomIndex;
    do { randomIndex = Math.floor(Math.random() * songs.length); } while (randomIndex === currentSongIndex);
    loadSong(randomIndex);
}

async function fetchArt(song) {
    const isAbsPath = song.path && (song.path.includes(':\\') || song.path.startsWith('/'));
    updateMetadataUI(null, null, null);
    try {
        if (isAbsPath) await fetchArtFromPath(song.path);
        else if (song.file) await fetchArtFromFile(song);
        else if (song.url?.startsWith('/music/')) await fetchArtFromLibrary(song.url);
        else updateArtUI(null);
    } catch (e) { updateArtUI(null); }
}

async function fetchArtFromFile(song) {
    const lib = (typeof musicMetadata !== 'undefined' ? musicMetadata : null);
    if (lib) {
        try {
            const meta = await lib.parseBlob(song.file);
            if (meta?.common) {
                updateMetadataUI(meta.common.title, meta.common.artist, meta.common.picture);
                if (meta.common.picture?.length > 0) return;
            }
        } catch (err) {}
    }
    const fd = new FormData(); fd.append('file', song.file);
    try {
        const res = await fetch('/api/art', { method: 'POST', body: fd });
        if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 0) updateArtUI(URL.createObjectURL(blob));
        }
    } catch (e) {}
}

async function fetchArtFromPath(path) {
    const url = `/api/art-by-path?path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { method: 'HEAD' });
    updateArtUI(res.ok ? url : null);
}

async function fetchArtFromLibrary(musicUrl) {
    const url = `/api/art/${musicUrl.replace(/^\/music\//, '')}`;
    const res = await fetch(url, { method: 'HEAD' });
    updateArtUI(res.ok ? url : null);
}

async function fetchMetadata(song) { await fetchArt(song); }

function updateMetadataUI(title, artist, pictures) {
    const displayName = title || (songs[currentSongIndex] ? songs[currentSongIndex].filename.replace(/\.[^/.]+$/, "") : "Aura Player");
    const displayArtist = artist || "Unknown Artist";
    elements.trackTitleLarge.textContent = displayName;
    elements.trackTitleMini.textContent = displayName;
    elements.trackArtistLarge.textContent = displayArtist;
    elements.trackArtistMini.textContent = displayArtist;
    if (elements.hologramTitle) elements.hologramTitle.textContent = displayName;
    if (elements.hologramArtist) elements.hologramArtist.textContent = displayArtist;
    checkMarquee();
    if (pictures && pictures.length > 0) {
        const blob = new Blob([pictures[0].data], { type: pictures[0].format });
        updateArtUI(URL.createObjectURL(blob));
    } else {
        pushMiniPlayerState();
    }
}

function updateArtUI(url) {
    const targetUrl = url || '/static/img/default-art.png';
    currentArtUrl = targetUrl;
    const img = new Image();
    img.onload = () => {
        try {
            const canvas = document.createElement('canvas'); canvas.width = 50; canvas.height = 50;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 50, 50);
            const data = ctx.getImageData(0, 0, 50, 50).data;
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
            const pixels = data.length / 4;
            const rAvg = Math.round(r / pixels), gAvg = Math.round(g / pixels), bAvg = Math.round(b / pixels);
            const brightness = (0.299 * rAvg + 0.587 * gAvg + 0.114 * bAvg);
            
            if (hologramEngine) {
                hologramEngine.updateColors({
                    primary: `rgb(${rAvg}, ${gAvg}, ${bAvg})`,
                    secondary: `rgb(${Math.round(rAvg * 0.8)}, ${Math.round(gAvg * 1.2)}, ${Math.round(bAvg * 1.1)})`
                });
            }
            let oppR = 255 - rAvg, oppG = 255 - gAvg, oppB = 255 - bAvg;
            if (brightness > 90 && brightness < 165) {
                if (brightness > 127) { oppR = 20; oppG = 20; oppB = 25; } 
                else { oppR = 245; oppG = 245; oppB = 245; }
            }
            document.documentElement.style.setProperty('--text-primary', `rgb(${oppR}, ${oppG}, ${oppB})`);
            const mix = brightness > 127 ? 40 : -40;
            document.documentElement.style.setProperty('--text-secondary', `rgb(${Math.max(0,Math.min(255,oppR+mix))}, ${Math.max(0,Math.min(255,oppG+mix))}, ${Math.max(0,Math.min(255,oppB+mix))})`);
            document.body.classList.toggle('light-bg', brightness > 140);
        } catch (e) {}
    };
    img.src = targetUrl;
    if (hologramEngine) hologramEngine.updateArtwork(targetUrl);
    elements.albumArtLarge.src = targetUrl;
    elements.albumArtMini.src = targetUrl;
    elements.artworkShadow.style.backgroundImage = url ? `url("${url}")` : 'none';
    if (elements.appBg) elements.appBg.style.backgroundImage = url ? `url("${url}")` : 'none';
    pushMiniPlayerState();
}

function resetUI() {
    elements.progress.style.width = '0%';
    elements.currentTimeLabel.textContent = '0:00';
    elements.durationLabel.textContent = '0:00';
    if (window.electronAPI?.updateMediaState) window.electronAPI.updateMediaState({ progress: 0, isPlaying: false });
}

function updatePlaylistHighlight() {
    document.querySelectorAll('.playlist-item').forEach(item => {
        item.classList.toggle('active', parseInt(item.dataset.index) === currentSongIndex);
    });
}

function checkMarquee() {
    const c = elements.miniInfoContainer, t = elements.trackTitleMini;
    if (t && c) t.classList.toggle('scroll', t.scrollWidth > c.clientWidth);
}

function formatTime(s) {
    if (isNaN(s)) return '0:00';
    return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
}

function setupEventListeners() {
    if (elements.hologramBtn) elements.hologramBtn.addEventListener('click', toggleHologramMode);
    if (elements.holoCloseBtn) elements.holoCloseBtn.addEventListener('click', toggleHologramMode);
    if (elements.holoMinimalBtn) {
        elements.holoMinimalBtn.addEventListener('click', () => {
            document.body.classList.toggle('hologram-minimal');
            elements.holoMinimalBtn.classList.toggle('active');
        });
    }

    elements.playBtn.addEventListener('click', togglePlay);
    elements.nextBtn.addEventListener('click', nextSong);
    elements.prevBtn.addEventListener('click', prevSong);
    
    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        elements.progress.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
        elements.currentTimeLabel.textContent = formatTime(audio.currentTime);
        if (!audio._lSync || audio.currentTime - audio._lSync >= 1) {
            audio._lSync = audio.currentTime; pushMiniPlayerState();
        }
    });
    audio.addEventListener('loadedmetadata', () => elements.durationLabel.textContent = formatTime(audio.duration));
    audio.addEventListener('error', () => {
        isPlaying = false; elements.playIcon.className = 'ri-play-fill';
        elements.artworkWrapper.classList.remove('playing'); pushMiniPlayerState();
    });
    audio.addEventListener('ended', nextSong);
    
    const seek = (e) => {
        if (!audio.duration) return;
        const rect = elements.progressBar.getBoundingClientRect();
        audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audio.duration;
    };
    elements.progressBar.addEventListener('click', seek);
    elements.progressBar.addEventListener('mousedown', (e) => {
        if (!audio.duration) return; elements.progressBar.classList.add('dragging'); seek(e);
        const onMove = (ev) => seek(ev);
        const onUp = () => { elements.progressBar.classList.remove('dragging'); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
    
    elements.volumeBar.addEventListener('click', (e) => {
        const rect = elements.volumeBar.getBoundingClientRect();
        audio.volume = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        updateVolumeUI(audio.volume); saveSettings();
    });
    elements.muteBtn.addEventListener('click', () => {
        if (audio.volume > 0) { audio.dataset.v = audio.volume; audio.volume = 0; }
        else { audio.volume = audio.dataset.v || 0.5; }
        updateVolumeUI(audio.volume); saveSettings();
    });
    
    if (elements.randomizeBtn) elements.randomizeBtn.addEventListener('click', randomizeSong);
    elements.searchInput.addEventListener('input', (e) => {
        renderPlaylist(songs.filter(s => s.filename.toLowerCase().includes(e.target.value.toLowerCase())));
    });
    elements.shuffleBtn.addEventListener('click', () => {
        isShuffle = !isShuffle;
        if (isShuffle) {
            const cur = songs[currentSongIndex];
            songs.sort(() => Math.random() - 0.5);
            currentSongIndex = songs.findIndex(s => s.url === cur.url);
        } else {
            const cur = songs[currentSongIndex];
            songs = [...originalOrder];
            currentSongIndex = songs.findIndex(s => s.url === cur.url);
        }
        renderPlaylist(songs); updateShuffleUI(); saveSettings();
    });
    elements.repeatBtn.addEventListener('click', () => { repeatMode = (repeatMode + 1) % 3; updateRepeatUI(); saveSettings(); });
    
    elements.addFolderBtn.addEventListener('click', async () => {
        if (window.electronAPI?.selectFolder) {
            const dir = await window.electronAPI.selectFolder();
            if (dir) {
                await window.electronAPI.saveConfig({ musicDir: dir });
                await setMusicDirectory(dir);
                await fetchSongs();
                if (songs.length > 0) loadSong(0, false);
            }
        } else elements.folderInput.click();
    });
}

function updateVolumeUI(v) {
    elements.volumeProgress.style.width = `${v * 100}%`;
    if (audioEngine) audioEngine.setMasterVolume(v);
    elements.volumeIcon.className = v === 0 ? 'ri-volume-mute-fill' : (v < 0.5 ? 'ri-volume-down-fill' : 'ri-volume-up-fill');
}
function updateShuffleUI() { elements.shuffleBtn.classList.toggle('active', isShuffle); }
function updateRepeatUI() {
    elements.repeatBtn.classList.toggle('active', repeatMode > 0);
    elements.repeatBtn.querySelector('i').className = repeatMode === 2 ? 'ri-repeat-one-fill' : 'ri-repeat-2-line';
}

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') nextSong();
    else if (e.code === 'ArrowLeft') prevSong();
    else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) randomizeSong();
    else if (e.code === 'F11' || (e.code === 'Escape' && isHologramActive)) {
        e.preventDefault();
        if (e.code === 'Escape' && isHologramActive) toggleHologramMode();
        else if (e.code === 'F11') {
            toggleHologramMode();
            if (isHologramActive) {
                if (window.electronAPI?.toggleFullscreen) window.electronAPI.toggleFullscreen();
                else document.documentElement.requestFullscreen().catch(()=>{});
            }
        }
    }
});

init();
