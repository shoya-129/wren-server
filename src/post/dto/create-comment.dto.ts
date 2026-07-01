import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateCommentDto {
    @IsNotEmpty({ message: "Encrypted content is required" })
    @IsString({ message: "Encrypted content must be a string" })
    encryptedContent: string;

    @IsOptional()
    @IsString({ message: "Encrypted media must be a string" })
    encryptedMedia?: string;
}
