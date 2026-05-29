/**
 * Aura Music Player — Advanced Audio Engine
 * Real-time modular DSP engine using Web Audio API.
 * 
 * Signal Chain:
 * MediaElementSource -> 10-Band EQ -> Bass Boost -> Reverb -> Echo -> Master Gain -> Destination
 */
class AudioEngine {
    // --- Constants ---
    static EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    static DEFAULT_Q = 1.4;
    static RAMP_TIME = 0.05; 
    static MAX_ECHO_DELAY = 5.0;
    static MAX_ECHO_FEEDBACK = 0.85;

    // --- State ---
    ctx = null;
    audio = null;
    source = null;
    eqBands = [];
    bassBoost = null;
    reverb = null;
    reverbWetGain = null;
    reverbDryGain = null;
    echoDelay = null;
    echoFeedback = null;
    echoWetGain = null;
    masterGain = null;

    constructor(audioElement) {
        if (!audioElement) throw new Error("AudioEngine requires an HTMLMediaElement");
        this.audio = audioElement;
        this.audio.preservesPitch = true;
    }

    async init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') await this.ctx.resume();
            return;
        }

        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.source = this.ctx.createMediaElementSource(this.audio);
        this._buildGraph();
    }

    _buildGraph() {
        let lastNode = this.source;

        // 1. EQ
        this.eqBands = AudioEngine.EQ_FREQUENCIES.map(freq => {
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.gain.value = 0;
            lastNode.connect(filter);
            lastNode = filter;
            return filter;
        });

        // 2. Bass Boost
        this.bassBoost = this.ctx.createBiquadFilter();
        this.bassBoost.type = 'lowshelf';
        this.bassBoost.frequency.value = 200;
        this.bassBoost.gain.value = 0;
        lastNode.connect(this.bassBoost);
        lastNode = this.bassBoost;

        // 3. Reverb (Parallel)
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
        this._generateSyntheticIR();

        // 4. Echo (Parallel Loop)
        this.echoDelay = this.ctx.createDelay(AudioEngine.MAX_ECHO_DELAY);
        this.echoFeedback = this.ctx.createGain();
        this.echoWetGain = this.ctx.createGain();
        const echoSum = this.ctx.createGain();
        
        this.echoDelay.delayTime.value = 0.3;
        this.echoFeedback.gain.value = 0.0;
        this.echoWetGain.gain.value = 0.0;

        // Feedback loop
        this.echoDelay.connect(this.echoFeedback);
        this.echoFeedback.connect(this.echoDelay);

        // Routing
        lastNode.connect(echoSum); // Dry
        lastNode.connect(this.echoDelay); // To Delay
        this.echoDelay.connect(this.echoWetGain);
        this.echoWetGain.connect(echoSum); // Wet
        
        lastNode = echoSum;

        // 5. Master Gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.audio.volume;
        lastNode.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
    }

    _generateSyntheticIR() {
        const sr = this.ctx.sampleRate, len = sr * 2.0;
        const imp = this.ctx.createBuffer(2, len, sr);
        for (let i = 0; i < 2; i++) {
            const d = imp.getChannelData(i);
            for (let j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 2);
        }
        this.reverb.buffer = imp;
    }

    setEQ(i, g) { if (this.eqBands[i]) this.eqBands[i].gain.setTargetAtTime(Math.max(-12, Math.min(12, g)), this.ctx.currentTime, AudioEngine.RAMP_TIME); }
    setBassBoost(g) { if (this.bassBoost) this.bassBoost.gain.setTargetAtTime(Math.max(0, Math.min(12, g)), this.ctx.currentTime, AudioEngine.RAMP_TIME); }
    setReverbLevel(l) {
        const w = Math.max(0, Math.min(1, l)), d = 1.0 - w;
        this.reverbWetGain.gain.setTargetAtTime(w, this.ctx.currentTime, AudioEngine.RAMP_TIME);
        this.reverbDryGain.gain.setTargetAtTime(d, this.ctx.currentTime, AudioEngine.RAMP_TIME);
    }
    setEcho(d, f, w = 0.4) {
        if (!this.echoDelay) return;
        this.echoDelay.delayTime.setTargetAtTime(Math.max(0, Math.min(5, d)), this.ctx.currentTime, AudioEngine.RAMP_TIME);
        this.echoFeedback.gain.setTargetAtTime(Math.max(0, Math.min(0.85, f)), this.ctx.currentTime, AudioEngine.RAMP_TIME);
        this.echoWetGain.gain.setTargetAtTime(Math.max(0, Math.min(1, w)), this.ctx.currentTime, AudioEngine.RAMP_TIME);
    }
    enableEcho(d = 0.3, f = 0.4) {
        const active = this.echoWetGain.gain.value > 0.01;
        this.setEcho(d, f, active ? 0 : 0.4);
        return !active;
    }
    setMasterVolume(l) { if (this.masterGain) this.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, l)), this.ctx.currentTime, 0.01); }
    suspend() { return this.ctx?.suspend(); }
    resume() { return this.ctx?.resume(); }
}
