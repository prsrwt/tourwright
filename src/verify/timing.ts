// timing.md: each cue, its time, and the words spoken around it, so a model can confirm that every
// beat lands on the word it was meant for without hearing the audio.

import { sceneSeconds, settleFrame, type Timeline } from '../timing/timeline.ts';

const CONTEXT_WORDS = 6;

export function timingMarkdown(name: string, timeline: Timeline): string {
  const seconds = (frames: number) => (frames / timeline.fps).toFixed(2);
  const lines = [
    `# Timing: ${name}`,
    '',
    `Total ${seconds(timeline.frames)} s (${timeline.frames} frames at ${timeline.fps} fps), including a ${seconds(timeline.titleFrames)} s title card.`,
    '',
  ];
  for (const scene of timeline.scenes) {
    lines.push(`## ${scene.id} (stage "${scene.stage}", starts at ${seconds(scene.from)} s, lasts ${seconds(scene.frames)} s)`, '');
    lines.push('| Cue | Time | Heard around it |', '| --- | --- | --- |');
    const cues = Object.entries(scene.cues).sort((a, b) => a[1] - b[1]);
    for (const [cue, frame] of cues) {
      lines.push(`| ${cue} | ${sceneSeconds(timeline, scene, frame).toFixed(2)} s | ${around(scene.sentences, frame)} |`);
    }
    if (scene.beats.length) {
      lines.push('', '| Beat | Cue | Moves from | Settles at | Action |', '| --- | --- | --- | --- | --- |');
      for (const beat of scene.beats) {
        const starts = Math.min(beat.camera?.from ?? Infinity, beat.highlight?.from ?? Infinity, beat.animate?.from ?? Infinity);
        const actions = [
          beat.camera && `camera to "${beat.camera.to}" (${typeof beat.camera.zoom === 'number' ? `${beat.camera.zoom}x` : beat.camera.zoom})`,
          beat.highlight && (beat.highlight.to === false ? 'clear highlight' : `highlight "${beat.highlight.to}"`),
          beat.animate &&
            `animate ${beat.animate.values.map((v) => `"${v}"`).join(', ')} from ${sceneSeconds(timeline, scene, beat.animate.from).toFixed(2)} s`,
        ].filter(Boolean);
        lines.push(
          `| ${beat.index} | ${beat.at} | ${sceneSeconds(timeline, scene, starts).toFixed(2)} s | ${sceneSeconds(timeline, scene, settleFrame(timeline, scene, beat)).toFixed(2)} s | ${actions.join(', ')} |`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** "...end of the previous sentence **[here]** start of the next...": what is heard as the cue lands. */
function around(sentences: Timeline['scenes'][number]['sentences'], frame: number): string {
  // Cues sit on sentence starts, so the cue is heard just before the first sentence at or after it.
  const next = sentences.findIndex((s) => s.from >= frame);
  const previous = next === -1 ? sentences.at(-1) : sentences[next - 1];
  const words = (text: string) => text.split(' ');
  const cell = (text: string) => text.replace(/\|/g, '\\|');
  const before = previous ? `...${cell(words(previous.text).slice(-CONTEXT_WORDS).join(' '))} ` : '';
  if (next === -1) return `${before}**[here]** (narration has ended)`;
  const all = words(sentences[next]!.text);
  return `${before}**[here]** ${cell(all.slice(0, CONTEXT_WORDS).join(' '))}${all.length > CONTEXT_WORDS ? '...' : ''}`;
}
