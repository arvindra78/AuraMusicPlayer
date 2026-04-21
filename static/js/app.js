// Aura Music Player 3.2.1 - app.js
// Using global musicMetadata from unpkg

// State
let songs = [];
let currentSongIndex = -1;
let isPlaying = false;
let isShuffle = true;
let repeatMode = 0; // 0 = none, 1 = all, 2 = one
const audio = new Audio();
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
    // Make art URL absolute so mini player (loaded via file://) can fetch it from Flask
    let artUrl = currentArtUrl;
    if (artUrl && artUrl.startsWith('/')) {
        artUrl = `${window.location.origin}${artUrl}`;
    }
    return { title, artist, artUrl, isPlaying, progress, currentTime: audio.currentTime || 0, duration: audio.duration || 0 };
}

// Push state to mini player window (called whenever playback state changes)
function pushMiniPlayerState() {
    if (window.electronAPI && window.electronAPI.sendMiniPlayerState) {
        window.electronAPI.sendMiniPlayerState(getMiniPlayerState());
    }
}

// Initialization
async function init() {
    loadSettings();
    
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
            });
        }
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
    } else {
        const playUrl = `/api/serve-file?path=${encodeURIComponent(filePath)}`;
        const filename = filePath.split(/[/\\]/).pop();
        const newSong = { url: playUrl, filename, path: filePath };
        songs = [newSong, ...songs];
        renderPlaylist(songs);
        loadSong(0);
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
        songs = [...data].sort(() => Math.random() - 0.5);
        originalOrder = [...data];
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
    
    isShuffle = true; // Always on
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

// Playlist rendering
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
            if (currentSongIndex === actualIndex && isPlaying) {
                pause();
            } else {
                loadSong(actualIndex);
            }
        });
        
        elements.playlist.appendChild(li);
    });
}

// Audio Control
async function loadSong(index, autoPlay = true) {
    if (index < 0 || index >= songs.length) return;
    
    // Track change animation
    if (elements.artworkShowcase && currentSongIndex >= 0 && currentSongIndex !== index) {
        elements.artworkShowcase.classList.add('track-changing');
        setTimeout(() => elements.artworkShowcase?.classList.remove('track-changing'), 400);
    }
    currentSongIndex = index;
    saveSettings();
    
    const song = songs[currentSongIndex];
    audio.src = song.url;
    
    // Reset UI
    resetUI();
    elements.trackTitleLarge.textContent = song.filename.replace(/\.[^/.]+$/, "");
    elements.trackTitleMini.textContent = song.filename.replace(/\.[^/.]+$/, "");
    
    updatePlaylistHighlight();
    checkMarquee();
    
    if (autoPlay) {
        play();
    }
    
    // Fetch and Parse Metadata asynchronously
    await fetchMetadata(song);
}

function play() {
    audio.play();
    isPlaying = true;
    elements.playIcon.className = 'ri-pause-fill';
    elements.artworkWrapper.classList.add('playing');
    
    // Show bottom bar mini info
    elements.miniArtworkContainer.classList.remove('hidden');
    elements.miniInfoContainer.classList.remove('hidden');
    pushMiniPlayerState();
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
    if (repeatMode === 2) {
        audio.currentTime = 0;
        play();
        return;
    }
    let nextIndex = currentSongIndex + 1;
    if (nextIndex >= songs.length) {
        nextIndex = 0;
        if (repeatMode === 0) {
            loadSong(nextIndex, false);
            return;
        }
    }
    loadSong(nextIndex);
}

function prevSong() {
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }
    let prevIndex = currentSongIndex - 1;
    if (prevIndex < 0) prevIndex = songs.length - 1;
    loadSong(prevIndex);
}

function randomizeSong() {
    if (songs.length === 0) return;
    if (songs.length === 1) { loadSong(0); return; }
    let randomIndex;
    do {
        randomIndex = Math.floor(Math.random() * songs.length);
    } while (randomIndex === currentSongIndex);
    loadSong(randomIndex);
}

// ─── Album Art API (single flow per song type) ───────────────────────────────

async function fetchArt(song) {
    const isAbsPath = song.path && (song.path.includes(':\\') || song.path.startsWith('/'));
    console.log('[Art] fetchArt', { 
        hasFile: !!song.file, 
        path: song.path, 
        isAbsPath,
        url: song.url?.slice?.(0, 50) 
    });

    updateMetadataUI(null, null, null);

    try {
        // Priority 1: If we have an absolute path (Electron), use the fast path-based API
        if (isAbsPath) {
            console.log('[Art] Using path-based extraction');
            await fetchArtFromPath(song.path);
        } 
        // Priority 2: If we have a File object (Browser/Manual upload), use multipart POST
        else if (song.file) {
            console.log('[Art] Using file-upload extraction');
            await fetchArtFromFile(song);
        }
        // Priority 3: Server library tracks
        else if (song.url?.startsWith('/music/')) {
            console.log('[Art] Using library-based extraction');
            await fetchArtFromLibrary(song.url);
        } 
        else {
            console.log('[Art] No handler for song type');
            updateArtUI(null);
        }
    } catch (e) {
        console.error('[Art] fetchArt error', e);
        updateArtUI(null);
    }
}

async function fetchArtFromFile(song) {
    console.log('[Art] fetchArtFromFile', song.filename, 'file:', song.file?.name, song.file?.size);
    if (!song.file) {
        updateArtUI(null);
        return;
    }

    // Try high-quality browser extraction FIRST if library is available
    const lib = (typeof musicMetadata !== 'undefined' ? musicMetadata : (typeof mm !== 'undefined' ? mm : null));
    if (lib) {
        console.log('[Art] Using music-metadata-browser for extraction');
        try {
            const meta = await lib.parseBlob(song.file);
            if (meta?.common) {
                const title = meta.common.title;
                const artist = meta.common.artist;
                const pictures = meta.common.picture;
                
                console.log('[Art] Local parse success', { title, artist, hasPic: !!pictures?.length });
                updateMetadataUI(title, artist, pictures);
                updatePlaylistItemUI(song.url, title, artist);
                
                if (pictures && pictures.length > 0) return; // Done!
            }
        } catch (err) {
            console.warn('[Art] music-metadata-browser failed, falling back to server', err);
        }
    }

    // Fallback: Send to server for extraction
    const fd = new FormData();
    fd.append('file', song.file);
    let res;
    try {
        res = await fetch('/api/art', { method: 'POST', body: fd });
    } catch (e) {
        console.error('[Art] POST /api/art fetch failed', e);
        const fallback = await extractArtFromBlob(song.file);
        updateArtUI(fallback || null);
        return;
    }

    if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) {
            const url = URL.createObjectURL(blob);
            updateArtUI(url);
        } else {
            console.log('[Art] Empty blob from server, trying legacy manual fallback');
            const fallback = await extractArtFromBlob(song.file);
            updateArtUI(fallback || null);
        }
    } else {
        console.log('[Art] Backend returned', res.status, 'trying legacy manual fallback');
        const fallback = await extractArtFromBlob(song.file);
        updateArtUI(fallback || null);
    }
}

async function fetchArtFromPath(path) {
    const url = `/api/art-by-path?path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) updateArtUI(url);
    else updateArtUI(null);
}

async function fetchArtFromLibrary(musicUrl) {
    const relPath = musicUrl.replace(/^\/music\//, '');
    const url = `/api/art/${relPath}`;
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) updateArtUI(url);
    else updateArtUI(null);
}

async function fetchMetadata(song) {
    await fetchArt(song);
}

function updatePlaylistItemUI(url, title, artist) {
    const items = document.querySelectorAll('.playlist-item');
    items.forEach(item => {
        // This is a bit slow but ensures the right item is updated
        // For local files, the URL is a blob URL
        const songObj = songs.find(s => s.url === url);
        if (songObj) {
            const trackNameEl = item.querySelector('.track-name');
            const trackArtistEl = item.querySelector('.track-artist');
            if (trackNameEl && (trackNameEl.textContent === songObj.filename.replace(/\.[^/.]+$/, ""))) {
                if (title) trackNameEl.textContent = title;
                if (artist) trackArtistEl.textContent = artist;
            }
        }
    });
}

async function extractArtFromBlob(file) {
    // Try DataView-based ID3 frame scan for local files
    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        // Quick check for ID3 tag
        const id3 = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
        if (id3 === 'ID3') {
            // search for APIC frame
            const bytes = new Uint8Array(buffer);
            for (let i = 10; i < bytes.length - 10; i++) {
                if (bytes[i] === 0x41 && bytes[i+1] === 0x50 && bytes[i+2] === 0x49 && bytes[i+3] === 0x43) {
                    // Found APIC frame header
                    const frameSize = (bytes[i+4] << 24) | (bytes[i+5] << 16) | (bytes[i+6] << 8) | bytes[i+7];
                    let offset = i + 10; // skip frame header
                    // Find start of image (after mime + null + pic type + description + null)
                    let nullCount = 0;
                    while (offset < i + 10 + frameSize && nullCount < 2) {
                        if (bytes[offset] === 0) nullCount++;
                        offset++;
                    }
                    const imageData = bytes.slice(offset, i + 10 + frameSize);
                    const blob = new Blob([imageData]);
                    return URL.createObjectURL(blob);
                }
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

function updateMetadataUI(title, artist, pictures) {
    if (title) {
        elements.trackTitleLarge.textContent = title;
        elements.trackTitleMini.textContent = title;
    } else {
        // Fallback to filename if no title
        const song = songs[currentSongIndex];
        if (song) {
            const name = song.filename.replace(/\.[^/.]+$/, "");
            elements.trackTitleLarge.textContent = name;
            elements.trackTitleMini.textContent = name;
        }
    }

    if (artist) {
        elements.trackArtistLarge.textContent = artist;
        elements.trackArtistMini.textContent = artist;
    } else {
        elements.trackArtistLarge.textContent = "Unknown Artist";
        elements.trackArtistMini.textContent = "Unknown Artist";
    }

    checkMarquee();
    
    if (pictures && pictures.length > 0) {
        const picture = pictures[0];
        const blob = new Blob([picture.data], { type: picture.format });
        const url = URL.createObjectURL(blob);
        updateArtUI(url);
    }
}

function updateArtUI(url) {
    const defaultArt = '/static/img/default-art.png';
    const targetUrl = url || defaultArt;

    // Track for mini player
    currentArtUrl = targetUrl;
    
    // Check brightness to adjust UI contrast
    const img = new Image();
    img.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 50;
            canvas.height = 50;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 50, 50);
            const data = ctx.getImageData(0, 0, 50, 50).data;
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
            }
            const pixels = data.length / 4;
            const rAvg = Math.round(r / pixels);
            const gAvg = Math.round(g / pixels);
            const bAvg = Math.round(b / pixels);
            const brightness = (0.299 * rAvg + 0.587 * gAvg + 0.114 * bAvg);
            
            // Calculate opposite (inverted) color
            let oppR = 255 - rAvg;
            let oppG = 255 - gAvg;
            let oppB = 255 - bAvg;
            
            // Contrast boost: if the image is medium grey, opposite is also grey (low contrast). 
            // In that case, we push it to black or white.
            if (brightness > 90 && brightness < 165) {
                if (brightness > 127) {
                    oppR = 20; oppG = 20; oppB = 25; // Dark
                } else {
                    oppR = 245; oppG = 245; oppB = 245; // Light
                }
            }
            
            document.documentElement.style.setProperty('--text-primary', `rgb(${oppR}, ${oppG}, ${oppB})`);
            
            // Derive a secondary color for artist names (slightly washed out)
            const mix = brightness > 127 ? 40 : -40;
            const subR = Math.max(0, Math.min(255, oppR + mix));
            const subG = Math.max(0, Math.min(255, oppG + mix));
            const subB = Math.max(0, Math.min(255, oppB + mix));
            document.documentElement.style.setProperty('--text-secondary', `rgb(${subR}, ${subG}, ${subB})`);
            
            if (brightness > 140) {
                document.body.classList.add('light-bg');
            } else {
                document.body.classList.remove('light-bg');
            }
        } catch (e) {
            console.error("Canvas read error:", e);
            document.body.classList.remove('light-bg');
            document.documentElement.style.removeProperty('--text-primary');
            document.documentElement.style.removeProperty('--text-secondary');
        }
    };
    img.onerror = () => {
        document.body.classList.remove('light-bg');
        document.documentElement.style.removeProperty('--text-primary');
        document.documentElement.style.removeProperty('--text-secondary');
    };
    img.src = targetUrl;

    if (url) {
        elements.albumArtLarge.src = url;
        elements.albumArtMini.src = url;
        elements.artworkShadow.style.backgroundImage = `url("${url}")`;
        
        if (elements.appBg) {
            elements.appBg.style.backgroundImage = `url("${url}")`;
            elements.appBg.style.backgroundSize = "cover";
            elements.appBg.style.backgroundPosition = "center";
            elements.appBg.style.backgroundRepeat = "no-repeat";
        }
    } else {
        elements.albumArtLarge.src = defaultArt;
        elements.albumArtMini.src = defaultArt;
        if (elements.artworkShadow) elements.artworkShadow.style.backgroundImage = 'none';
        
        if (elements.appBg) {
            elements.appBg.style.background = `radial-gradient(circle at 20% 20%, rgba(124, 138, 255, 0.15) 0%, transparent 50%), 
                                               radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.15) 0%, transparent 50%),
                                               var(--bg-base)`;
        }
    }

    // Notify mini player of the art change
    pushMiniPlayerState();
}

function resetUI() {
    elements.progress.style.width = '0%';
    elements.currentTimeLabel.textContent = '0:00';
    elements.durationLabel.textContent = '0:00';
}

function updatePlaylistHighlight() {
    document.querySelectorAll('.playlist-item').forEach((item) => {
        const idx = parseInt(item.dataset.index, 10);
        item.classList.toggle('active', idx === currentSongIndex);
    });
}

function checkMarquee() {
    const container = elements.miniInfoContainer;
    const title = elements.trackTitleMini;
    if (title.scrollWidth > container.clientWidth) {
        title.classList.add('scroll');
    } else {
        title.classList.remove('scroll');
    }
}

// Time Formatting
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

// Events Setup
function setupEventListeners() {
    // Playback
    elements.playBtn.addEventListener('click', togglePlay);
    elements.nextBtn.addEventListener('click', nextSong);
    elements.prevBtn.addEventListener('click', prevSong);
    
    // Audio Events
    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        const current = audio.currentTime;
        const duration = audio.duration;
        const progressPercent = (current / duration) * 100;
        
        elements.progress.style.width = `${progressPercent}%`;
        elements.currentTimeLabel.textContent = formatTime(current);

        // Throttle mini player sync to every ~1 second
        if (!audio._lastMiniSync || current - audio._lastMiniSync >= 1) {
            audio._lastMiniSync = current;
            pushMiniPlayerState();
        }
    });
    
    audio.addEventListener('loadedmetadata', () => {
        elements.durationLabel.textContent = formatTime(audio.duration);
    });
    
    audio.addEventListener('ended', nextSong);
    
    // Seek — click + drag
    function seekFromEvent(e) {
        if (!audio.duration) return;
        const rect = elements.progressBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = percent * audio.duration;
    }
    elements.progressBar.addEventListener('click', (e) => {
        if (e.target.classList.contains('progress-handle')) return;
        seekFromEvent(e);
    });
    elements.progressBar.addEventListener('mousedown', (e) => {
        if (!audio.duration) return;
        if (e.target.classList.contains('progress-handle')) e.preventDefault();
        elements.progressBar.classList.add('dragging');
        seekFromEvent(e);
        const onMove = (ev) => seekFromEvent(ev);
        const onUp = () => {
            elements.progressBar.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
    
    // Volume
    elements.volumeBar.addEventListener('click', (e) => {
        const rect = elements.volumeBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.volume = percent;
        updateVolumeUI(percent);
        saveSettings();
    });
    
    elements.muteBtn.addEventListener('click', () => {
        if (audio.volume > 0) {
            audio.dataset.savedVolume = audio.volume;
            audio.volume = 0;
        } else {
            audio.volume = audio.dataset.savedVolume || 0.5;
        }
        updateVolumeUI(audio.volume);
        saveSettings();
    });
    
    // Randomize
    if (elements.randomizeBtn) {
        elements.randomizeBtn.addEventListener('click', randomizeSong);
    }

    // Smart Features
    elements.searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        // Since we want to always stay in 'songs' order (which is shuffled), 
        // we filter the current 'songs' array.
        const filtered = songs.filter(s => s.filename.toLowerCase().includes(term));
        renderPlaylist(filtered);
    });
    
    elements.shuffleBtn.addEventListener('click', () => {
        // Now acts as "Reshuffle"
        songs = [...songs].sort(() => Math.random() - 0.5);
        // Maintain current song play if necessary, but usually shuffle means "I want something different"
        // Let's find current song's new index to avoid interruption
        if (currentSongIndex !== -1) {
            const currentSongUrl = songs[currentSongIndex].url; // This is the index in the OLD shuffled list
            // However, we just overwrote 'songs' with a NEW shuffled list.
            // Let's re-find it.
            // Wait, 'songs' was already shuffled. Let's do it better:
            const currentSong = songs[currentSongIndex];
            songs.sort(() => Math.random() - 0.5);
            currentSongIndex = songs.findIndex(s => s.url === currentSong.url);
        }
        renderPlaylist(songs);
        updateShuffleUI();
        saveSettings();
    });
    
    elements.repeatBtn.addEventListener('click', () => {
        repeatMode = (repeatMode + 1) % 3;
        updateRepeatUI();
        saveSettings();
    });
    
    // Local Folder Support
    elements.addFolderBtn.addEventListener('click', () => {
        elements.folderInput.click();
    });
    
    elements.folderInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        const audioFiles = files.filter(file => {
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            return ['.mp3', '.flac', '.wav', '.m4a', '.ogg'].includes(ext);
        });

        if (audioFiles.length === 0) return;

        // Replace current playlist with local folder contents
        songs = audioFiles.map(file => {
            const path = window.electronAPI?.getPathForFile?.(file) || file.path || '';
            console.log('[Folder] Mapping file:', file.name, 'Path:', path);
            return {
                url: URL.createObjectURL(file),
                filename: file.name,
                file: file,
                path: path || undefined
            };
        });
        
        originalOrder = [...songs];
        renderPlaylist(songs);
        
        if (songs.length > 0) {
            loadSong(0, false);
        }
    });
    
    // Media Session
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', play);
        navigator.mediaSession.setActionHandler('pause', pause);
        navigator.mediaSession.setActionHandler('previoustrack', prevSong);
        navigator.mediaSession.setActionHandler('nexttrack', nextSong);
    }
}

function updateVolumeUI(vol) {
    elements.volumeProgress.style.width = `${vol * 100}%`;
    if (vol === 0) {
        elements.volumeIcon.className = 'ri-volume-mute-fill';
    } else if (vol < 0.5) {
        elements.volumeIcon.className = 'ri-volume-down-fill';
    } else {
        elements.volumeIcon.className = 'ri-volume-up-fill';
    }
}

function updateShuffleUI() {
    elements.shuffleBtn.classList.toggle('active', isShuffle);
}

function updateRepeatUI() {
    elements.repeatBtn.classList.toggle('active', repeatMode > 0);
    if (repeatMode === 2) {
        elements.repeatBtn.querySelector('i').className = 'ri-repeat-one-fill';
    } else {
        elements.repeatBtn.querySelector('i').className = 'ri-repeat-2-line';
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    
    if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
    } else if (e.code === 'ArrowRight') {
        nextSong();
    } else if (e.code === 'ArrowLeft') {
        prevSong();
    } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        randomizeSong();
    } else if (e.code === 'F11') {
        e.preventDefault();
        // Toggle the class directly NOW — don't wait for IPC round-trip (unreliable on Windows)
        const willBeFullscreen = !document.body.classList.contains('fullscreen-mode');
        document.body.classList.toggle('fullscreen-mode', willBeFullscreen);
        if (window.electronAPI && window.electronAPI.toggleFullscreen) {
            window.electronAPI.toggleFullscreen();
        } else {
            if (willBeFullscreen) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
            }
        }
    }
});

// Start the engine
init();
