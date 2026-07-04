import { Module } from "@nestjs/common";
import { AdminGuard } from "../auth/guards/admin.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  controllers: [UserController],
  providers: [UserService, JwtAuthGuard, AdminGuard],
  exports: [UserService],
})
export class UserModule {}
