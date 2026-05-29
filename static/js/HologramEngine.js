/**
 * Aura Hologram Engine
 * High-performance 3D visualization layer powered by Three.js
 * Completely isolated from audio playback logic.
 */

class HologramEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.active = false;
        this.minimal = false;
        
        // Audio Analysis (Isolated)
        this.audioCtx = null;
        this.analyser = null;
        this.dataArray = null;
        this.audioSource = null;
        this.audioRetryId = null;
        this.audioRetryCount = 0;
        
        // Three.js Core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        
        // Visual Components
        this.group = new THREE.Group();
        this.spectrumBars = [];
        this.particleSystem = null;
        this.auraRing = null;
        this.artMesh = null;
        this.glowMesh = null;
        this.artBorder = null;
        this.grid = null;
        this.stars = null;
        
        // State
        this.colors = {
            primary: new THREE.Color('#7c8aff'),
            secondary: new THREE.Color('#8b5cf6'),
            accent: new THREE.Color('#ffffff')
        };
        
        this.envMode = 'Aura Space';
        this.environments = ['Aura Space']; // Simplified to one primary design
        this.performancePreset = 'High';
    }

    setEnvironment(name) {
        // Force the single simplified environment
        this.envMode = 'Aura Space';
        if (this.stars) this.stars.visible = true;
        if (this.grid) this.grid.visible = false;
        this.scene.background = null; 
        if (this.particleSystem) this.particleSystem.visible = true;
    }

    async init(audioElement) {
        this._attachAudioObserver(audioElement);
        this._resetSpectrumBars();
        if (this.scene) return;

        // Setup Three.js Scene
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 5;
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.scene.add(this.group);

        this._createEnvironment();
        this._createCyberGrid();
        this._createParticles();
        this._createAuraRing();
        this._createCircularSpectrum();
        this._createArtworkCenterpiece();
        this._createLights();
        window.addEventListener('resize', () => this.onResize());
    }

    _attachAudioObserver(audioElement) {
        if (!audioElement) return;

        try {
            // We create a SEPARATE AudioContext for visualization.
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.audioSource) {
                this.audioSource.disconnect();
                this.audioSource = null;
            }
            this.analyser = null;
            this.dataArray = null;
            if (this.audioRetryId) {
                clearTimeout(this.audioRetryId);
                this.audioRetryId = null;
            }
            
            // captureStream() allows us to observe the audio without interfering with 
            // the main AudioEngine's signal path.
            let stream = null;
            if (audioElement.captureStream) stream = audioElement.captureStream();
            else if (audioElement.mozCaptureStream) stream = audioElement.mozCaptureStream();
            
            if (stream && stream.getAudioTracks().length > 0) {
                this.audioSource = this.audioCtx.createMediaStreamSource(stream);
                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 512;
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                this.audioSource.connect(this.analyser);
                this.audioRetryCount = 0;
                
                // CRITICAL: DO NOT connect to this.audioCtx.destination.
                // This context must remain SILENT.
                
                console.log('[Hologram] Passive observer attached (Silent).');
            } else {
                console.warn('[Hologram] Audio observer init skipped: no audio track available yet.');
                if (this.audioRetryCount < 5) {
                    this.audioRetryCount += 1;
                    this.audioRetryId = setTimeout(() => this._attachAudioObserver(audioElement), 300);
                }
            }
        } catch (e) { 
            console.warn('[Hologram] Audio observer init failed:', e); 
        }
    }

    _resetSpectrumBars() {
        this.spectrumBars.forEach((bar) => {
            bar.scale.y = 0.6;
            bar.material.opacity = 0.45;
        });
    }

    _createEnvironment() {
        const starGeo = new THREE.BufferGeometry();
        const starCount = 3000;
        const pos = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount * 3; i++) pos[i] = (Math.random() - 0.5) * 50;
        starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }));
        this.scene.add(this.stars);
    }

    _createCyberGrid() {
        // Grid removed for simplicity as requested
    }

    _createParticles() {
        this.particleSystem = null;
        this.particleMaterial = null;
    }

    _createAuraRing() {
        const geo = new THREE.RingGeometry(1.8, 1.85, 128);
        this.auraRing = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: this.colors.primary, side: THREE.DoubleSide, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending }));
        this.group.add(this.auraRing);
    }

    _createCircularSpectrum() {
        const count = 128, radius = 3.1, barWidth = 0.05;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const geo = new THREE.PlaneGeometry(barWidth, 1); geo.translate(0, 0.5, 0);
            const bar = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: this.colors.primary, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
            bar.position.x = Math.cos(angle) * radius; bar.position.y = Math.sin(angle) * radius; bar.rotation.z = angle - Math.PI / 2;
            this.group.add(bar); this.spectrumBars.push(bar);
        }
    }

    _createArtworkCenterpiece() {
        this.artMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
        this.artMesh = new THREE.Mesh(new THREE.CircleGeometry(1.7, 64), this.artMaterial);
        this.group.add(this.artMesh);
        this.artBorder = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.8, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending }));
        this.group.add(this.artBorder);
        this.glowMaterial = new THREE.MeshBasicMaterial({ color: this.colors.primary, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending });
        this.glowMesh = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), this.glowMaterial);
        this.glowMesh.position.z = -0.1;
        this.group.add(this.glowMesh);
    }

    _createLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        this.pointLight = new THREE.PointLight(this.colors.primary, 2, 10);
        this.pointLight.position.set(0, 0, 2);
        this.scene.add(this.pointLight);
    }

    updateArtwork(url) {
        if (!url || !this.artMaterial) return;
        new THREE.TextureLoader().load(url, (tex) => { this.artMaterial.map = tex; this.artMaterial.needsUpdate = true; });
    }

    updateColors(colors) {
        if (colors.primary) {
            this.colors.primary.set(colors.primary);
            if (this.auraRing) this.auraRing.material.color.copy(this.colors.primary);
            if (this.glowMaterial) this.glowMaterial.color.copy(this.colors.primary);
            if (this.pointLight) this.pointLight.color.copy(this.colors.primary);
            if (this.artBorder) this.artBorder.material.color.copy(this.colors.primary);
            this.spectrumBars.forEach(b => b.material.color.copy(this.colors.primary));
            const bgCol = this.colors.primary.clone().multiplyScalar(0.15);
            this.scene.background = bgCol;
            this.scene.fog = new THREE.FogExp2(bgCol.getHex(), 0.05);
        }
        if (colors.secondary && this.particleMaterial) {
            this.colors.secondary.set(colors.secondary);
            this.particleMaterial.color.copy(this.colors.secondary);
        }
    }

    start() { this.active = true; this.animate(); if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume(); }
    stop() {
        this.active = false;
        if (this.audioRetryId) {
            clearTimeout(this.audioRetryId);
            this.audioRetryId = null;
        }
    }
    onResize() { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(window.innerWidth, window.innerHeight); }

    animate() {
        if (!this.active) return;
        requestAnimationFrame(() => this.animate());
        const time = this.clock.getElapsedTime();
        let bass = 0, mid = 0, treble = 0;
        if (this.analyser) {
            this.analyser.getByteFrequencyData(this.dataArray);
            for (let i = 0; i < 10; i++) bass += this.dataArray[i];
            for (let i = 10; i < 100; i++) mid += this.dataArray[i];
            for (let i = 100; i < 256; i++) treble += this.dataArray[i];
            bass = (bass / 10) / 255; mid = (mid / 90) / 255; treble = (treble / 156) / 255;
            for (let i = 0; i < this.spectrumBars.length; i++) {
                const val = this.dataArray[i % 128] / 255;
                const scale = 0.1 + val * 2.5;
                this.spectrumBars[i].scale.y = THREE.MathUtils.lerp(this.spectrumBars[i].scale.y, scale, 0.2);
                this.spectrumBars[i].material.opacity = 0.2 + val * 0.8;
            }
        }
        this.artMesh.position.y = Math.sin(time * 0.5) * 0.15;
        this.artMesh.rotation.y = Math.sin(time * 0.3) * 0.05;
        this.artMesh.scale.setScalar(1 + bass * 0.05);
        if (this.artBorder) {
            this.artBorder.position.y = this.artMesh.position.y;
            this.artBorder.rotation.z -= 0.01;
            this.artBorder.scale.setScalar(1 + bass * 0.08);
        }
        this.glowMesh.position.y = this.artMesh.position.y;
        this.glowMesh.scale.setScalar(1.2 + bass * 0.2);
        this.glowMesh.material.opacity = 0.1 + bass * 0.3;
        this.auraRing.rotation.z += 0.005 + treble * 0.02;
        this.auraRing.scale.setScalar(1 + mid * 0.1);
        if (this.particleSystem) {
            this.particleSystem.rotation.y += 0.001;
            this.particleSystem.position.y = Math.sin(time * 0.2) * 0.1;
        }
        this.stars.rotation.x += 0.0001; this.stars.rotation.y += 0.0001;
        this.renderer.render(this.scene, this.camera);
    }
}
