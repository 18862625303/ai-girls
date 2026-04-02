/// <reference types="vite/client" />

type SpeechToTextInput = {
  audioBase64: string
  mimeType?: string
  fileName?: string
  language?: string
}

declare global {
  interface Window {
    appAPI: {
      openFiles: () => Promise<string[]>
      readFileAsBase64: (filePath: string) => Promise<string>
      readDocxAsHtml: (filePath: string) => Promise<string>
      askAI: (message: string) => Promise<{ ok: boolean; reply: string }>
      askAIWithFiles: (message: string, filePaths: string[]) => Promise<{ ok: boolean; reply: string }>
      askAIStream: (message: string) => void
      askAIStreamWithFiles: (message: string, filePaths: string[]) => void
      stopAIStream: () => void
      speechToText: (payload: SpeechToTextInput) => Promise<{ ok: boolean; text: string; error?: string }>
      textToSpeech: (text: string) => Promise<{ ok: boolean; audioBase64: string; mimeType: string; error?: string }>
      onAIStreamStart: (cb: () => void) => () => void
      onAIStreamChunk: (cb: (chunk: string) => void) => () => void
      onAIStreamEnd: (cb: () => void) => () => void
      onAIStreamError: (cb: (errorText: string) => void) => () => void
    }
  }
}

export {}
