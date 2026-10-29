# ADR-005: Shared Monorepo Zod Contracts as Single Source of Truth

## Context

Full-stack TypeScript codebases frequently suffer from "contract drift": backend NestJS DTOs use `class-validator`, frontend React applications declare manual TypeScript interfaces or duplicate schemas, and WebSocket events have untyped or loosely typed payloads. Over time, subtle inconsistencies emerge (e.g., date formats, optional vs nullable fields, enum values), leading to silent runtime bugs.

## Considered Options

1. **Separate Schemas per Application**:
   - Backend defines DTOs via `class-validator` / `class-transformer`. Frontend defines schemas in Zod.
   - _Drawback_: Guaranteed drift as APIs evolve. No shared compile-time guarantees across workspace boundaries.
2. **OpenAPI / Swagger Code Generation**:
   - Generate TypeScript types from backend OpenAPI JSON schema at build time.
   - _Drawback_: Requires running backend to generate schema; brittle CI pipelines; lacks runtime validation on the frontend without heavy additional tooling.
3. **Dedicated Contracts Monorepo Package (`@bidstream/contracts`)**:
   - Build a shared package containing Zod schemas and inferred TypeScript types for:
     - All REST request DTOs and response envelopes.
     - All WebSocket client-to-server and server-to-client events.
     - Environment variable configuration schemas.
   - Built with `tsup` (generating ESM, CJS, and `.d.ts`).
   - Imported directly by `apps/api` (via `nestjs-zod`) and `apps/web` (via typed API client and form resolvers).

## Decision

We adopted a **Monorepo Shared Contracts Package (`packages/contracts`) using Zod**.

### Architecture:

- `packages/contracts/src/auth.ts`: Auth schemas (`RegisterDtoSchema`, `LoginDtoSchema`, `AuthResponseSchema`).
- `packages/contracts/src/auctions.ts`: Auction CRUD schemas, pagination, filter queries.
- `packages/contracts/src/bids.ts`: Bidding schemas (`PlaceBidDtoSchema`, `PlaceBidResultSchema`, `BidDtoSchema`).
- `packages/contracts/src/events.ts`: WebSocket typed payloads (`BidPlacedEventSchema`, `TimeSyncSchema`, etc.).
- `packages/contracts/src/common.ts`: Uniform error and pagination envelopes.

### Runtime Enforcement:

- **Backend**: `ZodValidationPipe` and `createZodDto` validate incoming payloads and generate OpenAPI specs without duplication.
- **Frontend**: The custom `api-client.ts` runs `.safeParse()` on every raw JSON response. If the backend response deviates from the contract, an informative `ApiClientError` is thrown, catching API regressions instantly.

## Consequences

- **Positive**: Absolute type safety across client and server; zero schema duplication; automated OpenAPI generation; contracts can be updated and verified with a single `npm run typecheck` across all workspaces.
- **Negative**: Monorepo builds require `packages/contracts` to be built prior to consumer applications; automated in root `npm run build` and CI pipeline.
