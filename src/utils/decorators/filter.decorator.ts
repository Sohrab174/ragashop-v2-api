import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { underscoreToCamelCase } from '../index';

const comparisonOperatorSign = {
  eq: '=',
  ne: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};

/**
 * Query string
 *
 * ?price=100
 * ?price=lte:200
 * ?price=gte:50
 * ?price=lt:100
 * ?price=gt:20
 * ?price=gt:20[and]lt:100
 *
 * ?status=inactive
 * ?status=ne:active
 *
 * ?first_name=like:oliver
 * ?first_name=in:oliver,sara
 */

/**
 * Usage e.g.
 *
 * @Filter([
 *   'price',
 *   ['affected_id', 'user_id'],
 *   'status,
 * ])
 *
 * Input:
 *  ...?price=gt:2[or]lte:10&affected_id=1&status=ne:active
 *
 * Return:
 * [
 *   { logicalOperator: 'OR', data:
 *     [
 *       { field: 'price', comparisonOperator: '>', value: 2 },
 *       { field: 'price', comparisonOperator: '<=', value: 10 },
 *     ]
 *   },
 *   { logicalOperator: 'AND', data: [{ field: 'userId', comparisonOperator: '=', value: 1 }] },
 *   { logicalOperator: 'AND', data: [{ field: 'status', comparisonOperator: '!=', value: 'active' }] },
 * ];
 */
export const Filter = createParamDecorator(
  (data: any[], ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();

    const filters = [];
    data.forEach((attr) => {
      let field;
      let fieldInDB;
      let dbFunction;

      if (typeof attr !== 'string') {
        // ['affected_id', 'user_id']
        field = attr[0];
        fieldInDB = attr[1];
        dbFunction = attr[2];
      } else {
        // 'price'
        field = attr;
        fieldInDB = attr;
        dbFunction = null;
      }

      const valueField = request.query[field];

      if (valueField) {
        let logicalOperator = 'and';
        if (valueField.indexOf('[or]') !== -1) {
          logicalOperator = 'or';
        }

        const values = valueField.split(`[${logicalOperator}]`); // gt:2[or]lte:10

        const filter = [];
        values.forEach((item) => {
          const valueAndOperator = item.split(':'); // gt:2

          let value = valueAndOperator[0];
          let comparisonOperator = 'eq'; // default operator
          if (valueAndOperator.length === 2) {
            comparisonOperator = valueAndOperator[0]; // ne | gt | ...
            value = valueAndOperator[1];
          }

          if (comparisonOperator === 'in') {
            value = value.split(',').map((v) => (/^\d+$/.test(v) ? +v : v));
          } else {
            value = /^\d+$/.test(value) ? +value : value; //  '2' -> 2
          }

          filter.push({
            field: underscoreToCamelCase(fieldInDB), // user_id -> userId
            comparisonOperator:
              comparisonOperatorSign[comparisonOperator] ||
              comparisonOperator.toUpperCase(),
            value,
            dbFunction,
          });
        });

        filters.push({
          logicalOperator: logicalOperator.toUpperCase(),
          data: filter,
        });
      }
    });

    return filters;
  },
);
