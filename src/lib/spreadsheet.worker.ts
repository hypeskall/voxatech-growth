import { parseSpreadsheet } from "./lead-spreadsheet";

self.onmessage = async (
  event: MessageEvent<{ bytes: ArrayBuffer; filename: string }>,
) => {
  try {
    self.postMessage({
      data: await parseSpreadsheet(event.data.bytes, event.data.filename),
    });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Nu am putut citi fișierul.",
    });
  }
};
