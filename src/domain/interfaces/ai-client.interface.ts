export interface AiResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface IAiClient {
  generate(prompt: string): Promise<AiResponse>;
}
