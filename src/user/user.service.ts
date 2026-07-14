import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import * as https from "https";
import { and, desc, eq, isNotNull, isNull, or, sql, ne } from "drizzle-orm";
import { BehaviorSubject, Observable } from "rxjs";
import { RegisterDto } from "../auth/dto/register.user.dto";
import { CacheService } from "../cache/cache.service";
import { db } from "../db";
import { dislikes, follows, likes, posts, reposts, users } from "../db/schema";
import { UpdateAccountStatusDto } from "./dto/update-account-status.dto";

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
  | "pushToken"
> &
  Partial<
    Pick<
      typeof users.$inferSelect,
      "isAdmin" | "accountStatus" | "suspendedUntil"
    >
  >;

@Injectable()
export class UserService implements OnModuleInit {
  private readonly userCountSubject = new BehaviorSubject<number>(0);

  constructor(private readonly cacheService: CacheService) {}

  async onModuleInit() {
    try {
      const count = await this.getCount();
      this.userCountSubject.next(count);
    } catch (error) {
      console.error("Failed to initialize user count:", error);
    }
  }

  async getCount(): Promise<number> {
    try {
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users);
      return result?.count ?? 0;
    } catch (error) {
      console.error("Failed to get user count from DB:", error);
      return 0;
    }
  }

  getUserCountStream(): Observable<number> {
    return this.userCountSubject.asObservable();
  }

  private async sendPushNotification(pushToken: string, title: string, body: string, data?: any) {
    console.log(`[PushNotification] Attempting to send. Token: ${pushToken}, Title: ${title}, Body: ${body}`);
    if (!pushToken) {
      console.log("[PushNotification] Aborted. Push token is empty.");
      return;
    }

    const payload = JSON.stringify({
      to: pushToken,
      sound: "default",
      title,
      body,
      data,
    });

    const options = {
      hostname: "exp.host",
      path: "/--/api/v2/push/send",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(responseBody);
            console.log("[PushNotification] Response from Expo:", parsed);
            resolve(parsed);
          } catch (e) {
            reject(new Error("Failed to parse push notification response"));
          }
        });
      });

      req.on("error", (error) => {
        console.error("[PushNotification] Failed to send push notification:", error);
        reject(error);
      });

      req.write(payload);
      req.end();
    }).catch((err) => {
      console.error("[PushNotification] Promise caught error:", err);
    });
  }

  async triggerUserCountUpdate() {
    try {
      const count = await this.getCount();
      this.userCountSubject.next(count);
    } catch (error) {
      console.error("Failed to update user count:", error);
    }
  }

  async createUser(registerUserDto: RegisterDto) {
    const newUser = await db
      .insert(users)
      .values(registerUserDto)
      .returning(this.buildUserSelection());

    this.triggerUserCountUpdate().catch((error) => {
      console.error("Failed to trigger user count update after registration:", error);
    });

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
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      pushToken: users.pushToken,
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
      accountStatus: (user?.accountStatus ?? "active"),
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
    const moderationState = this.normalizeModerationState(user);
    const { password, isAdmin, accountStatus, suspendedUntil, ...rest } = user;
    if (password || isAdmin || accountStatus || suspendedUntil) {
      // Noop to satisfy unused variable rule
    }

    if (includeAdmin) {
      return {
        ...rest,
        ...moderationState,
      };
    }

    return {
      ...rest,
      accountStatus: moderationState.accountStatus,
      suspendedUntil: moderationState.suspendedUntil,
    };
  }

  private toPublicUserSummary(user: UserRecord): PublicUserSummary {
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

  private async canViewerSeeProfilePosts(
    profileUserId: string,
    viewerId: string,
  ) {
    if (profileUserId === viewerId) {
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
    const cacheKey = `user:${profileUserId}:profile:${viewerId}`;
    const cachedProfile = this.cacheService.get<any>(cacheKey);
    if (cachedProfile) {
      return cachedProfile;
    }

    const [stats, reachStats, [followRelation]] = await Promise.all([
      this.getStatsSummary(profileUserId),
      this.getReachStats(profileUserId),
      db
        .select({ status: follows.status })
        .from(follows)
        .where(
          and(
            eq(follows.followerId, viewerId),
            eq(follows.followingId, profileUserId),
          ),
        ),
    ]);

    const followStatus = followRelation?.status ?? "none";

    const canViewPosts = await this.canViewerSeeProfilePosts(
      profileUserId,
      viewerId,
    );

    const profilePosts = canViewPosts
      ? await this.getProfilePosts(
          profileUserId,
          viewerId,
          user.encryptedFeedKey,
        )
      : [];

    const baseProfile = {
      user: {
        ...this.sanitizeUser(user, viewerId === profileUserId),
        followStatus,
      },
      stats,
      reachStats,
      canViewPosts,
      posts: profilePosts,
    };

    let resultProfile;
    if (viewerId === profileUserId) {
      const securityStats = await this.getSecurityStats(profileUserId);
      resultProfile = {
        ...baseProfile,
        securityStats,
      };
    } else {
      resultProfile = baseProfile;
    }

    this.cacheService.set(cacheKey, resultProfile, this.profileHeadCacheTtlMs);
    return resultProfile;
  }

  async getMyStats(uid: string) {
    const cacheKey = `user:${uid}:mystats`;
    const cachedMyStats = this.cacheService.get<any>(cacheKey);
    if (cachedMyStats) {
      return cachedMyStats;
    }

    const user = await this.findUserByIdentifier(uid);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const [stats, securityStats, reachStats] = await Promise.all([
      this.getStatsSummary(uid),
      this.getSecurityStats(uid),
      this.getReachStats(uid),
    ]);

    const result = {
      user: {
        ...this.sanitizeUser(user, true),
      },
      stats,
      securityStats,
      reachStats,
    };

    this.cacheService.set(cacheKey, result, this.profileHeadCacheTtlMs);
    return result;
  }

  async getUserStats(identifier: string) {
    const user = await this.findUserByIdentifier(identifier);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const uid = user.uid;
    const cacheKey = `user:${uid}:userstats`;
    const cachedUserStats = this.cacheService.get<any>(cacheKey);
    if (cachedUserStats) {
      return cachedUserStats;
    }

    const [stats, reachStats] = await Promise.all([
      this.getStatsSummary(uid),
      this.getReachStats(uid),
    ]);

    const result = {
      user: {
        ...this.toPublicUserSummary(user),
      },
      stats,
      reachStats,
    };

    this.cacheService.set(cacheKey, result, this.profileHeadCacheTtlMs);
    return result;
  }

  async getAllUsers(
    viewerId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<PublicUserSummary>> {
    const offset = (page - 1) * limit;

    const baseConditions = and(
      ne(users.uid, viewerId),
      or(
        isNull(follows.status),
        and(ne(follows.status, "accepted"), ne(follows.status, "pending")),
      ),
    );

    const [totalResult, allUsers] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .leftJoin(
          follows,
          and(
            eq(follows.followingId, users.uid),
            eq(follows.followerId, viewerId),
          ),
        )
        .where(baseConditions),
      db
        .select(this.buildUserSelection())
        .from(users)
        .leftJoin(
          follows,
          and(
            eq(follows.followingId, users.uid),
            eq(follows.followerId, viewerId),
          ),
        )
        .where(baseConditions)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ?? 0;

    return {
      data: allUsers.map((row) => this.toPublicUserSummary(row)),
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

  async updatePushToken(uid: string, pushToken: string) {
    const [updatedUser] = await db
      .update(users)
      .set({ pushToken, updatedAt: new Date() })
      .where(eq(users.uid, uid))
      .returning(this.buildUserSelection());

    if (!updatedUser) {
      throw new NotFoundException("User not found");
    }

    this.invalidateUserProfileCaches(uid);
    return {
      message: "Push token updated successfully",
      pushToken: updatedUser.pushToken,
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
        return {
          message: "Already following this user",
          follow: existingFollow,
        };
      }
      if (existingFollow.status === "pending") {
        return {
          message: "Follow request already pending",
          follow: existingFollow,
        };
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

      const [follower] = await db
      .select({ username: users.username, avatar: users.avatar })
      .from(users)
      .where(eq(users.uid, followerId));
      if (targetUser.pushToken && follower) {
        this.sendPushNotification(
          targetUser.pushToken,
          "New Follow Request",
          `You got a follow request from @${follower.username}`,
          { senderUsername: follower.username, senderAvatar: follower.avatar }
        );
      }

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

    const [follower] = await db
      .select({ username: users.username, avatar: users.avatar })
      .from(users)
      .where(eq(users.uid, followerId));
    
    console.log(`[followUser] Target user: ${targetUser.username}, PushToken: ${targetUser.pushToken}, Follower: ${follower?.username}`);

    if (targetUser.pushToken && follower) {
      await this.sendPushNotification(
        targetUser.pushToken,
        "New Follow Request",
        `You got a follow request from @${follower.username}`,
        { senderUsername: follower.username, senderAvatar: follower.avatar }
      );
    } else {
      console.log(`[followUser] Notification skipped. Target token present: ${!!targetUser.pushToken}, Follower present: ${!!follower}`);
    }

    return {
      message: "Follow request sent successfully",
      follow: newFollow,
    };
  }

  async getPendingFollowRequests(followingId: string) {
    const cacheKey = `user:${followingId}:pending_requests`;
    const cachedPending = this.cacheService.get<any>(cacheKey);
    if (cachedPending) {
      return cachedPending;
    }

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

    this.cacheService.set(cacheKey, pending, this.profileHeadCacheTtlMs);
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

    const [followerUser] = await db
      .select({ pushToken: users.pushToken })
      .from(users)
      .where(eq(users.uid, followerId));

    const [followingUser] = await db
      .select({ username: users.username, avatar: users.avatar })
      .from(users)
      .where(eq(users.uid, followingId));

    if (followerUser?.pushToken && followingUser) {
      await this.sendPushNotification(
        followerUser.pushToken,
        "Follow Request Accepted",
        `Your follow request to @${followingUser.username} was accepted.`,
        { senderUsername: followingUser.username, senderAvatar: followingUser.avatar }
      );
      await this.sendPushNotification(
        followerUser.pushToken,
        "Secure Feed Shared",
        `You can now access @${followingUser.username}'s posts.`,
        { senderUsername: followingUser.username, senderAvatar: followingUser.avatar }
      );
    }

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

    const [followerUser] = await db
      .select({ pushToken: users.pushToken })
      .from(users)
      .where(eq(users.uid, followerId));

    const [followingUser] = await db
      .select({ username: users.username, avatar: users.avatar })
      .from(users)
      .where(eq(users.uid, followingId));

    if (followerUser?.pushToken && followingUser) {
      await this.sendPushNotification(
        followerUser.pushToken,
        "Follow Request Rejected",
        `Your follow request to @${followingUser.username} was rejected.`,
        { senderUsername: followingUser.username, senderAvatar: followingUser.avatar }
      );
    }

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
      return {
        message: "Unfollowed successfully",
      };
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

    this.triggerUserCountUpdate().catch((error) => {
      console.error("Failed to trigger user count update after deletion:", error);
    });

    return {
      message: "Account deleted successfully",
      uid,
    };
  }
}
