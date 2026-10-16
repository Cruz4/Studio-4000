/** Tip link shown in the app and in the public project page. */
export const COFFEE_URL = "https://buymeacoffee.com/b4bdev";

/** AKAsheet, the social place linked from the top bar. */
export const AKASHEET_URL = "https://akasheet.com/?ref=studio4000";

export const AKASHEET_TIP = "AKAsheet.\nArtists share and sell their music here.\nThey can discover other artists and connect.\nA smart notebook with AI tools is there too.";

/** Inbox for bugs and ideas. Opens the person's own mail app. */
export const SUPPORT_EMAIL = "akasheet.support@gmail.com";

export function supportMailto(version?: string) {
  const subject = "Studio 4000 — bug or idea";
  const body = `What happened, or the idea:\n\n\n---\nStudio 4000 ${version ?? ""}\nWindows`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
