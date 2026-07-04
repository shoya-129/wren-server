import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AdminGuard } from "../auth/guards/admin.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UpdateAccountStatusDto } from "./dto/update-account-status.dto";
import { UserService } from "./user.service";

@Controller("user")
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("profile")
  getOwnProfile(@CurrentUser("sub") uid: string) {
    return this.userService.getProfile(uid, uid);
  }

  @Get("profile/:id")
  getUserProfile(
    @CurrentUser("sub") viewerId: string,
    @Param("id") profileUserId: string,
  ) {
    return this.userService.getProfile(profileUserId, viewerId);
  }

  @Get("stats")
  getOwnStats(@CurrentUser("sub") uid: string) {
    return this.userService.getMyStats(uid);
  }

  @Get("stats/:id")
  getUserStats(@Param("id") uid: string) {
    return this.userService.getUserStats(uid);
  }

  @Patch("privacy")
  updatePrivacy(
    @CurrentUser("sub") uid: string,
    @Body() updatePrivacyDto: UpdatePrivacyDto,
  ) {
    return this.userService.updatePrivacy(uid, updatePrivacyDto);
  }

  @Get("all")
  getAllUsers(@Query("page") page?: string, @Query("limit") limit?: string) {
    const { pageNum, limitNum } = this.parsePagination(page, limit);
    return this.userService.getAllUsers(pageNum, limitNum);
  }

  @Get(":id/followers")
  getFollowers(
    @Param("id") uid: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const { pageNum, limitNum } = this.parsePagination(page, limit);
    return this.userService.getFollowers(uid, pageNum, limitNum);
  }

  @Get(":id/following")
  getFollowing(
    @Param("id") uid: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const { pageNum, limitNum } = this.parsePagination(page, limit);
    return this.userService.getFollowing(uid, pageNum, limitNum);
  }

  @Get("follow/pending")
  getPendingFollowRequests(@CurrentUser("sub") uid: string) {
    return this.userService.getPendingFollowRequests(uid);
  }

  @Post("follow/accept")
  acceptFollowRequest(
    @CurrentUser("sub") uid: string,
    @Body() body: { followerId: string; encryptedFeedKey: string },
  ) {
    return this.userService.acceptFollowRequest(
      uid,
      body.followerId,
      body.encryptedFeedKey,
    );
  }

  @Post("follow/reject")
  rejectFollowRequest(
    @CurrentUser("sub") uid: string,
    @Body() body: { followerId: string },
  ) {
    return this.userService.rejectFollowRequest(uid, body.followerId);
  }

  @Post("follow/revoke")
  revokeFollowerAccess(
    @CurrentUser("sub") uid: string,
    @Body() body: { followerId: string },
  ) {
    return this.userService.revokeAccess(uid, body.followerId);
  }

  @Post("follow/:id")
  followUser(
    @CurrentUser("sub") uid: string,
    @Param("id") followingId: string,
  ) {
    return this.userService.followUser(uid, followingId);
  }

  @Post("unfollow/:id")
  unfollowUser(
    @CurrentUser("sub") uid: string,
    @Param("id") followingId: string,
  ) {
    return this.userService.unfollowUser(uid, followingId);
  }

  @Patch("admin/:id/status")
  @UseGuards(AdminGuard)
  updateAccountStatus(
    @CurrentUser("sub") adminId: string,
    @Param("id") targetUserId: string,
    @Body() updateAccountStatusDto: UpdateAccountStatusDto,
  ) {
    return this.userService.updateAccountStatus(
      adminId,
      targetUserId,
      updateAccountStatusDto,
    );
  }

  @Delete("account")
  deleteAccount(@CurrentUser("sub") uid: string) {
    return this.userService.deleteAccount(uid);
  }

  private parsePagination(page?: string, limit?: string) {
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;

    return {
      pageNum: Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage,
      limitNum:
        Number.isNaN(parsedLimit) || parsedLimit < 1
          ? 20
          : Math.min(parsedLimit, 100),
    };
  }
}
