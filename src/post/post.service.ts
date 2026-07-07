import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { v2 as cloudinary } from "cloudinary";
import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { CacheService } from "../cache/cache.service";
import { db } from "../db";
import {
  dislikes,
  follows,
  likes,
  postReports,
  posts,
  reposts,
  users,
} from "../db/schema";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { CreatePostDto } from "./dto/create-post.dto";
import { ReportPostDto } from "./dto/report-post.dto";

export interface FeedPost {
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
    verified: boolean | null;
  };
  encryptedFeedKey: string | null;
  likesCount: number;
  repostsCount: number;
  repliesCount: number;
}

@Injectable()
export class PostService {
  constructor(private readonly cacheService: CacheService) {}

  async uploadMedia(file: { buffer: Buffer }) {
    if (!file || !file.buffer) {
      throw new BadRequestException("No file uploaded");
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    try {
      const result = await new Promise<{ secure_url: string }>(
        (resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              resource_type: "raw",
              folder: "wren_encrypted",
              public_id: `encrypted_${Date.now()}_${Math.random().toString(36).substring(7)}.enc`,
            },
            (error: unknown, res: unknown) => {
              if (error) {
                const errMsg =
                  error instanceof Error
                    ? error.message
                    : error && typeof error === "object" && "message" in error
                    ? String((error as Record<string, unknown>).message)
                    : JSON.stringify(error);
                return reject(new Error(errMsg));
              }
              if (res && typeof res === "object" && "secure_url" in res) {
                resolve(res as { secure_url: string });
              } else {
                reject(new Error("No response received from Cloudinary"));
              }
            }
          );
          uploadStream.end(file.buffer);
        }
      );

      return { url: result.secure_url };
    } catch (e) {
      console.error("Cloudinary upload error:", e);
      throw new BadRequestException("Failed to upload file to Cloudinary");
    }
  }

  private invalidateUserProfileCaches(
    ...uids: Array<string | null | undefined>
  ) {
    const uniqueUserIds = Array.from(new Set(uids.filter(Boolean)));

    for (const uid of uniqueUserIds) {
      this.cacheService.deletePattern(`user:${uid}:`);
    }
  }

  async createPost(uid: string, dto: CreatePostDto) {
    const [newPost] = await db
      .insert(posts)
      .values({
        uid,
        encryptedContent: dto.encryptedContent,
        encryptedMedia: dto.encryptedMedia || null,
        replyTo: dto.replyTo || null,
        quoteTo: dto.quoteTo || null,
        visibility: dto.visibility || "followers",
      })
      .returning();

    this.cacheService.deletePattern("feed:");
    this.invalidateUserProfileCaches(uid);

    return newPost;
  }

  async getFeed(uid: string, page: number, limit: number): Promise<FeedPost[]> {
    const cacheKey = `feed:${uid}:${page}:${limit}`;
    const cachedResult = this.cacheService.get<FeedPost[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const likesCountSql = sql<number>`coalesce((select count(*)::int from ${likes} where ${likes.postId} = ${posts.postId}), 0)`;
    const repostsCountSql = sql<number>`coalesce((select count(*)::int from ${reposts} where ${reposts.postId} = ${posts.postId}), 0)`;
    const repliesCountSql = sql<number>`coalesce((select count(*)::int from ${posts} replies where replies.reply_to = ${posts.postId} and replies.deleted_at is null), 0)`;

    const followedUsers = await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(and(eq(follows.followerId, uid), eq(follows.status, "accepted")));

    const followedIds = followedUsers.map((f) => f.followingId);

    let combined: FeedPost[] = [];

    if (followedIds.length > 0) {
      const followedLimit = Math.ceil(limit * 0.8);
      const nonFollowedLimit = limit - followedLimit;

      const followedPosts = await db
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
          repostsCount: repostsCountSql,
          repliesCount: repliesCountSql,
        })
        .from(posts)
        .innerJoin(users, eq(posts.uid, users.uid))
        .innerJoin(
          follows,
          and(
            eq(follows.followingId, posts.uid),
            eq(follows.followerId, uid),
            eq(follows.status, "accepted"),
          ),
        )
        .where(and(ne(posts.uid, uid), isNull(posts.deletedAt)))
        .orderBy(desc(posts.createdAt))
        .limit(followedLimit)
        .offset((page - 1) * followedLimit);

      const actualFollowedCount = followedPosts.length;
      const dynamicNonFollowedLimit = limit - actualFollowedCount;

      const nonFollowedPosts = await db
        .select({
          post: posts,
          author: {
            uid: users.uid,
            username: users.username,
            name: users.name,
            avatar: users.avatar,
            verified: users.verified,
          },
          likesCount: likesCountSql,
          repostsCount: repostsCountSql,
          repliesCount: repliesCountSql,
        })
        .from(posts)
        .innerJoin(users, eq(posts.uid, users.uid))
        .where(
          and(
            or(ne(posts.uid, uid), isNotNull(posts.replyTo)),
            notInArray(posts.uid, followedIds),
            isNull(posts.deletedAt),
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(dynamicNonFollowedLimit)
        .offset((page - 1) * nonFollowedLimit);

      const mappedFollowed = followedPosts.map((item) => ({
        postId: item.post.postId,
        uid: item.post.uid,
        encryptedContent: item.post.encryptedContent,
        encryptedMedia: item.post.encryptedMedia,
        replyTo: item.post.replyTo,
        quoteTo: item.post.quoteTo,
        visibility: item.post.visibility,
        createdAt: item.post.createdAt,
        updatedAt: item.post.updatedAt,
        author: item.author,
        encryptedFeedKey: item.follow.encryptedFeedKey || null,
        likesCount: item.likesCount,
        repostsCount: item.repostsCount,
        repliesCount: item.repliesCount,
      }));

      const mappedNonFollowed = nonFollowedPosts.map((item) => ({
        postId: item.post.postId,
        uid: item.post.uid,
        encryptedContent: item.post.encryptedContent,
        encryptedMedia: item.post.encryptedMedia,
        replyTo: item.post.replyTo,
        quoteTo: item.post.quoteTo,
        visibility: item.post.visibility,
        createdAt: item.post.createdAt,
        updatedAt: item.post.updatedAt,
        author: item.author,
        encryptedFeedKey: null,
        likesCount: item.likesCount,
        repostsCount: item.repostsCount,
        repliesCount: item.repliesCount,
      }));

      combined = [...mappedFollowed, ...mappedNonFollowed].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
    } else {
      const nonFollowedPosts = await db
        .select({
          post: posts,
          author: {
            uid: users.uid,
            username: users.username,
            name: users.name,
            avatar: users.avatar,
            verified: users.verified,
          },
          likesCount: likesCountSql,
          repostsCount: repostsCountSql,
          repliesCount: repliesCountSql,
        })
        .from(posts)
        .innerJoin(users, eq(posts.uid, users.uid))
        .where(
          and(
            or(ne(posts.uid, uid), isNotNull(posts.replyTo)),
            isNull(posts.deletedAt),
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      combined = nonFollowedPosts.map((item) => ({
        postId: item.post.postId,
        uid: item.post.uid,
        encryptedContent: item.post.encryptedContent,
        encryptedMedia: item.post.encryptedMedia,
        replyTo: item.post.replyTo,
        quoteTo: item.post.quoteTo,
        visibility: item.post.visibility,
        createdAt: item.post.createdAt,
        updatedAt: item.post.updatedAt,
        author: item.author,
        encryptedFeedKey: null,
        likesCount: item.likesCount,
        repostsCount: item.repostsCount,
        repliesCount: item.repliesCount,
      }));
    }

    const ownReplies = await db
      .select({
        post: posts,
        author: {
          uid: users.uid,
          username: users.username,
          name: users.name,
          avatar: users.avatar,
          verified: users.verified,
        },
        likesCount: likesCountSql,
        repostsCount: repostsCountSql,
        repliesCount: repliesCountSql,
      })
      .from(posts)
      .innerJoin(users, eq(posts.uid, users.uid))
      .where(
        and(
          eq(posts.uid, uid),
          isNotNull(posts.replyTo),
          isNull(posts.deletedAt),
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(100);

    const mappedOwnReplies = ownReplies.map((item) =>
      this.mapPostRow({
        post: item.post,
        author: item.author,
        likesCount: item.likesCount,
        repostsCount: item.repostsCount,
        repliesCount: item.repliesCount,
        encryptedFeedKey: null,
      }),
    );

    const existingIds = new Set(combined.map((p) => p.postId));
    for (const reply of mappedOwnReplies) {
      if (!existingIds.has(reply.postId)) {
        combined.push(reply);
        existingIds.add(reply.postId);
      }
    }

    combined.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    this.cacheService.set(cacheKey, combined, 10000);

    return combined;
  }

  async toggleLike(postId: string, uid: string) {
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.postId, postId), isNull(posts.deletedAt)));
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    const [existingLike] = await db
      .select()
      .from(likes)
      .where(and(eq(likes.postId, postId), eq(likes.uid, uid)));

    if (existingLike) {
      await db
        .delete(likes)
        .where(and(eq(likes.postId, postId), eq(likes.uid, uid)));

      this.cacheService.deletePattern("feed:");
      return { liked: false, message: "Unliked successfully" };
    }

    await db
      .delete(dislikes)
      .where(and(eq(dislikes.postId, postId), eq(dislikes.uid, uid)));

    await db.insert(likes).values({ postId, uid });

    this.cacheService.deletePattern("feed:");
    return { liked: true, message: "Liked successfully" };
  }

  async toggleDislike(postId: string, uid: string) {
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.postId, postId), isNull(posts.deletedAt)));
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    const [existingDislike] = await db
      .select()
      .from(dislikes)
      .where(and(eq(dislikes.postId, postId), eq(dislikes.uid, uid)));

    if (existingDislike) {
      await db
        .delete(dislikes)
        .where(and(eq(dislikes.postId, postId), eq(dislikes.uid, uid)));

      this.cacheService.deletePattern("feed:");
      return { disliked: false, message: "Removed dislike successfully" };
    }

    await db
      .delete(likes)
      .where(and(eq(likes.postId, postId), eq(likes.uid, uid)));

    await db.insert(dislikes).values({ postId, uid });

    this.cacheService.deletePattern("feed:");
    return { disliked: true, message: "Disliked successfully" };
  }

  async toggleRepost(postId: string, uid: string) {
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.postId, postId), isNull(posts.deletedAt)));
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    const [existingRepost] = await db
      .select()
      .from(reposts)
      .where(and(eq(reposts.postId, postId), eq(reposts.uid, uid)));

    if (existingRepost) {
      await db
        .delete(reposts)
        .where(and(eq(reposts.postId, postId), eq(reposts.uid, uid)));

      this.cacheService.deletePattern("feed:");
      return { reposted: false, message: "Unreposted successfully" };
    }

    await db.insert(reposts).values({ postId, uid });

    this.cacheService.deletePattern("feed:");
    return { reposted: true, message: "Reposted successfully" };
  }

  async reportPost(postId: string, reporterId: string, dto: ReportPostDto) {
    const [post] = await db
      .select({ postId: posts.postId, uid: posts.uid })
      .from(posts)
      .where(and(eq(posts.postId, postId), isNull(posts.deletedAt)));

    if (!post) {
      throw new NotFoundException("Post not found");
    }

    if (post.uid === reporterId) {
      throw new BadRequestException("You cannot report your own post");
    }

    const [report] = await db
      .insert(postReports)
      .values({
        postId,
        reporterId,
        reason: dto.reason,
        details: dto.details || null,
      })
      .returning();

    return {
      message: "Post reported successfully",
      report,
    };
  }

  async deletePost(postId: string, uid: string) {
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.postId, postId), isNull(posts.deletedAt)));

    if (!post) {
      throw new NotFoundException("Post not found");
    }

    if (post.uid !== uid) {
      throw new ForbiddenException("You can only delete your own post");
    }

    const [deletedPost] = await db
      .update(posts)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posts.postId, postId))
      .returning();

    this.cacheService.deletePattern("feed:");
    this.invalidateUserProfileCaches(uid);

    return {
      message: "Post deleted successfully",
      postId: deletedPost.postId,
    };
  }

  private mapPostRow(item: {
    post: typeof posts.$inferSelect;
    author: {
      uid: string;
      username: string;
      name: string | null;
      avatar: string | null;
      verified: boolean | null;
    };
    likesCount: number;
    repostsCount: number;
    repliesCount: number;
    encryptedFeedKey?: string | null;
  }): FeedPost {
    return {
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
      encryptedFeedKey: item.encryptedFeedKey ?? null,
      likesCount: item.likesCount,
      repostsCount: item.repostsCount,
      repliesCount: item.repliesCount,
    };
  }

  async getReplies(postId: string, uid: string): Promise<FeedPost[]> {
    const [parentPost] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.postId, postId), isNull(posts.deletedAt)));
    if (!parentPost) {
      throw new NotFoundException("Post not found");
    }

    const likesCountSql = sql<number>`coalesce((select count(*)::int from ${likes} where ${likes.postId} = ${posts.postId}), 0)`;
    const repostsCountSql = sql<number>`coalesce((select count(*)::int from ${reposts} where ${reposts.postId} = ${posts.postId}), 0)`;
    const repliesCountSql = sql<number>`coalesce((select count(*)::int from ${posts} replies where replies.reply_to = ${posts.postId} and replies.deleted_at is null), 0)`;

    const replyRows = await db
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
        repostsCount: repostsCountSql,
        repliesCount: repliesCountSql,
      })
      .from(posts)
      .innerJoin(users, eq(posts.uid, users.uid))
      .leftJoin(
        follows,
        and(
          eq(follows.followingId, posts.uid),
          eq(follows.followerId, uid),
          eq(follows.status, "accepted"),
        ),
      )
      .where(and(eq(posts.replyTo, postId), isNull(posts.deletedAt)))
      .orderBy(desc(posts.createdAt));

    return replyRows.map((item) =>
      this.mapPostRow({
        post: item.post,
        author: item.author,
        likesCount: item.likesCount,
        repostsCount: item.repostsCount,
        repliesCount: item.repliesCount,
        encryptedFeedKey: item.follow?.encryptedFeedKey ?? null,
      }),
    );
  }

  async createComment(postId: string, uid: string, dto: CreateCommentDto) {
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.postId, postId), isNull(posts.deletedAt)));
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    const [newComment] = await db
      .insert(posts)
      .values({
        uid,
        encryptedContent: dto.encryptedContent,
        encryptedMedia: dto.encryptedMedia || null,
        replyTo: postId,
        visibility: post.visibility,
      })
      .returning();

    const [author] = await db
      .select({
        uid: users.uid,
        username: users.username,
        name: users.name,
        avatar: users.avatar,
        verified: users.verified,
      })
      .from(users)
      .where(eq(users.uid, uid));

    this.cacheService.deletePattern("feed:");
    this.invalidateUserProfileCaches(uid);

    return {
      ...newComment,
      author: {
        uid: author.uid,
        username: author.username,
        name: author.name,
        avatar: author.avatar,
        verified: author.verified ?? false,
      },
      encryptedFeedKey: null,
      likesCount: 0,
      repostsCount: 0,
      repliesCount: 0,
    };
  }
}
