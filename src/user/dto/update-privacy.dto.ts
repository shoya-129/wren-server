import { IsBoolean, IsIn, IsOptional } from "class-validator";

export class UpdatePrivacyDto {
    @IsOptional()
    @IsIn(["public", "followers"], {
        message: "profileVisibility must be public or followers",
    })
    profileVisibility?: "public" | "followers";

    @IsOptional()
    @IsBoolean({ message: "allowFollowRequests must be a boolean" })
    allowFollowRequests?: boolean;
}
