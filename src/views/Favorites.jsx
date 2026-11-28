import { useStore, openItem } from '../lib/store.js';
import { useNowNext } from '../lib/epg.js';
import { PosterCard, ChannelCard, Carousel } from '../components/Cards.jsx';

export function Favorites() {
  const favs = useStore((s) => s.favorites);
  const epg = useNowNext(favs.live);
  const total = favs.live.length + favs.movie.length + favs.series.length;
  return (
    <div className="home">
      <header className="page-head">
        <h1>Favourites</h1>
      </header>
      {!total && <p className="empty big">Hold OK (or press F) on any channel, film or series to add it here.</p>}
      <Carousel title="Channels" group="fav-live" count={favs.live.length}>
        {favs.live.map((c, i) => (
          <ChannelCard key={c.id} item={c} nowTitle={epg[c.epg]?.now?.title} onSelect={() => openItem(c, favs.live)} autoFocus={i === 0} />
        ))}
      </Carousel>
      <Carousel title="Movies" group="fav-movies" count={favs.movie.length}>
        {favs.movie.map((m, i) => (
          <PosterCard key={m.id} item={m} caption onSelect={() => openItem(m)} autoFocus={!favs.live.length && i === 0} />
        ))}
      </Carousel>
      <Carousel title="Series" group="fav-series" count={favs.series.length}>
        {favs.series.map((m, i) => (
          <PosterCard key={m.id} item={m} caption onSelect={() => openItem(m)} autoFocus={!favs.live.length && !favs.movie.length && i === 0} />
        ))}
      </Carousel>
    </div>
  );
}
