import { Request } from 'express';

export class AuthenticatedUser {
  username: string;
  sub: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
