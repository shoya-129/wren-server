import { Injectable } from "@nestjs/common";
import { RegisterDto } from "src/auth/dto/register.user.dto";
import { db } from "src/db";
import { users } from "src/db/schema";

@Injectable()
export class UserService {
    async createUser(registerUserDto: RegisterDto) {
        const newUser = await db
            .insert(users)
            .values(registerUserDto)
            .returning();

        return newUser;
    }
}
