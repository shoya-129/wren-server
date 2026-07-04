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

@Injectable()
export class UserService {
  constructor(private readonly cacheService: CacheService) {}

  async createUser(registerUserDto: RegisterDto) {
    const newUser = await db.insert(users).values(registerUserDto).returning();

    return newUser;
  }

  private async findUserByIdentifier(identifier: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.uid, identifier), eq(users.username, identifier)));

    return user ?? null;
  }

  private sanitizeUser(user: typeof users.$inferSelect, includeAdmin = false) {
    const { password, isAdmin, ...rest } = user;
    if (password || isAdmin) {
      // Noop to satisfy unused variable rule
    }

    if (includeAdmin) {
      return {
        ...rest,
        isAdmin,
      };
    }

    return rest;
  }

  private toPublicUserSummary(
    user: typeof users.$inferSelect,
  ): PublicUserSummary {
    return {
      uid: user.uid,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      bio: user.bio,
      publicKey: user.publicKey,
      verified: user.verified ?? false,
      accountStatus: user.accountStatus,
      profileVisibility: user.profileVisibility,
      allowFollowRequests: user.allowFollowRequests,
      createdAt: user.createdAt ?? null,
      updatedAt: user.updatedAt ?? null,
    };
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
    const [followersResult, followingResult, postsResult] = await Promise.all([
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
    ]);

    return {
      followersCount: followersResult[0]?.count ?? 0,
      followingCount: followingResult[0]?.count ?? 0,
      postsCount: postsResult[0]?.count ?? 0,
    };
  }

  async getSecurityStats(uid: string): Promise<UserSecurityStats> {
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
  }

  async getReachStats(uid: string): Promise<UserReachStats> {
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
  }

  async getPrivacySettings(uid: string): Promise<UserPrivacySettings> {
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

    return {
      profileVisibility: user.profileVisibility,
      allowFollowRequests: user.allowFollowRequests,
    };
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

    const [stats, reachStats, privacySettings, canViewPosts] =
      await Promise.all([
        this.getStatsSummary(profileUserId),
        this.getReachStats(profileUserId),
        this.getPrivacySettings(profileUserId),
        this.canViewerSeeProfilePosts(
          profileUserId,
          viewerId,
          user.profileVisibility,
        ),
      ]);

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
    const [user] = await db.select().from(users).where(eq(users.uid, uid));

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
        uid: user.uid,
        username: user.username,
        isAdmin: user.isAdmin,
        accountStatus: user.accountStatus,
        suspendedUntil: user.suspendedUntil,
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
        uid: user.uid,
        username: user.username,
        accountStatus: user.accountStatus,
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

    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid));

    if (!existingUser) {
      throw new NotFoundException("User not found");
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        profileVisibility:
          dto.profileVisibility ?? existingUser.profileVisibility,
        allowFollowRequests:
          dto.allowFollowRequests ?? existingUser.allowFollowRequests,
        updatedAt: new Date(),
      })
      .where(eq(users.uid, uid))
      .returning({
        profileVisibility: users.profileVisibility,
        allowFollowRequests: users.allowFollowRequests,
      });

    return {
      message: "Privacy settings updated successfully",
      privacySettings: updatedUser,
    };
  }

  async getAllUsers(
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<PublicUserSummary>> {
    const offset = (page - 1) * limit;

    const [totalResult, allUsers] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db
        .select()
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
          user: users,
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
          user: users,
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

    if (!targetUser.allowFollowRequests) {
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
      .select()
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

    return {
      message: "Account status updated successfully",
      user: updatedUser,
    };
  }

  async deleteAccount(uid: string) {
    const [user] = await db.select().from(users).where(eq(users.uid, uid));

    if (!user) {
      throw new NotFoundException("User not found");
    }

    await db.delete(users).where(eq(users.uid, uid));
    this.cacheService.deletePattern("feed:");

    return {
      message: "Account deleted successfully",
      uid,
    };
  }
}
