import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  Input,
  PLATFORM_ID,
  type OnInit,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { ContentCardsViewHandle, ContentCardsViewOptions } from '@pushizo/web';
import { PushizoService } from './pushizo.service.js';

/**
 * Hazır içerik kartı akışı: `<div pushizoContentCards [pushizoContentCardsOptions]="{ theme: 'auto' }"></div>`.
 * SDK hazır olunca öğeye çizilir (yükleniyor/boş/hata durumları görünümdedir) ve yönerge yok edilince kaldırılır.
 * Seçeneklerin yalnızca ilk değeri kullanılır; sunucuda hiçbir şey yapmaz.
 */
@Directive({ selector: '[pushizoContentCards]', standalone: true, exportAs: 'pushizoContentCards' })
export class PushizoContentCardsDirective implements OnInit {
  /** `ContentCards.render` seçenekleri. */
  @Input('pushizoContentCardsOptions') options: ContentCardsViewOptions | undefined;

  /** Görünüm kurulamazsa (ör. betik yüklenemedi) hata; yoksa null. */
  error: Error | null = null;

  private readonly pushizo = inject(PushizoService);
  private readonly host = inject<ElementRef<Element>>(ElementRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private handle: ContentCardsViewHandle | null = null;
  private active = true;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.active = false;
      this.handle?.destroy();
      this.handle = null;
    });
  }

  ngOnInit(): void {
    if (!this.browser) return;
    // `init` tekrarlanan çağrıda ilk sözü döndürür: görünüm SDK hazır olduktan sonra kurulur.
    void this.pushizo.init().then(() => {
      if (!this.active || !this.pushizo.ready()) return undefined;
      return this.pushizo.renderContentCards(this.host.nativeElement, this.options).then(
        (view) => {
          // Kurulum bitmeden yok edilen yönergenin görünümü hemen kaldırılır.
          if (this.active) this.handle = view;
          else view.destroy();
        },
        (err: unknown) => {
          this.error = err instanceof Error ? err : new Error(String(err));
        },
      );
    });
  }

  /** Akışı yeniden yükler (görünüm henüz kurulmadıysa hiçbir şey yapmaz). */
  refresh(): Promise<void> {
    return this.handle?.refresh() ?? Promise.resolve();
  }
}
