# TypeScript

## Type Safety

**Avoid type assertions (`as`)** — prefer type-safe alternatives:

- Type guards: `item is Type`
- Type narrowing: `in`, `typeof`, `instanceof`
- Discriminated unions with literal types
- Generics with constraints
- Only use `as` when unavoidable: `as const`, `as unknown as Type`

**Reuse types smartly:**

- Extract function parameter types: `Parameters<typeof function>[0]`.
- Keep only used props in interfaces — never add fields speculatively.
- Use `Partial<T>`, `Pick<T, K>`, `Omit<T, K>` instead of re-declaring shapes.
- Prefer `import type { ... }` for type-only imports (enforced by `consistent-type-imports`).

## Strictness

The repo runs with `strict: true` plus `noImplicitReturns`, `noImplicitOverride`. No `any` — `no-explicit-any` is an ESLint error.

## NestJS Specifics

- DTOs are classes (not interfaces) — required for `class-validator` and `class-transformer`.
- Use `@ApiProperty()` from `@nestjs/swagger` on DTO fields for auto-documentation.
- Inject services via constructor; never instantiate manually.
- For paginated list endpoints, return `PaginatedResponse<T>` and document with `@ApiPaginatedResponse(Model)`.
