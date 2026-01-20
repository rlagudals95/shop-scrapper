import { AnalysisException, createLogger } from '@/common';
import { AiResponse, IAiClient } from '@/domain/interfaces';
import { GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GeminiClient implements IAiClient {
  private readonly logger = createLogger(GeminiClient.name);
  private readonly model: GenerativeModel;
  private readonly maxRetries = 3;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('geminiApiKey');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  async generate(prompt: string): Promise<AiResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.debug(`AI generation attempt ${attempt}/${this.maxRetries}`);
        const result = await this.model.generateContent(prompt);
        const response = result.response;
        const content = response.text();

        return {
          content,
          usage: {
            promptTokens: response.usageMetadata?.promptTokenCount || 0,
            completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`AI generation failed (attempt ${attempt}): ${lastError.message}`);

        if (attempt < this.maxRetries) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    throw new AnalysisException(
      `AI generation failed after ${this.maxRetries} attempts: ${lastError?.message}`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
