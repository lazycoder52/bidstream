import { createZodDto } from 'nestjs-zod';
import { CreateAuctionDtoSchema } from '@bidstream/contracts';

export class CreateAuctionDto extends createZodDto(CreateAuctionDtoSchema) {}
