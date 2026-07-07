import { slugify } from './slugify.util';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips accents/diacritics', () => {
    expect(slugify('Engenharia de Software')).toBe('engenharia-de-software');
    expect(slugify('Cafés Especiais')).toBe('cafes-especiais');
  });

  it('collapses runs of non-alphanumeric characters into a single hyphen', () => {
    expect(slugify('Micro-frontends & Module Federation')).toBe(
      'micro-frontends-module-federation',
    );
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
  });

  it('handles numbers', () => {
    expect(slugify('Next.js 16')).toBe('next-js-16');
  });
});
