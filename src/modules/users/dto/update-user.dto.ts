import { PartialType } from '@nestjs/swagger';

import { CreateUserDto } from './create-user.dto';

/** All fields optional — PATCH semantics. */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
