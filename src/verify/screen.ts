// screen.md: what is on screen at every still, read from the page, so a model can judge a still
// (and a note about a moment) from text as well as from the contact sheet.

import { formatScreen, type ScreenDescription } from '../runtime/screen.ts';

export function screenMarkdown(name: string, shots: { label: string; screen: ScreenDescription }[]): string {
  const lines = [
    `# Screen: ${name}`,
    '',
    'What is on screen at each still, read from the page rather than the image: how much of the frame each target fills, the highlight and the text inside it, the caption and the stage\'s values.',
    '',
  ];
  for (const shot of shots) lines.push(`## ${shot.label}`, '', '```text', formatScreen(shot.screen), '```', '');
  return lines.join('\n');
}
