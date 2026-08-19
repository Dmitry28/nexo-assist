import 'reflect-metadata';

import { AppModule } from '@/app.module';
import { TelegramHandlers } from '@/modules/telegram/telegram.handlers';
import { TelegramService } from '@/modules/telegram/telegram.service';

/**
 * Guards against import cycles that silently strip DI metadata.
 *
 * A cycle in the telegram module (handlers → scheduler → service → handlers) left
 * `TelegramService` without `TelegramHandlers` in its `design:paramtypes`, and Nest refused to
 * boot — while lint and unit specs stayed green (they import in a benign order, and
 * `import-x/no-cycle` does not fire in this eslint/plugin pair, see PRODUCT_PLAN.md § бэклог).
 * Importing AppModule first reproduces the production order.
 */
describe('DI wiring', () => {
  it('keeps constructor metadata intact when the graph is entered through AppModule', () => {
    expect(AppModule).toBeDefined(); // touching it is what loads the graph

    const params: unknown[] = Reflect.getMetadata('design:paramtypes', TelegramService);

    expect(params).not.toContain(undefined);
    expect(params).toContain(TelegramHandlers);
  });
});
