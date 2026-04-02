/// <reference types="vite/client" />

declare global {
  interface Window {
    appAPI: {
      openFiles: () => Promise<string[]>
      readFileAsBase64: (filePath: string) => Promise<string>
      readDocxAsHtml: (filePath: string) => Promise<string>
      askAI: (message: string) => Promise<{ ok: boolean; reply: string }>
      askAIStream: (message: string) => void
      onAIStreamStart: (cb: () => void) => () => void
      onAIStreamChunk: (cb: (chunk: string) => void) => () => void
      onAIStreamEnd: (cb: () => void) => () => void
      onAIStreamError: (cb: (errorText: string) => void) => () => void
    }
  }
}

export {}