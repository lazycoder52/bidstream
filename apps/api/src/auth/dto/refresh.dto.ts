import { createZodDto } from 'nestjs-zod';
import { RefreshTokenDtoSchema } from '@bidstream/contracts';

export class RefreshTokenDto extends createZodDto(RefreshTokenDtoSchema) {}
