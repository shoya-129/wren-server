import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { RegisterDto } from "../auth/dto/register.user.dto";
import { CacheService } from "../cache/cache.service";
import { db } from "../db";
import { dislikes, follows, likes, posts, reposts, users } from "../db/schema";
import { UpdateAccountStatusDto } from "./dto/update-account-status.dto";
import { UpdatePrivacyDto } from "./dto/update-privacy.dto";

export interface UserStatsSummary {
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

export interface UserSecurityStats {
  feedKeySharedWithCount: number;
  pendingFollowRequestsCount: number;
}

export interface UserReachStats {
  potentialAudienceCount: number;
  publicPostsCount: number;
  followersOnlyPostsCount: number;
}

export interface UserPrivacySettings {
  profileVisibility: "public" | "followers";
  allowFollowRequests: boolean;
}

export interface UserProfilePost {
  postId: string;
  uid: string;
  encryptedContent: string;
  encryptedMedia: string | null;
  replyTo: string | null;
  quoteTo: string | null;
  visibility: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    uid: string;
    username: string;
    name: string | null;
    avatar: string | null;
    verified: boolean;
  };
  encryptedFeedKey: string | null;
  likesCount: number;
  dislikesCount: number;
  repostsCount: number;
  repliesCount: number;
}

export interface PublicUserSummary {
  uid: string;
  username: string;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  publicKey: string;
  verified: boolean;
  accountStatus: "active" | "suspended" | "banned";
  profileVisibility: "public" | "followers";
  allowFollowRequests: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface UserConnectionSummary extends PublicUserSummary {
  followedAt: Date | null;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

type UserRecord = Pick<
  typeof users.$inferSelect,
  | "uid"
  | "username"
  | "email"
  | "name"
  | "avatar"
  | "bio"
  | "password"
  | "publicKey"
  | "encryptedPrivateKey"
  | "encryptedFeedKey"
  | "salt"
  | "verified"
  | "createdAt"
  | "updatedAt"
> &
  Partial<
    Pick<
      typeof users.$inferSelect,
      | "isAdmin"
      | "accountStatus"
      | "suspendedUntil"
      | "profileVisibility"
      | "allowFollowRequests"
    >
  >;

@Injectable()
export class UserService {
  constructor(private readonly cacheService: CacheService) {}

  async createUser(registerUserDto: RegisterDto) {
    const newUser = await db
      .insert(users)
      .values(registerUserDto)
      .returning(this.buildUserSelection());

    return newUser;
  }

  private buildUserSelection() {
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

  private normalizePrivacySettings(
    privacySettings?: Partial<UserPrivacySettings> | null,
  ): UserPrivacySettings {
    return {
      profileVisibility:
        privacySettings?.profileVisibility === "followers"
          ? "followers"
          : "public",
      allowFollowRequests: privacySettings?.allowFollowRequests !== false,
    };
  }

  private normalizeModerationState(
    user?: Partial<
      Pick<
        typeof users.$inferSelect,
        "isAdmin" | "accountStatus" | "suspendedUntil"
      >
    > | null,
  ) {
    return {
      isAdmin: user?.isAdmin ?? false,
      accountStatus: (user?.accountStatus ?? "active") as
        | "active"
        | "suspended"
        | "banned",
      suspendedUntil: user?.suspendedUntil ?? null,
    };
  }

  private isMissingPrivacyColumnError(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";

    return (
      message.includes("profile_visibility") ||
      message.includes("allow_follow_requests")
    );
  }

  private async findUserByIdentifier(
    identifier: string,
  ): Promise<UserRecord | null> {
    const [user] = await db
      .select(this.buildUserSelection())
      .from(users)
      .where(or(eq(users.uid, identifier), eq(users.username, identifier)));

    return user ?? null;
  }

  private sanitizeUser(user: UserRecord, includeAdmin = false) {
    const privacySettings = this.normalizePrivacySettings(user);
    const moderationState = this.normalizeModerationState(user);
    const { password, isAdmin, accountStatus, suspendedUntil, ...rest } = user;
    if (password || isAdmin || accountStatus || suspendedUntil) {
      // Noop to satisfy unused variable rule
    }

    if (includeAdmin) {
      return {
        ...rest,
        ...privacySettings,
        ...moderationState,
      };
    }

    return {
      ...rest,
      ...privacySettings,
      accountStatus: moderationState.accountStatus,
      suspendedUntil: moderationState.suspendedUntil,
    };
  }

  private toPublicUserSummary(user: UserRecord): PublicUserSummary {
    const privacySettings = this.normalizePrivacySettings(user);
    const moderationState = this.normalizeModerationState(user);

    return {
      uid: user.uid,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      bio: user.bio,
      publicKey: user.publicKey,
      verified: user.verified ?? false,
      accountStatus: moderationState.accountStatus,
      profileVisibility: privacySettings.profileVisibility,
      allowFollowRequests: privacySettings.allowFollowRequests,
      createdAt: user.createdAt ?? null,
      updatedAt: user.updatedAt ?? null,
    };
  }

  private readonly profileHeadCacheTtlMs = 15000;

  private buildUserCacheKey(uid: string, section: string) {
    return `user:${uid}:${section}`;
  }

  private async getCachedUserSection<T>(
    uid: string,
    section: string,
    loader: () => Promise<T>,
    ttlMs = this.profileHeadCacheTtlMs,
  ): Promise<T> {
    const cacheKey = this.buildUserCacheKey(uid, section);
    const cachedValue = this.cacheService.get<T>(cacheKey);

    if (cachedValue) {
      return cachedValue;
    }

    const loadedValue = await loader();
    this.cacheService.set(cacheKey, loadedValue, ttlMs);
    return loadedValue;
  }

  private invalidateUserProfileCaches(
    ...uids: Array<string | null | undefined>
  ) {
    const uniqueUserIds = Array.from(new Set(uids.filter(Boolean)));

    for (const uid of uniqueUserIds) {
      this.cacheService.deletePattern(`user:${uid}:`);
    }
  }

  private buildPagination(
    page: number,
    limit: number,
    total: number,
  ): PaginationMeta {
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  async getStatsSummary(uid: string): Promise<UserStatsSummary> {
    return this.getCachedUserSection(uid, "stats", async () => {
      const [followersResult, followingResult, postsResult] = await Promise.all(
        [
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(follows)
            .where(
              and(eq(follows.followingId, uid), eq(follows.status, "accepted")),
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(follows)
            .where(
              and(eq(follows.followerId, uid), eq(follows.status, "accepted")),
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(posts)
            .where(and(eq(posts.uid, uid), isNull(posts.deletedAt))),
        ],
      );

      return {
        followersCount: followersResult[0]?.count ?? 0,
        followingCount: followingResult[0]?.count ?? 0,
        postsCount: postsResult[0]?.count ?? 0,
      };
    });
  }

  async getSecurityStats(uid: string): Promise<UserSecurityStats> {
    return this.getCachedUserSection(uid, "security", async () => {
      const [feedKeySharedResult, pendingRequestsResult] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(follows)
          .where(
            and(
              eq(follows.followingId, uid),
              eq(follows.status, "accepted"),
              isNotNull(follows.encryptedFeedKey),
            ),
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(follows)
          .where(
            and(eq(follows.followingId, uid), eq(follows.status, "pending")),
          ),
      ]);

      return {
        feedKeySharedWithCount: feedKeySharedResult[0]?.count ?? 0,
        pendingFollowRequestsCount: pendingRequestsResult[0]?.count ?? 0,
      };
    });
  }

  async getReachStats(uid: string): Promise<UserReachStats> {
    return this.getCachedUserSection(uid, "reach", async () => {
      const [audienceResult, publicPostsResult, followersOnlyPostsResult] =
        await Promise.all([
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(follows)
            .where(
              and(eq(follows.followingId, uid), eq(follows.status, "accepted")),
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(posts)
            .where(
              and(
                eq(posts.uid, uid),
                eq(posts.visibility, "public"),
                isNull(posts.deletedAt),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(posts)
            .where(
              and(
                eq(posts.uid, uid),
                eq(posts.visibility, "followers"),
                isNull(posts.deletedAt),
              ),
            ),
        ]);

      return {
        potentialAudienceCount: audienceResult[0]?.count ?? 0,
        publicPostsCount: publicPostsResult[0]?.count ?? 0,
        followersOnlyPostsCount: followersOnlyPostsResult[0]?.count ?? 0,
      };
    });
  }

  async getPrivacySettings(uid: string): Promise<UserPrivacySettings> {
    return this.getCachedUserSection(uid, "privacy", async () => {
      try {
        const [user] = await db
          .select({
            profileVisibility: users.profileVisibility,
            allowFollowRequests: users.allowFollowRequests,
          })
          .from(users)
          .where(eq(users.uid, uid));

        if (!user) {
          throw new NotFoundException("User not found");
        }

        return this.normalizePrivacySettings(user);
      } catch (error) {
        if (this.isMissingPrivacyColumnError(error)) {
          return this.normalizePrivacySettings();
        }

        throw error;
      }
    });
  }

  private async canViewerSeeProfilePosts(
    profileUserId: string,
    viewerId: string,
    profileVisibility: "public" | "followers",
  ) {
    if (profileUserId === viewerId || profileVisibility === "public") {
      return true;
    }

    const [follow] = await db
      .select({ followerId: follows.followerId })
      .from(follows)
      .where(
        and(
          eq(follows.followingId, profileUserId),
          eq(follows.followerId, viewerId),
          eq(follows.status, "accepted"),
        ),
      );

    return !!follow;
  }

  private async getProfilePosts(
    profileUserId: string,
    viewerId: string,
    ownEncryptedFeedKey: string,
  ): Promise<UserProfilePost[]> {
    const likesCountSql = sql<number>`coalesce((select count(*)::int from ${likes} where ${likes.postId} = ${posts.postId}), 0)`;
    const dislikesCountSql = sql<number>`coalesce((select count(*)::int from ${dislikes} where ${dislikes.postId} = ${posts.postId}), 0)`;
    const repostsCountSql = sql<number>`coalesce((select count(*)::int from ${reposts} where ${reposts.postId} = ${posts.postId}), 0)`;
    const repliesCountSql = sql<number>`coalesce((select count(*)::int from ${posts} replies where replies.reply_to = ${posts.postId} and replies.deleted_at is null), 0)`;

    const profilePosts = await db
      .select({
        post: posts,
        author: {
          uid: users.uid,
          username: users.username,
          name: users.name,
          avatar: users.avatar,
          verified: users.verified,
        },
        follow: {
          encryptedFeedKey: follows.encryptedFeedKey,
        },
        likesCount: likesCountSql,
        dislikesCount: dislikesCountSql,
        repostsCount: repostsCountSql,
        repliesCount: repliesCountSql,
      })
      .from(posts)
      .innerJoin(users, eq(posts.uid, users.uid))
      .leftJoin(
        follows,
        and(
          eq(follows.followingId, posts.uid),
          eq(follows.followerId, viewerId),
          eq(follows.status, "accepted"),
        ),
      )
      .where(and(eq(posts.uid, profileUserId), isNull(posts.deletedAt)))
      .orderBy(desc(posts.createdAt));

    return profilePosts.map((item) => ({
      postId: item.post.postId,
      uid: item.post.uid,
      encryptedContent: item.post.encryptedContent,
      encryptedMedia: item.post.encryptedMedia,
      replyTo: item.post.replyTo,
      quoteTo: item.post.quoteTo,
      visibility: item.post.visibility,
      createdAt: item.post.createdAt,
      updatedAt: item.post.updatedAt,
      author: {
        uid: item.author.uid,
        username: item.author.username,
        name: item.author.name,
        avatar: item.author.avatar,
        verified: item.author.verified ?? false,
      },
      encryptedFeedKey:
        viewerId === profileUserId
          ? ownEncryptedFeedKey
          : (item.follow?.encryptedFeedKey ?? null),
      likesCount: item.likesCount,
      dislikesCount: item.dislikesCount,
      repostsCount: item.repostsCount,
      repliesCount: item.repliesCount,
    }));
  }

  async getProfile(
    profileUserIdentifier: string,
    viewerId = profileUserIdentifier,
  ) {
    const user = await this.findUserByIdentifier(profileUserIdentifier);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const profileUserId = user.uid;

    const [stats, reachStats, privacySettings] = await Promise.all([
      this.getStatsSummary(profileUserId),
      this.getReachStats(profileUserId),
      this.getPrivacySettings(profileUserId),
    ]);

    const canViewPosts = await this.canViewerSeeProfilePosts(
      profileUserId,
      viewerId,
      privacySettings.profileVisibility,
    );

    const profilePosts = canViewPosts
      ? await this.getProfilePosts(
          profileUserId,
          viewerId,
          user.encryptedFeedKey,
        )
      : [];

    const baseProfile = {
      user: this.sanitizeUser(user, viewerId === profileUserId),
      stats,
      reachStats,
      privacySettings,
      canViewPosts,
      posts: profilePosts,
    };

    if (viewerId === profileUserId) {
      const securityStats = await this.getSecurityStats(profileUserId);

      return {
        ...baseProfile,
        securityStats,
      };
    }

    return baseProfile;
  }

  async getMyStats(uid: string) {
    const user = await this.findUserByIdentifier(uid);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const [stats, securityStats, reachStats, privacySettings] =
      await Promise.all([
        this.getStatsSummary(uid),
        this.getSecurityStats(uid),
        this.getReachStats(uid),
        this.getPrivacySettings(uid),
      ]);

    return {
      user: {
        ...this.sanitizeUser(user, true),
        ...privacySettings,
      },
      stats,
      securityStats,
      reachStats,
      privacySettings,
    };
  }

  async getUserStats(identifier: string) {
    const user = await this.findUserByIdentifier(identifier);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const uid = user.uid;

    const [stats, reachStats, privacySettings] = await Promise.all([
      this.getStatsSummary(uid),
      this.getReachStats(uid),
      this.getPrivacySettings(uid),
    ]);

    return {
      user: {
        ...this.toPublicUserSummary(user),
        ...privacySettings,
      },
      stats,
      reachStats,
      privacySettings,
    };
  }

  async updatePrivacy(uid: string, dto: UpdatePrivacyDto) {
    if (
      dto.profileVisibility === undefined &&
      dto.allowFollowRequests === undefined
    ) {
      throw new BadRequestException(
        "At least one privacy field must be provided",
      );
    }

    let existingUser: UserPrivacySettings | null = null;
    let missingPrivacyColumns = false;

    try {
      const [user] = await db
        .select({
          profileVisibility: users.profileVisibility,
          allowFollowRequests: users.allowFollowRequests,
        })
        .from(users)
        .where(eq(users.uid, uid));

      existingUser = user ?? null;
    } catch (error) {
      if (!this.isMissingPrivacyColumnError(error)) {
        throw error;
      }

      missingPrivacyColumns = true;
    }

    if (missingPrivacyColumns) {
      throw new BadRequestException(
        "Privacy columns are not available in the database yet. Apply the latest migration first.",
      );
    }

    if (!existingUser) {
      throw new NotFoundException("User not found");
    }

    try {
      const normalizedExistingSettings =
        this.normalizePrivacySettings(existingUser);
      const [updatedUser] = await db
        .update(users)
        .set({
          profileVisibility:
            dto.profileVisibility ??
            normalizedExistingSettings.profileVisibility,
          allowFollowRequests:
            dto.allowFollowRequests ??
            normalizedExistingSettings.allowFollowRequests,
          updatedAt: new Date(),
        })
        .where(eq(users.uid, uid))
        .returning({
          profileVisibility: users.profileVisibility,
          allowFollowRequests: users.allowFollowRequests,
        });

      const normalizedPrivacySettings =
        this.normalizePrivacySettings(updatedUser);
      this.invalidateUserProfileCaches(uid);

      return {
        message: "Privacy settings updated successfully",
        privacySettings: normalizedPrivacySettings,
      };
    } catch (error) {
      if (this.isMissingPrivacyColumnError(error)) {
        throw new BadRequestException(
          "Privacy columns are not available in the database yet. Apply the latest migration first.",
        );
      }

      throw error;
    }
  }

  async getAllUsers(
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<PublicUserSummary>> {
    const offset = (page - 1) * limit;

    const [totalResult, allUsers] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db
        .select(this.buildUserSelection())
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ?? 0;

    return {
      data: allUsers.map((u) => this.toPublicUserSummary(u)),
      pagination: this.buildPagination(page, limit, total),
    };
  }

  async getFollowers(
    identifier: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<UserConnectionSummary>> {
    const targetUser = await this.findUserByIdentifier(identifier);

    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    const uid = targetUser.uid;
    const offset = (page - 1) * limit;

    const [totalResult, followerRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(follows)
        .where(
          and(eq(follows.followingId, uid), eq(follows.status, "accepted")),
        ),
      db
        .select({
          user: this.buildUserSelection(),
          followedAt: follows.acceptedAt,
          requestedAt: follows.createdAt,
        })
        .from(follows)
        .innerJoin(users, eq(follows.followerId, users.uid))
        .where(
          and(eq(follows.followingId, uid), eq(follows.status, "accepted")),
        )
        .orderBy(desc(follows.acceptedAt), desc(follows.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ?? 0;

    return {
      data: followerRows.map((row) => ({
        ...this.toPublicUserSummary(row.user),
        followedAt: row.followedAt ?? row.requestedAt ?? null,
      })),
      pagination: this.buildPagination(page, limit, total),
    };
  }

  async getFollowing(
    identifier: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<UserConnectionSummary>> {
    const targetUser = await this.findUserByIdentifier(identifier);

    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    const uid = targetUser.uid;
    const offset = (page - 1) * limit;

    const [totalResult, followingRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(follows)
        .where(
          and(eq(follows.followerId, uid), eq(follows.status, "accepted")),
        ),
      db
        .select({
          user: this.buildUserSelection(),
          followedAt: follows.acceptedAt,
          requestedAt: follows.createdAt,
        })
        .from(follows)
        .innerJoin(users, eq(follows.followingId, users.uid))
        .where(and(eq(follows.followerId, uid), eq(follows.status, "accepted")))
        .orderBy(desc(follows.acceptedAt), desc(follows.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ?? 0;

    return {
      data: followingRows.map((row) => ({
        ...this.toPublicUserSummary(row.user),
        followedAt: row.followedAt ?? row.requestedAt ?? null,
      })),
      pagination: this.buildPagination(page, limit, total),
    };
  }

  async followUser(followerId: string, followingIdentifier: string) {
    const targetUser = await this.findUserByIdentifier(followingIdentifier);

    if (!targetUser) {
      throw new NotFoundException("User to follow not found");
    }

    const followingId = targetUser.uid;

    if (followerId === followingId) {
      throw new BadRequestException("You cannot follow yourself");
    }

    const targetPrivacySettings = await this.getPrivacySettings(followingId);

    if (!targetPrivacySettings.allowFollowRequests) {
      throw new ForbiddenException(
        "This user is not accepting follow requests",
      );
    }

    const [existingFollow] = await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      );

    if (existingFollow) {
      if (existingFollow.status === "accepted") {
        throw new BadRequestException("Already following this user");
      }
      if (existingFollow.status === "pending") {
        throw new BadRequestException("Follow request already pending");
      }
      if (existingFollow.status === "blocked") {
        throw new ForbiddenException("You are blocked by this user");
      }

      const [updatedFollow] = await db
        .update(follows)
        .set({
          status: "pending",
          encryptedFeedKey: null,
          acceptedAt: null,
          createdAt: new Date(),
        })
        .where(
          and(
            eq(follows.followerId, followerId),
            eq(follows.followingId, followingId),
          ),
        )
        .returning();

      this.cacheService.deletePattern(`feed:${followerId}:`);
      this.invalidateUserProfileCaches(followerId, followingId);

      return {
        message: "Follow request re-sent successfully",
        follow: updatedFollow,
      };
    }

    const [newFollow] = await db
      .insert(follows)
      .values({
        followerId,
        followingId,
        status: "pending",
      })
      .returning();

    this.cacheService.deletePattern(`feed:${followerId}:`);
    this.invalidateUserProfileCaches(followerId, followingId);

    return {
      message: "Follow request sent successfully",
      follow: newFollow,
    };
  }

  async getPendingFollowRequests(followingId: string) {
    const pending = await db
      .select({
        followerId: follows.followerId,
        status: follows.status,
        createdAt: follows.createdAt,
        username: users.username,
        name: users.name,
        publicKey: users.publicKey,
      })
      .from(follows)
      .innerJoin(users, eq(follows.followerId, users.uid))
      .where(
        and(
          eq(follows.followingId, followingId),
          eq(follows.status, "pending"),
        ),
      );

    return pending;
  }

  async acceptFollowRequest(
    followingId: string,
    followerId: string,
    encryptedFeedKey: string,
  ) {
    const [followReq] = await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
          eq(follows.status, "pending"),
        ),
      );

    if (!followReq) {
      throw new NotFoundException("Pending follow request not found");
    }

    const [updatedFollow] = await db
      .update(follows)
      .set({
        status: "accepted",
        encryptedFeedKey,
        acceptedAt: new Date(),
      })
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      )
      .returning();

    this.cacheService.deletePattern(`feed:${followerId}:`);
    this.invalidateUserProfileCaches(followerId, followingId);

    return {
      message: "Follow request accepted",
      follow: updatedFollow,
    };
  }

  async rejectFollowRequest(followingId: string, followerId: string) {
    const [followReq] = await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
          eq(follows.status, "pending"),
        ),
      );

    if (!followReq) {
      throw new NotFoundException("Pending follow request not found");
    }

    const [updatedFollow] = await db
      .update(follows)
      .set({
        status: "rejected",
        encryptedFeedKey: null,
        acceptedAt: null,
      })
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      )
      .returning();

    this.cacheService.deletePattern(`feed:${followerId}:`);
    this.invalidateUserProfileCaches(followerId, followingId);

    return {
      message: "Follow request rejected",
      follow: updatedFollow,
    };
  }

  async revokeAccess(followingId: string, followerId: string) {
    const [follow] = await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
          eq(follows.status, "accepted"),
        ),
      );

    if (!follow) {
      throw new NotFoundException("Accepted follower access not found");
    }

    const [updatedFollow] = await db
      .update(follows)
      .set({
        status: "rejected",
        encryptedFeedKey: null,
        acceptedAt: null,
      })
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      )
      .returning();

    this.cacheService.deletePattern(`feed:${followerId}:`);
    this.invalidateUserProfileCaches(followerId, followingId);

    return {
      message: "Access revoked successfully",
      follow: updatedFollow,
    };
  }

  async unfollowUser(followerId: string, followingIdentifier: string) {
    const targetUser = await this.findUserByIdentifier(followingIdentifier);

    if (!targetUser) {
      throw new NotFoundException("Follow relationship not found");
    }

    const followingId = targetUser.uid;

    const [follow] = await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      );

    if (!follow) {
      throw new NotFoundException("Follow relationship not found");
    }

    await db
      .delete(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      );

    this.cacheService.deletePattern(`feed:${followerId}:`);
    this.invalidateUserProfileCaches(followerId, followingId);

    return {
      message: "Unfollowed successfully",
    };
  }

  async updateAccountStatus(
    adminId: string,
    targetUserId: string,
    dto: UpdateAccountStatusDto,
  ) {
    const [targetUser] = await db
      .select(this.buildUserSelection())
      .from(users)
      .where(eq(users.uid, targetUserId));

    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    if (targetUser.isAdmin && targetUser.uid !== adminId) {
      throw new ForbiddenException(
        "Admin accounts cannot be managed through this endpoint",
      );
    }

    if (adminId === targetUserId && dto.status !== "active") {
      throw new BadRequestException(
        "You cannot suspend or ban your own admin account",
      );
    }

    if (dto.status === "suspended" && !dto.suspensionDays) {
      throw new BadRequestException(
        "suspensionDays is required when status is suspended",
      );
    }

    const now = new Date();
    const suspendedUntil =
      dto.status === "suspended" && dto.suspensionDays
        ? new Date(now.getTime() + dto.suspensionDays * 24 * 60 * 60 * 1000)
        : null;

    const [updatedUser] = await db
      .update(users)
      .set({
        accountStatus: dto.status,
        suspendedUntil,
        updatedAt: now,
      })
      .where(eq(users.uid, targetUserId))
      .returning({
        uid: users.uid,
        username: users.username,
        accountStatus: users.accountStatus,
        suspendedUntil: users.suspendedUntil,
      });

    this.cacheService.deletePattern("feed:");
    this.invalidateUserProfileCaches(targetUserId);

    return {
      message: "Account status updated successfully",
      user: updatedUser,
    };
  }

  async deleteAccount(uid: string) {
    const [user] = await db
      .select(this.buildUserSelection())
      .from(users)
      .where(eq(users.uid, uid));

    if (!user) {
      throw new NotFoundException("User not found");
    }

    await db.delete(users).where(eq(users.uid, uid));
    this.cacheService.deletePattern("feed:");
    this.cacheService.deletePattern("user:");

    return {
      message: "Account deleted successfully",
      uid,
    };
  }
}
