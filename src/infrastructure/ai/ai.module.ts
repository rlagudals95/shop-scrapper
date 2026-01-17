import { Module } from '@nestjs/common';
import { GeminiClient } from './gemini.client';
import { INJECTION_TOKENS } from '@/common';

@Module({
  providers: [
    GeminiClient,
    {
      provide: INJECTION_TOKENS.AI_CLIENT,
      useExisting: GeminiClient,
    },
  ],
  exports: [INJECTION_TOKENS.AI_CLIENT, GeminiClient],
})
export class AiModule {}
