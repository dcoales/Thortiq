import {createContext, useContext} from 'react';

import type {CommandBus} from '../commands/commandBus';

export interface CommandBusContextValue {
  readonly bus: CommandBus;
}

export const CommandBusContext = createContext<CommandBusContextValue | null>(null);

export const useCommandBus = (): CommandBus => {
  const value = useContext(CommandBusContext);
  if (!value) {
    throw new Error('CommandBusContext is not provided');
  }
  return value.bus;
};

