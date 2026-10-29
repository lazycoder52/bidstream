import { createZodDto } from 'nestjs-zod';
import { UpdateAuctionDtoSchema } from '@bidstream/contracts';

export class UpdateAuctionDto extends createZodDto(UpdateAuctionDtoSchema) {}
