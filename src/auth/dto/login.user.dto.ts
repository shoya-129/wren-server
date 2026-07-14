import { IsNotEmpty, IsString } from "class-validator";

export class LoginUser {
    @IsNotEmpty({ message: "Username or email is required" })
    @IsString({ message: "Username or email must be a string" })
    identifier: string;

    @IsNotEmpty({ message: "Password is required" })
    @IsString({ message: "Password must be a string" })
    password: string;

    @IsString({ message: "Push token must be a string" })
    pushToken?: string;
}
