import type {Request, Response, NextFunction} from 'express';
import jwt from 'jsonwebtoken';
import type {SignOptions} from 'jsonwebtoken';

import type {UserProfile} from '@thortiq/client-core';

export type JwtClaims = {
  readonly sub: string;
  readonly name: string;
  readonly email?: string;
  readonly avatarUrl?: string;
};

export interface AuthenticatedUser extends UserProfile {}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  token?: string;
  claims?: JwtClaims;
}

const parseBearerToken = (header: string | undefined): string | null => {
  if (!header) {
    return null;
  }
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return null;
  }
  return value.trim();
};

const createProfileFromClaims = (claims: JwtClaims): AuthenticatedUser => ({
  id: claims.sub,
  displayName: claims.name,
  email: claims.email,
  avatarUrl: claims.avatarUrl
});

export const verifyToken = (secret: string, token: string): JwtClaims => {
  const decoded = jwt.verify(token, secret);
  const claims = decoded as Partial<JwtClaims> & {sub?: string; name?: string};
  if (!claims.sub || !claims.name) {
    throw new Error('Missing required JWT claims');
  }
  return {
    sub: claims.sub,
    name: claims.name,
    email: claims.email,
    avatarUrl: claims.avatarUrl
  };
};

type ExpirationValue = SignOptions['expiresIn'];

export const createTokenSigner = (secret: string, expiresIn: ExpirationValue = '12h') => {
  const options: SignOptions = {expiresIn};
  return (profile: UserProfile): string =>
    jwt.sign(
      {
        sub: profile.id,
        name: profile.displayName,
        email: profile.email,
        avatarUrl: profile.avatarUrl
      },
      secret,
      options
    );
};

export const createAuthMiddleware = (secret: string) =>
  (req: Request, res: Response, next: NextFunction) => {
    const token = parseBearerToken(req.header('authorization'));
    if (!token) {
      res.status(401).json({error: 'missing_token'});
      return;
    }

    try {
      const claims = verifyToken(secret, token);
      const user = createProfileFromClaims(claims);
      (req as AuthenticatedRequest).user = user;
      (req as AuthenticatedRequest).token = token;
      (req as AuthenticatedRequest).claims = claims;
      next();
    } catch (error) {
      res.status(401).json({error: 'invalid_token'});
    }
  };
