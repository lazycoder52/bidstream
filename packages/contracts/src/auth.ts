import { z } from 'zod';

export const UserRoleSchema = z.enum(['BUYER', 'SELLER', 'ADMIN']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const RegisterDtoSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  role: UserRoleSchema.default('BUYER'),
});

export type RegisterDto = z.infer<typeof RegisterDtoSchema>;

export const LoginDtoSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginDto = z.infer<typeof LoginDtoSchema>;

export const RefreshTokenDtoSchema = z.object({
  refreshToken: z.string().optional(),
});

export type RefreshTokenDto = z.infer<typeof RefreshTokenDtoSchema>;

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: UserRoleSchema,
  createdAt: z.string().datetime(),
});

export type UserDto = z.infer<typeof UserDtoSchema>;

export const AuthResponseSchema = z.object({
  user: UserDtoSchema,
  accessToken: z.string(),
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleSchema,
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type JwtPayload = z.infer<typeof JwtPayloadSchema>;
