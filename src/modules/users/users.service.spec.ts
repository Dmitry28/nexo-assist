import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  const newQuery = (overrides: Partial<PaginationQueryDto> = {}): PaginationQueryDto =>
    Object.assign(new PaginationQueryDto(), { page: 1, limit: 20 }, overrides);

  it('creates a user', () => {
    const user = service.create({ email: 'ada@example.com', name: 'Ada' });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('ada@example.com');
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('rejects duplicate emails', () => {
    service.create({ email: 'dup@example.com', name: 'One' });

    expect(() => service.create({ email: 'dup@example.com', name: 'Two' })).toThrow(
      ConflictException,
    );
  });

  it('throws when a user is missing', () => {
    expect(() => service.findOne('missing')).toThrow(NotFoundException);
  });

  it('paginates results', () => {
    for (let i = 0; i < 5; i++) {
      service.create({ email: `u${i}@example.com`, name: `User ${i}` });
    }

    const result = service.findAll(newQuery({ page: 1, limit: 2 }));

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(5);
    expect(result.meta.totalPages).toBe(3);
  });

  it('updates a user', () => {
    const created = service.create({ email: 'old@example.com', name: 'Old' });
    const updated = service.update(created.id, { name: 'New' });

    expect(updated.name).toBe('New');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime());
  });

  it('removes a user', () => {
    const created = service.create({ email: 'bye@example.com', name: 'Bye' });
    service.remove(created.id);

    expect(() => service.findOne(created.id)).toThrow(NotFoundException);
  });
});
