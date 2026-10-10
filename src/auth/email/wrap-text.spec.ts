import { wrapText } from './wrap-text';

describe('wrapText', () => {
  it('breaks a paragraph into lines no longer than the width, between words', () => {
    const lines = wrapText('one two three four five six seven', 12);

    expect(lines).toEqual(['one two', 'three four', 'five six', 'seven']);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(12);
  });

  it('keeps a word longer than the width on its own line', () => {
    expect(wrapText('a supercalifragilistic b', 8)).toEqual([
      'a',
      'supercalifragilistic',
      'b',
    ]);
  });

  it('returns one line for a short paragraph', () => {
    expect(wrapText('short', 72)).toEqual(['short']);
  });
});
