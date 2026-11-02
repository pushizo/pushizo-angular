import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  InjectionToken,
  NgZone,
  PLATFORM_ID,
  signal,
  type Signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, distinctUntilChanged, map, Observable } from 'rxjs';
import type {
  InitOptions,
  NotificationClickEvent,
  PermissionState,
  PushSubscriptionState,
  PushizoSdk,
} from '@pushizo/web';
import { getBinding, SERVER_STATE, type PushizoState } from './binding.js';

/** `providePushizo` / `PushizoModule.forRoot` ile verilen `Pushizo.init` seçenekleri. */
export const PUSHIZO_OPTIONS = new InjectionToken<InitOptions>('PUSHIZO_OPTIONS');

/**
 * Paylaşılan Pushizo SDK örneğini ve durumunu Angular'a sunar. Durum hem Signal (`permission`, `pushSubscription`,
 * `ready`, `error`) hem Observable (`state$`, `permission$`, `pushSubscription$`) olarak okunur.
 * Sunucuda (`isPlatformBrowser` false) SDK'ya dokunulmaz; durum sabit kalır.
 */
@Injectable()
export class PushizoService {
  private readonly binding = getBinding();
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly options = inject(PUSHIZO_OPTIONS);
  private readonly zone = inject(NgZone, { optional: true });
  private readonly current = signal<PushizoState>(
    this.browser ? this.binding.getState() : SERVER_STATE,
  );
  private readonly subject = new BehaviorSubject<PushizoState>(this.current());

  /** Paylaşılan Pushizo SDK örneği (`login`, `User.addTags`, `Notifications.requestPermission` …). */
  readonly sdk: PushizoSdk = this.binding.sdk;

  readonly state: Signal<PushizoState> = this.current.asReadonly();
  readonly ready: Signal<boolean> = computed(() => this.current().ready);
  readonly error: Signal<Error | null> = computed(() => this.current().error);
  readonly permission: Signal<PermissionState> = computed(() => this.current().permission);
  readonly pushSubscription: Signal<PushSubscriptionState> = computed(
    () => this.current().pushSubscription,
  );

  readonly state$: Observable<PushizoState> = this.subject.asObservable();
  readonly permission$: Observable<PermissionState> = this.state$.pipe(
    map((s) => s.permission),
    distinctUntilChanged(),
  );
  readonly pushSubscription$: Observable<PushSubscriptionState> = this.state$.pipe(
    map((s) => s.pushSubscription),
    distinctUntilChanged(),
  );

  /**
   * Bildirim tıklamaları. Abone olununca dinleyici eklenir, abonelik bitince kaldırılır; sunucuda hiç yayın yapmaz.
   */
  readonly notificationClick$: Observable<NotificationClickEvent> =
    new Observable<NotificationClickEvent>((observer) => {
      if (!this.browser) return undefined;
      const remove = this.sdk.Notifications.addClickListener((event) =>
        this.run(() => observer.next(event)),
      );
      return () => {
        remove();
      };
    });

  constructor() {
    if (!this.browser) return;
    const unsubscribe = this.binding.subscribe((next) => this.run(() => this.set(next)));
    const disconnect = this.binding.connect();
    this.set(this.binding.getState());
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      disconnect();
      this.subject.complete();
    });
  }

  /**
   * SDK'yı bir kez başlatır (`providePushizo` bunu uygulama açılışında kendisi çağırır). Söz reddedilmez; hata
   * `error` sinyaline yazılır. Sunucuda hiçbir şey yapmaz.
   */
  init(): Promise<void> {
    if (!this.browser) return Promise.resolve();
    return this.binding.init(this.options);
  }

  private set(next: PushizoState): void {
    this.current.set(next);
    this.subject.next(next);
  }

  /** Web SDK geri çağrıları Angular bölgesi dışından gelebilir; değişiklik algılaması için bölgeye alınır. */
  private run(fn: () => void): void {
    if (this.zone) this.zone.run(fn);
    else fn();
  }
}
