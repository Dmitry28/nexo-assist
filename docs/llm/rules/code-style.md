# Code Style

## Naming

- Descriptive variables with auxiliary verbs: `isLoading`, `hasError`, `hasPermission`.
- NestJS file conventions: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.dto.ts`, `*.entity.ts`, `*.filter.ts`, `*.guard.ts`, `*.interceptor.ts`.
- **Named exports** for all modules, services, utilities (no default exports except framework requirements).
- File names: kebab-case (`users.service.ts`).
- Classes: PascalCase (`UsersService`).
- Interfaces / type aliases: PascalCase (enforced via ESLint `naming-convention`).

## Constants

- Magic numbers and strings extracted to constants with descriptive names.
- Group related defaults into a `DEFAULTS` object (except booleans).

## Function Parameters

2+ parameters → object parameter:

```typescript
// ❌
function send(message: string, channel: string, retries: number) {}

// ✅
function send(params: { message: string; channel: string; retries: number }) {}
```

## NestJS Specifics

- One class per file.
- DTOs use `class-validator` decorators (`@IsString()`, `@IsEmail()`, etc.) and `@ApiProperty` for OpenAPI.
- Services contain business logic only — no HTTP concerns.
- Controllers handle HTTP only — delegate to services; throw NestJS exceptions (`NotFoundException`, …).
- Use `ConfigService.get('app.<key>', { infer: true })` — never `process.env` directly inside modules.
- Use the `@/*` path alias for intra-`src` imports across folders.

## Conditions

Extract non-trivial conditions into named boolean variables:

```typescript
// ❌
if (user.status === 'active' && user.subscription?.tier !== 'free' && !user.lockedAt) { … }

// ✅
const hasActivePaidAccess = user.status === 'active' && user.subscription?.tier !== 'free' && !user.lockedAt;
if (hasActivePaidAccess) { … }
```

## Comments

- Prefixes: `TODO`, `FIXME`, `NOTE` — **no other comment styles allowed**.
- Always in English.
- `TODO` and `FIXME` must include a priority `[H|M|L]` and clear description.
- Default to writing no comments — only add when the WHY is non-obvious (a hidden constraint, subtle invariant, workaround).
- Never narrate WHAT the code does (well-named identifiers do that).

Format:

```typescript
// NOTE: explanation of non-obvious logic or context
// TODO: what needs to be done [H|M|L]
// FIXME: what is broken and why [H|M|L]
```

## General

- Remove dead code when noticed.
