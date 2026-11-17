import { describe, expect, it } from 'vitest';
import { safeLink } from './links';

describe('safeLink', () => {
  it('keeps https addresses', () => {
    expect(safeLink('https://www.tone3000.com/tones/1')).toBe(
      'https://www.tone3000.com/tones/1',
    );
  });
  it('drops other schemes and addresses with credentials', () => {
    expect(safeLink('javascript:alert(1)')).toBeUndefined();
    expect(safeLink('http://example.com')).toBeUndefined();
    expect(safeLink('https://user:pass@example.com')).toBeUndefined();
    expect(safeLink('not a url')).toBeUndefined();
    expect(safeLink(undefined)).toBeUndefined();
  });
});
