import { Request } from "express";

export class AuthenticatedUser {
  username: string;
  sub: string;
  isAdmin?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
