import { createZodDto } from 'nestjs-zod';
import { PlaceBidDtoSchema } from '@bidstream/contracts';

export class PlaceBidDto extends createZodDto(PlaceBidDtoSchema) {}
