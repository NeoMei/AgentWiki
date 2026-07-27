import { Controller, Post, Body, Logger, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuditService } from '../security/audit.service';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;

}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    this.logger.log('Login attempt: ' + dto.email);
    try {
      const result = await this.authService.login(dto.email, dto.password);
      await this.audit.record({
        action: 'auth.login',
        outcome: 'success',
        actorUserId: result.user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return result;
    } catch (error) {
      await this.audit.record({
        action: 'auth.login',
        outcome: 'failure',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: { email: dto.email },
      });
      throw error;
    }
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    this.logger.log('Registration attempt: ' + dto.email);
    const result = await this.authService.register(dto.email, dto.password, dto.name);
    await this.audit.record({
      action: 'auth.register',
      outcome: 'success',
      actorUserId: result.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }
}
