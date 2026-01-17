import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisException } from '../../../src/common/exceptions/crawl.exception';
import { GeminiClient } from '../../../src/infrastructure/ai/gemini.client';

// Mock the Google Generative AI module
jest.mock('@google/generative-ai', () => {
  const mockGenerateContent = jest.fn();
  const mockGetGenerativeModel = jest.fn(() => ({
    generateContent: mockGenerateContent,
  }));

  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
    __mockGenerateContent: mockGenerateContent,
    __mockGetGenerativeModel: mockGetGenerativeModel,
  };
});

describe('GeminiClient', () => {
  let geminiClient: GeminiClient;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockGenerateContent: jest.Mock;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Get the mock function
    const googleAiModule = require('@google/generative-ai');
    mockGenerateContent = googleAiModule.__mockGenerateContent;

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'geminiApiKey') return 'test-api-key';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiClient,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    geminiClient = module.get<GeminiClient>(GeminiClient);
  });

  describe('constructor', () => {
    it('should throw error when API key is not configured', async () => {
      const noKeyConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as jest.Mocked<ConfigService>;

      await expect(
        Test.createTestingModule({
          providers: [
            GeminiClient,
            {
              provide: ConfigService,
              useValue: noKeyConfigService,
            },
          ],
        }).compile(),
      ).rejects.toThrow('GEMINI_API_KEY is not configured');
    });
  });

  describe('generate', () => {
    it('should return AI response on successful generation', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => '{"pageType": "LISTING", "confidence": 0.9}',
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
          },
        },
      });

      const result = await geminiClient.generate('Test prompt');

      expect(result.content).toBe('{"pageType": "LISTING", "confidence": 0.9}');
      expect(result.usage?.promptTokens).toBe(100);
      expect(result.usage?.completionTokens).toBe(50);
    });

    it('should handle response without usage metadata', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => 'Response without metadata',
          usageMetadata: undefined,
        },
      });

      const result = await geminiClient.generate('Test prompt');

      expect(result.content).toBe('Response without metadata');
      expect(result.usage?.promptTokens).toBe(0);
      expect(result.usage?.completionTokens).toBe(0);
    });

    it('should retry on failure and succeed', async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          response: {
            text: () => 'Success after retry',
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 25 },
          },
        });

      const result = await geminiClient.generate('Test prompt');

      expect(result.content).toBe('Success after retry');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('should throw AnalysisException after max retries', async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'));

      await expect(geminiClient.generate('Test prompt')).rejects.toThrow(AnalysisException);
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    }, 15000); // Increase timeout for retries with delays

    it('should include last error message in exception', async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new Error('First error'))
        .mockRejectedValueOnce(new Error('Second error'))
        .mockRejectedValueOnce(new Error('Final error message'));

      await expect(geminiClient.generate('Test prompt')).rejects.toThrow('Final error message');
    }, 15000);

    it('should handle non-Error exceptions', async () => {
      mockGenerateContent
        .mockRejectedValueOnce('String error')
        .mockRejectedValueOnce({ message: 'Object error' })
        .mockRejectedValueOnce(null);

      await expect(geminiClient.generate('Test prompt')).rejects.toThrow(AnalysisException);
    }, 15000);

    it('should pass prompt to the model', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => 'Response',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      });

      const testPrompt = 'This is a specific test prompt';
      await geminiClient.generate(testPrompt);

      expect(mockGenerateContent).toHaveBeenCalledWith(testPrompt);
    });
  });
});
