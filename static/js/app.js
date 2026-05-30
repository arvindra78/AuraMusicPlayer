// Aura Music Player 3.3.2 - app.js
// Using global musicMetadata from unpkg

// State
let allSongs = [];      // Global library (all discovered songs)
let songs = [];         // Current active playlist/view
let currentSongIndex = -1;
let isPlaying = false;
let isShuffle = true;
let repeatMode = 0; // 0 = none, 1 = all, 2 = one

// Playlist System State
let playlists = [];
let favorites = [];
let recentlyPlayed = [];
let currentView = 'all'; // 'all', 'favorites', 'recent', or {playlist_id}

const audio = new Audio();
const audioEngine = new AudioEngine(audio);
let hologramEngine = null;
let isHologramActive = false;
let originalOrder = []; // for shuffle toggle
let currentArtUrl = '';

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

    // Sidebar Nav
    navAllSongs: document.getElementById('navAllSongs'),
    navFavorites: document.getElementById('navFavorites'),
    navRecent: document.getElementById('navRecent'),
    userPlaylists: document.getElementById('userPlaylists'),
    addPlaylistBtn: document.getElementById('addPlaylistBtn'),

    // Modals
    playlistModal: document.getElementById('playlistModal'),
    modalTitle: document.getElementById('modalTitle'),
    playlistNameInput: document.getElementById('playlistNameInput'),
    modalCancelBtn: document.getElementById('modalCancelBtn'),
    modalSaveBtn: document.getElementById('modalSaveBtn'),

    deleteConfirmModal: document.getElementById('deleteConfirmModal'),
    deleteCancelBtn: document.getElementById('deleteCancelBtn'),
    deleteConfirmBtn: document.getElementById('deleteConfirmBtn'),

    // Context Menu
    contextMenu: document.getElementById('contextMenu'),
};

// Add fallbacks for broken images
elements.albumArtLarge.onerror = () => { elements.albumArtLarge.src = '/static/img/default-art.png'; };
elements.albumArtMini.onerror = () => { elements.albumArtMini.src = '/static/img/default-art.png'; };

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
    console.log('[Startup] Initializing Aura Music Player...');
    loadSettings();
    await loadPlaylists();
    
    // Initialize Hologram Engine
    try {
        if (elements.hologramCanvas) {
            hologramEngine = new HologramEngine(elements.hologramCanvas);
        }
    } catch (e) {
        console.error('[Startup] Failed to instantiate HologramEngine:', e);
    }

    let initialFile = null;
    try {
        if (window.electronAPI && window.electronAPI.getInitialFile) {
            initialFile = await window.electronAPI.getInitialFile();
        }
    } catch (e) {}
    
    if (initialFile) {
        await handleExternalFile(initialFile);
    } else {
        try {
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
        } catch (e) {}

        await fetchSongs();

        if (allSongs.length > 0 && currentSongIndex !== -1) {
            loadSong(currentSongIndex, false);
        }
    }
    
    setupEventListeners();
    setupOpenFileHandler();
    setupMediaSessionHandlers();
    setupPlaylistHandlers();

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
    console.log('[Startup] Initialization complete.');
}

async function loadPlaylists() {
    if (window.electronAPI && window.electronAPI.getPlaylists) {
        const data = await window.electronAPI.getPlaylists();
        playlists = data.playlists || [];
        favorites = data.favorites || [];
        recentlyPlayed = data.recentlyPlayed || [];
        renderNavPlaylists();
    }
}

async function savePlaylists() {
    if (window.electronAPI && window.electronAPI.savePlaylists) {
        await window.electronAPI.savePlaylists({
            playlists,
            favorites,
            recentlyPlayed
        });
    }
}

async function fetchSongs() {
    try {
        const response = await fetch('/api/songs');
        const data = await response.json();
        allSongs = [...data];
        switchView(currentView);
    } catch (error) {
        console.error('Failed to fetch songs:', error);
    }
}

function switchView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    if (view === 'all') {
        songs = [...allSongs];
        elements.navAllSongs.classList.add('active');
    } else if (view === 'favorites') {
        songs = allSongs.filter(s => favorites.includes(s.url));
        elements.navFavorites.classList.add('active');
    } else if (view === 'recent') {
        songs = recentlyPlayed.map(url => allSongs.find(s => s.url === url)).filter(Boolean);
        elements.navRecent.classList.add('active');
    } else {
        const pl = playlists.find(p => p.id === view);
        if (pl) {
            songs = pl.songs.map(url => allSongs.find(s => s.url === url)).filter(Boolean);
            const plEl = document.querySelector(`.nav-item[data-id="${view}"]`);
            if (plEl) plEl.classList.add('active');
        } else {
            songs = [...allSongs];
            currentView = 'all';
            elements.navAllSongs.classList.add('active');
        }
    }

    originalOrder = [...songs];
    if (isShuffle) {
        songs.sort(() => Math.random() - 0.5);
    }
    renderPlaylist(songs);
    updatePlaylistHighlight();
}

function renderPlaylist(listToRender) {
    elements.playlist.innerHTML = '';
    if (elements.playlistEmpty) {
        elements.playlistEmpty.classList.toggle('hidden', listToRender.length > 0);
    }
    listToRender.forEach((song, idx) => {
        const li = document.createElement('li');
        li.className = 'playlist-item';
        li.dataset.index = idx;
        li.dataset.url = song.url;
        li.draggable = true;

        const isFav = favorites.includes(song.url);
        
        if (idx === currentSongIndex) li.classList.add('active');
        
        li.innerHTML = `
            <i class="ri-music-2-line track-icon"></i>
            <div class="track-number">${idx + 1}</div>
            <i class="ri-play-mini-fill play-icon"></i>
            <div class="track-details">
                <div class="track-name">${song.filename.replace(/\.[^/.]+$/, "")}</div>
                <div class="track-artist">${song.artist || "Unknown Artist"}</div>
            </div>
            <button class="fav-btn ${isFav ? 'active' : ''}" title="Favorite">
                <i class="ri-heart-line"></i>
            </button>
            <button class="playlist-item-more" title="More Options">
                <i class="ri-more-2-fill"></i>
            </button>
        `;

        li.addEventListener('click', (e) => {
            if (e.target.closest('.fav-btn') || e.target.closest('.playlist-item-more')) return;
            if (currentSongIndex === idx && isPlaying) pause();
            else loadSong(idx);
        });

        const favBtn = li.querySelector('.fav-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(song.url);
        });

        const moreBtn = li.querySelector('.playlist-item-more');
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showSongContextMenu(e, song, idx);
        });

        // Drag events
        li.addEventListener('dragstart', (e) => {
            li.classList.add('dragging');
            e.dataTransfer.setData('text/plain', song.url);
            e.dataTransfer.effectAllowed = 'copy';
        });

        li.addEventListener('dragend', () => {
            li.classList.remove('dragging');
        });

        elements.playlist.appendChild(li);
    });
}

function renderNavPlaylists() {
    elements.userPlaylists.innerHTML = '';
    playlists.forEach(pl => {
        const div = document.createElement('div');
        div.className = `nav-item ${currentView === pl.id ? 'active' : ''}`;
        div.dataset.id = pl.id;
        div.innerHTML = `
            <i class="ri-playlist-line"></i>
            <span>${pl.name}</span>
        `;
        div.addEventListener('click', () => switchView(pl.id));
        
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showPlaylistContextMenu(e, pl);
        });

        // Drop target
        div.addEventListener('dragover', (e) => {
            e.preventDefault();
            div.classList.add('drag-over');
        });
        div.addEventListener('dragleave', () => {
            div.classList.remove('drag-over');
        });
        div.addEventListener('drop', (e) => {
            e.preventDefault();
            div.classList.remove('drag-over');
            const songUrl = e.dataTransfer.getData('text/plain');
            addSongToPlaylist(songUrl, pl.id);
        });

        elements.userPlaylists.appendChild(div);
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
    if (autoPlay) {
        await play();
        addToRecentlyPlayed(song.url);
    }
    await fetchMetadata(song);
}

function addToRecentlyPlayed(url) {
    recentlyPlayed = recentlyPlayed.filter(u => u !== url);
    recentlyPlayed.unshift(url);
    if (recentlyPlayed.length > 100) recentlyPlayed.pop();
    savePlaylists();
}

function toggleFavorite(url) {
    if (favorites.includes(url)) {
        favorites = favorites.filter(u => u !== url);
    } else {
        favorites.push(url);
    }
    savePlaylists();
    const items = document.querySelectorAll(`.playlist-item[data-url="${url}"]`);
    items.forEach(li => {
        const btn = li.querySelector('.fav-btn');
        btn.classList.toggle('active', favorites.includes(url));
    });
    if (currentView === 'favorites') switchView('favorites');
}

function createPlaylist(name) {
    if (!name) return;
    if (playlists.find(p => p.name === name)) {
        alert('A playlist with this name already exists.');
        return;
    }
    const id = 'pl_' + Date.now();
    playlists.push({ id, name, songs: [] });
    savePlaylists();
    renderNavPlaylists();
    return id;
}

function renamePlaylist(id, newName) {
    if (!newName) return;
    const pl = playlists.find(p => p.id === id);
    if (pl) {
        pl.name = newName;
        savePlaylists();
        renderNavPlaylists();
    }
}

function deletePlaylist(id) {
    playlists = playlists.filter(p => p.id !== id);
    if (currentView === id) switchView('all');
    savePlaylists();
    renderNavPlaylists();
}

function addSongToPlaylist(songUrl, playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (pl) {
        if (!pl.songs.includes(songUrl)) {
            pl.songs.push(songUrl);
            savePlaylists();
            if (currentView === playlistId) switchView(playlistId);
        }
    }
}

function removeSongFromPlaylist(songUrl, playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (pl) {
        pl.songs = pl.songs.filter(u => u !== songUrl);
        savePlaylists();
        if (currentView === playlistId) switchView(playlistId);
    }
}

async function play() {
    try {
        if (audioEngine && !audioEngine.ctx) await audioEngine.init();
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
    if (songs.length === 0) return;
    if (repeatMode === 2) { audio.currentTime = 0; play(); return; }
    let nextIndex = (currentSongIndex + 1) % songs.length;
    if (nextIndex === 0 && repeatMode === 0) { loadSong(nextIndex, false); return; }
    loadSong(nextIndex);
}

function prevSong() {
    if (songs.length === 0) return;
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
    elements.hologramBtn.addEventListener('click', toggleHologramMode);
    elements.holoCloseBtn.addEventListener('click', toggleHologramMode);
    elements.holoMinimalBtn.addEventListener('click', () => {
        document.body.classList.toggle('hologram-minimal');
        elements.holoMinimalBtn.classList.toggle('active');
    });

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
    
    elements.randomizeBtn.addEventListener('click', randomizeSong);
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
    
    const sidebarToggle = document.getElementById('sidebarToggle');
    const appContainer = document.querySelector('.app-container');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('change', () => {
            appContainer.classList.toggle('sidebar-hidden', !sidebarToggle.checked);
            localStorage.setItem('aura-sidebar-visible', sidebarToggle.checked);
        });
        
        // Load initial state
        const sidebarVisible = localStorage.getItem('aura-sidebar-visible') !== 'false';
        sidebarToggle.checked = sidebarVisible;
        appContainer.classList.toggle('sidebar-hidden', !sidebarVisible);
    }

    elements.addFolderBtn.addEventListener('click', async () => {
        if (window.electronAPI?.selectFolder) {
            const dir = await window.electronAPI.selectFolder();
            if (dir) {
                await window.electronAPI.saveConfig({ musicDir: dir });
                await setMusicDirectory(dir);
                await fetchSongs();
                if (allSongs.length > 0) loadSong(0, false);
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

function setupPlaylistHandlers() {
    elements.navAllSongs.addEventListener('click', () => switchView('all'));
    elements.navFavorites.addEventListener('click', () => switchView('favorites'));
    elements.navRecent.addEventListener('click', () => switchView('recent'));
    elements.addPlaylistBtn.addEventListener('click', () => {
        showPlaylistModal('New Playlist', '', (name) => createPlaylist(name));
    });
    elements.modalCancelBtn.addEventListener('click', hidePlaylistModal);
    elements.modalSaveBtn.addEventListener('click', () => {
        const name = elements.playlistNameInput.value.trim();
        if (name && elements.modalSaveBtn.onSave) {
            elements.modalSaveBtn.onSave(name);
            hidePlaylistModal();
        }
    });
    elements.deleteCancelBtn.addEventListener('click', hideDeleteModal);
    document.addEventListener('click', () => { elements.contextMenu.style.display = 'none'; });
}

function showPlaylistModal(title, initialValue, onSave) {
    elements.modalTitle.textContent = title;
    elements.playlistNameInput.value = initialValue;
    elements.modalSaveBtn.textContent = initialValue ? 'Save Changes' : 'Create Playlist';
    elements.modalSaveBtn.onSave = onSave;
    elements.playlistModal.classList.add('visible');
    elements.playlistNameInput.focus();
}

function hidePlaylistModal() { elements.playlistModal.classList.remove('visible'); }

function showDeleteModal(playlistName, onConfirm) {
    document.getElementById('deleteConfirmText').textContent = `Are you sure you want to delete "${playlistName}"? This action cannot be undone.`;
    elements.deleteConfirmBtn.onclick = () => { onConfirm(); hideDeleteModal(); };
    elements.deleteConfirmModal.classList.add('visible');
}

function hideDeleteModal() { elements.deleteConfirmModal.classList.remove('visible'); }

function showSongContextMenu(e, song, index) {
    const menu = elements.contextMenu;
    menu.innerHTML = '';
    const items = [
        { label: 'Add to Favorites', icon: 'ri-heart-line', action: () => toggleFavorite(song.url) },
        { separator: true },
        { label: 'Add to Playlist', icon: 'ri-playlist-add-line', submenu: playlists.map(pl => ({
            label: pl.name,
            action: () => addSongToPlaylist(song.url, pl.id)
        })).concat([
            { separator: true },
            { label: '+ New Playlist', action: () => {
                showPlaylistModal('New Playlist', '', (name) => {
                    const id = createPlaylist(name);
                    if (id) addSongToPlaylist(song.url, id);
                });
            }}
        ])}
    ];
    if (currentView !== 'all' && currentView !== 'favorites' && currentView !== 'recent') {
        items.push({ separator: true });
        items.push({ label: 'Remove from Playlist', icon: 'ri-delete-bin-line', action: () => removeSongFromPlaylist(song.url, currentView) });
    }
    renderMenu(menu, items);
    menu.style.display = 'block';
    const { clientX: x, clientY: y } = e;
    const { innerWidth: winW, innerHeight: winH } = window;
    const { offsetWidth: menuW, offsetHeight: menuH } = menu;
    menu.style.left = (x + menuW > winW ? x - menuW : x) + 'px';
    menu.style.top = (y + menuH > winH ? y - menuH : y) + 'px';
}

function showPlaylistContextMenu(e, pl) {
    const menu = elements.contextMenu;
    menu.innerHTML = '';
    const items = [
        { label: 'Rename Playlist', icon: 'ri-edit-line', action: () => {
            showPlaylistModal('Rename Playlist', pl.name, (newName) => renamePlaylist(pl.id, newName));
        }},
        { label: 'Delete Playlist', icon: 'ri-delete-bin-line', action: () => {
            showDeleteModal(pl.name, () => deletePlaylist(pl.id));
        }}
    ];
    renderMenu(menu, items);
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
}

function renderMenu(container, items) {
    items.forEach(item => {
        if (item.separator) {
            const sep = document.createElement('div');
            sep.className = 'menu-separator';
            container.appendChild(sep);
            return;
        }
        const div = document.createElement('div');
        div.className = 'menu-item';
        div.innerHTML = `<span><i class="${item.icon}"></i>${item.label}</span>${item.submenu ? '<i class="ri-arrow-right-s-line submenu-arrow"></i>' : ''}`;
        if (item.action) div.addEventListener('click', (e) => { e.stopPropagation(); item.action(); elements.contextMenu.style.display = 'none'; });
        if (item.submenu) div.addEventListener('mouseenter', (e) => showSubmenu(e, item.submenu, div));
        container.appendChild(div);
    });
}

function showSubmenu(e, submenuItems, parentItem) {
    const existingSub = document.querySelector('.context-submenu');
    if (existingSub) existingSub.remove();
    const sub = document.createElement('div');
    sub.className = 'context-menu context-submenu';
    sub.style.display = 'block';
    renderMenu(sub, submenuItems);
    document.body.appendChild(sub);
    const rect = parentItem.getBoundingClientRect();
    sub.style.left = (rect.right + 5) + 'px';
    sub.style.top = rect.top + 'px';
    const hideSub = (ev) => { if (!sub.contains(ev.relatedTarget) && !parentItem.contains(ev.relatedTarget)) sub.remove(); };
    parentItem.addEventListener('mouseleave', hideSub);
    sub.addEventListener('mouseleave', hideSub);
}

function setupOpenFileHandler() {
    if (!window.electronAPI?.onOpenFile) return;
    window.electronAPI.onOpenFile((filePath) => handleExternalFile(filePath));
}

function toggleHologramMode() {
    if (!hologramEngine || !hologramEngine.enabled) return;
    isHologramActive = !isHologramActive;
    document.body.classList.toggle('hologram-active', isHologramActive);
    document.body.classList.toggle('fullscreen-mode', isHologramActive);
    elements.hologramContainer.classList.toggle('hidden', !isHologramActive);
    elements.hologramBtn.classList.toggle('active', isHologramActive);
    if (isHologramActive) {
        hologramEngine.init(audio); hologramEngine.start();
        if (currentArtUrl) hologramEngine.updateArtwork(currentArtUrl);
        elements.hologramTitle.textContent = elements.trackTitleLarge.textContent;
        elements.hologramArtist.textContent = elements.trackArtistLarge.textContent;
    } else { hologramEngine.stop(); }
}

async function setMusicDirectory(dir) {
    try {
        await fetch('/api/set-directory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ directory: dir })
        });
    } catch (e) {}
}

async function handleExternalFile(filePath) {
    if (!filePath) return;
    const ext = filePath.split('.').pop().toLowerCase();
    if (!['mp3', 'flac', 'wav', 'm4a', 'ogg'].includes(ext)) return;
    if (window.electronAPI && window.electronAPI.dirname) {
        const dir = window.electronAPI.dirname(filePath);
        await setMusicDirectory(dir);
        if (window.electronAPI.saveConfig) await window.electronAPI.saveConfig({ musicDir: dir });
        await fetchSongs();
        const filename = filePath.split(/[/\\]/).pop();
        const index = songs.findIndex(s => s.filename === filename);
        if (index !== -1) loadSong(index);
        else {
            const playUrl = `/api/serve-file?path=${encodeURIComponent(filePath)}`;
            const newSong = { url: playUrl, filename, path: filePath };
            allSongs = [newSong, ...allSongs];
            switchView('all');
            loadSong(0);
        }
    }
}

function loadSettings() {
    const savedVol = localStorage.getItem('aura-volume');
    audio.volume = savedVol !== null ? parseFloat(savedVol) : 0.5;
    updateVolumeUI(audio.volume);
    isShuffle = localStorage.getItem('aura-shuffle') !== 'false';
    repeatMode = parseInt(localStorage.getItem('aura-repeat') || '0');
    currentSongIndex = parseInt(localStorage.getItem('aura-last-song') || '-1');
    updateShuffleUI(); updateRepeatUI();
}

function saveSettings() {
    localStorage.setItem('aura-volume', audio.volume);
    localStorage.setItem('aura-shuffle', isShuffle);
    localStorage.setItem('aura-repeat', repeatMode);
    localStorage.setItem('aura-last-song', currentSongIndex);
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
