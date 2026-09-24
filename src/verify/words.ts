// "Use the words on the screen": viewers match what they hear to what they see, so a button the
// narration names must exist, spelt the same, while the sentence is spoken. Only two forms count
// as naming a label, so ordinary capitalised words (names, acronyms) are left alone: text in
// double quotes, and a capitalised phrase after an action verb ("use Prepare claim to...").

// A verb may start the sentence, so either case for its first letter; the label after it must
// still start with a capital.
const VERBS = ['click', 'select', 'choose', 'use', 'open', 'press', 'tap', 'pick', 'turn on', 'turn off', 'switch on', 'switch off', 'toggle']
  .map((verb) => `[${verb[0]}${verb[0]!.toUpperCase()}]${verb.slice(1)}`)
  .join('|');
// Words that end a label: what follows a button's name in a sentence, not the name itself.
const STOP = new Set(['to', 'and', 'or', 'for', 'in', 'on', 'at', 'then', 'so', 'with', 'button', 'tab', 'link', 'toggle', 'switch', 'menu', 'option', 'page', 'if', 'when', 'from']);

export function namedLabels(sentence: string): string[] {
  const labels = new Set<string>();
  for (const match of sentence.matchAll(/["“]([^"”]{2,60})["”]/g)) labels.add(match[1]!.trim());
  const afterVerb = new RegExp(String.raw`\b(?:${VERBS})\s+(?:the\s+)?([A-Z][\w'’-]*(?:\s+[\w'’-]+){0,4})`, 'g');
  for (const match of sentence.matchAll(afterVerb)) {
    const words: string[] = [];
    for (const word of match[1]!.split(/\s+/)) {
      const bare = word.replace(/[.,;:!?)]+$/, '');
      if (words.length > 0 && STOP.has(bare.toLowerCase())) break;
      words.push(bare);
      if (bare !== word) break; // Punctuation ends the label.
    }
    if (words.length) labels.add(words.join(' '));
  }
  return [...labels];
}

/** Case and spacing differences do not matter; different words do. */
export function normalise(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}
