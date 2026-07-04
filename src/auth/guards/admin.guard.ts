import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { AuthenticatedRequest } from "../interfaces/authenticated-request.interface";

@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

        if (!request.user?.isAdmin) {
            throw new ForbiddenException("Admin access required");
        }

        return true;
    }
}
