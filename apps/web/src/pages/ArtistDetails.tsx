import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import { DownloadPanel } from '../components/media/DownloadPanel';
import { FavoriteButton } from '../components/media/UserFlagButtons';
import { TitleQuality } from '../components/media/TitleQuality';
import { UpgradeQuality } from '../components/media/UpgradeQuality';
import { YoutubeFinder } from '../components/media/YoutubeFinder';
import { ArtistVideos } from '../components/media/ArtistVideos';
import { CastRow, type Person } from '../components/media/CastRow';
import { useMusicPlayer } from '../components/media/MusicProvider';
import { Dialog } from '../components/ui/Dialog';
import { MenuItem, MenuDivider, MoreMenu } from '../components/ui/MoreMenu';
import { SvgIcon } from '../components/ui/SvgIcon';
import { artistMix } from '../lib/instant-mix';
import { api, type AlbumItem, type ApiError, type CoverCandidate, type MediaItem } from '../lib/api';

type DialogName = null | 'artwork' | 'quality' | 'upgrade' | 'youtube' | 'remove';

const COVER_GROUPS: Array<{ kind: NonNullable<CoverCandidate['kind']>; label: string }> = [
  { kind: 'artist', label: 'Artist photos' }, { kind: 'logo', label: 'Logos' }, { kind: 'group', label: 'Band and group photos' },
  { kind: 'live', label: 'Live and press photos' }, { kind: 'banner', label: 'Banners and backgrounds' }
];

function Bio({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 260;
  return (
    <div className="ah-bio">
      <p className={open || !long ? '' : 'is-clamped'}>{text}</p>
      {long && <button type="button" className="mp-link" onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? 'Show less' : 'Read more'}</button>}
    </div>
  );
}

export default function ArtistDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playQueue } = useMusicPlayer();
  const [artist, setArtist] = useState<MediaItem | null>(null);
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [covers, setCovers] = useState<CoverCandidate[]>([]);
  const [chosenCover, setChosenCover] = useState<string | null>(null);
  const [members, setMembers] = useState<{ kind: string; people: Person[] } | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loadFailed, setLoadFailed] = useState<{ message: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [mixing, setMixing] = useState(false);
  const [videosKey, setVideosKey] = useState(0);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerNote, setPickerNote] = useState<string | null>(null);
  const [brokenCovers, setBrokenCovers] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);

  useEffect(() => { api.authStatus().then(st => setIsAdmin(st.user?.role === 'admin')).catch(() => {}); }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setMissing(false); setArtist(null); setAlbums([]); setMembers(null); setNote(null); setDialog(null);
    api.artist(id)
      .then(a => { if (!cancelled) setArtist(a || null); })
      .catch(err => {
        if (cancelled) return;
        if ((err as ApiError).status === 404) setMissing(true);
        else setLoadFailed({ message: err instanceof Error ? err.message : 'Could not load this artist.' });
      });
    api.artistAlbums(id).then(({ albums }) => { if (!cancelled) setAlbums(albums); }).catch(() => {});
    api.artistCovers(id).then(r => { if (!cancelled) { setCovers(r.candidates); setChosenCover(r.chosen); } }).catch(() => {});
    setMembersLoading(true);
    api.artistMembers(id)
      .then(r => { if (!cancelled) setMembers({ kind: r.kind, people: r.members }); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const openArtwork = () => {
    setDialog('artwork');
    // First time here: look for logos, portraits and group photos without being asked twice.
    if (!covers.some(c => c.source !== 'lidarr')) void findMoreCovers();
  };

  const findMoreCovers = useCallback(async () => {
    if (!id) return;
    setPickerBusy(true); setPickerNote(null);
    try {
      const r = await api.moreArtistCovers(id);
      setCovers(r.candidates);
      setPickerNote(r.added > 0 ? `Found ${r.added} more.` : 'Nothing new was found for this artist.');
    } catch (err) {
      setPickerNote(err instanceof Error ? err.message : 'Could not look for more artwork.');
    } finally {
      setPickerBusy(false);
    }
  }, [id]);

  const chooseCover = async (url: string) => {
    if (!id) return;
    setPickerBusy(true);
    try {
      const result = await api.chooseArtistCover(id, url);
      setChosenCover(result.chosen);
      setArtist(prev => prev ? { ...prev, artwork: { ...prev.artwork, poster: covers.find(c => c.url === url)?.preview ?? result.chosen } } : prev);
      setDialog(null);
    } catch (err) {
      setPickerNote((err as Error).message);
    } finally {
      setPickerBusy(false);
    }
  };

  const startMix = async () => {
    if (!artist) return;
    setMixing(true); setNote(null);
    try {
      const queue = await artistMix(artist);
      if (queue.length === 0) setNote({ tone: 'err', text: 'No playable tracks for this artist yet.' });
      else playQueue(queue, 0);
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setMixing(false);
    }
  };

  const searchMissing = async () => {
    if (!artist) return;
    setNote({ tone: 'ok', text: 'Searching for missing albums…' });
    try {
      const r = await api.searchArtist(artist.id);
      setNote({ tone: r.success ? 'ok' : 'err', text: r.message });
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    }
  };

  const remove = async (deleteFiles: boolean) => {
    if (!artist) return;
    setRemoving(true);
    try {
      await api.deleteArtist(artist.id, deleteFiles);
      navigate('/music');
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
      setDialog(null);
      setRemoving(false);
    }
  };

  const isLidarr = !!artist && /^lidarr-/.test(artist.id);
  const canPlay = isLidarr && (artist!.trackFileCount ?? 0) > 0;
  const cover = artist?.artwork?.poster;

  return (
    <main className="page artist-page">
      <BackButton to="/music" label="Music" />

      {missing && <div className="empty-state">This artist is not in your Music service library. It may have been removed.</div>}
      {loadFailed && <div className="error-state" role="alert">{loadFailed.message}</div>}
      {!artist && !missing && !loadFailed && <div className="loading-state">Loading artist...</div>}

      {artist && (
        <>
          <header className="ah">
            <div className="ah-cover">
              {cover ? <img src={cover} alt={`${artist.title}`} /> : <span aria-hidden="true">{artist.title[0]}</span>}
            </div>
            <div className="ah-body">
              <h1 className="ah-title">{artist.title}</h1>
              {artist.genres?.length ? <ul className="ah-chips" aria-label="Genres">{artist.genres.slice(0, 4).map(g => <li key={g}>{g}</li>)}</ul> : null}
              {artist.overview && <Bio text={artist.overview} />}

              <p className="ah-stats">
                <span>{artist.albumCount ?? albums.length} albums</span>
                <span>{(artist.trackFileCount ?? 0)}{artist.totalTrackCount ? ` of ${artist.totalTrackCount}` : ''} tracks</span>
                {artist.sizeOnDisk ? <span>{(artist.sizeOnDisk / 1024 ** 3).toFixed(1)} GB</span> : null}
              </p>

              {isLidarr && <DownloadPanel mediaId={artist.id} />}

              <div className="ah-actions">
                {canPlay && (
                  <button type="button" className="btn btn-primary ah-play" onClick={() => void startMix()} disabled={mixing}>
                    <SvgIcon name="play" size={18} /> {mixing ? 'Building mix…' : 'Play mix'}
                  </button>
                )}
                <FavoriteButton mediaType="artist" mediaId={artist.id} initial={artist.favorite} />
                <MoreMenu label="More for this artist">
                  {isLidarr && isAdmin && <MenuItem icon="search" label="Search for missing albums" onSelect={() => void searchMissing()} />}
                  <MenuItem icon="image" label="Change artwork" hint="Photos, logos, group shots" onSelect={openArtwork} />
                  {isLidarr && isAdmin && <MenuItem icon="youtube" label="Find concerts on YouTube" onSelect={() => setDialog('youtube')} />}
                  {isLidarr && isAdmin && canPlay && <MenuItem icon="sparkle" label="Upgrade quality" hint="Look for lossless copies" onSelect={() => setDialog('upgrade')} />}
                  {isLidarr && isAdmin && <MenuItem icon="sliders-h" label="Download quality" onSelect={() => setDialog('quality')} />}
                  {isLidarr && isAdmin && <><MenuDivider /><MenuItem icon="trash" label="Remove artist" danger onSelect={() => setDialog('remove')} /></>}
                </MoreMenu>
              </div>
              {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
            </div>
          </header>

          {members?.kind === 'band' && <CastRow title="Band members" people={members.people} loading={membersLoading} />}
          {membersLoading && !members && <CastRow title="Band members" people={[]} loading />}

          <section className="album-section" aria-label="Albums">
            <div className="rail-head">
              <h2 className="rail-title">Albums</h2>
              {albums.length > 0 && <span className="page-count">{albums.length} albums</span>}
            </div>
            {albums.length === 0 ? (
              <div className="empty-state">No albums for this artist yet.</div>
            ) : (
              <div className="album-grid">
                {albums.map(album => (
                  <Link key={album.id} className="album-card" to={`/albums/${album.id}`}>
                    <div className="album-card-cover">
                      {album.artwork?.cover
                        ? <img src={album.artwork.cover} alt={`${album.title} cover`} loading="lazy" />
                        : <div className="album-card-placeholder">{artist.title[0]}</div>}
                    </div>
                    <span className="album-card-title">{album.title}</span>
                    <span className="album-card-sub">{album.releaseDate ? album.releaseDate.slice(0, 4) : ''}{album.albumType ? ` · ${album.albumType}` : ''}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {isLidarr && <ArtistVideos artistId={artist.id} artistName={artist.title} refreshKey={videosKey} />}

          <Dialog open={dialog === 'artwork'} onClose={() => setDialog(null)} title="Artwork" wide>
            <div className="art-dialog-head">
              <p className="dlg-help">Pictures of {artist.title}: logos, portraits, band and live photos. Album covers come with the music.</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void findMoreCovers()} disabled={pickerBusy}>{pickerBusy ? 'Looking…' : 'Find more'}</button>
            </div>
            {pickerNote && <p className="dlg-help" role="status">{pickerNote}</p>}
            {(() => {
              const usable = covers.filter(c => c.kind !== 'album' && !brokenCovers.has(c.url));
              if (usable.length === 0) return <p className="dlg-help">{pickerBusy ? 'Looking for artwork…' : 'No artwork was found yet. Try "Find more" (the server needs internet access).'}</p>;
              return COVER_GROUPS.map(({ kind, label }) => {
                const group = usable.filter(c => (c.kind ?? 'artist') === kind);
                if (group.length === 0) return null;
                return (
                  <div key={kind}>
                    <h3 className="cover-picker-group">{label}</h3>
                    <div className={`cover-grid cover-grid--${kind}`}>
                      {group.map(c => (
                        <button key={c.url} type="button" className={`cover-tile${chosenCover === c.url ? ' is-chosen' : ''}`} onClick={() => void chooseCover(c.url)} disabled={pickerBusy}
                          aria-label={`Use ${c.label ?? label}`}>
                          <img src={c.preview ?? c.url} alt="" loading="lazy" onError={() => setBrokenCovers(prev => new Set(prev).add(c.url))} />
                          <span>{c.label ?? c.source}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </Dialog>

          <Dialog open={dialog === 'quality'} onClose={() => setDialog(null)} title="Download quality">
            <TitleQuality mediaType="artist" id={artist.id} bare />
          </Dialog>

          <Dialog open={dialog === 'upgrade'} onClose={() => setDialog(null)} title="Upgrade quality">
            <UpgradeQuality artistId={artist.id} />
          </Dialog>

          <Dialog open={dialog === 'youtube'} onClose={() => setDialog(null)} title={`Concerts and videos: ${artist.title}`} wide>
            <YoutubeFinder initialQuery={`${artist.title} live concert`} fixedArtist={artist.title} onDownloaded={() => setVideosKey(k => k + 1)} />
          </Dialog>

          <Dialog open={dialog === 'remove'} onClose={() => !removing && setDialog(null)} title="Remove artist">
            <p className="dlg-help">Remove {artist.title} from your library? You can keep the music files on disk or delete them.</p>
            <div className="dlg-actions">
              <button type="button" className="btn btn-danger" disabled={removing} onClick={() => void remove(false)}>Remove, keep files</button>
              <button type="button" className="btn btn-danger" disabled={removing} onClick={() => void remove(true)}>Remove and delete files</button>
              <button type="button" className="btn btn-secondary" disabled={removing} onClick={() => setDialog(null)}>Cancel</button>
            </div>
          </Dialog>
        </>
      )}
    </main>
  );
}
