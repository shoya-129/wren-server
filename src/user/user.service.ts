import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from "@nestjs/common";
import { RegisterDto } from "../auth/dto/register.user.dto";
import { db } from "../db";
import { users, follows } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { CacheService } from "../cache/cache.service";

@Injectable()
export class UserService {
    constructor(private readonly cacheService: CacheService) {}

    async createUser(registerUserDto: RegisterDto) {
        const newUser = await db
            .insert(users)
            .values(registerUserDto)
            .returning();

        return newUser;
    }

    async getProfile(uid: string) {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.uid, uid));

        if (!user) {
            throw new NotFoundException("User not found");
        }

        const { password, ...rest } = user;
        if (password) {
            // Noop to satisfy unused variable rule
        }
        return rest;
    }

    async getAllUsers() {
        const allUsers = await db.select().from(users);
        return allUsers.map((u) => {
            const { password, ...rest } = u;
            if (password) {
                // Noop to satisfy unused variable rule
            }
            return rest;
        });
    }

    async followUser(followerId: string, followingId: string) {
        if (followerId === followingId) {
            throw new BadRequestException("You cannot follow yourself");
        }

        const [targetUser] = await db
            .select()
            .from(users)
            .where(eq(users.uid, followingId));

        if (!targetUser) {
            throw new NotFoundException("User to follow not found");
        }

        const [existingFollow] = await db
            .select()
            .from(follows)
            .where(
                and(
                    eq(follows.followerId, followerId),
                    eq(follows.followingId, followingId)
                )
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
            // If status is rejected, let's reset it to pending
            const [updatedFollow] = await db
                .update(follows)
                .set({ status: "pending", createdAt: new Date() })
                .where(
                    and(
                        eq(follows.followerId, followerId),
                        eq(follows.followingId, followingId)
                    )
                )
                .returning();

            // Clear follower A's feed cache
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

        // Clear follower A's feed cache
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
                    eq(follows.status, "pending")
                )
            );

        return pending;
    }

    async acceptFollowRequest(
        followingId: string,
        followerId: string,
        encryptedFeedKey: string
    ) {
        const [followReq] = await db
            .select()
            .from(follows)
            .where(
                and(
                    eq(follows.followerId, followerId),
                    eq(follows.followingId, followingId),
                    eq(follows.status, "pending")
                )
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
                    eq(follows.followingId, followingId)
                )
            )
            .returning();

        // Clear follower A's feed cache since they can now see B's posts
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
                    eq(follows.status, "pending")
                )
            );

        if (!followReq) {
            throw new NotFoundException("Pending follow request not found");
        }

        const [updatedFollow] = await db
            .update(follows)
            .set({
                status: "rejected",
            })
            .where(
                and(
                    eq(follows.followerId, followerId),
                    eq(follows.followingId, followingId)
                )
            )
            .returning();

        // Clear follower A's feed cache
        this.cacheService.deletePattern(`feed:${followerId}:`);

        return {
            message: "Follow request rejected",
            follow: updatedFollow,
        };
    }

    async unfollowUser(followerId: string, followingId: string) {
        const [follow] = await db
            .select()
            .from(follows)
            .where(
                and(
                    eq(follows.followerId, followerId),
                    eq(follows.followingId, followingId)
                )
            );

        if (!follow) {
            throw new NotFoundException("Follow relationship not found");
        }

        await db
            .delete(follows)
            .where(
                and(
                    eq(follows.followerId, followerId),
                    eq(follows.followingId, followingId)
                )
            );

        // Clear follower A's feed cache
        this.cacheService.deletePattern(`feed:${followerId}:`);

        return {
            message: "Unfollowed successfully",
        };
    }
}
