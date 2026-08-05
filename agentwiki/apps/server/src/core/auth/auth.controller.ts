import { Controller, Post, Body, Logger, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuditService } from '../security/audit.service';
import { BusinessException } from '../filters/business-error';
import { CombinedAuthGuard } from './combined-auth.guard';
import { CurrentPrincipal } from './current-principal.decorator';

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

export class ChangeRequiredPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword: string;

  @IsString()
  @MinLength(8)
  confirmPassword: string;
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

  @Post('change-required-password')
  @UseGuards(CombinedAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changeRequiredPassword(
    @Body() dto: ChangeRequiredPasswordDto,
    @CurrentPrincipal() principal: any,
  ) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BusinessException('AUTH_PASSWORD_MISMATCH', 'Passwords do not match');
    }
    if (!principal.mustChangePassword) {
      throw new BusinessException('AUTH_INVALID_STATE', 'Password change not required');
    }
    return this.authService.changeRequiredPassword(principal.userId, dto.newPassword);
  }
}
