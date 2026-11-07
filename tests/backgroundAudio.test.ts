import { describe, expect, it } from 'vitest';
import { isIOS, OutputRoute } from '../src/io/local/backgroundAudio';

class FakeNode {
  links = new Set<unknown>();
  connect(n: unknown) {
    this.links.add(n);
  }
  disconnect(n: unknown) {
    this.links.delete(n);
  }
}

describe('backgroundAudio', () => {
  it('detects iPhone and iPad, not desktop Mac or Android', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', maxTouchPoints: 5 })).toBe(false);
  });

  it('without the media element, plays straight to the speakers', () => {
    const destination = {};
    const out = new FakeNode();
    const route = new OutputRoute({ destination } as never, out as never, false);
    expect(out.links.has(destination)).toBe(true);
    expect(route.isDirect).toBe(true);
  });
});
