import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthController } from './auth/auth.controller';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import { UserModule } from './user/user.module';
import { UserService } from './user/user.service';
import { JwtService } from "@nestjs/jwt";

@Module({
  imports: [AuthModule, UserModule],
  controllers: [AppController, AuthController],
  providers: [AppService, AuthService, UserService, JwtService],
})
export class AppModule {}
