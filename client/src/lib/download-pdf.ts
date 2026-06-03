export async function downloadFile(
  url: string,
  fallbackFilename: string,
  defaultErrorMessage = "Failed to generate file. Please try again.",
): Promise<void> {
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
