import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

import { PaginationMeta } from './paginated-response.dto';

/**
 * Documents a `PaginatedResponse<Model>` envelope (`{ data: Model[], meta }`) in OpenAPI.
 * Use on any list endpoint that returns `PaginatedResponse`:
 *
 *   @ApiPaginatedResponse(User)
 *   findAll() { ... }
 */
export const ApiPaginatedResponse = <TModel extends Type>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(PaginationMeta, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMeta) },
        },
      },
    }),
  );
