/**
 * Aura Music Player — Advanced Audio Engine
 * Real-time modular DSP engine using Web Audio API.
 * 
 * Signal Chain:
 * MediaElementSource -> 10-Band EQ -> Bass Boost -> Reverb (Dry/Wet) -> Echo (Feedback) -> Master Gain -> Destination
 */
class AudioEngine {
    // --- Constants ---
    static EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    static DEFAULT_Q = 1.4;
    static RAMP_TIME = 0.005; // 5ms for smooth transitions
    static MAX_ECHO_DELAY = 5.0;
    static MAX_ECHO_FEEDBACK = 0.85; // Guard against runaway resonance

    // --- State ---
    /** @type {AudioContext} */
    ctx = null;
    /** @type {HTMLMediaElement} */
    audio = null;
    /** @type {MediaElementAudioSourceNode} */
    source = null;
    /** @type {BiquadFilterNode[]} */
    eqBands = [];
    /** @type {BiquadFilterNode} */
    bassBoost = null;
    /** @type {ConvolverNode} */
    reverb = null;
    /** @type {GainNode} */
    reverbWetGain = null;
    /** @type {GainNode} */
    reverbDryGain = null;
    /** @type {DelayNode} */
    echoDelay = null;
    /** @type {GainNode} */
    echoFeedback = null;
    /** @type {GainNode} */
    echoWetGain = null;
    /** @type {GainNode} */
    masterGain = null;

    /**
     * @param {HTMLMediaElement} audioElement - Existing audio element to process
     */
    constructor(audioElement) {
        if (!audioElement) throw new Error("AudioEngine requires an HTMLMediaElement");
        this.audio = audioElement;
        // Ensure pitch preservation is on by default for speed control
        this.audio.preservesPitch = true;
        this.audio.mozPreservesPitch = true;
    }

    /**
     * Initializes the Web Audio graph. Safe to call multiple times (lazy init).
     * Must be called after a user gesture to comply with browser autoplay policies.
     * @returns {Promise<void>}
     */
    async init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') await this.ctx.resume();
            return;
        }

        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.source = this.ctx.createMediaElementSource(this.audio);

        this._buildGraph();
    }

    /**
     * Builds the linear DSP chain
     * @private
     */
    _buildGraph() {
        // 1. 10-Band Parametric EQ
        let lastNode = this.source;
        this.eqBands = AudioEngine.EQ_FREQUENCIES.map(freq => {
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = AudioEngine.DEFAULT_Q;
            filter.gain.value = 0;
            lastNode.connect(filter);
            lastNode = filter;
            return filter;
        });

        // 2. Bass Boost (LowShelf)
        this.bassBoost = this.ctx.createBiquadFilter();
        this.bassBoost.type = 'lowshelf';
        this.bassBoost.frequency.value = 200;
        this.bassBoost.gain.value = 0;
        lastNode.connect(this.bassBoost);
        lastNode = this.bassBoost;

        // 3. Reverb Section (Dry/Wet Parallel Mix)
        // [lastNode] -> [reverbDryGain] -> [sumNode]
        //           -> [reverbNode] -> [reverbWetGain] -> [sumNode]
        this.reverb = this.ctx.createConvolver();
        this.reverbDryGain = this.ctx.createGain();
        this.reverbWetGain = this.ctx.createGain();
        const reverbSum = this.ctx.createGain();

        this.reverbDryGain.gain.value = 1.0;
        this.reverbWetGain.gain.value = 0.0;

        lastNode.connect(this.reverb);
        lastNode.connect(this.reverbDryGain);
        this.reverb.connect(this.reverbWetGain);
        
        this.reverbDryGain.connect(reverbSum);
        this.reverbWetGain.connect(reverbSum);
        
        lastNode = reverbSum;
        this._generateSyntheticIR(); // Load default synthetic reverb

        // 4. Echo / Delay Section
        // [lastNode] -> [echoWetGain (Sum)] -> [master]
        //           -> [echoDelay] -> [echoFeedback] -> [echoDelay]
        //                          -> [echoWetGain]
        this.echoDelay = this.ctx.createDelay(AudioEngine.MAX_ECHO_DELAY);
        this.echoFeedback = this.ctx.createGain();
        this.echoWetGain = this.ctx.createGain();
        
        this.echoDelay.delayTime.value = 0.3; // Default 300ms
        this.echoFeedback.gain.value = 0.0;   // Start disabled (0 feedback)
        this.echoWetGain.gain.value = 1.0;     // Full passage from reverbSum

        // Setup Feedback Loop
        this.echoDelay.connect(this.echoFeedback);
        this.echoFeedback.connect(this.echoDelay);

        // Mix Echo into chain
        lastNode.connect(this.echoDelay);
        
        const echoOutput = this.ctx.createGain();
        lastNode.connect(echoOutput);
        this.echoDelay.connect(echoOutput);
        
        lastNode = echoOutput;

        // 5. Master Gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.audio.volume; // Sync with initial audio volume
        
        lastNode.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
    }

    /**
     * Generates a synthetic impulse response for the ConvolverNode.
     * Use white noise with exponential decay.
     * @private
     */
    _generateSyntheticIR() {
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * 2.5; // 2.5 seconds
        const impulse = this.ctx.createBuffer(2, length, sampleRate);
        
        for (let i = 0; i < 2; i++) {
            const channelData = impulse.getChannelData(i);
            for (let j = 0; j < length; j++) {
                // White noise * exponential decay curve
                channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2.5);
            }
        }
        this.reverb.buffer = impulse;
    }

    // --- Public API ---

    /**
     * Sets the gain for a specific EQ band
     * @param {number} index - Band index (0-9)
     * @param {number} gainDb - Gain in dB (-12 to 12)
     */
    setEQ(index, gainDb) {
        if (!this.eqBands[index]) return;
        const clampedGain = Math.max(-12, Math.min(12, gainDb));
        this.eqBands[index].gain.setTargetAtTime(clampedGain, this.ctx.currentTime, AudioEngine.RAMP_TIME);
    }

    /**
     * Reset all EQ bands to 0dB
     */
    resetEQ() {
        this.eqBands.forEach((_, i) => this.setEQ(i, 0));
    }

    /**
     * Apply a predefined EQ preset
     * @param {'flat' | 'bassBoost' | 'pop' | 'rock' | 'jazz' | 'vocal' | number[]} preset 
     */
    applyPreset(preset) {
        const presets = {
            'flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            'bassBoost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
            'pop': [-1, 2, 3, 4, 3, 1, -1, -2, -2, -2],
            'rock': [4, 3, 2, -1, -2, -2, -1, 1, 2, 3],
            'jazz': [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
            'vocal': [-2, -3, -3, 1, 3, 4, 4, 3, 1, -1]
        };

        const gains = Array.isArray(preset) ? preset : (presets[preset] || presets.flat);
        gains.forEach((g, i) => this.setEQ(i, g));
    }

    /**
     * Sets the bass boost level
     * @param {number} gainDb - Gain in dB (0-12)
     */
    setBassBoost(gainDb) {
        if (!this.bassBoost) return;
        const clampedGain = Math.max(0, Math.min(12, gainDb));
        this.bassBoost.gain.setTargetAtTime(clampedGain, this.ctx.currentTime, AudioEngine.RAMP_TIME);
    }

    /**
     * Toggles bass boost or sets weight directly
     * @param {number} [gainDb] - Optional gain to set
     * @returns {boolean} - Active state
     */
    enableBassBoost(gainDb = 8) {
        const current = this.bassBoost.gain.value;
        const target = current > 0 ? 0 : gainDb;
        this.setBassBoost(target);
        return target > 0;
    }

    /**
     * Sets Reverb wetness level
     * @param {number} level - 0.0 (Dry) to 1.0 (Wet)
     */
    setReverbLevel(level) {
        if (!this.reverbWetGain) return;
        const wet = Math.max(0, Math.min(1, level));
        const dry = 1.0 - wet;
        
        this.reverbWetGain.gain.setTargetAtTime(wet, this.ctx.currentTime, AudioEngine.RAMP_TIME);
        this.reverbDryGain.gain.setTargetAtTime(dry, this.ctx.currentTime, AudioEngine.RAMP_TIME);
    }

    /**
     * Toggles reverb
     * @param {number} [level] - Optional wet level 
     * @returns {boolean} - New toggle state
     */
    enableReverb(level = 0.5) {
        const current = this.reverbWetGain.gain.value;
        const target = current > 0.01 ? 0 : level;
        this.setReverbLevel(target);
        return target > 0;
    }

    /**
     * Load an external Impulse Response from URL
     * @param {string} url 
     */
    async loadImpulseResponse(url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        this.reverb.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    }

    /**
     * Sets Echo parameters
     * @param {number} delayTime - Delay in seconds (0-5)
     * @param {number} feedback - Feedback gain (0-0.9)
     */
    setEcho(delayTime, feedback) {
        if (!this.echoDelay) return;
        const d = Math.max(0, Math.min(AudioEngine.MAX_ECHO_DELAY, delayTime));
        const f = Math.max(0, Math.min(AudioEngine.MAX_ECHO_FEEDBACK, feedback));
        
        this.echoDelay.delayTime.setTargetAtTime(d, this.ctx.currentTime, AudioEngine.RAMP_TIME);
        this.echoFeedback.gain.setTargetAtTime(f, this.ctx.currentTime, AudioEngine.RAMP_TIME);
    }

    /**
     * Toggles echo with defaults
     */
    enableEcho(delayTime = 0.3, feedback = 0.4) {
        const current = this.echoFeedback.gain.value;
        const targetF = current > 0.01 ? 0 : feedback;
        this.setEcho(delayTime, targetF);
        return targetF > 0;
    }

    /**
     * Controls playback speed without changing pitch
     * @param {number} rate - Multiplier (0.5 to 2.0)
     */
    setPlaybackSpeed(rate) {
        const clamped = Math.max(0.5, Math.min(2.0, rate));
        this.audio.playbackRate = clamped;
    }

    /**
     * Master volume control (post-DSP)
     * @param {number} level - 0.0 to 1.0
     */
    setMasterVolume(level) {
        if (!this.masterGain) return;
        const clamped = Math.max(0, Math.min(1, level));
        this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.01); // 10ms ramp
    }

    // --- Lifecycle ---

    suspend() {
        return this.ctx?.suspend();
    }

    resume() {
        return this.ctx?.resume();
    }

    /**
     * Disconnects nodes and cleans up resources
     */
    destroy() {
        if (this.source) this.source.disconnect();
        this.eqBands.forEach(b => b.disconnect());
        if (this.bassBoost) this.bassBoost.disconnect();
        if (this.reverb) this.reverb.disconnect();
        if (this.reverbWetGain) this.reverbWetGain.disconnect();
        if (this.reverbDryGain) this.reverbDryGain.disconnect();
        if (this.echoDelay) this.echoDelay.disconnect();
        if (this.echoFeedback) this.echoFeedback.disconnect();
        if (this.masterGain) this.masterGain.disconnect();
        
        this.ctx?.close();
        
        this.ctx = null;
        this.eqBands = [];
    }
}
