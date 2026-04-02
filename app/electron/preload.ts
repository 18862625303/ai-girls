import { ipcRenderer, contextBridge } from 'electron'

type SpeechToTextInput = {
  audioBase64: string
  mimeType?: string
  fileName?: string
  language?: string
}

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...rest) => listener(event, ...rest))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...rest] = args
    return ipcRenderer.off(channel, ...rest)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...rest] = args
    return ipcRenderer.send(channel, ...rest)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...rest] = args
    return ipcRenderer.invoke(channel, ...rest)
  },
})

contextBridge.exposeInMainWorld('appAPI', {
  openFiles: () => ipcRenderer.invoke('app:open-files') as Promise<string[]>,
  readFileAsBase64: (filePath: string) => ipcRenderer.invoke('app:read-file', filePath) as Promise<string>,
  readDocxAsHtml: (filePath: string) => ipcRenderer.invoke('app:read-docx-html', filePath) as Promise<string>,
  askAI: (message: string) => ipcRenderer.invoke('app:ask-ai', message) as Promise<{ ok: boolean; reply: string }>,
  askAIStream: (message: string) => ipcRenderer.send('app:ask-ai-stream', message),
  stopAIStream: () => ipcRenderer.send('app:stop-ai-stream'),
  speechToText: (payload: SpeechToTextInput) =>
    ipcRenderer.invoke('app:speech-to-text', payload) as Promise<{ ok: boolean; text: string; error?: string }>,
  textToSpeech: (text: string) =>
    ipcRenderer.invoke('app:text-to-speech', text) as Promise<{ ok: boolean; audioBase64: string; mimeType: string; error?: string }>,
  onAIStreamStart: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('app:ai-stream-start', listener)
    return () => ipcRenderer.off('app:ai-stream-start', listener)
  },
  onAIStreamChunk: (cb: (chunk: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: string) => cb(chunk)
    ipcRenderer.on('app:ai-stream-chunk', listener)
    return () => ipcRenderer.off('app:ai-stream-chunk', listener)
  },
  onAIStreamEnd: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('app:ai-stream-end', listener)
    return () => ipcRenderer.off('app:ai-stream-end', listener)
  },
  onAIStreamError: (cb: (errorText: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, errorText: string) => cb(errorText)
    ipcRenderer.on('app:ai-stream-error', listener)
    return () => ipcRenderer.off('app:ai-stream-error', listener)
  },
})
