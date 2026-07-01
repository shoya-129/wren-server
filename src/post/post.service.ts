import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { db } from '../db';
import { posts, users, follows, likes, reposts, dislikes } from '../db/schema';
import { eq, and, desc, ne, notInArray, sql, or, isNotNull } from 'drizzle-orm';
import { CacheService } from '../cache/cache.service';

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
  };
  encryptedFeedKey: string | null;
  likesCount: number;
  repostsCount: number;
  repliesCount: number;
}

@Injectable()
export class PostService {
  constructor(private readonly cacheService: CacheService) {}

  async createPost(uid: string, dto: CreatePostDto) {
    const [newPost] = await db
      .insert(posts)
      .values({
        uid,
        encryptedContent: dto.encryptedContent,
        encryptedMedia: dto.encryptedMedia || null,
        replyTo: dto.replyTo || null,
        quoteTo: dto.quoteTo || null,
        visibility: dto.visibility || 'followers',
      })
      .returning();

    // Invalidate cached feeds across all users since a new post is added
    this.cacheService.deletePattern('feed:');

    return newPost;
  }

  async getFeed(uid: string, page: number, limit: number): Promise<FeedPost[]> {
    const cacheKey = `feed:${uid}:${page}:${limit}`;
    const cachedResult = this.cacheService.get<FeedPost[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Correlated subqueries to compute counts for likes, reposts, and replies safely
    const likesCountSql = sql<number>`coalesce((select count(*)::int from ${likes} where ${likes.postId} = ${posts.postId}), 0)`;
    const repostsCountSql = sql<number>`coalesce((select count(*)::int from ${reposts} where ${reposts.postId} = ${posts.postId}), 0)`;
    const repliesCountSql = sql<number>`coalesce((select count(*)::int from ${posts} replies where replies.reply_to = ${posts.postId}), 0)`;

    // 1. Get the list of users followed by the current user (where status = accepted)
    const followedUsers = await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(and(eq(follows.followerId, uid), eq(follows.status, 'accepted')));

    const followedIds = followedUsers.map((f) => f.followingId);

    let combined: FeedPost[] = [];

    if (followedIds.length > 0) {
      // Interleave followed posts with non-followed posts (80/20 split)
      const followedLimit = Math.ceil(limit * 0.8);
      const nonFollowedLimit = limit - followedLimit;

      // Query posts from followed users (excluding own posts)
      const followedPosts = await db
        .select({
          post: posts,
          author: {
            uid: users.uid,
            username: users.username,
            name: users.name,
            avatar: users.avatar,
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
            eq(follows.status, 'accepted')
          )
        )
        .where(ne(posts.uid, uid)) // Exclude own posts
        .orderBy(desc(posts.createdAt))
        .limit(followedLimit)
        .offset((page - 1) * followedLimit);

      // If followed posts run out, we fill the gap with non-followed posts
      const actualFollowedCount = followedPosts.length;
      const dynamicNonFollowedLimit = limit - actualFollowedCount;

      // Query posts from non-followed users (excluding own posts and followed users)
      const nonFollowedPosts = await db
        .select({
          post: posts,
          author: {
            uid: users.uid,
            username: users.username,
            name: users.name,
            avatar: users.avatar,
          },
          likesCount: likesCountSql,
          repostsCount: repostsCountSql,
          repliesCount: repliesCountSql,
        })
        .from(posts)
        .innerJoin(users, eq(posts.uid, users.uid))
        .where(
          and(
            or(ne(posts.uid, uid), isNotNull(posts.replyTo)), // Exclude own top-level posts but allow own replies
            notInArray(posts.uid, followedIds) // Exclude followed users (safe because followedIds is not empty)
          )
        )
        .orderBy(desc(posts.createdAt))
        .limit(dynamicNonFollowedLimit)
        .offset((page - 1) * nonFollowedLimit);

      // Map and format results
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
        encryptedFeedKey: null, // Non-followed posts do not provide encrypted keys
        likesCount: item.likesCount,
        repostsCount: item.repostsCount,
        repliesCount: item.repliesCount,
      }));

      // Merge and sort chronologically (newest first)
      combined = [...mappedFollowed, ...mappedNonFollowed].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
    } else {
      // User has no followings: fetch only non-followed posts (excluding own posts)
      const nonFollowedPosts = await db
        .select({
          post: posts,
          author: {
            uid: users.uid,
            username: users.username,
            name: users.name,
            avatar: users.avatar,
          },
          likesCount: likesCountSql,
          repostsCount: repostsCountSql,
          repliesCount: repliesCountSql,
        })
        .from(posts)
        .innerJoin(users, eq(posts.uid, users.uid))
        .where(or(ne(posts.uid, uid), isNotNull(posts.replyTo))) // Exclude own top-level posts but allow own replies
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
        encryptedFeedKey: null, // Non-followed posts do not provide encrypted keys
        likesCount: item.likesCount,
        repostsCount: item.repostsCount,
        repliesCount: item.repliesCount,
      }));
    }

    // Always include the user's own replies so they can see their comments in threads
    const ownReplies = await db
      .select({
        post: posts,
        author: {
          uid: users.uid,
          username: users.username,
          name: users.name,
          avatar: users.avatar,
        },
        likesCount: likesCountSql,
        repostsCount: repostsCountSql,
        repliesCount: repliesCountSql,
      })
      .from(posts)
      .innerJoin(users, eq(posts.uid, users.uid))
      .where(and(eq(posts.uid, uid), isNotNull(posts.replyTo)))
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
      })
    );

    const existingIds = new Set(combined.map((p) => p.postId));
    for (const reply of mappedOwnReplies) {
      if (!existingIds.has(reply.postId)) {
        combined.push(reply);
        existingIds.add(reply.postId);
      }
    }

    combined.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Save in cache for 10 seconds to speed up immediate transfers
    this.cacheService.set(cacheKey, combined, 10000);

    return combined;
  }

  async toggleLike(postId: string, uid: string) {
    const [post] = await db.select().from(posts).where(eq(posts.postId, postId));
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const [existingLike] = await db
      .select()
      .from(likes)
      .where(and(eq(likes.postId, postId), eq(likes.uid, uid)));

    if (existingLike) {
      await db
        .delete(likes)
        .where(and(eq(likes.postId, postId), eq(likes.uid, uid)));
      
      this.cacheService.deletePattern('feed:');
      return { liked: false, message: 'Unliked successfully' };
    } else {
      // Remove dislike first if liked
      await db
        .delete(dislikes)
        .where(and(eq(dislikes.postId, postId), eq(dislikes.uid, uid)));

      await db
        .insert(likes)
        .values({ postId, uid });

      this.cacheService.deletePattern('feed:');
      return { liked: true, message: 'Liked successfully' };
    }
  }

  async toggleDislike(postId: string, uid: string) {
    const [post] = await db.select().from(posts).where(eq(posts.postId, postId));
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const [existingDislike] = await db
      .select()
      .from(dislikes)
      .where(and(eq(dislikes.postId, postId), eq(dislikes.uid, uid)));

    if (existingDislike) {
      await db
        .delete(dislikes)
        .where(and(eq(dislikes.postId, postId), eq(dislikes.uid, uid)));
      
      this.cacheService.deletePattern('feed:');
      return { disliked: false, message: 'Removed dislike successfully' };
    } else {
      // Remove like first if disliked
      await db
        .delete(likes)
        .where(and(eq(likes.postId, postId), eq(likes.uid, uid)));

      await db
        .insert(dislikes)
        .values({ postId, uid });

      this.cacheService.deletePattern('feed:');
      return { disliked: true, message: 'Disliked successfully' };
    }
  }

  async toggleRepost(postId: string, uid: string) {
    const [post] = await db.select().from(posts).where(eq(posts.postId, postId));
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const [existingRepost] = await db
      .select()
      .from(reposts)
      .where(and(eq(reposts.postId, postId), eq(reposts.uid, uid)));

    if (existingRepost) {
      await db
        .delete(reposts)
        .where(and(eq(reposts.postId, postId), eq(reposts.uid, uid)));
      
      this.cacheService.deletePattern('feed:');
      return { reposted: false, message: 'Unreposted successfully' };
    } else {
      await db
        .insert(reposts)
        .values({ postId, uid });

      this.cacheService.deletePattern('feed:');
      return { reposted: true, message: 'Reposted successfully' };
    }
  }

  private mapPostRow(
    item: {
      post: typeof posts.$inferSelect;
      author: {
        uid: string;
        username: string;
        name: string | null;
        avatar: string | null;
      };
      likesCount: number;
      repostsCount: number;
      repliesCount: number;
      encryptedFeedKey?: string | null;
    }
  ): FeedPost {
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
      author: item.author,
      encryptedFeedKey: item.encryptedFeedKey ?? null,
      likesCount: item.likesCount,
      repostsCount: item.repostsCount,
      repliesCount: item.repliesCount,
    };
  }

  async getReplies(postId: string, uid: string): Promise<FeedPost[]> {
    const [parentPost] = await db.select().from(posts).where(eq(posts.postId, postId));
    if (!parentPost) {
      throw new NotFoundException('Post not found');
    }

    const likesCountSql = sql<number>`coalesce((select count(*)::int from ${likes} where ${likes.postId} = ${posts.postId}), 0)`;
    const repostsCountSql = sql<number>`coalesce((select count(*)::int from ${reposts} where ${reposts.postId} = ${posts.postId}), 0)`;
    const repliesCountSql = sql<number>`coalesce((select count(*)::int from ${posts} replies where replies.reply_to = ${posts.postId}), 0)`;

    const replyRows = await db
      .select({
        post: posts,
        author: {
          uid: users.uid,
          username: users.username,
          name: users.name,
          avatar: users.avatar,
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
          eq(follows.status, 'accepted')
        )
      )
      .where(eq(posts.replyTo, postId))
      .orderBy(desc(posts.createdAt));

    return replyRows.map((item) =>
      this.mapPostRow({
        post: item.post,
        author: item.author,
        likesCount: item.likesCount,
        repostsCount: item.repostsCount,
        repliesCount: item.repliesCount,
        encryptedFeedKey: item.follow?.encryptedFeedKey ?? null,
      })
    );
  }

  async createComment(postId: string, uid: string, dto: CreateCommentDto) {
    const [post] = await db.select().from(posts).where(eq(posts.postId, postId));
    if (!post) {
      throw new NotFoundException('Post not found');
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
      })
      .from(users)
      .where(eq(users.uid, uid));

    this.cacheService.deletePattern('feed:');

    return {
      ...newComment,
      author,
      encryptedFeedKey: null,
      likesCount: 0,
      repostsCount: 0,
      repliesCount: 0,
    };
  }
}

