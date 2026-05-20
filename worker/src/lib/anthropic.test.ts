import { describe, expect, it } from 'vitest';
import { extractJson } from './anthropic.js';

describe('extractJson', () => {
  it('extracts from a code-fenced json block', () => {
    const out = extractJson('Here is your JSON:\n```json\n{"a": 1}\n```');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('extracts from an unlabeled code fence', () => {
    const out = extractJson('preamble\n```\n{"b": 2}\n```\ntrailer');
    expect(JSON.parse(out)).toEqual({ b: 2 });
  });

  it('extracts a raw object without code fence', () => {
    const out = extractJson('here is data {"c": [1,2,3]} bye');
    expect(JSON.parse(out)).toEqual({ c: [1, 2, 3] });
  });

  it('extracts the outermost object (handles nested braces)', () => {
    const out = extractJson('start {"outer":{"inner":1},"k":2} end');
    expect(JSON.parse(out)).toEqual({ outer: { inner: 1 }, k: 2 });
  });

  it('throws when no JSON object present', () => {
    expect(() => extractJson('no braces here at all')).toThrow(/no JSON object/);
  });
});
