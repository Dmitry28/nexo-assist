# Code Style

## Naming

- Descriptive variables with auxiliary verbs: `isLoading`, `hasError`, `hasPermission`.
- Boolean flags follow **verb + noun** order with the resource explicit (`isUserCreationAllowed`), never noun + verb or a bare verb without a resource (`isCreating`).
- NestJS file conventions: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.dto.ts`, `*.entity.ts`, `*.filter.ts`, `*.guard.ts`, `*.interceptor.ts`.
- **Named exports** for all modules, services, utilities (no default exports except framework requirements).
- File names: kebab-case (`users.service.ts`).
- Classes: PascalCase (`UsersService`).
- Interfaces / type aliases: PascalCase (enforced via ESLint `naming-convention`).

## Constants

- Magic numbers and strings extracted to constants with descriptive names.
- Group related defaults into a `DEFAULTS` object (except booleans).

## Function Parameters

3+ parameters, or any two adjacent same-typed/boolean arguments a call site could
swap silently → object parameter. Two clearly-distinct params stay positional
(`notify(chatId, text)`), as do pairs mirroring a platform API
(`withParam(url, key, value)` ~ `URLSearchParams.set`).

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
- Config: inject the typed `AppConfig` via `@Inject(configuration.KEY)` (see [architecture.md](architecture.md#config-access)) — never `process.env` or string-path `ConfigService.get()` inside modules.
- Use the `@/*` path alias for intra-`src` imports across folders.

## Conditions

Silent guards (`if (!x) return;` with no log or side effect) need a `//` comment explaining why the no-op is intentional — otherwise log it.

Extract non-trivial conditions into named boolean variables:

```typescript
// ❌
if (user.status === 'active' && user.subscription?.tier !== 'free' && !user.lockedAt) { … }

// ✅
const hasActivePaidAccess = user.status === 'active' && user.subscription?.tier !== 'free' && !user.lockedAt;
if (hasActivePaidAccess) { … }
```

## Comments

- Comments explain non-obvious WHY, never WHAT — well-named identifiers carry intent. Default to none.
- `NOTE:` flags non-obvious logic or technical behavior — a hidden constraint, subtle invariant, workaround, or surprising API behavior; also on a method/field whose name doesn't fully convey its meaning (e.g. `getSeen`).
- Plain `//` is fine for brief context (dominant style, e.g. `src/main.ts`, `src/app.module.ts`).
- `TODO` and `FIXME` mark actionable items and must include a priority `[H|M|L]` and clear description.
- Always in English.
- Never remove relevant existing comments.

Format:

```typescript
// Brief context.
// NOTE: non-obvious logic or technical behavior.
// TODO: what needs to be done [H|M|L]
// FIXME: what is broken and why [H|M|L]
```

## General

- Remove dead code when noticed (`npm run check:dead-code` finds unused files/exports/deps).
- No `eslint-disable` / `@ts-expect-error` without a `TODO [H|M|L]` — fix the root cause instead of suppressing.
