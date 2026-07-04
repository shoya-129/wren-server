import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PostController } from "./post.controller";
import { PostService } from "./post.service";

@Module({
  controllers: [PostController],
  providers: [PostService, JwtAuthGuard],
})
export class PostModule {}
