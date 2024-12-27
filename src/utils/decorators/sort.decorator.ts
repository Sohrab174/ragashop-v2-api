import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { underscoreToCamelCase } from '../index';

/**
 * ?sort=created_at:desc
 * @Sort('created_at:desc')
 * [ { createdAt: 'DESC' } ]
 *
 * ?sort=updated_at:asc
 * @Sort('updated_at:asc') OR @Sort('updated_at')
 * [ { updatedAt: 'ASC' } ]
 *
 * ?sort=updated_at:asc,created_at:desc
 * @Sort('updated_at:asc,created_at:desc')
 * [ { updatedAt: 'ASC' }, { createdAt: 'DESC' } ]
 */
export const Sort = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();

    const sortsQuery = request.query?.sort || data;
    if (!sortsQuery) return null;

    const sortList = [];

    const sorts = sortsQuery.split(',');
    sorts.forEach((sortQuery) => {
      const sort = sortQuery.split(':');

      const field = underscoreToCamelCase(sort[0]);
      const orderBy = sort[1] || 'asc';

      sortList.push({ field, dir: orderBy.toUpperCase() });
    });

    return sortList;
  },
);
