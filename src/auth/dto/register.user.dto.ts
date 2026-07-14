import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class RegisterDto {
    @IsNotEmpty({ message: "Username is required" })
    @IsString({ message: "Username must be a string" })
    username: string;

    @IsNotEmpty({ message: "Email is required" })
    @IsEmail({}, { message: "Email must be a valid email address" })
    email: string;

    @IsNotEmpty({ message: "Password is required" })
    @IsString({ message: "Password must be a string" })
    password: string;

    @IsNotEmpty({ message: "Encrypted private key is required" })
    @IsString({ message: "Encrypted private key must be a string" })
    encryptedPrivateKey: string;

    @IsNotEmpty({ message: "Encrypted feed key is required" })
    @IsString({ message: "Encrypted feed key must be a string" })
    encryptedFeedKey: string;

    @IsNotEmpty({ message: "Salt is required" })
    @IsString({ message: "Salt must be a string" })
    salt: string;

    @IsNotEmpty({ message: "Public key is required" })
    @IsString({ message: "Public key must be a string" })
    publicKey: string;

    @IsOptional()
    @IsString({ message: "Push token must be a string" })
    pushToken?: string;
}
