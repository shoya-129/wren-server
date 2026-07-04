import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class ReportPostDto {
    @IsNotEmpty({ message: "Reason is required" })
    @IsString({ message: "Reason must be a string" })
    reason: string;

    @IsOptional()
    @IsString({ message: "Details must be a string" })
    details?: string;
}
