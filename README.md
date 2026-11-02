<!-- pushizo:header -->
<p align="center">
  <a href="https://pushizo.com"><img src="https://raw.githubusercontent.com/pushizo/.github/main/profile/assets/mark.svg" alt="Pushizo" width="56" height="56"></a>
</p>
<p align="center">
  <a href="https://docs.pushizo.com/docs/integrations/angular"><img src="https://img.shields.io/badge/docs-docs.pushizo.com-5b4bdb" alt="Docs"></a>
  <a href="https://docs.pushizo.com/docs/api"><img src="https://img.shields.io/badge/API-reference-b44fc4" alt="API reference"></a>
  <a href="https://github.com/pushizo/pushizo-angular/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-16130f" alt="License: MIT"></a>
</p>
<p align="center"><a href="#english">English</a> · <a href="#türkçe">Türkçe</a></p>

## English

**Pushizo for Angular** — Angular providers for the Pushizo Web SDK. providePushizo (standalone) or PushizoModule.forRoot (NgModule) initializes the shared SDK once in the browser and never on the server; PushizoService exposes permission and push subscription state as signals and observables. Angular 17 and later.

```bash
npm install @pushizo/angular @pushizo/web
```

The detailed guide below is in Turkish; code samples are language-neutral. Full documentation:
[docs.pushizo.com/docs/integrations/angular](https://docs.pushizo.com/docs/integrations/angular) · API reference: [docs.pushizo.com/docs/api](https://docs.pushizo.com/docs/api).

## Türkçe
<!-- /pushizo:header -->

# @pushizo/angular

Pushizo Web SDK'sı (`@pushizo/web`) için Angular sağlayıcıları: `providePushizo(options)` (standalone) veya
`PushizoModule.forRoot(options)` (NgModule) paylaşılan SDK örneğini tarayıcıda bir kez başlatır; `PushizoService`
izin ve push abonelik durumunu **Signal** ve **Observable** olarak sunar.

- SSR güvenli: sunucuda (`isPlatformBrowser` false) `init` çağrılmaz, gözlemci bağlanmaz.
- Angular 17 ve sonrası; paket Angular'ın kısmi (partial) derleme biçimindedir, uygulama derleyicisi bağlar.
- Kök enjektör yok edilince gözlemciler kaldırılır, Observable'lar tamamlanır.

## Kurulum

```bash
npm install @pushizo/angular @pushizo/web
```

Service worker site kökünde olmalıdır: `src/PushizoSDKWorker.js` dosyasını oluşturun ve `angular.json` →
`projects.<app>.architect.build.options.assets` içine `{ "glob": "PushizoSDKWorker.js", "input": "src", "output": "/" }` ekleyin.

```js
// src/PushizoSDKWorker.js
const apiUrl = new URL(self.location.href).searchParams.get('apiUrl') || 'https://api.pushizo.com';
importScripts(`${apiUrl.replace(/\/$/, '')}/sdk-web/PushizoSDKWorker.js`);
```

## Kullanım

```ts
// app.config.ts (standalone)
import { ApplicationConfig } from '@angular/core';
import { providePushizo } from '@pushizo/angular';

export const appConfig: ApplicationConfig = {
  providers: [providePushizo({ appId: 'app_…', serviceWorkerPath: '/PushizoSDKWorker.js' })],
};
```

```ts
// app.module.ts (NgModule)
import { PushizoModule } from '@pushizo/angular';

@NgModule({ imports: [BrowserModule, PushizoModule.forRoot({ appId: 'app_…' })] })
export class AppModule {}
```

```ts
import { Component, inject } from '@angular/core';
import { PushizoService } from '@pushizo/angular';

@Component({
  selector: 'app-push-toggle',
  template: `
    @if (pushizo.error(); as error) {
      <p role="alert">{{ error.message }}</p>
    } @else if (!pushizo.ready()) {
      <p>Yükleniyor…</p>
    } @else if (pushizo.permission() === 'denied') {
      <p>Bildirimler tarayıcı ayarlarından engellenmiş.</p>
    } @else if (pushizo.pushSubscription().optedIn) {
      <button (click)="pushizo.sdk.User.pushSubscription.optOut()">Bildirimleri kapat</button>
    } @else {
      <button (click)="pushizo.sdk.Notifications.requestPermission()">Bildirimlere izin ver</button>
    }
  `,
})
export class PushToggleComponent {
  readonly pushizo = inject(PushizoService);
}
```

Observable ile bildirim tıklaması:

```ts
inject(PushizoService)
  .notificationClick$.pipe(takeUntilDestroyed())
  .subscribe(({ notification, result }) => router.navigateByUrl(result.url ?? notification.url ?? '/'));
```

## API

| Ad | Açıklama |
|----|----------|
| `providePushizo(options)` | Ortam sağlayıcıları; açılışta tarayıcıda `Pushizo.init` bir kez (açılışı bekletmez). |
| `PushizoModule.forRoot(options)` | NgModule karşılığı (yalnızca kök modülde). |
| `PushizoService.sdk` | Paylaşılan SDK örneği: `login`, `User.addTags`, `Session.sendEvent`, `Inbox` … |
| `ready`, `error`, `permission`, `pushSubscription`, `state` | Salt okunur Signal'ler. |
| `state$`, `permission$`, `pushSubscription$` | Observable'lar (son değeri hemen verir). |
| `notificationClick$` | Bildirim tıklamaları; abonelik bitince dinleyici kaldırılır. |
| `PUSHIZO_OPTIONS` | Verilen init seçeneklerinin enjeksiyon belirteci. |

`init` hatası fırlatılmaz, `error` sinyaline yazılır.

Ayrıntılı rehber (SSR, login/logout, tag ve olaylar, bildirim kutusu): [Angular rehberi](https://docs.pushizo.com/docs/integrations/angular).

<!-- pushizo:footer -->
---

## Support · Destek

- **Guide · Rehber:** [docs.pushizo.com/docs/integrations/angular](https://docs.pushizo.com/docs/integrations/angular)
- **API reference & OpenAPI · API referansı ve OpenAPI:** [docs.pushizo.com/docs/api](https://docs.pushizo.com/docs/api) ·
  [pushizo-openapi](https://github.com/pushizo/pushizo-openapi)
- **Bugs & ideas · Hata ve öneri:** [Issues](https://github.com/pushizo/pushizo-angular/issues)
- **Security · Güvenlik:** please do not open public issues; email [security@pushizo.com](mailto:security@pushizo.com) ·
  herkese açık issue açmayın, bu adrese yazın.
- **Help · Destek:** [support@pushizo.com](mailto:support@pushizo.com)

This repository is mirrored automatically from the Pushizo main repository on every release. Please open an issue
instead of a pull request; fixes land in the main repository and ship with the next release.
Bu depo her sürümde Pushizo ana deposundan otomatik yansıtılır. Pull request yerine issue açın; düzeltmeler ana depoda
yapılır ve bir sonraki sürümle buraya gelir.

Released under the MIT License · MIT lisanslıdır — [LICENSE](https://github.com/pushizo/pushizo-angular/blob/main/LICENSE).
<!-- /pushizo:footer -->
