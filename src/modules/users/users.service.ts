import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PaginatedResponse } from '@/common/dto/paginated-response.dto';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

/**
 * Reference service backed by an in-memory store.
 * Swap the Map for a repository (TypeORM/Prisma/Drizzle) when you add a DB —
 * the controller and DTOs stay unchanged.
 */
@Injectable()
export class UsersService {
  private readonly store = new Map<string, User>();

  create(dto: CreateUserDto): User {
    const exists = [...this.store.values()].some((u) => u.email === dto.email);
    if (exists) {
      throw new ConflictException(`User with email "${dto.email}" already exists`);
    }

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email: dto.email,
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    };

    this.store.set(user.id, user);
    return user;
  }

  findAll(query: PaginationQueryDto): PaginatedResponse<User> {
    const all = [...this.store.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const page = all.slice(query.offset, query.offset + query.limit);
    return new PaginatedResponse(page, all.length, query.page, query.limit);
  }

  findOne(id: string): User {
    const user = this.store.get(id);
    if (!user) {
      throw new NotFoundException(`User "${id}" not found`);
    }
    return user;
  }

  update(id: string, dto: UpdateUserDto): User {
    const user = this.findOne(id);
    const updated: User = { ...user, ...dto, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    if (!this.store.delete(id)) {
      throw new NotFoundException(`User "${id}" not found`);
    }
  }
}
