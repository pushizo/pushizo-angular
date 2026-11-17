/**
 * @pushizo/angular — Pushizo Web SDK'sı (`@pushizo/web`) için Angular sağlayıcıları ve servis.
 *
 * `providePushizo(options)` (standalone) veya `PushizoModule.forRoot(options)` (NgModule) paylaşılan SDK örneğini
 * tarayıcıda bir kez başlatır; `PushizoService` izin ve push abonelik durumunu Signal ve Observable olarak sunar.
 */
export { PUSHIZO_OPTIONS, PushizoService } from './pushizo.service.js';
export { providePushizo, PushizoModule } from './providers.js';
export { PushizoContentCardsDirective } from './content-cards.directive.js';
export type { PushizoState } from './binding.js';
