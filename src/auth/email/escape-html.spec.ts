import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('escapes the five characters that can break out of markup or an attribute', () => {
    expect(escapeHtml(`<b class="x">Tom & Jerry's</b>`)).toBe(
      '&lt;b class=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;',
    );
  });

  it('leaves everything else alone, accents included', () => {
    expect(escapeHtml('código válido — 10 minutos')).toBe(
      'código válido — 10 minutos',
    );
  });
});
