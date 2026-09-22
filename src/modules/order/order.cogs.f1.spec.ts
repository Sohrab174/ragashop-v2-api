import { OrderService } from './order.service';

import { OrderItemCogsStatus, ProfitabilityStatus } from '../finance/finance.types';

import { ProductCurrency } from '../product/entities/product.entity';



describe('OrderService F1 COGS recognition', () => {

  function buildService(items: any[], order: any = {}) {

    const financialEventService = {

      insertIdempotent: jest.fn().mockResolvedValue('inserted'),

    };

    const service = new OrderService(

      {} as any,

      {} as any,

      {} as any,

      {} as any,

      {} as any,

      {} as any,

      {} as any,

      {} as any,

      { unprocessableEntity: jest.fn() } as any,

      {} as any,

      {} as any,

      {} as any,

      {} as any,

      financialEventService as any,

    );



    const updates: any[] = [];

    const queryRunner: any = {

      manager: {

        findOne: jest.fn().mockResolvedValue({

          id: 1,

          fxRateToIrt: 3500,

          commercialCurrency: ProductCurrency.TRY,

          ...order,

        }),

        find: jest.fn().mockResolvedValue(items),

        createQueryBuilder: jest.fn(() => {

          const qb: any = {

            update: () => qb,

            set: (v: any) => {

              updates.push(v);

              return qb;

            },

            where: () => qb,

            execute: jest.fn().mockResolvedValue({ affected: 1 }),

          };

          return qb;

        }),

      },

    };



    return { service, queryRunner, financialEventService, updates };

  }



  it('emits ORDER_COGS_RECOGNIZED in IRT from OrderItem snapshots', async () => {

    const { service, queryRunner, financialEventService, updates } =

      buildService([

        {

          quantity: 2,

          unitLandedCostSnapshot: 2500,

          cogsStatus: OrderItemCogsStatus.captured,

          costCurrency: ProductCurrency.TRY,

        },

      ]);



    await service.recognizeCogsFromOrderItemSnapshots(1, queryRunner as any);



    expect(financialEventService.insertIdempotent).toHaveBeenCalledWith(

      queryRunner,

      expect.objectContaining({

        eventType: 'ORDER_COGS_RECOGNIZED',

        amount: 17_500_000,

        currency: ProductCurrency.IRT,

        amountIrt: 17_500_000,

        fxRateToIrt: 3500,

        idempotencyKey: 'opf:1:ORDER_COGS_RECOGNIZED',

      }),

    );

    expect(updates.some((u) => u.profitabilityStatus === ProfitabilityStatus.complete)).toBe(

      true,

    );

  });



  it('normalizes mixed TRY + IRT using Order FX snapshot', async () => {

    const { service, queryRunner, financialEventService } = buildService([

      {

        quantity: 1,

        unitLandedCostSnapshot: 1,

        cogsStatus: OrderItemCogsStatus.captured,

        costCurrency: ProductCurrency.TRY,

      },

      {

        quantity: 1,

        unitLandedCostSnapshot: 1000,

        cogsStatus: OrderItemCogsStatus.captured,

        costCurrency: ProductCurrency.IRT,

      },

    ]);



    await service.recognizeCogsFromOrderItemSnapshots(1, queryRunner as any);



    expect(financialEventService.insertIdempotent).toHaveBeenCalledWith(

      queryRunner,

      expect.objectContaining({

        amount: 4500,

        currency: ProductCurrency.IRT,

        amountIrt: 4500,

      }),

    );

  });



  it('USD cost keeps profitability incomplete and emits no aggregate COGS', async () => {

    const { service, queryRunner, financialEventService, updates } =

      buildService([

        {

          quantity: 1,

          unitLandedCostSnapshot: 10,

          cogsStatus: OrderItemCogsStatus.captured,

          costCurrency: ProductCurrency.USD,

        },

      ]);



    await service.recognizeCogsFromOrderItemSnapshots(1, queryRunner as any);



    expect(financialEventService.insertIdempotent).not.toHaveBeenCalled();

    expect(

      updates.some(

        (u) =>

          u.profitabilityStatus ===

          ProfitabilityStatus.incomplete_missing_cogs,

      ),

    ).toBe(true);

  });



  it('missing currency keeps incomplete and emits no aggregate', async () => {

    const { service, queryRunner, financialEventService, updates } =

      buildService([

        {

          quantity: 1,

          unitLandedCostSnapshot: 10,

          cogsStatus: OrderItemCogsStatus.captured,

          costCurrency: null,

        },

      ]);



    await service.recognizeCogsFromOrderItemSnapshots(1, queryRunner as any);



    expect(financialEventService.insertIdempotent).not.toHaveBeenCalled();

    expect(

      updates.some(

        (u) =>

          u.profitabilityStatus ===

          ProfitabilityStatus.incomplete_missing_cogs,

      ),

    ).toBe(true);

  });



  it('missing landed cost marks incomplete and does not emit aggregate COGS', async () => {

    const { service, queryRunner, financialEventService, updates } =

      buildService([

        {

          quantity: 1,

          unitLandedCostSnapshot: null,

          cogsStatus: OrderItemCogsStatus.missing,

          costCurrency: null,

        },

      ]);



    await service.recognizeCogsFromOrderItemSnapshots(1, queryRunner as any);



    expect(financialEventService.insertIdempotent).not.toHaveBeenCalled();

    expect(

      updates.some(

        (u) =>

          u.profitabilityStatus ===

          ProfitabilityStatus.incomplete_missing_cogs,

      ),

    ).toBe(true);

  });



  it('never rereads Product — uses only OrderItem snapshots', async () => {

    const { service, queryRunner } = buildService([

      {

        quantity: 1,

        unitLandedCostSnapshot: 100,

        cogsStatus: OrderItemCogsStatus.captured,

        costCurrency: ProductCurrency.TRY,

      },

    ]);

    await service.recognizeCogsFromOrderItemSnapshots(1, queryRunner as any);

    expect(queryRunner.manager.find).toHaveBeenCalledWith(

      expect.anything(),

      expect.objectContaining({ where: { orderId: 1 } }),

    );

  });



  it('keeps Order FX for COGS even if a different live rate is imagined', async () => {

    const { service, queryRunner, financialEventService } = buildService(

      [

        {

          quantity: 1,

          unitLandedCostSnapshot: 1,

          cogsStatus: OrderItemCogsStatus.captured,

          costCurrency: ProductCurrency.TRY,

        },

      ],

      { fxRateToIrt: 3500 },

    );



    await service.recognizeCogsFromOrderItemSnapshots(1, queryRunner as any);



    expect(financialEventService.insertIdempotent).toHaveBeenCalledWith(

      queryRunner,

      expect.objectContaining({ amount: 3500, fxRateToIrt: 3500 }),

    );

  });

});


