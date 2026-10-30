import { z } from 'zod';
import {
  AuthResponseSchema,
  AuthResponse,
  LoginDto,
  RegisterDto,
  UserDtoSchema,
  UserDto,
  AuctionDtoSchema,
  AuctionDto,
  CreateAuctionDto,
  UpdateAuctionDto,
  AuctionListQuery,
  PlaceBidDto,
  PlaceBidResultSchema,
  PlaceBidResult,
  BidDtoSchema,
  BidDto,
  createPaginatedResponseSchema,
  ApiErrorResponseSchema,
} from '@bidstream/contracts';

export class ApiClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errors?: Array<{ field?: string; message: string }>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
  schema?: z.ZodTypeAny;
}

let getAccessToken: () => string | null = () => null;
let onTokenExpired: (() => Promise<string | null>) | null = null;

export function configureApiAuth(
  tokenGetter: () => string | null,
  refreshHandler?: () => Promise<string | null>,
) {
  getAccessToken = tokenGetter;
  if (refreshHandler) onTokenExpired = refreshHandler;
}

export async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { schema, idempotencyKey, headers = {}, ...rest } = options;

  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('Content-Type') && rest.body) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const token = getAccessToken();
  if (token && !requestHeaders.has('Authorization')) {
    requestHeaders.set('Authorization', `Bearer ${token}`);
  }

  if (idempotencyKey) {
    requestHeaders.set('Idempotency-Key', idempotencyKey);
  }

  let response = await fetch(`${API_BASE}${endpoint}`, {
    ...rest,
    headers: requestHeaders,
    credentials: 'include', // sends refresh token cookie
  });

  // Handle 401 Unauthorized with token refresh retry
  if (response.status === 401 && onTokenExpired) {
    const newToken = await onTokenExpired();
    if (newToken) {
      requestHeaders.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...rest,
        headers: requestHeaders,
        credentials: 'include',
      });
    }
  }

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = null;
    }

    const parsedError = ApiErrorResponseSchema.safeParse(errorData);
    if (parsedError.success) {
      throw new ApiClientError(
        parsedError.data.statusCode,
        parsedError.data.message,
        parsedError.data.errors,
        parsedError.data.requestId,
      );
    }

    throw new ApiClientError(
      response.status,
      response.statusText || 'An unexpected API error occurred',
    );
  }

  const rawJson = await response.json();

  const payload =
    rawJson &&
    typeof rawJson === 'object' &&
    'success' in rawJson &&
    'data' in rawJson &&
    (rawJson as Record<string, unknown>).success === true
      ? (rawJson as Record<string, unknown>).data
      : rawJson;

  if (schema) {
    let validationResult = schema.safeParse(payload);
    if (!validationResult.success && payload !== rawJson) {
      const rawValidation = schema.safeParse(rawJson);
      if (rawValidation.success) {
        validationResult = rawValidation;
      }
    }

    if (!validationResult.success) {
      console.error(
        `[Contracts Validation Error] Schema mismatch on ${endpoint}:`,
        validationResult.error,
      );
      throw new Error(
        `API response validation failed on ${endpoint}: ${validationResult.error.message}`,
      );
    }
    return validationResult.data as T;
  }

  return payload as T;
}

export const PaginatedAuctionsSchema = createPaginatedResponseSchema(AuctionDtoSchema);

export const authApi = {
  login: async (dto: LoginDto): Promise<AuthResponse> => {
    return request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(dto),
      schema: AuthResponseSchema,
    });
  },

  register: async (dto: RegisterDto): Promise<AuthResponse> => {
    return request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(dto),
      schema: AuthResponseSchema,
    });
  },

  refresh: async (): Promise<AuthResponse> => {
    return request<AuthResponse>('/auth/refresh', {
      method: 'POST',
      schema: AuthResponseSchema,
    });
  },

  getProfile: async (): Promise<UserDto> => {
    return request<UserDto>('/users/me', {
      method: 'GET',
      schema: UserDtoSchema,
    });
  },
};

export const auctionsApi = {
  list: async (
    query: Partial<AuctionListQuery> = {},
  ): Promise<z.infer<typeof PaginatedAuctionsSchema>> => {
    const params = new URLSearchParams();
    if (query.page) params.set('page', query.page.toString());
    if (query.limit) params.set('limit', query.limit.toString());
    if (query.status) params.set('status', query.status);
    if (query.search) params.set('search', query.search);
    if (query.sellerId) params.set('sellerId', query.sellerId);
    if (query.minPrice !== undefined) params.set('minPrice', query.minPrice.toString());
    if (query.maxPrice !== undefined) params.set('maxPrice', query.maxPrice.toString());

    const qs = params.toString();
    const endpoint = `/auctions${qs ? `?${qs}` : ''}`;
    return request<z.infer<typeof PaginatedAuctionsSchema>>(endpoint, {
      method: 'GET',
      schema: PaginatedAuctionsSchema,
    });
  },

  get: async (id: string): Promise<AuctionDto> => {
    return request<AuctionDto>(`/auctions/${id}`, {
      method: 'GET',
      schema: AuctionDtoSchema,
    });
  },

  create: async (dto: CreateAuctionDto): Promise<AuctionDto> => {
    return request<AuctionDto>('/auctions', {
      method: 'POST',
      body: JSON.stringify(dto),
      schema: AuctionDtoSchema,
    });
  },

  update: async (id: string, dto: UpdateAuctionDto): Promise<AuctionDto> => {
    return request<AuctionDto>(`/auctions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
      schema: AuctionDtoSchema,
    });
  },

  placeBid: async (
    auctionId: string,
    dto: PlaceBidDto,
    idempotencyKey?: string,
  ): Promise<PlaceBidResult> => {
    return request<PlaceBidResult>(`/auctions/${auctionId}/bids`, {
      method: 'POST',
      body: JSON.stringify(dto),
      idempotencyKey,
      schema: PlaceBidResultSchema,
    });
  },

  getBids: async (auctionId: string): Promise<BidDto[]> => {
    return request<BidDto[]>(`/auctions/${auctionId}/bids`, {
      method: 'GET',
      schema: z.array(BidDtoSchema),
    });
  },
};
