import { IsIn, IsInt, IsOptional, Min } from "class-validator";

export class UpdateAccountStatusDto {
    @IsIn(["active", "suspended", "banned"], {
        message: "Status must be active, suspended, or banned",
    })
    status: "active" | "suspended" | "banned";

    @IsOptional()
    @IsInt({ message: "suspensionDays must be an integer" })
    @Min(1, { message: "suspensionDays must be at least 1 day" })
    suspensionDays?: number;
}
