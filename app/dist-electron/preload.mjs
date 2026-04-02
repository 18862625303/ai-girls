"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("appAPI", {
  openFiles: () => electron.ipcRenderer.invoke("app:open-files"),
  readFileAsBase64: (filePath) => electron.ipcRenderer.invoke("app:read-file", filePath),
  readDocxAsHtml: (filePath) => electron.ipcRenderer.invoke("app:read-docx-html", filePath),
  askAI: (message) => electron.ipcRenderer.invoke("app:ask-ai", message),
  askAIWithFiles: (message, filePaths) => electron.ipcRenderer.invoke("app:ask-ai-with-files", message, filePaths),
  askAIStream: (message) => electron.ipcRenderer.send("app:ask-ai-stream", message),
  askAIStreamWithFiles: (message, filePaths) => electron.ipcRenderer.send("app:ask-ai-stream-with-files", message, filePaths),
  stopAIStream: () => electron.ipcRenderer.send("app:stop-ai-stream"),
  speechToText: (payload) => electron.ipcRenderer.invoke("app:speech-to-text", payload),
  textToSpeech: (text) => electron.ipcRenderer.invoke("app:text-to-speech", text),
  onAIStreamStart: (cb) => {
    const listener = () => cb();
    electron.ipcRenderer.on("app:ai-stream-start", listener);
    return () => electron.ipcRenderer.off("app:ai-stream-start", listener);
  },
  onAIStreamChunk: (cb) => {
    const listener = (_event, chunk) => cb(chunk);
    electron.ipcRenderer.on("app:ai-stream-chunk", listener);
    return () => electron.ipcRenderer.off("app:ai-stream-chunk", listener);
  },
  onAIStreamEnd: (cb) => {
    const listener = () => cb();
    electron.ipcRenderer.on("app:ai-stream-end", listener);
    return () => electron.ipcRenderer.off("app:ai-stream-end", listener);
  },
  onAIStreamError: (cb) => {
    const listener = (_event, errorText) => cb(errorText);
    electron.ipcRenderer.on("app:ai-stream-error", listener);
    return () => electron.ipcRenderer.off("app:ai-stream-error", listener);
  }
});
