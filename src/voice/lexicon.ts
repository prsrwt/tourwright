/** Replaces whole, case-sensitive words with how the voice should say them. Longer entries win. */
export function applyLexicon(text: string, lexicon: Record<string, string> | undefined): string {
  if (!lexicon) return text;
  const words = Object.keys(lexicon).sort((a, b) => b.length - a.length);
  if (words.length === 0) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return text.replace(pattern, (word) => lexicon[word] ?? word);
}

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
