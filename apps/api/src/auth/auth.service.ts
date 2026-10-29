import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UsersService } from '../users/users.service.js';
import { RedisService } from '../redis/redis.service.js';
import { JwtPayload, UserDto } from '@bidstream/contracts';

@Injectable()
export class AuthService {
  private readonly refreshTtlSeconds = 7 * 24 * 60 * 60; // 7 days

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async register(
    dto: RegisterDto,
  ): Promise<{ user: UserDto; accessToken: string; refreshToken: string }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('A user with this email address already exists');
    }

    const passwordHash = await argon2.hash(dto.password, {
      memoryCost: 65536,
      timeCost: 3,
    });

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
      role: dto.role,
    });

    const formattedUser: UserDto = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };

    const tokens = await this.generateTokens(formattedUser);
    return { user: formattedUser, ...tokens };
  }

  async login(
    dto: LoginDto,
  ): Promise<{ user: UserDto; accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await argon2.verify(user.passwordHash, dto.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const formattedUser: UserDto = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };

    const tokens = await this.generateTokens(formattedUser);
    return { user: formattedUser, ...tokens };
  }

  async refreshTokens(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Check if token exists in Redis
    const redis = this.redisService.getClient();
    const redisKey = `refresh_token:${payload.sub}:${refreshToken}`;
    const exists = await redis.get(redisKey);

    if (!exists) {
      throw new UnauthorizedException('Refresh token has been revoked or expired');
    }

    // Rotate: delete previous token from Redis
    await redis.del(redisKey);

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User account no longer exists');
    }

    const formattedUser: UserDto = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };

    return this.generateTokens(formattedUser);
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    const redis = this.redisService.getClient();
    if (refreshToken) {
      await redis.del(`refresh_token:${userId}:${refreshToken}`);
    } else {
      const keys = await redis.keys(`refresh_token:${userId}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  }

  private async generateTokens(
    user: UserDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessSecret = this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');

    const accessToken = this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(
      { ...payload, jti: uuidv4() },
      {
        secret: refreshSecret,
        expiresIn: '7d',
      },
    );

    const redis = this.redisService.getClient();
    await redis.set(
      `refresh_token:${user.id}:${refreshToken}`,
      'valid',
      'EX',
      this.refreshTtlSeconds,
    );

    return { accessToken, refreshToken };
  }
}
