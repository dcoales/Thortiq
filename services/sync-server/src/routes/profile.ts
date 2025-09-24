import {Router} from 'express';

import type {AuthenticatedRequest} from '../auth';

export const createProfileRouter = () => {
  const router = Router();

  router.get('/', (req, res) => {
    const {user} = req as AuthenticatedRequest;
    res.json({profile: user});
  });

  return router;
};

