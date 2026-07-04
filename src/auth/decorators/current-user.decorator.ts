import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import {
  AuthenticatedRequest,
  AuthenticatedUser,
} from "../interfaces/authenticated-request.interface";

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!data) {
      return user;
    }

    return user?.[data];
  },
);
