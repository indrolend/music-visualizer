#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');
const ffmpegPath = require('ffmpeg-static');
const { fft, util: fftUtil } = require('fft-js');

const SAMPLE_RATE = 44100;
const DEFAULTS = {
  threshold: 0.58,
  width: 1280,
  height: 720,
  fps: 30,
  intensity: 1.0,
  particleCount: 1100,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '-i' || token === '--input') {
      args.input = next;
      index += 1;
    } else if (token === '-o' || token === '--output') {
      args.output = next;
      index += 1;
    } else if (token === '--threshold') {
      args.threshold = Number(next);
      index += 1;
    } else if (token === '--width') {
      args.width = Number(next);
      index += 1;
    } else if (token === '--height') {
      args.height = Number(next);
      index += 1;
    } else if (token === '--fps') {
      args.fps = Number(next);
      index += 1;
    } else if (token === '--intensity') {
      args.intensity = Number(next);
      index += 1;
    } else if (token === '--particle-count') {
      args.particleCount = Number(next);
      index += 1;
    }
  }

  if (!args.input || !args.output) {
    throw new Error('Usage: node motifviz.js -i input.mp3 -o output.mp4 [--threshold 0.58 --width 1280 --height 720 --fps 30 --intensity 1.0]');
  }

  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not resolve a usable ffmpeg binary.');
  }

  return args;
}

function runFfmpeg(ffmpegArgs, errorPrefix) {
  const result = spawnSync(ffmpegPath, ffmpegArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 32,
  });

  if (result.status !== 0) {
    const message = result.stderr || result.stdout || 'Unknown ffmpeg error.';
    throw new Error(`${errorPrefix}\n${message}`.trim());
  }
}

function decodeAudioToSamples(inputPath, tempDir) {
  const rawAudioPath = path.join(tempDir, 'decoded-audio.pcm');
  runFfmpeg(
    [
      '-v', 'error',
      '-y',
      '-i', inputPath,
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-f', 's16le',
      rawAudioPath,
    ],
    'Failed to decode the input audio.'
  );

  const buffer = fs.readFileSync(rawAudioPath);
  const sampleCount = Math.floor(buffer.length / 2);
  const samples = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2) / 32768;
  }

  return samples;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function easeOutBack(value) {
  const t = clamp(value, 0, 1);
  const tension = 1.12;
  const shifted = t - 1;
  return 1 + (tension + 1) * shifted * shifted * shifted + tension * shifted * shifted;
}

function fract(value) {
  return value - Math.floor(value);
}

function smoothSeries(series, factor) {
  if (!series.length) {
    return series;
  }

  const next = new Array(series.length);
  next[0] = series[0];
  for (let index = 1; index < series.length; index += 1) {
    next[index] = lerp(next[index - 1], series[index], factor);
  }
  return next;
}

function normalizeSeries(series) {
  const maxValue = Math.max(...series, 0.0001);
  return series.map((value) => clamp(value / maxValue, 0, 1.25));
}

function windowedSamples(samples, startIndex, size) {
  const frame = new Array(size).fill(0);
  for (let index = 0; index < size; index += 1) {
    const sampleIndex = startIndex + index;
    const sample = sampleIndex < samples.length ? samples[sampleIndex] : 0;
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)));
    frame[index] = sample * hann;
  }
  return frame;
}

function sumBand(magnitudes, sampleRate, fftSize, lowHz, highHz) {
  let total = 0;
  let count = 0;
  for (let bin = 0; bin < magnitudes.length; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize;
    if (frequency >= lowHz && frequency < highHz) {
      total += magnitudes[bin];
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function analyzeAudio(samples, fps, threshold) {
  const fftSize = 1024;
  const hopSize = Math.max(1, Math.floor(SAMPLE_RATE / fps));
  const frameCount = Math.max(1, Math.ceil(samples.length / hopSize));
  const rawFrames = [];
  let previousRms = 0;
  let cooldown = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const startIndex = frameIndex * hopSize;
    const frame = windowedSamples(samples, startIndex, fftSize);
    const phasors = fft(frame);
    const magnitudes = fftUtil.fftMag(phasors).slice(0, fftSize / 2);

    let rms = 0;
    for (let index = 0; index < frame.length; index += 1) {
      rms += frame[index] * frame[index];
    }
    rms = Math.sqrt(rms / frame.length);

    const low = sumBand(magnitudes, SAMPLE_RATE, fftSize, 20, 180);
    const mid = sumBand(magnitudes, SAMPLE_RATE, fftSize, 180, 1800);
    const high = sumBand(magnitudes, SAMPLE_RATE, fftSize, 1800, 8000);

    const beat = cooldown === 0 && rms >= threshold && rms > previousRms * 1.08;
    cooldown = beat ? Math.max(2, Math.round(fps * 0.14)) : Math.max(0, cooldown - 1);
    previousRms = lerp(previousRms, rms, 0.4);

    rawFrames.push({ rms, low, mid, high, beat });
  }

  const normalizedLow = normalizeSeries(smoothSeries(rawFrames.map((frame) => frame.low), 0.34));
  const normalizedMid = normalizeSeries(smoothSeries(rawFrames.map((frame) => frame.mid), 0.28));
  const normalizedHigh = normalizeSeries(smoothSeries(rawFrames.map((frame) => frame.high), 0.24));
  const normalizedRms = normalizeSeries(smoothSeries(rawFrames.map((frame) => frame.rms), 0.3));

  return rawFrames.map((frame, index) => ({
    time: index / fps,
    rms: normalizedRms[index],
    low: normalizedLow[index],
    mid: normalizedMid[index],
    high: normalizedHigh[index],
    beat: frame.beat,
  }));
}

function drawBackground(ctx, width, height, features) {
  const gradient = ctx.createLinearGradient(0, 0, width, height * 1.05);
  gradient.addColorStop(0, '#03060f');
  gradient.addColorStop(0.5, '#09091a');
  gradient.addColorStop(1, '#02030a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const haze = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    0,
    width * 0.5,
    height * 0.5,
    Math.min(width, height) * 0.58
  );
  haze.addColorStop(0, `rgba(255, 40, 105, ${0.06 + features.rms * 0.1})`);
  haze.addColorStop(0.45, `rgba(0, 210, 245, ${0.04 + features.high * 0.08})`);
  haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, width, height);

  const bandAlpha = 0.03 + features.mid * 0.04;
  ctx.strokeStyle = `rgba(80, 225, 255, ${bandAlpha})`;
  ctx.lineWidth = 1;
  for (let y = 0; y < height; y += 24) {
    const wobble = Math.sin(y * 0.012 + features.low * 7) * 14;
    ctx.beginPath();
    ctx.moveTo(0, y + wobble);
    ctx.lineTo(width, y - wobble * 0.8);
    ctx.stroke();
  }
}

function traceBlobPath(ctx, cx, cy, baseRadius, features, time, intensity, morphShift = 0) {
  const points = 196;
  const beatPush = easeOutBack(features.rms * 0.9) * 0.14;

  for (let point = 0; point <= points; point += 1) {
    const unit = point / points;
    const angle = unit * Math.PI * 2;
    const harmonicA = Math.sin(angle * 2.6 + time * 2.3 + morphShift * 0.9);
    const harmonicB = Math.cos(angle * 5.7 - time * 1.75 + morphShift * 1.3);
    const harmonicC = Math.sin(angle * 11.2 + time * 3.4 + morphShift * 2.1);
    const gatedPulse = clamp(features.high * 0.85 + beatPush, 0, 1.8);
    const shard = Math.pow(Math.max(0, Math.sin(angle * 18 + time * 4.2 + morphShift)), 2);
    const ridge = Math.sin((angle + morphShift) * 3 + time * 1.1) * features.mid * 0.12;
    const radius = baseRadius
      * (1
      + harmonicA * 0.11
      + harmonicB * 0.07
      + harmonicC * 0.02
      + shard * gatedPulse * 0.13
      + ridge)
      * intensity;

    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * 0.9;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawBlobTechLayers(ctx, width, height, features, state, time, intensity) {
  const cx = width / 2;
  const cy = height / 2;
  const minSide = Math.min(width, height);
  const baseRadius = minSide * (0.18 + features.low * 0.12 + state.explosion * 0.08);

  ctx.beginPath();
  traceBlobPath(ctx, cx, cy, baseRadius, features, time, intensity, state.phase);

  const fillGradient = ctx.createRadialGradient(cx, cy, minSide * 0.02, cx, cy, baseRadius * 1.25);
  fillGradient.addColorStop(0, `rgba(255, 52, 112, ${0.62 + features.high * 0.18})`);
  fillGradient.addColorStop(0.46, `rgba(127, 43, 199, ${0.72 + features.mid * 0.1})`);
  fillGradient.addColorStop(1, 'rgba(3, 14, 26, 0.96)');
  ctx.fillStyle = fillGradient;
  ctx.shadowColor = `rgba(255, 55, 128, ${0.4 + state.explosion * 0.25})`;
  ctx.shadowBlur = 26 + features.high * 28;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  traceBlobPath(ctx, cx, cy, baseRadius, features, time, intensity, state.phase);
  ctx.clip();

  const stripAlpha = 0.08 + features.mid * 0.16;
  for (let y = Math.floor(cy - baseRadius); y < cy + baseRadius; y += 9) {
    const phase = fract((y * 0.03) + time * 0.8);
    const bright = phase > 0.52 ? 1 : 0;
    ctx.strokeStyle = `rgba(${20 + bright * 140}, ${240 - bright * 75}, 255, ${stripAlpha * (0.65 + bright * 0.6)})`;
    ctx.lineWidth = bright ? 1.4 : 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - baseRadius * 1.15, y);
    ctx.lineTo(cx + baseRadius * 1.15, y + Math.sin(y * 0.05 + time * 4) * 2.5);
    ctx.stroke();
  }

  const spokeCount = 16;
  for (let spoke = 0; spoke < spokeCount; spoke += 1) {
    const angle = (spoke / spokeCount) * Math.PI * 2 + time * 0.22;
    const inner = baseRadius * 0.12;
    const outer = baseRadius * (0.84 + Math.sin(time * 2.2 + spoke) * 0.08);
    ctx.strokeStyle = `rgba(120, 245, 255, ${0.1 + features.high * 0.22})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }

  ctx.restore();
  ctx.shadowBlur = 0;

  ctx.lineWidth = 1.8 + features.high * 2.2;
  ctx.strokeStyle = `rgba(130, 250, 255, ${0.38 + features.rms * 0.22})`;
  ctx.beginPath();
  traceBlobPath(ctx, cx, cy, baseRadius, features, time, intensity, state.phase + 0.16);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(255, 80, 145, ${0.42 + state.explosion * 0.22})`;
  ctx.beginPath();
  traceBlobPath(ctx, cx, cy, baseRadius * 0.84, features, time, intensity, state.phase + 0.7);
  ctx.stroke();

  const ringRadius = baseRadius * (1.16 + state.explosion * 0.35);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(85, 225, 255, ${0.08 + features.high * 0.14})`;
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
}

function renderFrame(ctx, width, height, features, state, time, intensity) {
  if (features.beat && state.cooldown <= 0) {
    state.cooldown = 5;
    state.explosion = Math.min(1, state.explosion + 0.85 + features.high * 0.16);
  } else {
    state.cooldown = Math.max(0, state.cooldown - 1);
    const decay = 0.06 + (1 - clamp(features.rms, 0, 1)) * 0.028;
    state.explosion = Math.max(0, state.explosion - decay);
  }

  state.phase += 0.014 + features.mid * 0.026;

  drawBackground(ctx, width, height, features);
  drawBlobTechLayers(ctx, width, height, features, state, time, intensity);
}

function renderFrames(options, features, tempDir) {
  const canvas = createCanvas(options.width, options.height);
  const ctx = canvas.getContext('2d');
  const framesDir = path.join(tempDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  const state = { explosion: 0, cooldown: 0, phase: 0 };

  for (let frameIndex = 0; frameIndex < features.length; frameIndex += 1) {
    const frameFeatures = features[frameIndex];
    renderFrame(ctx, options.width, options.height, frameFeatures, state, frameFeatures.time, options.intensity);
    const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(6, '0')}.png`);
    fs.writeFileSync(framePath, canvas.toBuffer('image/png'));
  }

  return framesDir;
}

function muxVideoWithAudio(framesDir, inputAudioPath, outputPath, fps, durationSeconds) {
  runFfmpeg(
    [
      '-v', 'error',
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, 'frame-%06d.png'),
      '-i', inputAudioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-af', 'aresample=async=1:first_pts=0',
      '-t', String(durationSeconds),
      outputPath,
    ],
    'Failed to encode the output video.'
  );
}

function ensureOutputDir(outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureOutputDir(options.output);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motifviz-'));
  try {
    const samples = decodeAudioToSamples(options.input, tempDir);
    const features = analyzeAudio(samples, options.fps, options.threshold);
    const framesDir = renderFrames(options, features, tempDir);
    const durationSeconds = Number((features.length / options.fps).toFixed(3));
    muxVideoWithAudio(framesDir, options.input, options.output, options.fps, durationSeconds);

    const summary = {
      output: options.output,
      durationSeconds: Number(durationSeconds.toFixed(2)),
      frames: features.length,
      resolution: `${options.width}x${options.height}`,
      fps: options.fps,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
