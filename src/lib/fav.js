// What the F key (or a long OK press) favourites while something is playing.
/** The channel, the film, or — for an episode — its series ({ k: favourites list, item }). */
export function favTarget(it) {
  if (!it) return null;
  if (it.kind === 'live') return { k: 'live', item: it };
  if (it.kind === 'movie') return { k: 'movie', item: it };
  if (it.kind === 'episode' && it.seriesId) {
    return { k: 'series', item: { kind: 'series', id: it.seriesId, name: it.seriesName || it.name, icon: it.seriesIcon || '' } };
  }
  return null; // trailers and anything else
}
