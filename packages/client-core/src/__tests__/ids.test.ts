import {createNodeId, createScopedIdGenerator, createUlid} from '../ids';

const ULID_LENGTH = 26;

describe('ID generation', () => {
  it('creates ULIDs with the expected length', () => {
    const id = createNodeId();
    expect(id).toHaveLength(ULID_LENGTH);
  });

  it('produces monotonic values when timestamps repeat', () => {
    const generator = createScopedIdGenerator();
    const timestamp = Date.now();

    const first = generator(timestamp);
    const second = generator(timestamp);

    expect(second > first).toBe(true);
  });

  it('allows explicit timestamps for deterministic ordering', () => {
    const earlier = createUlid(1);
    const later = createUlid(2);

    expect(earlier < later).toBe(true);
  });
});

