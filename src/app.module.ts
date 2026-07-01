import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { PostModule } from './post/post.module';
import { CacheModule } from './cache/cache.module';

@Module({
  imports: [AuthModule, UserModule, PostModule, CacheModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
