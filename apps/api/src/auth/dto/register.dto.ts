import { createZodDto } from 'nestjs-zod';
import { RegisterDtoSchema } from '@bidstream/contracts';

export class RegisterDto extends createZodDto(RegisterDtoSchema) {}
