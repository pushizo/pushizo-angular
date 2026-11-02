// @vitest-environment happy-dom
// JIT: dekoratörlü sınıflar (`@Injectable`, `@NgModule`) testte derleyici ile çözülür; paket çıktısı ngc ile kısmi derlenir.
import '@angular/compiler';
import {
  createEnvironmentInjector,
  Injector,
  NgZone,
  PLATFORM_ID,
  type EnvironmentInjector,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as web from '@pushizo/web';
import type { NotificationClickEvent, PermissionState } from '@pushizo/web';
import { getBinding, resetBinding } from '../binding.js';
import { providePushizo, PUSHIZO_OPTIONS, PushizoModule, PushizoService } from '../index.js';
import { CLICK, type FakeSdk } from './fake-sdk.js';

vi.mock('@pushizo/web', async () => {
  const { createFakeSdk } = await import('./fake-sdk.js');
  const fake = createFakeSdk();
  return { default: fake.sdk, Pushizo: fake.sdk, __fake: fake };
});

const fake = (web as unknown as { __fake: FakeSdk }).__fake;
const OPTIONS = { appId: 'app_angular_test' };
const flush = () => new Promise((r) => setTimeout(r, 0));

let injectors: EnvironmentInjector[] = [];

function create(
  providers: Array<Provider | EnvironmentProviders>,
  platform = 'browser',
): EnvironmentInjector {
  const injector = createEnvironmentInjector(
    [{ provide: PLATFORM_ID, useValue: platform }, ...providers],
    Injector.NULL as EnvironmentInjector,
  );
  injectors.push(injector);
  return injector;
}

beforeEach(() => {
  fake.reset();
  resetBinding();
});

afterEach(() => {
  for (const injector of injectors) if (!injector.destroyed) injector.destroy();
  injectors = [];
});

describe('@pushizo/angular', () => {
  it('providePushizo: ortam başlatıcısı init çağrısını bir kez yapar, ready sinyali güncellenir', async () => {
    const injector = create([providePushizo(OPTIONS)]);
    const service = injector.get(PushizoService);
    expect(injector.get(PUSHIZO_OPTIONS)).toBe(OPTIONS);
    await service.init();
    await flush();
    expect(fake.sdk.init).toHaveBeenCalledTimes(1);
    expect(fake.sdk.init).toHaveBeenCalledWith(OPTIONS);
    expect(service.ready()).toBe(true);
    expect(service.sdk).toBe(fake.sdk);
    // İkinci enjektör (ör. ikinci uygulama) SDK'yı yeniden başlatmaz.
    create([providePushizo(OPTIONS)]);
    await flush();
    expect(fake.sdk.init).toHaveBeenCalledTimes(1);
  });

  it('PushizoModule.forRoot aynı sağlayıcıları verir', async () => {
    const mwp = PushizoModule.forRoot(OPTIONS);
    expect(mwp.ngModule).toBe(PushizoModule);
    const injector = create([...(mwp.providers ?? [])]);
    await flush();
    expect(injector.get(PushizoService).ready()).toBe(true);
    expect(fake.sdk.init).toHaveBeenCalledTimes(1);
  });

  it('izin ve abonelik değişiklikleri Signal ve Observable olarak yayınlanır', async () => {
    const service = create([providePushizo(OPTIONS)]).get(PushizoService);
    await flush();
    const permissions: PermissionState[] = [];
    const sub = service.permission$.subscribe((p) => permissions.push(p));
    fake.setPermission('granted');
    fake.setSubscription({ id: 'sub_1', token: 'https://push.example.test/1', optedIn: true });
    expect(service.permission()).toBe('granted');
    expect(service.pushSubscription().optedIn).toBe(true);
    expect(service.pushSubscription().id).toBe('sub_1');
    // distinctUntilChanged: abonelik değişikliği izin akışını tekrarlamaz.
    expect(permissions).toEqual(['default', 'granted']);
    sub.unsubscribe();
  });

  it('init hatası error sinyaline yazılır', async () => {
    fake.failNextInit(new Error('appId gerekli'));
    const service = create([providePushizo(OPTIONS)]).get(PushizoService);
    await flush();
    expect(service.ready()).toBe(false);
    expect(service.error()?.message).toBe('appId gerekli');
  });

  it('enjektör yok edilince gözlemciler kaldırılır ve Observable tamamlanır', async () => {
    const injector = create([providePushizo(OPTIONS)]);
    const service = injector.get(PushizoService);
    const complete = vi.fn();
    service.state$.subscribe({ complete });
    expect(fake.counts()).toMatchObject({ permission: 1, subscription: 1 });
    injector.destroy();
    expect(fake.counts()).toMatchObject({ permission: 0, subscription: 0 });
    expect(complete).toHaveBeenCalled();
    expect(getBinding().connectionCount).toBe(0);
  });

  it('notificationClick$ abone olununca dinleyici ekler, abonelik bitince kaldırır; NgZone içinde yayınlar', () => {
    const zone = { run: vi.fn((fn: () => unknown) => fn()) };
    const service = create([providePushizo(OPTIONS), { provide: NgZone, useValue: zone }]).get(
      PushizoService,
    );
    const events: NotificationClickEvent[] = [];
    const sub = service.notificationClick$.subscribe((e) => events.push(e));
    expect(fake.counts().click).toBe(1);
    fake.click(CLICK);
    expect(events).toEqual([CLICK]);
    expect(zone.run).toHaveBeenCalled();
    sub.unsubscribe();
    expect(fake.counts().click).toBe(0);
  });

  it('sunucu platformunda init çağrılmaz, gözlemci bağlanmaz, tıklama akışı boş kalır', async () => {
    const service = create([providePushizo(OPTIONS)], 'server').get(PushizoService);
    await service.init();
    await flush();
    const events: unknown[] = [];
    service.notificationClick$.subscribe((e) => events.push(e)).unsubscribe();
    expect(fake.sdk.init).not.toHaveBeenCalled();
    expect(fake.counts()).toEqual({ permission: 0, subscription: 0, click: 0 });
    expect(service.ready()).toBe(false);
    expect(service.permission()).toBe('default');
  });

  it('seçeneksiz providePushizo açıklayıcı hata verir', () => {
    expect(() => providePushizo(undefined as never)).toThrow('appId');
  });
});
