import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { UserService } from "./user.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/interfaces/authenticated-request.interface";

@Controller("user")
@UseGuards(JwtAuthGuard)
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Get("profile")
    getProfile(@CurrentUser() user: AuthenticatedUser) {
        return this.userService.getProfile(user.sub);
    }

    @Get("all")
    getAllUsers() {
        return this.userService.getAllUsers();
    }

    @Get("follow/pending")
    getPendingFollowRequests(@CurrentUser() user: AuthenticatedUser) {
        return this.userService.getPendingFollowRequests(user.sub);
    }

    @Post("follow/accept")
    acceptFollowRequest(
        @CurrentUser() user: AuthenticatedUser,
        @Body() body: { followerId: string; encryptedFeedKey: string }
    ) {
        return this.userService.acceptFollowRequest(
            user.sub,
            body.followerId,
            body.encryptedFeedKey
        );
    }

    @Post("follow/reject")
    rejectFollowRequest(
        @CurrentUser() user: AuthenticatedUser,
        @Body() body: { followerId: string }
    ) {
        return this.userService.rejectFollowRequest(user.sub, body.followerId);
    }

    @Post("follow/:id")
    followUser(@CurrentUser() user: AuthenticatedUser, @Param("id") followingId: string) {
        return this.userService.followUser(user.sub, followingId);
    }

    @Post("unfollow/:id")
    unfollowUser(@CurrentUser() user: AuthenticatedUser, @Param("id") followingId: string) {
        return this.userService.unfollowUser(user.sub, followingId);
    }
}
