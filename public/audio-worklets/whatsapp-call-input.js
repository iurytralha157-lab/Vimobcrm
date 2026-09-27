// AudioWorklet receives microphone samples and emits 60 ms mono frames at 16 kHz.
class WhatsAppCallInput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.frame = new Float32Array(960);
    this.frameLength = 0;
    this.tapCount = 63;
    this.taps = new Float32Array(this.tapCount);
    this.history = new Float32Array(this.tapCount);
    this.historyIndex = 0;
    this.historyLength = 0;
    const cutoff = Math.min(7200, sampleRate * 0.45) / sampleRate;
    let sum = 0;
    for (let index = 0; index < this.tapCount; index += 1) {
      const offset = index - (this.tapCount - 1) / 2;
      const sinc = offset === 0
        ? 2 * cutoff
        : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset);
      const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * index / (this.tapCount - 1));
      this.taps[index] = sinc * window;
      sum += this.taps[index];
    }
    for (let index = 0; index < this.tapCount; index += 1) this.taps[index] /= sum;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const ratio = 16000 / sampleRate;
    for (let index = 0; index < channels[0].length; index += 1) {
      let mono = 0;
      for (const channel of channels) mono += channel[index];
      mono /= channels.length;
      this.history[this.historyIndex] = mono;
      this.historyIndex = (this.historyIndex + 1) % this.tapCount;
      this.historyLength = Math.min(this.tapCount, this.historyLength + 1);
      this.phase += ratio;
      if (this.phase < 1 || this.historyLength < this.tapCount) continue;
      this.phase -= 1;
      let filtered = 0;
      for (let tap = 0; tap < this.tapCount; tap += 1) {
        filtered += this.taps[tap] * this.history[(this.historyIndex + tap) % this.tapCount];
      }
      this.frame[this.frameLength] = filtered;
      this.frameLength += 1;
      if (this.frameLength === this.frame.length) {
        const complete = this.frame;
        this.port.postMessage(complete, [complete.buffer]);
        this.frame = new Float32Array(960);
        this.frameLength = 0;
      }
    }
    return true;
  }
}

registerProcessor("whatsapp-call-input", WhatsAppCallInput);
