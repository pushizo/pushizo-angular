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
  ContentCardsViewHandle,
  ContentCardsViewOptions,
  ForegroundLifecycleEvent,
  InboxChangeEvent,
  InitOptions,
  NotificationClickEvent,
  PermissionState,
  PushSubscriptionState,
  PushizoSdk,
  SearchQueryOptions,
  SearchResponse,
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
  private readonly flagVersion = signal(0);
  private readonly unread = signal<number | null>(null);

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

  /**
   * Ön plan bildirimleri (`event.preventDefault()` ile bildirim engellenebilir). Abonelik bitince dinleyici
   * `Notifications.removeForegroundLifecycleListener` ile kaldırılır; sunucuda hiç yayın yapmaz.
   */
  readonly notificationForeground$: Observable<ForegroundLifecycleEvent> =
    new Observable<ForegroundLifecycleEvent>((observer) => {
      if (!this.browser) return undefined;
      const listener = (event: ForegroundLifecycleEvent) => this.run(() => observer.next(event));
      this.sdk.Notifications.addForegroundLifecycleListener(listener);
      return () => this.sdk.Notifications.removeForegroundLifecycleListener(listener);
    });

  /** Özellik bayrakları sunucudan her yenilendiğinde yayın yapar; abonelik bitince gözlemci kaldırılır. */
  readonly featureFlagsChange$: Observable<void> = new Observable<void>((observer) => {
    if (!this.browser) return undefined;
    const listener = () => this.run(() => observer.next());
    this.sdk.FeatureFlags.addObserver(listener);
    return () => this.sdk.FeatureFlags.removeObserver(listener);
  });

  /** Bildirim kutusu değişimleri (`Inbox.addObserver`); abonelik bitince gözlemci kaldırılır. */
  readonly inboxChange$: Observable<InboxChangeEvent> = new Observable<InboxChangeEvent>(
    (observer) => {
      if (!this.browser) return undefined;
      const listener = (event: InboxChangeEvent) => this.run(() => observer.next(event));
      this.sdk.Inbox.addObserver(listener);
      return () => this.sdk.Inbox.removeObserver(listener);
    },
  );

  /**
   * Bildirim kutusundaki okunmamış sayısı (rozet için): kutu olaylarıyla güncellenir; ilk değer için
   * `refreshInboxUnreadCount()` çağrılır. Henüz bilinmiyorsa `null`.
   */
  readonly inboxUnreadCount: Signal<number | null> = this.unread.asReadonly();

  constructor() {
    if (!this.browser) return;
    const unsubscribe = this.binding.subscribe((next) => this.run(() => this.set(next)));
    const disconnect = this.binding.connect();
    this.set(this.binding.getState());
    const onFlags = () => this.run(() => this.flagVersion.update((v) => v + 1));
    const onInbox = (event: InboxChangeEvent) => this.run(() => this.unread.set(event.unreadCount));
    this.sdk.FeatureFlags.addObserver(onFlags);
    this.sdk.Inbox.addObserver(onInbox);
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      disconnect();
      this.sdk.FeatureFlags.removeObserver(onFlags);
      this.sdk.Inbox.removeObserver(onInbox);
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

  /**
   * Özellik bayrağı açık mı (Signal). Değerler sunucudan yenilendiğinde güncellenir; SDK hazır olana kadar ve
   * sunucuda `defaultValue` döner.
   */
  featureFlag(key: string, defaultValue = false): Signal<boolean> {
    return computed(() => {
      this.flagVersion();
      return this.browser && this.current().ready
        ? this.sdk.FeatureFlags.isEnabled(key, defaultValue)
        : defaultValue;
    });
  }

  /** Özellik bayrağının değeri (Signal); bayrak kapalıysa ya da SDK hazır değilse `defaultValue`. */
  featureFlagValue<T = unknown>(key: string, defaultValue?: T): Signal<T | undefined> {
    return computed(() => {
      this.flagVersion();
      return this.browser && this.current().ready
        ? this.sdk.FeatureFlags.getValue<T>(key, defaultValue)
        : defaultValue;
    });
  }

  /** Okunmamış sayısını sunucudan okur ve `inboxUnreadCount` sinyaline yazar; sunucuda `null` döner. */
  async refreshInboxUnreadCount(): Promise<number | null> {
    if (!this.browser) return null;
    const count = await this.sdk.Inbox.unreadCount();
    this.run(() => this.unread.set(count));
    return count;
  }

  /**
   * Hazır içerik kartı akışını öğeye çizer (`ContentCards.render`); dönen tutamaç `refresh()` ve `destroy()`
   * sağlar. Şablonda `pushizoContentCards` yönergesi bunu kendiliğinden yapar. Sunucuda çağrılmaz.
   */
  renderContentCards(
    target: string | Element,
    options?: ContentCardsViewOptions,
  ): Promise<ContentCardsViewHandle> {
    if (!this.browser)
      return Promise.reject(
        new Error('PushizoService: içerik kartları yalnızca tarayıcıda çizilir.'),
      );
    return this.sdk.ContentCards.render(target, options);
  }

  /** Site araması (`Search.query`); sonuç Angular bölgesi içinde çözülür. */
  search(text: string, options?: SearchQueryOptions): Promise<SearchResponse> {
    return new Promise<SearchResponse>((resolve, reject) => {
      this.sdk.Search.query(text, options).then(
        (response) => this.run(() => resolve(response)),
        (err: unknown) =>
          this.run(() => reject(err instanceof Error ? err : new Error(String(err)))),
      );
    });
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
