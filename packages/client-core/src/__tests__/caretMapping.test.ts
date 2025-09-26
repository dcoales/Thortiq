import {getCaretOffsetFromPoint, rangeFromTextOffset} from '../utils/caret';

describe('caret mapping helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('computes caret offset from static point when browser API is available', () => {
    const container = document.createElement('div');
    container.textContent = 'Hello world';
    document.body.appendChild(container);

    const range = rangeFromTextOffset(container, 5);
    const docWithCaret = document as Document & {caretRangeFromPoint: (x: number, y: number) => Range | null};
    const original = docWithCaret.caretRangeFromPoint;
    docWithCaret.caretRangeFromPoint = jest.fn(() => range);

    const offset = getCaretOffsetFromPoint(container, {x: 0, y: 0});
    expect(offset).toBe(5);
    expect(docWithCaret.caretRangeFromPoint).toHaveBeenCalled();

    docWithCaret.caretRangeFromPoint = original;
  });

  it('returns null when range falls outside container', () => {
    const container = document.createElement('div');
    container.textContent = 'Hello world';
    document.body.appendChild(container);

    const other = document.createElement('div');
    other.textContent = 'Other';
    document.body.appendChild(other);
    const range = rangeFromTextOffset(other, 1);

    const docWithCaret = document as Document & {caretRangeFromPoint: (x: number, y: number) => Range | null};
    const original = docWithCaret.caretRangeFromPoint;
    docWithCaret.caretRangeFromPoint = jest.fn(() => range);

    const offset = getCaretOffsetFromPoint(container, {x: 0, y: 0});
    expect(offset).toBeNull();

    docWithCaret.caretRangeFromPoint = original;
  });
});
