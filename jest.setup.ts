if (typeof Element !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalQuerySelectorAll = Element.prototype.querySelectorAll;

  Element.prototype.querySelectorAll = function patchedQuerySelectorAll(selectors: string) {
    if (!(this instanceof Element)) {
      return originalQuerySelectorAll.call(this, selectors);
    }
    if (selectors === 'input,textarea,select') {
      return originalQuerySelectorAll.call(this, 'input,textarea,select,[contenteditable="true"]');
    }
    return originalQuerySelectorAll.call(this, selectors);
  };
}
