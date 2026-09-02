import { describe, expect, it } from 'vitest';
import { checkName, commentUrl, isHex, mdEscape, randomHex } from './namecolor-core';

const reason = (raw: string) => {
  const r = checkName(raw);
  return r.ok ? null : r.reason;
};

describe('checkName', () => {
  it('accepts ordinary names and normalizes whitespace', () => {
    const r = checkName('  Mossbank   Green ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('Mossbank Green');
  });

  it('keeps spelling variants distinct — they are separate answers to vote between', () => {
    const a = checkName('Blue');
    const b = checkName('blu');
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.name).not.toBe(b.name);
  });

  it('accepts hyphens between letter runs', () => {
    expect(checkName('sea-foam').ok).toBe(true);
  });

  it('rejects empty and whitespace-only input', () => {
    expect(reason('')).toBeTruthy();
    expect(reason('   ')).toBeTruthy();
  });

  it('rejects anything over the length cap, counted in code points', () => {
    expect(checkName('a'.repeat(24)).ok).toBe(true);
    expect(reason('a'.repeat(25))).toBeTruthy();
    // An emoji is one character to a reader, so it's one here too.
    expect(checkName('💙'.repeat(24)).ok).toBe(true);
  });

  it('accepts punctuation, digits, emoji and other scripts', () => {
    for (const good of [
      "Devil's Red", 'blue!', 'blue2', 'blue_grey', '#1 Blue', '50% Grey', 'Café Crème',
      'Sky — but sadder', 'Mid.Night', 'Blue?!', 'Blue (ish)', '💙', 'ばか', 'grey/green',
    ]) {
      expect(reason(good), good).toBeNull();
    }
  });

  it('rejects links and u/ r/ mentions, which would post as live spam', () => {
    for (const bad of ['http://x.com', '[click](http://x.com)', 'www.foo.io', 'see reddit.com', 'u/spez blue', '/r/pics']) {
      expect(reason(bad), bad).toBeTruthy();
    }
  });

  it('rejects invisible padding and names with nothing readable in them', () => {
    for (const bad of ['b​lue', 'blue‮', '!!!', '~~~ ***']) {
      expect(reason(bad), bad).toBeTruthy();
    }
  });

  it('blocks slurs even when padded with separators or diacritics', () => {
    expect(reason('r e t a r d')).toBeTruthy();
    expect(reason('re-tard')).toBeTruthy();
    expect(reason('re.tard')).toBeTruthy();
    expect(reason('rétard')).toBeTruthy();
  });

  it('blocks profanity behind the punctuation that is now allowed', () => {
    expect(reason('shit.brown')).toBeTruthy();
    expect(reason('(shit) brown')).toBeTruthy();
  });

  it('blocks profanity as words without eating innocent names', () => {
    expect(reason('shit brown')).toBeTruthy();
    expect(checkName('Cocktail Hour').ok).toBe(true);
    expect(checkName('Scunthorpe Sky').ok).toBe(true);
    expect(checkName('Assam Tea').ok).toBe(true);
  });
});

describe('helpers', () => {
  it('generates hexes that pass its own validator', () => {
    for (let i = 0; i < 200; i++) expect(isHex(randomHex())).toBe(true);
  });

  it('rejects malformed hexes', () => {
    for (const bad of ['fff', '#fff', '#12345g', 'red', '#1234567']) expect(isHex(bad), bad).toBe(false);
  });

  it('absolutizes comment permalinks and leaves full URLs alone', () => {
    expect(commentUrl('/r/x/comments/a/b/c/')).toBe('https://www.reddit.com/r/x/comments/a/b/c/');
    expect(commentUrl('https://www.reddit.com/r/x/')).toBe('https://www.reddit.com/r/x/');
  });
});

describe('mdEscape', () => {
  it('defuses markdown a free-text name could smuggle into a comment', () => {
    expect(mdEscape('[click](http)')).toBe(String.raw`\[click\]\(http\)`);
    expect(mdEscape('**loud**')).toBe(String.raw`\*\*loud\*\*`);
    expect(mdEscape('> quote')).toBe(String.raw`\> quote`);
    expect(mdEscape('Devil’s Red')).toBe('Devil’s Red');
  });
});
