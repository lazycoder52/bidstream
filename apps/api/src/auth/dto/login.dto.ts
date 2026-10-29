import { createZodDto } from 'nestjs-zod';
import { LoginDtoSchema } from '@bidstream/contracts';

export class LoginDto extends createZodDto(LoginDtoSchema) {}
