if (typeof Element !== 'undefined') {
  const originalQuerySelectorAll = Element.prototype.querySelectorAll.bind(Element.prototype);

  Element.prototype.querySelectorAll = function patchedQuerySelectorAll(selectors: string) {
    if (selectors === 'input,textarea,select') {
      return originalQuerySelectorAll.call(this, 'input,textarea,select,[contenteditable="true"]');
    }
    return originalQuerySelectorAll.call(this, selectors);
  };
}
