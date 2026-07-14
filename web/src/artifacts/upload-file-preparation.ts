import { zip } from "fflate";

const HTML_EXTENSION = /\.html?$/i;
const SUPPORTED_EXTENSION = /\.(?:zip|html?)$/i;

export function artifactNameFromFile(fileName: string): string {
  return fileName.replace(SUPPORTED_EXTENSION, "").trim().slice(0, 120);
}

export function isHtmlUpload(fileName: string): boolean {
  return HTML_EXTENSION.test(fileName);
}

export function isSupportedArtifactUpload(fileName: string): boolean {
  return SUPPORTED_EXTENSION.test(fileName);
}

export async function prepareArtifactUpload(file: File): Promise<File> {
  if (!isHtmlUpload(file.name)) return file;

  const bytes = new Uint8Array(await readFile(file));
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip({ "index.html": bytes }, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });

  const uploadBytes = new Uint8Array(archive.byteLength);
  uploadBytes.set(archive);
  return new File([uploadBytes], `${artifactNameFromFile(file.name)}.zip`, { type: "application/zip" });
}

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
