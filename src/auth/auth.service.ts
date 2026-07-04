import { Injectable } from "@nestjs/common";
import { UserService } from "../user/user.service";
import { RegisterDto } from "./dto/register.user.dto";
import { LoginUser } from "./dto/login.user.dto";
import bcrypt from "bcrypt";
import { db } from "../db";
import { users } from "../db/schema";
import { eq, or } from "drizzle-orm";
import { JwtService } from "@nestjs/jwt";

type AuthUserRecord = {
  uid: string;
  username: string;
  email: string;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  password: string;
  publicKey: string;
  encryptedPrivateKey: string;
  encryptedFeedKey: string;
  salt: string;
  verified: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private jwtService: JwtService,
  ) {}

  private buildAuthUserSelection() {
    return {
      uid: users.uid,
      username: users.username,
      email: users.email,
      name: users.name,
      avatar: users.avatar,
      bio: users.bio,
      password: users.password,
      publicKey: users.publicKey,
      encryptedPrivateKey: users.encryptedPrivateKey,
      encryptedFeedKey: users.encryptedFeedKey,
      salt: users.salt,
      verified: users.verified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    };
  }

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
      message.includes("suspended_until") ||
      message.includes("profile_visibility") ||
      message.includes("allow_follow_requests")
    );
  }

  private async getAccountState(uid: string) {
    try {
      const [user] = await db
        .select({
          isAdmin: users.isAdmin,
          accountStatus: users.accountStatus,
          suspendedUntil: users.suspendedUntil,
        })
        .from(users)
        .where(eq(users.uid, uid));

      return this.normalizeAccountState(user);
    } catch (error) {
      if (this.isMissingUserMetaColumnError(error)) {
        return this.normalizeAccountState();
      }

      throw error;
    }
  }

  private buildAuthResponseUser(
    user: AuthUserRecord,
    accountState: ReturnType<AuthService["normalizeAccountState"]>,
    privacySettings: {
      profileVisibility: "public" | "followers";
      allowFollowRequests: boolean;
    },
  ) {
    return {
      uid: user.uid,
      username: user.username,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      bio: user.bio,
      publicKey: user.publicKey,
      encryptedPrivateKey: user.encryptedPrivateKey,
      encryptedFeedKey: user.encryptedFeedKey,
      salt: user.salt,
      verified: user.verified ?? false,
      isAdmin: accountState.isAdmin,
      accountStatus: accountState.accountStatus,
      suspendedUntil: accountState.suspendedUntil,
      profileVisibility: privacySettings.profileVisibility,
      allowFollowRequests: privacySettings.allowFollowRequests,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async registerUser(registerUserDto: RegisterDto) {
    const existingUser = await db
      .select({ uid: users.uid })
      .from(users)
      .where(eq(users.email, registerUserDto.email));

    if (existingUser.length > 0) {
      return {
        message: "User already exist",
        statusCode: 422,
      };
    }

    const saltRounds = 12;
    const hash = await bcrypt.hash(registerUserDto.password, saltRounds);

    const [createdUser] = await this.userService.createUser({
      ...registerUserDto,
      password: hash,
    });

    const jwtPayload = {
      username: createdUser.username,
      sub: createdUser.uid,
    };
    const accessToken = await this.jwtService.signAsync(jwtPayload, {
      expiresIn: "7d",
      secret: process.env.JWT_SECRET,
    });

    const [stats, securityStats, reachStats, privacySettings, accountState] =
      await Promise.all([
        this.userService.getStatsSummary(createdUser.uid),
        this.userService.getSecurityStats(createdUser.uid),
        this.userService.getReachStats(createdUser.uid),
        this.userService.getPrivacySettings(createdUser.uid),
        this.getAccountState(createdUser.uid),
      ]);

    const { password } = createdUser;
    if (password) {
      // Noop to satisfy unused variable rule
    }
    return {
      user: this.buildAuthResponseUser(
        createdUser,
        accountState,
        privacySettings,
      ),
      stats,
      securityStats,
      reachStats,
      privacySettings,
      accessToken,
      message: "User created successfully",
      statusCode: 201,
    };
  }

  async loginUser(loginUserDto: LoginUser) {
    const [user] = await db
      .select(this.buildAuthUserSelection())
      .from(users)
      .where(
        or(
          eq(users.username, loginUserDto.identifier),
          eq(users.email, loginUserDto.identifier),
        ),
      );

    if (!user) {
      return {
        message: "Invalid username/email or password",
        statusCode: 401,
      };
    }

    const accountState = await this.getAccountState(user.uid);

    if (accountState.accountStatus === "banned") {
      return {
        message: "Account is banned",
        statusCode: 403,
      };
    }

    if (accountState.accountStatus === "suspended") {
      const now = new Date();

      if (accountState.suspendedUntil && accountState.suspendedUntil <= now) {
        if (!this.isMissingUserMetaColumnError("")) {
          // Noop to satisfy lint when using helper in this branch only
        }

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

        accountState.accountStatus = "active";
        accountState.suspendedUntil = null;
      } else {
        return {
          message: accountState.suspendedUntil
            ? `Account is suspended until ${accountState.suspendedUntil.toISOString()}`
            : "Account is suspended",
          statusCode: 403,
        };
      }
    }

    const isPasswordValid = await bcrypt.compare(
      loginUserDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      return {
        message: "Invalid username/email or password",
        statusCode: 401,
      };
    }

    const jwtPayload = { username: user.username, sub: user.uid };
    const accessToken = await this.jwtService.signAsync(jwtPayload, {
      expiresIn: "7d",
      secret: process.env.JWT_SECRET,
    });

    const [stats, securityStats, reachStats, privacySettings] =
      await Promise.all([
        this.userService.getStatsSummary(user.uid),
        this.userService.getSecurityStats(user.uid),
        this.userService.getReachStats(user.uid),
        this.userService.getPrivacySettings(user.uid),
      ]);

    const { password } = user;
    if (password) {
      // Noop to satisfy unused variable rule
    }
    return {
      user: this.buildAuthResponseUser(user, accountState, privacySettings),
      stats,
      securityStats,
      reachStats,
      privacySettings,
      accessToken,
      message: "Logged in successfully",
      statusCode: 200,
    };
  }
}
