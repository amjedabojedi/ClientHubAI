export interface EmailRecipient {
  address: string | { email: string; name?: string };
}

export interface EmailTransmission {
  options?: {
    sandbox?: boolean;
  };
  recipients: EmailRecipient[];
  content: {
    from: string;
    subject: string;
    html?: string;
    text?: string;
    attachments?: Array<{
      name: string;
      type: string;
      data: string;
    }>;
  };
}

export interface EmailTransmissionResult {
  results?: {
    id?: string;
    total_accepted_recipients?: number;
    total_rejected_recipients?: number;
  };
}

type EmailTransport = (
  transmission: EmailTransmission,
) => Promise<EmailTransmissionResult>;

let testTransport: EmailTransport | undefined;

/**
 * Compatibility test double for the prior provider's post-level stubs.
 * It is never constructed or called in production unless a test replaces
 * `post` on its prototype.
 */
export class EmailTransportTestDouble {
  async post(_request: { json: EmailTransmission }): Promise<EmailTransmissionResult> {
    throw new Error("EmailTransportTestDouble.post must be stubbed by a test");
  }
}

const defaultTestDoublePost = EmailTransportTestDouble.prototype.post;

/**
 * Allows the DB-backed notification tests to intercept delivery without
 * configuring a real provider. Production code never calls this.
 */
export function setEmailTransportForTests(transport?: EmailTransport): void {
  testTransport = transport;
}

/**
 * Sends a SparkPost transmission using Node's built-in HTTP client.
 *
 * Keeping this small adapter in-project removes the unmaintained SDK and its
 * deprecated request dependency without changing provider configuration or the
 * payload accepted by existing email call sites.
 */
export async function sendSparkPostTransmission(
  transmission: EmailTransmission,
): Promise<EmailTransmissionResult> {
  if (testTransport) {
    return testTransport(transmission);
  }
  if (EmailTransportTestDouble.prototype.post !== defaultTestDoublePost) {
    return EmailTransportTestDouble.prototype.post({ json: transmission });
  }

  const apiKey = process.env.SPARKPOST_API_KEY;
  if (!apiKey) {
    throw new Error("SPARKPOST_API_KEY not configured");
  }

  const response = await fetch("https://api.sparkpost.com/api/v1/transmissions", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(transmission),
  });

  const body = await response.text();
  let payload: EmailTransmissionResult | { errors?: Array<{ message?: string }> } = {};
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`SparkPost returned an invalid response (${response.status})`);
    }
  }

  if (!response.ok) {
    const message =
      "errors" in payload
        ? payload.errors?.map((error) => error.message).filter(Boolean).join("; ")
        : undefined;
    throw new Error(message || `SparkPost transmission failed (${response.status})`);
  }

  return payload as EmailTransmissionResult;
}