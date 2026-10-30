import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiResponse, JwtPayload, UserDto } from '@bidstream/contracts';
import { UsersService } from '../users/users.service.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @SwaggerResponse({ status: 201, description: 'User successfully registered' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<{ user: unknown; accessToken: string }>> {
    const { user, accessToken, refreshToken } = await this.authService.register(dto);
    this.setRefreshTokenCookie(res, refreshToken);
    return {
      success: true,
      data: { user, accessToken },
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user with credentials' })
  @SwaggerResponse({ status: 200, description: 'User successfully authenticated' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<{ user: unknown; accessToken: string }>> {
    const { user, accessToken, refreshToken } = await this.authService.login(dto);
    this.setRefreshTokenCookie(res, refreshToken);
    return {
      success: true,
      data: { user, accessToken },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate and refresh access token via refresh token' })
  @SwaggerResponse({ status: 200, description: 'Tokens successfully refreshed' })
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<{ user: UserDto; accessToken: string }>> {
    this.verifyOrigin(req);

    const token = req.cookies?.refresh_token || dto.refreshToken;
    if (!token) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const { user, accessToken, refreshToken } = await this.authService.refreshTokens(token);
    this.setRefreshTokenCookie(res, refreshToken);
    return {
      success: true,
      data: { user, accessToken },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log out current session and revoke refresh token' })
  @SwaggerResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @CurrentUser('sub') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<{ message: string }>> {
    const token = req.cookies?.refresh_token;
    await this.authService.logout(userId, token);
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      path: '/',
    });
    return {
      success: true,
      data: { message: 'Logged out successfully' },
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get profile of current authenticated user' })
  @SwaggerResponse({ status: 200, description: 'Current user profile' })
  async me(@CurrentUser() user: JwtPayload): Promise<ApiResponse<unknown>> {
    const profile = await this.usersService.findById(user.sub);
    return {
      success: true,
      data: profile,
    };
  }

  private verifyOrigin(req: Request) {
    const origin = req.headers['origin'] as string | undefined;
    const referer = req.headers['referer'] as string | undefined;

    let requestOrigin = origin;
    if (!requestOrigin && referer) {
      try {
        requestOrigin = new URL(referer).origin;
      } catch {
        // Ignore unparseable referer
      }
    }

    if (requestOrigin) {
      const allowedConfig = this.configService.get<string>('CORS_ORIGIN', 'http://localhost:5173');
      const allowedOrigins = allowedConfig
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

      if (!allowedOrigins.includes(requestOrigin)) {
        throw new UnauthorizedException(
          `Request origin '${requestOrigin}' is not authorized for refresh token rotation`,
        );
      }
    }
  }

  private setRefreshTokenCookie(res: Response, token: string) {
    res.cookie('refresh_token', token, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }
}
