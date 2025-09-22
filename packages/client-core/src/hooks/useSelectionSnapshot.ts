import {useEffect, useState} from 'react';

import type {SelectionSnapshot} from '../selection/selectionManager';
import {SelectionManager} from '../selection/selectionManager';
import {useYDoc} from './yDocContext';

export const useSelectionSnapshot = (): SelectionSnapshot => {
  const doc = useYDoc();
  const [snapshot, setSnapshot] = useState<SelectionSnapshot>(() => {
    const manager = new SelectionManager(doc);
    return manager.getSelectionSnapshot();
  });

  useEffect(() => {
    const manager = new SelectionManager(doc);
    const sync = () => setSnapshot(manager.getSelectionSnapshot());

    sync();
    const handler = () => sync();

    doc.on('update', handler);
    return () => {
      doc.off('update', handler);
    };
  }, [doc]);

  return snapshot;
};

