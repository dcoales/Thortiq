import {useCallback, useEffect, useState} from 'react';

import type {NodeId} from '../types';
import {LOCAL_ORIGIN} from '../yjs/undo';
import {getOrCreateNodeText} from '../yjs/doc';
import {useYDoc} from './yDocContext';

export const useNodeText = (
  nodeId: NodeId
): readonly [string, (nextValue: string) => void] => {
  const doc = useYDoc();
  const [value, setValue] = useState('');

  useEffect(() => {
    const text = getOrCreateNodeText(doc, nodeId);
    const sync = () => {
      setValue(String(text.toJSON() ?? ''));
    };

    sync();

    const observer = () => {
      sync();
    };

    text.observe(observer);

    return () => {
      text.unobserve(observer);
    };
  }, [doc, nodeId]);

  const updateValue = useCallback(
    (next: string) => {
      const text = getOrCreateNodeText(doc, nodeId);
      doc.transact(() => {
        text.delete(0, text.length);
        if (next.length > 0) {
          text.insert(0, next);
        }
      }, LOCAL_ORIGIN);
    },
    [doc, nodeId]
  );

  return [value, updateValue] as const;
};
