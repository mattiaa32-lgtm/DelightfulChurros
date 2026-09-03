// Suggesting a category for a newly synced record.
//
// Discogs returns genres and styles for every release ("Rock" + "Krautrock,
// Experimental"), which is real data rather than a guess. This maps that
// onto whichever categories the user actually keeps, so the suggestion is
// always one of their own names — the app never invents a category.
//
// Styles are checked before genres because they are far more specific:
// "Rock" alone could be half the collection, but "Krautrock" is decisive.
// Within styles, the first rule to match wins, so the list is ordered
// from most to least specific.
//
// A suggestion is only ever a starting point: the sync leaves the cube
// blank, which is what marks a record as still needing review.

const RULES = [
  // style keyword(s)                            → which category to look for
  [/\b(hip hop|rap|trip hop|turntabl|boom bap)\b/i,        /hip.?hop|rap/i],
  [/\b(reggae|dub|ska|rocksteady|roots)\b/i,               /reggae|dub|ska/i],
  [/\b(death metal|black metal|doom|sludge|thrash|heavy metal|stoner|hardcore|grindcore|metalcore)\b/i,
                                                            /metal|heavy/i],
  [/\b(krautrock|prog|psychedelic|space rock|canterbury|acid rock)\b/i,
                                                            /prog|psychedel/i],
  [/\b(jazz.?funk|fusion|afrobeat|latin|samba|bossa|highlife|ethio|world|african|brazilian)\b/i,
                                                            /fusion|jazz.?funk|global|world|latin/i],
  [/\b(free jazz|hard bop|bebop|post bop|modal|swing|big band|cool jazz|spiritual jazz|jazz)\b/i,
                                                            /\bjazz\b/i],
  [/\b(funk|soul|r&b|rhythm and blues|disco|motown|gospel|boogie)\b/i,
                                                            /funk|soul|r&b/i],
  [/\b(ambient|techno|house|idm|electro|downtempo|drum ?n ?bass|jungle|synth.?pop|new age|experimental electronic|dub techno|minimal)\b/i,
                                                            /electronic|ambient/i],
  [/\b(post.?punk|indie rock|shoegaze|new wave|noise rock|alternative rock|grunge|emo|math rock)\b/i,
                                                            /indie|post.?punk|alternat/i],
  [/\b(folk rock|singer.?songwriter|soft rock|country|americana|pop rock|synthpop|ballad)\b/i,
                                                            /pop|soft rock|singer/i],
  [/\b(blues rock|hard rock|classic rock|southern rock|rock ?& ?roll|rockabilly|blues|arena rock|glam)\b/i,
                                                            /classic rock|hard rock|blues/i],
  // broad genres last: only reached when nothing specific matched
  [/\b(electronic)\b/i,                                     /electronic|ambient/i],
  [/\b(funk ?\/ ?soul)\b/i,                                 /funk|soul/i],
  [/\b(rock)\b/i,                                           /classic rock|hard rock|blues/i],
  [/\b(pop)\b/i,                                            /pop|soft rock|singer/i]
];

/**
 * @param {string[]} genres   Discogs genres + styles for the release
 * @param {string[]} categories  the user's own category names
 * @param {string} artist
 * @returns {string} one of `categories`, or "" if nothing matched
 */
export function suggestCategory(genres, categories, artist) {
  if (!categories || !categories.length) return "";

  /* An artist who has their own category outranks any genre rule —
     someone who keeps a Pink Floyd shelf wants Pink Floyd records on it,
     not filed under prog. */
  const a = String(artist || "").toLowerCase().trim();
  if (a) {
    for (const c of categories) {
      const cl = c.toLowerCase();
      if (cl === a || (a.length > 3 && cl.indexOf(a) > -1 && cl.length < a.length + 6)) {
        return c;
      }
    }
  }

  const hay = (genres || []).join(" ");
  if (!hay.trim()) return "";

  for (const [needle, want] of RULES) {
    if (!needle.test(hay)) continue;
    const hits = categories.filter((c) => want.test(c));
    if (!hits.length) continue;
    /* Several categories can match one pattern \u2014 "jazz" appears in both
       "Jazz" and "Fusion, jazz-funk & global groove". Prefer the most
       specific: an exact word match first, then the shortest name, since
       a compound category is by definition the broader bucket. */
    hits.sort((x, y) => {
      const ex = (s2) => new RegExp("^" + s2.split(/[,&]/)[0].trim() + "$", "i");
      const xExact = ex(x).test(x.split(/[,&]/)[0].trim()) && x.split(/[,&]/).length === 1;
      const yExact = ex(y).test(y.split(/[,&]/)[0].trim()) && y.split(/[,&]/).length === 1;
      if (xExact !== yExact) return xExact ? -1 : 1;
      return x.length - y.length;
    });
    return hits[0];
  }
  return "";
}
