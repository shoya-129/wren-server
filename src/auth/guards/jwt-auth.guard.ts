import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import { Request } from "express";
import { db } from "../../db";
import { users } from "../../db/schema";
import {
  AuthenticatedRequest,
  AuthenticatedUser,
} from "../interfaces/authenticated-request.interface";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  private normalizeAccountState(
    user?: Partial<{
      isAdmin: boolean | null;
      accountStatus: "active" | "suspended" | "banned" | null;
      suspendedUntil: Date | null;
    }> | null,
  ) {
    return {
      isAdmin: user?.isAdmin ?? false,
      accountStatus: user?.accountStatus ?? "active",
      suspendedUntil: user?.suspendedUntil ?? null,
    };
  }

  private isMissingUserMetaColumnError(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";

    return (
      message.includes("is_admin") ||
      message.includes("account_status") ||
      message.includes("suspended_until")
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException("Token not found or invalid format");
    }

    let payload: AuthenticatedUser;
    try {
      payload = await this.jwtService.verifyAsync<AuthenticatedUser>(
        token,
        {
          secret: process.env.JWT_SECRET,
        },
      );
    } catch (jwtError) {
      throw new UnauthorizedException("Invalid or expired token");
    }

    try {
      const [user] = await db
        .select({
          uid: users.uid,
          username: users.username,
        })
        .from(users)
        .where(eq(users.uid, payload.sub));

      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      let accountState = this.normalizeAccountState();

      try {
        const [accountUser] = await db
          .select({
            isAdmin: users.isAdmin,
            accountStatus: users.accountStatus,
            suspendedUntil: users.suspendedUntil,
          })
          .from(users)
          .where(eq(users.uid, user.uid));

        accountState = this.normalizeAccountState(accountUser);
      } catch (error) {
        if (!this.isMissingUserMetaColumnError(error)) {
          throw error;
        }
      }

      if (accountState.accountStatus === "banned") {
        throw new ForbiddenException("Account is banned");
      }

      if (accountState.accountStatus === "suspended") {
        const now = new Date();

        if (accountState.suspendedUntil && accountState.suspendedUntil <= now) {
          try {
            await db
              .update(users)
              .set({
                accountStatus: "active",
                suspendedUntil: null,
                updatedAt: now,
              })
              .where(eq(users.uid, user.uid));
          } catch (error) {
            if (!this.isMissingUserMetaColumnError(error)) {
              throw error;
            }
          }
        } else {
          throw new ForbiddenException(
            accountState.suspendedUntil
              ? `Account is suspended until ${accountState.suspendedUntil.toISOString()}`
              : "Account is suspended",
          );
        }
      }

      request.user = {
        username: user.username,
        sub: user.uid,
        isAdmin: accountState.isAdmin,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw error;
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
