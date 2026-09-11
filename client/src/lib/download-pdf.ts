type DownloadedFile = {
  blob: Blob;
  filename: string;
};

async function fetchFile(
  url: string,
  fallbackFilename: string,
  defaultErrorMessage = "Failed to generate file. Please try again.",
): Promise<DownloadedFile> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    let message = defaultErrorMessage;
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch {
      // response was not JSON; keep default message
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || fallbackFilename;

  return { blob, filename };
}

export async function downloadFile(
  url: string,
  fallbackFilename: string,
  defaultErrorMessage = "Failed to generate file. Please try again.",
): Promise<void> {
  const { blob, filename } = await fetchFile(url, fallbackFilename, defaultErrorMessage);
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export async function downloadPdf(url: string, fallbackFilename: string): Promise<void> {
  return downloadFile(url, fallbackFilename, "Failed to generate PDF. Please try again.");
}

/**
 * Opens a PDF in a new browser tab without writing binary PDF bytes into an
 * HTML document. The tab is opened before the request starts so browsers do
 * not treat it as an unsolicited popup.
 *
 * Returns false when the browser blocked the popup. Request and PDF errors
 * are thrown using the same response parsing as downloadPdf.
 */
export async function previewPdf(
  url: string,
  fallbackFilename: string,
): Promise<boolean> {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) return false;

  previewWindow.document.title = "Generating PDF…";

  try {
    const { blob } = await fetchFile(
      url,
      fallbackFilename,
      "Failed to generate PDF. Please try again.",
    );
    const objectUrl = window.URL.createObjectURL(blob);
    previewWindow.location.href = objectUrl;
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}
