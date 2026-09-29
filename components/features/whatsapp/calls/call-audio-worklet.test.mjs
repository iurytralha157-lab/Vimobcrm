import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync("public/audio-worklets/whatsapp-call-input.js", "utf8");

function processSine(frequency, { rightOnly = false } = {}) {
  let Processor;
  const frames = [];
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage: (frame) => frames.push(frame) };
    }
  }
  runInNewContext(source, {
    AudioWorkletProcessor,
    Float32Array,
    Math,
    sampleRate: 48000,
    registerProcessor: (_name, type) => { Processor = type; },
  });
  const processor = new Processor();
  for (let offset = 0; offset < 48000; offset += 128) {
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    for (let index = 0; index < 128; index += 1) {
      const sample = Math.sin(2 * Math.PI * frequency * (offset + index) / 48000);
      if (!rightOnly) left[index] = sample;
      right[index] = sample;
    }
    processor.process([[left, right]]);
  }
  return frames;
}

function rms(frames) {
  const samples = frames.flatMap((frame) => Array.from(frame));
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

test("microphone worklet emits 960-sample frames and keeps speech band", () => {
  const frames = processSine(1000);
  assert.ok(frames.length >= 15);
  assert.ok(frames.every((frame) => frame.length === 960));
  assert.ok(rms(frames) > 0.6);
});

test("microphone worklet attenuates frequencies above 8 kHz before decimation", () => {
  const frames = processSine(12000);
  assert.ok(rms(frames) < 0.08);
});

test("microphone worklet includes both input channels", () => {
  const frames = processSine(1000, { rightOnly: true });
  assert.ok(rms(frames) > 0.28 && rms(frames) < 0.4);
});
