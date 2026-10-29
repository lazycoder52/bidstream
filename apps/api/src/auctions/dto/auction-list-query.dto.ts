import { createZodDto } from 'nestjs-zod';
import { AuctionListQuerySchema } from '@bidstream/contracts';

export class AuctionListQueryDto extends createZodDto(AuctionListQuerySchema) {}
