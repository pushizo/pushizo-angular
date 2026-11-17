// @vitest-environment happy-dom
// JIT: dekoratörlü sınıflar (`@Injectable`, `@NgModule`) testte derleyici ile çözülür; paket çıktısı ngc ile kısmi derlenir.
import '@angular/compiler';
import {
  createEnvironmentInjector,
  DestroyRef,
  ElementRef,
  Injector,
  NgZone,
  PLATFORM_ID,
  runInInjectionContext,
  type EnvironmentInjector,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as web from '@pushizo/web';
import type {
  ForegroundLifecycleEvent,
  InboxChangeEvent,
  NotificationClickEvent,
  PermissionState,
} from '@pushizo/web';
import { getBinding, resetBinding } from '../binding.js';
import {
  providePushizo,
  PUSHIZO_OPTIONS,
  PushizoContentCardsDirective,
  PushizoModule,
  PushizoService,
} from '../index.js';
import { CLICK, FOREGROUND, type FakeSdk } from './fake-sdk.js';

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

  it('ön plan, bayrak ve kutu akışları abonelik bitince remove* ile temizlenir', () => {
    const service = create([providePushizo(OPTIONS)]).get(PushizoService);
    // Servisin kendi bayrak ve kutu gözlemcileri (Signal'ler için) zaten bağlıdır.
    expect(fake.extraCounts()).toMatchObject({ foreground: 0, flags: 1, inbox: 1 });
    const foreground: ForegroundLifecycleEvent[] = [];
    const inbox: InboxChangeEvent[] = [];
    const flags = vi.fn();
    const subs = [
      service.notificationForeground$.subscribe((e) => foreground.push(e)),
      service.featureFlagsChange$.subscribe(flags),
      service.inboxChange$.subscribe((e) => inbox.push(e)),
    ];
    expect(fake.extraCounts()).toMatchObject({ foreground: 1, flags: 2, inbox: 2 });
    fake.foreground(FOREGROUND);
    fake.setFlags({ a: { enabled: true } });
    fake.inbox({ type: 'count', unreadCount: 4 });
    expect(foreground).toEqual([FOREGROUND]);
    expect(flags).toHaveBeenCalledTimes(1);
    expect(inbox).toEqual([{ type: 'count', unreadCount: 4 }]);
    for (const sub of subs) sub.unsubscribe();
    expect(fake.extraCounts()).toMatchObject({ foreground: 0, flags: 1, inbox: 1 });
    expect(fake.sdk.Notifications.removeForegroundLifecycleListener).toHaveBeenCalledTimes(1);
  });

  it('featureFlag sinyali bayrak yenilenince güncellenir; enjektör yok edilince gözlemciler kaldırılır', async () => {
    const injector = create([providePushizo(OPTIONS)]);
    const service = injector.get(PushizoService);
    const enabled = service.featureFlag('new_checkout');
    const limit = service.featureFlagValue<number>('limit', 5);
    fake.setFlags({ new_checkout: { enabled: true }, limit: { enabled: true, value: 20 } });
    // SDK hazır olana kadar varsayılan değer döner.
    expect(enabled()).toBe(false);
    await service.init();
    await flush();
    expect(enabled()).toBe(true);
    expect(limit()).toBe(20);
    fake.setFlags({});
    expect(enabled()).toBe(false);
    expect(limit()).toBe(5);
    injector.destroy();
    expect(fake.extraCounts()).toMatchObject({ flags: 0, inbox: 0 });
    expect(fake.sdk.FeatureFlags.removeObserver).toHaveBeenCalledTimes(1);
    expect(fake.sdk.Inbox.removeObserver).toHaveBeenCalledTimes(1);
  });

  it('inboxUnreadCount sinyali olaylarla ve refreshInboxUnreadCount ile güncellenir', async () => {
    const service = create([providePushizo(OPTIONS)]).get(PushizoService);
    expect(service.inboxUnreadCount()).toBeNull();
    fake.setUnread(3);
    expect(await service.refreshInboxUnreadCount()).toBe(3);
    expect(service.inboxUnreadCount()).toBe(3);
    fake.inbox({ type: 'read', itemId: 'in_1', unreadCount: 2 });
    expect(service.inboxUnreadCount()).toBe(2);
  });

  it('search ve renderContentCards web SDK çağrılarına gider', async () => {
    const service = create([providePushizo(OPTIONS)]).get(PushizoService);
    const response = await service.search('fiyat', { limit: 3 });
    expect(fake.sdk.Search.query).toHaveBeenCalledWith('fiyat', { limit: 3 });
    expect(response.query_id).toBe('q_fiyat');
    const host = document.createElement('div');
    const view = await service.renderContentCards(host, { theme: 'dark' });
    expect(fake.sdk.ContentCards.render).toHaveBeenCalledWith(host, { theme: 'dark' });
    expect(fake.extraCounts().cardViews).toBe(1);
    view.destroy();
    expect(fake.extraCounts().cardViews).toBe(0);
  });

  it('pushizoContentCards yönergesi SDK hazır olunca görünümü kurar, yok edilince kaldırır', async () => {
    const host = document.createElement('div');
    const injector = create([
      providePushizo(OPTIONS),
      { provide: ElementRef, useValue: new ElementRef(host) },
    ]);
    const directive = runInInjectionContext(injector, () => new PushizoContentCardsDirective());
    directive.options = { theme: 'dark' };
    directive.ngOnInit();
    await flush();
    await flush();
    expect(fake.sdk.ContentCards.render).toHaveBeenCalledWith(host, { theme: 'dark' });
    expect(fake.extraCounts().cardViews).toBe(1);
    await directive.refresh();
    expect(injector.get(DestroyRef)).toBeDefined();
    injector.destroy();
    expect(fake.extraCounts().cardViews).toBe(0);
  });

  it('sunucu platformunda yeni akışlar ve yönerge web SDK çağrısı yapmaz', async () => {
    const host = {} as Element;
    const injector = create(
      [providePushizo(OPTIONS), { provide: ElementRef, useValue: new ElementRef(host) }],
      'server',
    );
    const service = injector.get(PushizoService);
    service.notificationForeground$.subscribe().unsubscribe();
    service.featureFlagsChange$.subscribe().unsubscribe();
    service.inboxChange$.subscribe().unsubscribe();
    const directive = runInInjectionContext(injector, () => new PushizoContentCardsDirective());
    directive.ngOnInit();
    await flush();
    expect(fake.extraCounts()).toEqual({ foreground: 0, flags: 0, inbox: 0, cardViews: 0 });
    expect(service.featureFlag('a', true)()).toBe(true);
    expect(await service.refreshInboxUnreadCount()).toBeNull();
    await expect(service.renderContentCards(host)).rejects.toThrow('tarayıcıda');
    expect(fake.sdk.ContentCards.render).not.toHaveBeenCalled();
  });

  it('seçeneksiz providePushizo açıklayıcı hata verir', () => {
    expect(() => providePushizo(undefined as never)).toThrow('appId');
  });
});
