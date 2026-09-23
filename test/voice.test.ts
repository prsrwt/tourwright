import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '../src/schema/script.ts';
import { resolveSettings } from '../src/schema/settings.ts';
import { SAMPLE_RATE, type VoiceBackend } from '../src/voice/backend.ts';
import { fakeBackend } from '../src/voice/fake.ts';
import { applyLexicon } from '../src/voice/lexicon.ts';
import { voiceScript } from '../src/voice/synthesize.ts';
import { decodeWav, encodeWav } from '../src/voice/wav.ts';

const script: Script = {
  title: 'Intro',
  lexicon: { GASDS: 'G A S D S' },
  scenes: [
    { stage: 'dashboard', say: '[open]This is the GASDS page. It works out a total.', beats: [{ at: 'open', camera: { to: 'all' } }] },
    { stage: 'dashboard', say: 'Check it against your records.' },
  ],
};

function counting(backend: VoiceBackend): VoiceBackend & { calls: string[] } {
  const calls: string[] = [];
  return { id: backend.id, calls, synthesize: (text, voice) => (calls.push(text), backend.synthesize(text, voice)) };
}

test('a WAV round-trips through encode and decode', () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1]);
  const wav = decodeWav(encodeWav(samples, SAMPLE_RATE));
  assert.equal(wav.sampleRate, SAMPLE_RATE);
  assert.equal(wav.samples.length, 5);
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(wav.samples[i]! - samples[i]!) < 1e-4);
});

test('the lexicon replaces whole, case-sensitive words only', () => {
  const lexicon = { GASDS: 'G A S D S', Gift: 'Giff' };
  assert.equal(applyLexicon('The GASDS claim. GASDSX and gasds stay.', lexicon), 'The G A S D S claim. GASDSX and gasds stay.');
  assert.equal(applyLexicon('Gift Aid, Gifted.', lexicon), 'Giff Aid, Gifted.');
});

test('the fake voice depends only on the text and the speed', async () => {
  const voice = resolveSettings(undefined).voice;
  const a = await fakeBackend.synthesize('Hello there.', voice);
  const b = await fakeBackend.synthesize('Hello there.', voice);
  const longer = await fakeBackend.synthesize('Hello there, again.', voice);
  const faster = await fakeBackend.synthesize('Hello there.', { ...voice, speed: 2 });
  assert.equal(a.length, b.length);
  assert.ok(longer.length > a.length);
  assert.ok(faster.length < a.length);
});

test('each sentence is synthesised once, then read from the cache', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'tourwright-voice-'));
  const settings = resolveSettings(undefined);
  const backend = counting(fakeBackend);

  const first = await voiceScript(script, settings, backend, cache);
  assert.equal(first.synthesised, 3);
  assert.deepEqual(backend.calls, ['This is the G A S D S page.', 'It works out a total.', 'Check it against your records.']);
  assert.deepEqual(first.scenes[0]![0]!.cues, ['open']);
  assert.equal(first.scenes[0]![0]!.text, 'This is the GASDS page.');

  const second = await voiceScript(script, settings, backend, cache);
  assert.equal(second.synthesised, 0);
  assert.equal(backend.calls.length, 3);
  assert.deepEqual(second.scenes, first.scenes);
  assert.equal(readdirSync(cache).length, 3);
});

test('changing a sentence, the voice or the backend synthesises only what changed', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'tourwright-voice-'));
  const settings = resolveSettings(undefined);
  const backend = counting(fakeBackend);
  await voiceScript(script, settings, backend, cache);

  const edited: Script = { ...script, scenes: [script.scenes[0]!, { stage: 'dashboard', say: 'Check it against your own records.' }] };
  assert.equal((await voiceScript(edited, settings, backend, cache)).synthesised, 1);
  assert.equal((await voiceScript(edited, resolveSettings({ voice: { speed: 1.1 } }), backend, cache)).synthesised, 3);
  assert.equal((await voiceScript(edited, settings, { ...fakeBackend, id: 'other' }, cache)).synthesised, 3);
});
