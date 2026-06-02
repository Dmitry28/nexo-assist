import { ApiProperty } from '@nestjs/swagger';

/**
 * Domain/representation model returned to clients.
 * When you add a database, keep this as the API-facing shape and map
 * the persistence entity into it (never leak ORM internals through the API).
 */
export class User {
  @ApiProperty({ example: '3f1a7c9e-2b4d-4e6f-8a01-9c2d3e4f5a6b' })
  id: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name: string;

  @ApiProperty({ example: '2026-06-03T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-03T00:00:00.000Z' })
  updatedAt: Date;
}
