/**
 * Mixes system/tab audio and microphone into a single track with Web Audio.
 *
 * Tab capture mutes the captured tab for the user, so tab audio is also routed to the speakers
 * (`monitor: true`) – otherwise the user would not hear the page while recording.
 */
export class AudioMixer {
  private readonly ctx: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly nodes: AudioNode[] = [];
  private micGain: GainNode | null = null;
  private micVolume = 1;
  private analyser: AnalyserNode | null = null;
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null;
  private systemAnalyser: AnalyserNode | null = null;
  private systemBuffer: Uint8Array<ArrayBuffer> | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.destination = this.ctx.createMediaStreamDestination();
  }

  addSystemAudio(stream: MediaStream, monitor: boolean): void {
    if (stream.getAudioTracks().length === 0) return;
    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(this.destination);
    if (monitor) src.connect(this.ctx.destination);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    this.systemAnalyser = analyser;
    this.systemBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    this.nodes.push(src, analyser);
  }

  get hasSystemAudio(): boolean {
    return this.systemAnalyser !== null;
  }

  /** 0–1 RMS level of the system / tab audio. */
  systemLevel(): number {
    return this.systemAnalyser && this.systemBuffer ? rms(this.systemAnalyser, this.systemBuffer) : 0;
  }

  addMicrophone(stream: MediaStream, volume: number): void {
    if (stream.getAudioTracks().length === 0) return;
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    this.micVolume = volume;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(gain);
    gain.connect(this.destination);
    gain.connect(analyser);
    this.micGain = gain;
    this.analyser = analyser;
    this.levelBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    this.nodes.push(src, gain, analyser);
  }

  get hasMicrophone(): boolean {
    return this.micGain !== null;
  }

  setMicMuted(muted: boolean): void {
    if (!this.micGain) return;
    this.micGain.gain.setTargetAtTime(muted ? 0 : this.micVolume, this.ctx.currentTime, 0.02);
  }

  /** 0–1 RMS level of the microphone. */
  micLevel(): number {
    if (!this.analyser || !this.levelBuffer) return 0;
    return rms(this.analyser, this.levelBuffer);
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get track(): MediaStreamTrack | null {
    return this.destination.stream.getAudioTracks()[0] ?? null;
  }

  async close(): Promise<void> {
    this.nodes.forEach((n) => n.disconnect());
    this.destination.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx.state !== 'closed') await this.ctx.close();
  }
}

function rms(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) {
    const s = (v - 128) / 128;
    sum += s * s;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 3);
}

/** Lightweight level meter for previews (popup / permissions page). */
export class LevelMeter {
  private readonly ctx = new AudioContext();
  private readonly analyser: AnalyserNode;
  private readonly buffer: Uint8Array<ArrayBuffer>;
  private readonly source: MediaStreamAudioSourceNode;

  constructor(stream: MediaStream) {
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.source.connect(this.analyser);
  }

  level(): number {
    this.analyser.getByteTimeDomainData(this.buffer);
    let sum = 0;
    for (const v of this.buffer) {
      const s = (v - 128) / 128;
      sum += s * s;
    }
    return Math.min(1, Math.sqrt(sum / this.buffer.length) * 3);
  }

  async close(): Promise<void> {
    this.source.disconnect();
    if (this.ctx.state !== 'closed') await this.ctx.close();
  }
}
