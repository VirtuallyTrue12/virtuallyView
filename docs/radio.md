# Radio

Open **Radio** in the top bar. Pick a country (it starts with the one your browser says you are in), then a region if the country has them, and optionally a style (news, rock, jazz...) or a name. Press a station to play it. The heart keeps it under **Favorites**; **Recent** lists what you played lately.

- **It keeps playing** while you browse other pages. Starting a song stops the radio, and starting a station stops the music, so two sounds never overlap.
- **What is playing now** (artist, song and its album cover) shows when the station tells. Covers come from the free iTunes Search and Deezer lookups, fetched by your server.
- **Stations that do not play are hidden.** A slow background check (three stations at a time) plays a little of every listed station: a real piece of the stream, not just its playlist. A station that fails twice in a row is hidden for a day; **Show all** brings them back. Answers are kept in `radio-health.json` in the data folder.
- **Pause and rewind live radio** up to 30 minutes. While someone listens, the server keeps the station's last 30 minutes on disk (`radio-buffer` in the data folder) and the page plays from there. Everyone on the same station shares one copy. At most four stations are kept at once for the whole server (`RADIO_TIMESHIFT_MAX` changes it), up to about 100 MB each, and a station nobody has listened to for 5 minutes is stopped and deleted. If all are in use, the station simply plays live.
- **Record a show** for up to four hours to an `.m4a` file you can play or download later. Recordings belong to the person who made them (up to two at a time each, three for the server; not on Kids profiles) and are kept under `recordings/radio`. Recording needs 1 GB free.
- **Privacy:** audio is relayed by your server, so the station never learns your address and an `http://` station still plays on an `https://` page. Station lists come from the open [Radio Browser](https://www.radio-browser.info) directory, which needs no account. If you set an outbound proxy or Tor in Settings, the directory lookups use it; the audio itself is fetched directly.
- A station that is off the air says so instead of playing silence; try another.

Each person can have up to three stations open at once (for example on three devices).
