import {useEffect, useState} from 'react';

import {useYDoc} from './yDocContext';

export const useDocVersion = (): number => {
  const doc = useYDoc();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleUpdate = () => {
      setVersion((current) => current + 1);
    };

    doc.on('update', handleUpdate);
    return () => {
      doc.off('update', handleUpdate);
    };
  }, [doc]);

  return version;
};

