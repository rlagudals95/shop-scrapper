import { Module } from '@nestjs/common';
import { PlaywrightClient } from './playwright.client';
import { INJECTION_TOKENS } from '@/common';

@Module({
  providers: [
    PlaywrightClient,
    {
      provide: INJECTION_TOKENS.BROWSER_CLIENT,
      useExisting: PlaywrightClient,
    },
  ],
  exports: [INJECTION_TOKENS.BROWSER_CLIENT, PlaywrightClient],
})
export class BrowserModule {}
