import {
  ENVIRONMENT_INITIALIZER,
  inject,
  makeEnvironmentProviders,
  NgModule,
  type EnvironmentProviders,
  type ModuleWithProviders,
} from '@angular/core';
import type { InitOptions } from '@pushizo/web';
import { PUSHIZO_OPTIONS, PushizoService } from './pushizo.service.js';

/**
 * Bağımsız (standalone) uygulamalar için: `bootstrapApplication(App, { providers: [providePushizo({ appId })] })`.
 * Uygulama açılışında tarayıcıda `Pushizo.init` bir kez çağrılır (açılışı bekletmez); sunucuda çağrılmaz.
 */
export function providePushizo(options: InitOptions): EnvironmentProviders {
  if (!options || typeof options !== 'object')
    throw new Error('providePushizo: init seçenekleri gerekli (appId).');
  return makeEnvironmentProviders([
    { provide: PUSHIZO_OPTIONS, useValue: options },
    PushizoService,
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        void inject(PushizoService).init();
      },
    },
  ]);
}

/** NgModule tabanlı uygulamalar için: `imports: [PushizoModule.forRoot({ appId })]` (yalnızca kök modülde). */
@NgModule()
export class PushizoModule {
  static forRoot(options: InitOptions): ModuleWithProviders<PushizoModule> {
    return { ngModule: PushizoModule, providers: [providePushizo(options)] };
  }
}
