// Mono 16-bit PCM WAV, the only format Tourwright writes or reads.

export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = samples.length * 2;
  const out = Buffer.alloc(44 + data);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + data, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return out;
}

export interface Wav {
  sampleRate: number;
  samples: Float32Array;
}

export function decodeWav(buffer: Buffer): Wav {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file.');
  }
  let sampleRate = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      const format = buffer.readUInt16LE(body);
      const channels = buffer.readUInt16LE(body + 2);
      const bits = buffer.readUInt16LE(body + 14);
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error('Only mono 16-bit PCM WAV is supported.');
      sampleRate = buffer.readUInt32LE(body + 4);
    } else if (id === 'data') {
      if (!sampleRate) throw new Error('WAV data chunk comes before its fmt chunk.');
      const count = Math.floor(Math.min(size, buffer.length - body) / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = buffer.readInt16LE(body + i * 2) / 0x8000;
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk.');
}
