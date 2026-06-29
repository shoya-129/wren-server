import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.user.dto";
import { LoginUser } from "./dto/login.user.dto";

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post("register")
    register(@Body() registerUserDto: RegisterDto) {
        const result = this.authService.registerUser(registerUserDto);
        return result;
    }

    @Post("login")
    login(@Body() loginUserDto: LoginUser) {
        const result = this.authService.loginUser(loginUserDto);
        return result;
    }
}

