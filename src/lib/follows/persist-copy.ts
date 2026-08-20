export function followPersistLine(displayName: string): string {
  return `Watching ${displayName}. Get a weekly note when they post.`;
}

export function followPersistCta(): string {
  return "Email me when they post";
}

export function followPersistValueLine(displayName: string): string {
  return `Create a free account — we'll email you when ${displayName} posts.`;
}

export function followEmailPrompt(displayName: string): string {
  return `Get an email when ${displayName} posts or closes roles. Nothing else.`;
}

export function followEmailSentLine(): string {
  return "Check your inbox — click the link to confirm.";
}

export function followEmailVerifiedLine(displayName: string): string {
  return `You're watching ${displayName}. We'll email you when something changes.`;
}
