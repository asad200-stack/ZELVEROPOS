/**
 * Mailbox verification delivery.
 *
 * Telegram is the only outbound integration, and it notifies a store about POS events.
 * It is not a mailbox provider. There is no SMTP, Resend, SendGrid, or SES configuration.
 * Until one of those exists, public trial provisioning must not claim that a verification
 * message was sent.
 */
export function verificationEmailConfigured(): boolean {
  return false;
}
