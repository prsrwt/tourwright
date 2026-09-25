import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayText, parseNarration } from '../src/narration/parse.ts';

test('splits sentences on terminators followed by whitespace or the end', () => {
  const n = parseNarration('This is the page.  It  works out a total! Is it right?');
  assert.deepEqual(
    n.sentences.map((s) => s.text),
    ['This is the page.', 'It works out a total!', 'Is it right?'],
  );
});

test('does not split inside numbers or on a terminator without following whitespace', () => {
  const n = parseNarration('The total is 1.5 million. See example.com for more.');
  assert.deepEqual(
    n.sentences.map((s) => s.text),
    ['The total is 1.5 million.', 'See example.com for more.'],
  );
});

test('keeps closing quotes and brackets with the sentence they end', () => {
  const n = parseNarration('Press "Export." (It saves a file.) Done.');
  assert.deepEqual(
    n.sentences.map((s) => s.text),
    ['Press "Export."', '(It saves a file.)', 'Done.'],
  );
});

test('attaches sentence-start cues to their sentence', () => {
  const n = parseNarration('[intro]This is the page. [total] [claim]It works out a total.');
  assert.deepEqual(n.sentences, [
    // start: where each sentence begins in the text, its first marker included.
    { text: 'This is the page.', cues: ['intro'], start: 0 },
    { text: 'It works out a total.', cues: ['total', 'claim'], start: 25 },
  ]);
  assert.ok(n.markers.every((m) => m.atSentenceStart));
});

test('marks a mid-sentence cue and leaves it off the sentence', () => {
  const n = parseNarration('It works out [total]a total.');
  assert.equal(n.markers[0]?.atSentenceStart, false);
  assert.equal(n.markers[0]?.sentence, 0);
  assert.deepEqual(n.sentences[0]?.cues, []);
  assert.equal(n.sentences[0]?.text, 'It works out a total.');
});

test('a cue after the last sentence points past the end', () => {
  const n = parseNarration('Done. [after]');
  assert.equal(n.sentences.length, 1);
  assert.equal(n.markers[0]?.sentence, 1);
});

test('reports an unclosed bracket', () => {
  assert.deepEqual(parseNarration('Look [here.').unclosed, [5]);
});

test('display text drops markers and collapses whitespace', () => {
  assert.equal(displayText('[a]One.\n\n  [b]Two  words.'), 'One. Two words.');
});
