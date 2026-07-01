import { Controller, Get, Post, Body, UseGuards, Query, Param } from "@nestjs/common";
import { PostService } from "./post.service";
import { CreatePostDto } from "./dto/create-post.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/interfaces/authenticated-request.interface";

@Controller("posts")
@UseGuards(JwtAuthGuard)
export class PostController {
    constructor(private readonly postService: PostService) {}

    @Post()
    create(@CurrentUser() user: AuthenticatedUser, @Body() createPostDto: CreatePostDto) {
        return this.postService.createPost(user.sub, createPostDto);
    }

    @Get("feed")
    getFeed(
        @CurrentUser() user: AuthenticatedUser,
        @Query("page") page?: string,
        @Query("limit") limit?: string
    ) {
        const pageNum = page ? parseInt(page, 10) : 1;
        const limitNum = limit ? parseInt(limit, 10) : 20;
        return this.postService.getFeed(user.sub, pageNum, limitNum);
    }

    @Post(":id/like")
    like(@CurrentUser() user: AuthenticatedUser, @Param("id") postId: string) {
        return this.postService.toggleLike(postId, user.sub);
    }

    @Post(":id/dislike")
    dislike(@CurrentUser() user: AuthenticatedUser, @Param("id") postId: string) {
        return this.postService.toggleDislike(postId, user.sub);
    }

    @Post(":id/repost")
    repost(@CurrentUser() user: AuthenticatedUser, @Param("id") postId: string) {
        return this.postService.toggleRepost(postId, user.sub);
    }

    @Post(":id/comment")
    comment(
        @CurrentUser() user: AuthenticatedUser,
        @Param("id") postId: string,
        @Body() createCommentDto: CreateCommentDto
    ) {
        return this.postService.createComment(postId, user.sub, createCommentDto);
    }
}
