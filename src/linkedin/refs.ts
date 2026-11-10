/** Post identifiers LinkedIn uses: share and ugcPost URNs are editable/deletable; activity URNs come from feed links. */
export type PostUrnKind = "share" | "ugcPost" | "activity";

export interface PostRef {
  urn: string;
  kind: PostUrnKind;
}

const URN = /urn:li:(share|ugcPost|activity):(\d+)/;
const SLUG_ACTIVITY = /-(?:activity|share|ugcPost)-(\d{10,})-/;

/**
 * Accepts a post URN or a LinkedIn post URL and returns its URN.
 * Handles `/feed/update/urn:li:activity:…/`, URL-encoded URNs, and `/posts/name_slug-activity-123-abc/` links.
 */
export function parsePostRef(input: string): PostRef {
  const value = input.trim();
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // keep the raw value
  }
  const urn = decoded.match(URN);
  if (urn) return { urn: `urn:li:${urn[1]}:${urn[2]}`, kind: urn[1] as PostUrnKind };
  const slug = decoded.match(SLUG_ACTIVITY);
  if (slug && /linkedin\.com\/posts\//.test(decoded)) {
    const kind = (decoded.match(/-(activity|share|ugcPost)-\d/)?.[1] ?? "activity") as PostUrnKind;
    return { urn: `urn:li:${kind}:${slug[1]}`, kind };
  }
  throw new Error(`Could not find a post id in "${input}". Pass a URN like urn:li:share:123 or a linkedin.com post link.`);
}

/** Edit and delete only work on share/ugcPost URNs (the ones our create tools return). */
export function requireEditablePost(input: string): string {
  const ref = parsePostRef(input);
  if (ref.kind === "activity") {
    throw new Error(
      `${ref.urn} is a feed activity id. Edit/delete need the post URN returned when it was created (urn:li:share:… or urn:li:ugcPost:…).`,
    );
  }
  return ref.urn;
}
