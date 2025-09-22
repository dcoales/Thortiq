import {createContext, useContext} from 'react';
import * as Y from 'yjs';

export interface YDocContextValue {
  readonly doc: Y.Doc;
}

export const YDocContext = createContext<YDocContextValue | null>(null);

export const useYDoc = (): Y.Doc => {
  const value = useContext(YDocContext);
  if (!value) {
    throw new Error('YDocContext is not provided');
  }
  return value.doc;
};

