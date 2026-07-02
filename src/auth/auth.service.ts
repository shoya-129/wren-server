import { Injectable } from "@nestjs/common";
import { UserService } from "../user/user.service";
import { RegisterDto } from "./dto/register.user.dto";
import { LoginUser } from "./dto/login.user.dto";
import bcrypt from "bcrypt";
import { db } from "../db";
import { users } from "../db/schema";
import { eq, or } from "drizzle-orm";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class AuthService {
    constructor(
        private readonly userService: UserService,
        private jwtService: JwtService,
    ) {}

    async registerUser(registerUserDto: RegisterDto) {
        const existingUser = await db
            .select()
            .from(users)
            .where(
                eq(users.email, registerUserDto.email),
            );

        if (existingUser.length > 0) {
            return {
                message: "User already exist",
                statusCode: 422,
            };
        }

        const saltRounds = 12;
        const hash = await bcrypt.hash(registerUserDto.password, saltRounds);

        const [createdUser] = await this.userService.createUser({
            ...registerUserDto,
            password: hash,
        });

        const jwtPayload = {
            username: createdUser.username,
            sub: createdUser.uid,
        };
        const accessToken = await this.jwtService.signAsync(jwtPayload, {
            expiresIn: "7d",
            secret: process.env.JWT_SECRET,
        });

        const { password, ...rest } = createdUser;
        if (password) {
            // Noop to satisfy unused variable rule
        }
        return {
            user: rest,
            accessToken,
            message: "User created successfully",
            statusCode: 201,
        };
    }

    async loginUser(loginUserDto: LoginUser) {
        const [user] = await db
            .select()
            .from(users)
            .where(
                or(
                    eq(users.username, loginUserDto.identifier),
                    eq(users.email, loginUserDto.identifier),
                ),
            );

        if (!user) {
            return {
                message: "Invalid username/email or password",
                statusCode: 401,
            };
        }

        const isPasswordValid = await bcrypt.compare(
            loginUserDto.password,
            user.password,
        );

        if (!isPasswordValid) {
            return {
                message: "Invalid username/email or password",
                statusCode: 401,
            };
        }

        const jwtPayload = { username: user.username, sub: user.uid };
        const accessToken = await this.jwtService.signAsync(jwtPayload, {
            expiresIn: "7d",
            secret: process.env.JWT_SECRET,
        });

        const { password, ...rest } = user;
        if (password) {
            // Noop to satisfy unused variable rule
        }
        return {
            user: rest,
            accessToken,
            message: "Logged in successfully",
            statusCode: 200,
        };
    }
}
