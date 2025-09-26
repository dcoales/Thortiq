import {buildRichOverlayStyles} from '../components/richOverlayStyles';

describe('buildRichOverlayStyles', () => {
  it('keeps the underlay visible until overlay is ready', () => {
    const {underlay, overlay} = buildRichOverlayStyles(18, false);
    expect(underlay.visibility).toBe('visible');
    expect(underlay.pointerEvents).toBe('auto');
    expect(overlay.visibility).toBe('hidden');
    expect(overlay.pointerEvents).toBe('none');
    expect(underlay.lineHeight).toBe('18px');
    expect(overlay.lineHeight).toBe('18px');
  });

  it('swaps visibility once the overlay reports ready', () => {
    const {underlay, overlay} = buildRichOverlayStyles(18, true);
    expect(underlay.visibility).toBe('hidden');
    expect(underlay.pointerEvents).toBe('none');
    expect(overlay.visibility).toBe('visible');
    expect(overlay.pointerEvents).toBe('auto');
  });
});
