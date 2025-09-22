import {useEffect, useState} from 'react';

import {useYDoc} from './yDocContext';

export const useYMapSubscription = <T>(collectionName: string): Map<string, T> => {
  const doc = useYDoc();
  const map = doc.getMap<T>(collectionName);
  const [snapshot, setSnapshot] = useState<Map<string, T>>(() => new Map(map.entries()));

  useEffect(() => {
    const handler = () => {
      setSnapshot(new Map(map.entries()));
    };

    map.observe(handler);
    return () => map.unobserve(handler);
  }, [map]);

  return snapshot;
};
