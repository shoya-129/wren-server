import { Injectable } from "@nestjs/common";
import { RegisterDto } from "../auth/dto/register.user.dto";
import { db } from "../db";
import { users } from "../db/schema";

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
