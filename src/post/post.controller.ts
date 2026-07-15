import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Header,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { CreatePostDto } from "./dto/create-post.dto";
import { ReportPostDto } from "./dto/report-post.dto";
import { PostService } from "./post.service";

@Controller("posts")
@UseGuards(JwtAuthGuard)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  uploadFile(@UploadedFile() file: any) {
    return this.postService.uploadMedia(file);
  }

  @Post()
  create(
    @CurrentUser("sub") uid: string,
    @Body() createPostDto: CreatePostDto,
  ) {
    return this.postService.createPost(uid, createPostDto);
  }

  @Get("feed")
  @Header("Cache-Control", "public, max-age=5, stale-while-revalidate=5")
  @Header("Vary", "Authorization")
  getFeed(
    @CurrentUser("sub") uid: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.postService.getFeed(uid, pageNum, limitNum);
  }

  @Post(":id/like")
  like(@CurrentUser("sub") uid: string, @Param("id") postId: string) {
    return this.postService.toggleLike(postId, uid);
  }

  @Post(":id/dislike")
  dislike(@CurrentUser("sub") uid: string, @Param("id") postId: string) {
    return this.postService.toggleDislike(postId, uid);
  }

  @Post(":id/repost")
  repost(@CurrentUser("sub") uid: string, @Param("id") postId: string) {
    return this.postService.toggleRepost(postId, uid);
  }

  @Post(":id/report")
  reportPost(
    @CurrentUser("sub") uid: string,
    @Param("id") postId: string,
    @Body() reportPostDto: ReportPostDto,
  ) {
    return this.postService.reportPost(postId, uid, reportPostDto);
  }

  @Get(":id")
  getPost(@CurrentUser("sub") uid: string, @Param("id") postId: string) {
    return this.postService.getPost(postId, uid);
  }

  @Get(":id/replies")
  getReplies(@CurrentUser("sub") uid: string, @Param("id") postId: string) {
    return this.postService.getReplies(postId, uid);
  }

  @Post(":id/comment")
  comment(
    @CurrentUser("sub") uid: string,
    @Param("id") postId: string,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.postService.createComment(postId, uid, createCommentDto);
  }

  @Delete(":id")
  deletePost(@CurrentUser("sub") uid: string, @Param("id") postId: string) {
    return this.postService.deletePost(postId, uid);
  }
}
