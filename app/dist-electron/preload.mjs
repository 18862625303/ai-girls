"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...rest) => listener(event, ...rest));
  },
  off(...args) {
    const [channel, ...rest] = args;
    return electron.ipcRenderer.off(channel, ...rest);
  },
  send(...args) {
    const [channel, ...rest] = args;
    return electron.ipcRenderer.send(channel, ...rest);
  },
  invoke(...args) {
    const [channel, ...rest] = args;
    return electron.ipcRenderer.invoke(channel, ...rest);
  }
});
electron.contextBridge.exposeInMainWorld("appAPI", {
  openFiles: () => electron.ipcRenderer.invoke("app:open-files"),
  readFileAsBase64: (filePath) => electron.ipcRenderer.invoke("app:read-file", filePath),
  readDocxAsHtml: (filePath) => electron.ipcRenderer.invoke("app:read-docx-html", filePath),
  askAI: (message) => electron.ipcRenderer.invoke("app:ask-ai", message),
  askAIStream: (message) => electron.ipcRenderer.send("app:ask-ai-stream", message),
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
