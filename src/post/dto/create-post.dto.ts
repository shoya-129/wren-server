import { IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";

export class CreatePostDto {
    @IsNotEmpty({ message: "Encrypted content is required" })
    @IsString({ message: "Encrypted content must be a string" })
    encryptedContent: string;

    @IsOptional()
    @IsString({ message: "Encrypted media must be a string" })
    encryptedMedia?: string;

    @IsOptional()
    @IsUUID("all", { message: "replyTo must be a valid UUID" })
    replyTo?: string;

    @IsOptional()
    @IsUUID("all", { message: "quoteTo must be a valid UUID" })
    quoteTo?: string;

    @IsOptional()
    @IsString({ message: "Visibility must be a string" })
    visibility?: string;
}
