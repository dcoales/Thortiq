import type {PropsWithChildren} from 'react';
import {useMemo} from 'react';
import * as Y from 'yjs';

import type {CommandBus} from '../commands/commandBus';
import {CommandBusContext} from '../hooks/commandBusContext';
import {YDocContext} from '../hooks/yDocContext';

export interface ThortiqProviderProps {
  readonly doc: Y.Doc;
  readonly bus: CommandBus;
}

export const ThortiqProvider = ({doc, bus, children}: PropsWithChildren<ThortiqProviderProps>) => {
  const docValue = useMemo(() => ({doc}), [doc]);
  const busValue = useMemo(() => ({bus}), [bus]);

  return (
    <YDocContext.Provider value={docValue}>
      <CommandBusContext.Provider value={busValue}>{children}</CommandBusContext.Provider>
    </YDocContext.Provider>
  );
};

